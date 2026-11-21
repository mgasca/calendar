//! What the app asks the API for, and when: on navigation, on "Try again", every five minutes, and when the date
//! changes at the user's midnight (the request names the day, so a new day is a new request).

use crate::App;
use crate::fetch::Remote;
use crate::route::Route;
use crate::session::{self, Session};
use crate::views::tasks::TaskList;
use chrono::{DateTime, NaiveDate, Utc};

/// How long loaded data stays fresh before it is fetched again (the web app's `refetchInterval`).
pub const REFRESH_SECONDS: i64 = 300;

/// What the data on screen was loaded for; a different key means a new request.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Key {
  #[default]
  None,
  Day(NaiveDate),
  Week(NaiveDate, NaiveDate),
  Tasks(&'static str, NaiveDate),
}

/// Bookkeeping for the current page's data.
#[derive(Clone, Debug, Default)]
pub struct Loads {
  pub key: Key,
  pub at: Option<DateTime<Utc>>,
  pub session_checked: bool,
}

/// Goes to `route` and loads what it shows.
pub fn go(app: &mut App, route: Route) {
  app.route = route;
  ensure(app);
}

/// "Try again": fetches the current page again.
pub fn reload(app: &mut App) {
  refetch(app);
}

/// The key of what the current route shows today.
fn key_for(app: &App) -> Key {
  let today = app.clock.today();
  match app.route {
    Route::Today | Route::Day(_) => Key::Day(app.route.day_date(today).unwrap_or(today)),
    Route::Week(start) => Key::Week(start, today),
    Route::Tasks(view) => Key::Tasks(view.api(), today),
    // Triage lists what My tasks' Overdue view lists: the same request and data.
    Route::Triage => Key::Tasks("overdue", today),
  }
}

/// Starts the session check, then the current page's load when its key changed or its data went stale.
pub fn ensure(app: &mut App) {
  if app.offline {
    return;
  }
  if matches!(app.session, Session::Checking) {
    if !app.loads.session_checked {
      app.loads.session_checked = true;
      let api = app.api.clone();
      app.effects.run(async move { api.me().await }, |app, result| {
        app.session = match result {
          Ok(user) => Session::SignedIn(user),
          Err(error) if error.is_unauthorized() => Session::SignedOut { error: None },
          Err(_) => Session::SignedOut {
            error: Some("Unable to check your session.".to_owned()),
          },
        };
        ensure(app);
      });
    }
    return;
  }
  if !matches!(app.session, Session::SignedIn(_)) {
    return;
  }
  let key = key_for(app);
  let stale = app
    .loads
    .at
    .is_none_or(|at| (app.clock.now() - at).num_seconds() >= REFRESH_SECONDS);
  if key == app.loads.key && !stale {
    return;
  }
  if key != app.loads.key {
    // A different page or day: its data is not the last page's.
    match key {
      Key::Day(_) => app.day = keep_if(&app.day, matches!(app.loads.key, Key::Day(_))),
      Key::Week(..) => app.week = keep_if(&app.week, matches!(app.loads.key, Key::Week(..))),
      Key::Tasks(..) | Key::None => app.tasks = Remote::default(),
    }
  }
  app.loads.key = key.clone();
  app.loads.at = Some(app.clock.now());
  let api = app.api.clone();
  let day = app.clock.day();
  match key {
    Key::Day(date) => {
      app.day.start();
      app
        .effects
        .run(async move { api.day_agenda(date, &day).await }, move |app, result| {
          if app.loads.key == Key::Day(date) {
            app.day.finish(result);
          }
        });
    }
    Key::Week(start, today) => {
      app.week.start();
      app
        .effects
        .run(async move { api.week_agenda(start, &day).await }, move |app, result| {
          if app.loads.key == Key::Week(start, today) {
            app.week.finish(result);
          }
        });
    }
    Key::Tasks(view, today) => {
      app.tasks.start();
      app
        .effects
        .run(async move { api.tasks(view, &day, None, None).await }, move |app, result| {
          if app.loads.key == Key::Tasks(view, today) {
            app.tasks.finish(result.map(|page| TaskList {
              total: page.total.flatten().map(|t| calendar_client::as_count(&t)),
              items: page.items,
              next_cursor: page.next_cursor.flatten(),
            }));
          }
        });
    }
    Key::None => {}
  }
}

/// The last data stays on screen while a neighbouring day or week loads (the web app's `keepPreviousData`).
fn keep_if<T: Clone>(remote: &Remote<T>, same_kind: bool) -> Remote<T> {
  if same_kind {
    Remote {
      data: remote.data.clone(),
      loading: false,
      error: None,
    }
  } else {
    Remote::default()
  }
}

/// "Load more": the next page of the current task view.
pub fn more_tasks(app: &mut App) {
  let (Key::Tasks(view, today), Some(cursor)) = (app.loads.key.clone(), app.tasks.data.as_ref().and_then(|l| l.next_cursor.clone())) else {
    return;
  };
  if app.tasks.loading {
    return;
  }
  app.tasks.start();
  let api = app.api.clone();
  let day = app.clock.day();
  app.effects.run(
    async move { api.tasks(view, &day, None, Some(&cursor)).await },
    move |app, result| {
      if app.loads.key != Key::Tasks(view, today) {
        return;
      }
      app.tasks.loading = false;
      match result {
        Ok(page) => {
          if let Some(list) = &mut app.tasks.data {
            list.items.extend(page.items);
            list.next_cursor = page.next_cursor.flatten();
          }
          app.tasks.error = None;
        }
        Err(error) => app.tasks.error = Some(error),
      }
    },
  );
}

/// The API's 401 hook: the session is over (#1008 owns what happens next).
pub fn unauthorized(app: &mut App) {
  session::on_unauthorized(app);
}

/// After a change: fetches the current page again and marks the other pages' data stale (the web app invalidates
/// its `agenda` and `tasks` queries).
pub fn refetch(app: &mut App) {
  // Stale, not forgotten: the data stays on screen ("Updating…") while it is fetched again.
  app.loads.at = None;
  ensure(app);
}

/// Enter in the Day page's "Go to date" field: opens that day when the field holds a date the app accepts.
pub fn go_to_date(app: &mut App) {
  if let Some(date) = crate::format::parse_iso_date(app.go_to_date.text.trim()) {
    app.go_to_date.clear();
    go(app, Route::Day(date));
  }
}
