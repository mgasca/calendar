//! Calendar's second UI, built with Rune (ADR-0067).
//!
//! The app is one piece of state ([`App`]) and a view of it ([`view`]). The same code runs as a desktop window
//! (`src/main.rs`), as WASM in the browser ([`start`]), and headless in tests, where Rune renders element trees and
//! PNGs with no display. API calls run through [`fetch::Effects`] and land in the state before the next frame.

#![forbid(unsafe_code)]

pub mod actions;
pub mod bulk;
pub mod clock;
pub mod dialogs;
pub mod fetch;
pub mod fixtures;
pub mod format;
pub mod forms;
pub mod load;
pub mod locale;
pub mod pickers;
pub mod route;
pub mod session;
pub mod theme;
pub mod triage;
pub mod views;

use calendar_client::Api;
use calendar_client::generated::{DayAgendaResponse, WeekAgendaResponse};
use clock::Clock;
use fetch::{Effects, Remote};
use route::{Route, TaskView};
use rune::tok::type_;
use rune::{AppSpec, Cx, El, ScrollSpec, col, el, row, text};
use session::Session;
use views::tasks::TaskList;

/// The shell's navigation, as the web app's "Main" nav.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Nav {
  Today,
  Week,
  Tasks,
}

impl Nav {
  pub const ALL: [Nav; 3] = [Nav::Today, Nav::Week, Nav::Tasks];

  #[must_use]
  pub fn label(self) -> &'static str {
    match self {
      Nav::Today => "Today",
      Nav::Week => "Week",
      Nav::Tasks => "My tasks",
    }
  }

  #[must_use]
  pub fn key(self) -> &'static str {
    match self {
      Nav::Today => "nav-today",
      Nav::Week => "nav-week",
      Nav::Tasks => "nav-tasks",
    }
  }

  /// Whether the route is this item's page (the web app marks it `aria-current="page"`; `/` matches exactly).
  #[must_use]
  pub fn is_current(self, route: Route) -> bool {
    matches!(
      (self, route),
      (Nav::Today, Route::Today) | (Nav::Week, Route::Week(_)) | (Nav::Tasks, Route::Tasks(_))
    )
  }

  fn target(self, app: &App) -> Route {
    match self {
      Nav::Today => Route::Today,
      Nav::Week => Route::week_of(app.clock.today()),
      Nav::Tasks => Route::Tasks(TaskView::default()),
    }
  }
}

/// The app's whole state.
pub struct App {
  pub route: Route,
  /// Owned by #1008 (S3): the signed-in session.
  pub session: Session,
  pub api: Api,
  pub effects: Effects,
  pub clock: Clock,
  /// How dates and times read: the user's locale (#1032), `en-GB` in scenes and tests, as the web tests pin it.
  pub locale: locale::Locale,
  /// No API calls at all: named scenes and view tests set the data themselves.
  pub offline: bool,
  pub loads: load::Loads,
  pub day: Remote<DayAgendaResponse>,
  pub week: Remote<WeekAgendaResponse>,
  pub tasks: Remote<TaskList>,
  /// Toggles in flight, the last toggle error and the delete confirmation (#1005).
  pub actions: actions::Actions,
  /// The add or edit dialog on screen (#1006).
  pub dialog: Option<dialogs::Dialog>,
  /// The month grid open under a date field (#1033).
  pub calendar: Option<pickers::Calendar>,
  /// The digits typed so far into a time spin button: its key and the digits (#1033).
  pub spin_typed: Option<(String, String)>,
  /// The message after a save or delete, with "Show day" when it went on another day.
  pub notice: Option<dialogs::Notice>,
  /// Triage's selection and its last result (#1007).
  pub triage: triage::Triage,
  /// Where a text field's edits go when its dialog has already closed.
  pub scratch: rune::TextEdit,
  /// The Day page's "Go to date" field.
  pub go_to_date: rune::TextEdit,
}

impl std::fmt::Debug for App {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("App")
      .field("route", &self.route)
      .field("session", &self.session)
      .finish_non_exhaustive()
  }
}

/// The API's origin: the page's own on the web; `CALENDAR_API_ORIGIN`, else the local API, on the desktop.
#[must_use]
pub fn api_origin() -> String {
  #[cfg(target_arch = "wasm32")]
  {
    web_sys::window().and_then(|w| w.location().origin().ok()).unwrap_or_default()
  }
  #[cfg(not(target_arch = "wasm32"))]
  {
    std::env::var("CALENDAR_API_ORIGIN").unwrap_or_else(|_| "http://localhost:5041".to_owned())
  }
}

