//! Focus after a dialog closes, and the notice's timer (#1035), as the web app's `ModalDialog` callers and
//! `components/Notification.tsx` manage them.
//!
//! - **After a dialog:** focus goes back to the control that opened it (Add event, Add task, an item's title). When
//!   that control is gone (the item was deleted, or moved off the view), it goes to the page's heading, which takes
//!   focus without being a Tab stop, as the web app's `tabindex="-1"`. A delete confirmation over a list restores
//!   nothing, as in the web app (#1040 tracks that for both apps).
//! - **The notice** stays [`NOTICE_SECONDS`], paused while the pointer is over it or focus is inside it, and starts
//!   the full time again after. It never takes focus; dismissing it with focus inside hands focus back to where it
//!   came from.

use crate::App;
use crate::route::Route;
use rune::Tx;

/// How long a notice stays: the web app's `NOTIFICATION_MS`.
pub const NOTICE_SECONDS: f64 = 6.0;

/// Where focus is going after a dialog closed: the opener, else the heading.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Returning {
  pub target: String,
  pub fallback: &'static str,
  /// Whether focus has been asked for yet (it is, on the first poll after the close).
  pub asked: bool,
}

/// The app's focus bookkeeping.
#[derive(Clone, Debug, Default)]
pub struct Focus {
  /// The control that opened the dialog on screen.
  pub opener: Option<String>,
  /// Set when a dialog closes, until focus has settled.
  pub returning: Option<Returning>,
  /// Where focus was before it went into the notice.
  pub before_notice: Option<String>,
  /// The last focused key outside the notice.
  last_outside: Option<String>,
}

/// The page's heading, where focus goes when the control that opened a dialog is gone.
#[must_use]
pub fn heading(route: Route) -> &'static str {
  match route {
    Route::Today | Route::Day(_) => "day-title",
    Route::Week(_) => "week-title",
    Route::Tasks(_) => "tasks-title",
    Route::Triage => "triage-heading",
  }
}

/// Records the control that opened a dialog: the one focused as its press or key arrived.
pub fn opened(app: &mut App, tx: &Tx) {
  app.focus.opener = tx.focused().map(str::to_owned);
}

/// A dialog closed: focus goes back to its opener, or to the heading after a delete (the web app's
/// `focusAfterEdit(result.deleted ? null : opener)`).
pub fn closed(app: &mut App, deleted: bool) {
  let fallback = heading(app.route);
  let opener = app.focus.opener.take();
  let target = if deleted { None } else { opener };
  app.focus.returning = Some(Returning {
    target: target.unwrap_or_else(|| fallback.to_owned()),
    fallback,
    asked: false,
  });
}

fn in_notice(key: &str) -> bool {
  key.starts_with("notice")
}

/// Run from `poll`: settles focus after a dialog closed, and runs the notice's timer. `now` is the window's clock.
pub fn poll(app: &mut App, now: f64, tx: &mut Tx) {
  let focused = tx.focused().map(str::to_owned);
  settle(app, focused.as_deref(), tx);
  notice(app, now, focused.as_deref(), tx);
  if let Some(key) = focused.filter(|k| !in_notice(k)) {
    app.focus.last_outside = Some(key);
  }
}

fn settle(app: &mut App, focused: Option<&str>, tx: &mut Tx) {
  if app.dialog.is_some() {
    // Another dialog opened before focus settled: it owns focus now.
    app.focus.returning = None;
    return;
  }
  let Some(returning) = &mut app.focus.returning else { return };
  if !returning.asked {
    returning.asked = true;
    tx.focus(returning.target.clone(), true);
    tx.wake_after(std::time::Duration::ZERO);
    return;
  }
  match focused {
    // Landed. It stays watched until the save's refetch has come back: an item moved off the view disappears then.
    Some(key) if key == returning.target => {
      if app.effects.pending() == 0 && !page_loading(app) {
        app.focus.returning = None;
      }
    }
    // The user has moved on.
    Some(_) => app.focus.returning = None,
    // The opener isn't shown (or stopped being): the heading takes focus.
    None => {
      tx.focus(returning.fallback, true);
      app.focus.returning = None;
    }
  }
}

fn page_loading(app: &App) -> bool {
  match app.route {
    Route::Today | Route::Day(_) => app.day.loading,
    Route::Week(_) => app.week.loading,
    Route::Tasks(_) | Route::Triage => app.tasks.loading,
  }
}

fn notice(app: &mut App, now: f64, focused: Option<&str>, tx: &mut Tx) {
  let Some(notice) = &mut app.notice else {
    app.focus.before_notice = None;
    return;
  };
  let focus_inside = focused.is_some_and(in_notice);
  if focus_inside && app.focus.before_notice.is_none() {
    app.focus.before_notice = app.focus.last_outside.clone();
  }
  if notice.hovered || focus_inside {
    // Paused: the full time starts again once the pointer and focus leave (WCAG 2.2.1).
    notice.due = None;
    return;
  }
  match notice.due {
    None => {
      let due = now + NOTICE_SECONDS;
      notice.due = Some(due);
      tx.wake_at(due);
    }
    Some(due) if now >= due => {
      app.notice = None;
      app.focus.before_notice = None;
    }
    Some(due) => tx.wake_at(due),
  }
}

/// "Dismiss notification", and "Show day" before it acts: the notice goes, and focus inside it goes back to where it
/// came from (or nowhere, when that is gone).
pub fn dismiss(app: &mut App, tx: &mut Tx) {
  app.notice = None;
  if tx.focused().is_some_and(in_notice)
    && let Some(key) = app.focus.before_notice.take()
  {
    tx.focus(key, true);
  }
  app.focus.before_notice = None;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn each_page_names_its_heading() {
    assert_eq!(heading(Route::Today), "day-title");
    assert_eq!(heading(Route::Week("2026-11-16".parse().unwrap())), "week-title");
    assert_eq!(heading(Route::Triage), "triage-heading");
  }
}