impl App {
  /// An app talking to the API at `origin` through `effects`.
  #[must_use]
  pub fn new(origin: &str, clock: Clock, effects: Effects) -> Self {
    let poster = effects.poster();
    let api = Api::new(origin, session::http_client(origin)).on_unauthorized(move || poster.post(load::unauthorized));
    App {
      route: Route::Today,
      session: Session::Checking,
      api,
      effects,
      clock,
      locale: locale::Locale::system(),
      offline: false,
      loads: load::Loads::default(),
      day: Remote::default(),
      week: Remote::default(),
      tasks: Remote::default(),
      actions: actions::Actions::default(),
      dialog: None,
      calendar: None,
      spin_typed: None,
      notice: None,
      triage: triage::Triage::default(),
      scratch: rune::TextEdit::default(),
      go_to_date: rune::TextEdit::default(),
    }
  }

  /// A signed-in app with no API, its clock stopped at the fixtures' instant: for scenes and view tests.
  #[must_use]
  pub fn offline() -> Self {
    let mut app = App::new(
      "http://127.0.0.1:9",
      Clock::fixed(fixtures::ZONE, fixtures::now()),
      Effects::manual(),
    );
    app.offline = true;
    app.locale = fixtures::locale();
    app.session = Session::SignedIn(fixtures::user());
    app
  }
}

impl Default for App {
  fn default() -> Self {
    App::new(&api_origin(), Clock::system(), Effects::background())
  }
}

/// The window's content: the session's screens until signed in, then the shell and the current page.
pub fn view(app: &App, cx: &mut Cx<App>) -> El {
  match &app.session {
    Session::SignedIn(user) => shell(app, &user.name, cx),
    other => session::view(other, cx),
  }
}

fn shell(app: &App, user: &str, cx: &mut Cx<App>) -> El {
  let t = theme::tokens(cx.system_dark());
  let nav = Nav::ALL
    .into_iter()
    .fold(row().key("nav").role("navigation").label("Main").gap(4.0), |nav, item| {
      let current = item.is_current(app.route);
      nav.child(
        el()
          .key(item.key())
          .role("button")
          .label(item.label())
          // The current page reads as pressed, as `aria-current="page"` marks it in the web app.
          .checked(current)
          .focusable(true)
          .px(12.0)
          .py(6.0)
          .radius(6.0)
          .fill(if current { t.accent_soft } else { t.surface })
          .on_press(move |app: &mut App| {
            let route = item.target(app);
            load::go(app, route);
          })
          .child(text(item.label()).color(if current { t.text } else { t.text_muted })),
      )
    });
  let header = row()
    .key("header")
    .role("banner")
    .w_full()
    .items_center()
    .px(16.0)
    .py(12.0)
    .gap(16.0)
    .fill(t.surface)
    .child(text("Calendar").key("app-title").font(type_::TITLE).color(t.text))
    .child(nav)
    .child(el().grow(1.0))
    .child(text(user).key("user-name").font(type_::BODY).color(t.text_muted))
    .child(views::button("sign-out", "Sign out", &t).on_press(session::sign_out));
  let page = match app.route {
    Route::Today | Route::Day(_) => views::day::view(app, &t),
    Route::Week(start) => views::week::view(app, start, &t),
    Route::Tasks(view) => views::tasks::view(app, view, &t),
    Route::Triage => views::triage::view(app, &t),
  };
  let mut body = col()
    .key("page")
    .role("main")
    .w_full()
    .grow(1.0)
    .padding(16.0)
    .gap(12.0)
    .scroll(ScrollSpec { stick_bottom: false });
  if let Some(alert) = views::toggle_error(app, &t) {
    body = body.child(alert);
  }
  if let Some(notice) = views::dialogs::notice(app, &t) {
    body = body.child(notice);
  }
  let mut root = col().w_full().h_full().fill(t.bg).child(header).child(body.child(page));
  if let Some(dialog) = views::delete_dialog(app, &t) {
    root = root.child(dialog);
  }
  if let Some(form) = views::dialogs::view(app, &t) {
    root = root.child(form);
  }
  if let Some(dialog) = views::triage::dialog(app, &t) {
    root = root.child(dialog);
  }
  root
}

fn setup(app: &mut App, waker: rune::Waker) {
  app.effects.set_waker(waker);
  load::ensure(app);
}

/// Applies finished API calls, then refreshes stale data or a new day; checks the clock every 15 s (the web app's
/// `useToday`), so a page rolls over at the user's midnight.
fn poll(app: &mut App, _now: f64, tx: &mut rune::Tx) -> bool {
  let effects = app.effects.clone();
  let changed = effects.drain(app);
  dialogs::follow_start(app);
  dialogs::clear_edited_errors(app);
  load::ensure(app);
  tx.wake_after(std::time::Duration::from_secs(15));
  changed
}

/// A scene's starting state: offline, signed in, the fixtures' day loaded. Compute anything clock-dependent after
/// this call, from the offline clock, never from `app` before it: until then `app` is the harness's, on the system
/// clock (#1059).
fn scene(app: &mut App, route: Route) {
  // The whole offline app, its manual effects included: a press in a scene queues its request and never reaches
  // the network.
  *app = App::offline();
  app.route = route;
}

/// The window, its size and the named scenes headless runs render (`--scene week`).
#[must_use]
// A table of named scenes, one entry per state a golden needs.
#[allow(clippy::too_many_lines)]
pub fn spec() -> AppSpec<App> {
  AppSpec {
    setup: Some(setup),
    poll: Some(poll),
    scenes: &[
      ("today", |app| {
        scene(app, Route::Today);
        app.day.finish(Ok(fixtures::day()));
      }),
      ("today-empty", |app| {
        scene(app, Route::Today);
        app.day.finish(Ok(fixtures::empty_day()));
      }),
      ("today-loading", |app| {
        scene(app, Route::Today);
        app.day.start();
      }),
      ("today-error", |app| {
        scene(app, Route::Today);
        app.day.finish(Err(calendar_client::ApiError {
          status: Some(500),
          message: Some("The server had a problem.".to_owned()),
        }));
      }),
      ("week", |app| {
        // The week of the offline clock that `scene` installs: `app` is the harness's until then (#1059).
        scene(app, Route::Today);
        app.route = Route::week_of(app.clock.today());
        app.week.finish(Ok(fixtures::week()));
      }),
      ("tasks", |app| {
        scene(app, Route::Tasks(TaskView::Upcoming));
        app.tasks.finish(Ok(TaskList {
          items: fixtures::tasks().items,
          next_cursor: Some("page-2".to_owned()),
          total: None,
        }));
      }),
      ("signed-out", |app| {
        scene(app, Route::Today);
        app.session = Session::SignedOut { error: None };
      }),
      ("today-toggle-error", |app| {
        scene(app, Route::Today);
        app.day.finish(Ok(fixtures::day()));
        app.actions.toggle_error = Some("Couldn\u{2019}t update the task. Your change was undone.".to_owned());
      }),
      ("today-delete", |app| {
        scene(app, Route::Today);
        app.day.finish(Ok(fixtures::day()));
        let id = "00000000-0000-4000-8000-000000000003".parse().expect("a fixture id");
        actions::ask_delete(app, id, Some("Book flights"));
      }),
      ("add-event", |app| {
        scene(app, Route::Today);
        app.day.finish(Ok(fixtures::day()));
        let today = app.clock.today();
        dialogs::add_event(app, today);
      }),
      ("add-event-calendar", |app| {
        // The start date's month grid open (#1033).
        scene(app, Route::Today);
        app.day.finish(Ok(fixtures::day()));
        let today = app.clock.today();
        dialogs::add_event(app, today);
        app.calendar = Some(pickers::Calendar {
          field: views::dialogs::START_DATE,
          focus: today,
        });
      }),
      ("event-form-errors", |app| {
        scene(app, Route::Today);
        app.day.finish(Ok(fixtures::day()));
        let today = app.clock.today();
        dialogs::add_event(app, today);
        if let Some(d) = dialogs::event(app) {
          d.end_time.replace_text("08:00");
        }
        dialogs::save_event(app);
      }),
      ("edit-task", |app| {
        scene(app, Route::Tasks(TaskView::Upcoming));
        app.tasks.finish(Ok(TaskList {
          items: fixtures::tasks().items,
          next_cursor: None,
          total: None,
        }));
        let task = fixtures::tasks().items[2].clone();
        let draft = forms::task_draft(&task, app.clock.zone);
        dialogs::add_task(app, None);
        if let Some(d) = dialogs::task(app) {
          d.id = Some(task.id);
          d.title.replace_text(&draft.title);
          d.deadline = draft.deadline;
          d.due_date.replace_text(&draft.due_date);
          d.priority.clone_from(&draft.priority);
          d.notes.replace_text(&draft.notes);
        }
      }),
      ("triage", |app| {
        scene(app, Route::Triage);
        app.tasks.finish(Ok(TaskList {
          items: fixtures::overdue_tasks().items,
          next_cursor: Some("page-2".to_owned()),
          total: Some(42),
        }));
      }),
      ("triage-selected", |app| {
        scene(app, Route::Triage);
        app.tasks.finish(Ok(TaskList {
          items: fixtures::overdue_tasks().items,
          next_cursor: Some("page-2".to_owned()),
          total: Some(42),
        }));
        app.triage.selected = fixtures::overdue_tasks().items.iter().take(2).map(|t| t.id).collect();
        app.triage.notice = Some("3 tasks updated".to_owned());
      }),
    ],
    ..AppSpec::new("Calendar", (960.0, 720.0), App::default, view)
  }
}

/// The browser entry point; `just native build-web` builds it.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(start))]
pub fn start() {
  rune::run(spec());
}
