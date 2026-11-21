//! Triage (`/triage`), as the web app's `features/triage/Triage.tsx`: tick overdue tasks, or all of them on the
//! server, and complete, reschedule, clear the deadline of or delete them in one go (`bulk.rs`).

use crate::bulk::{self, Action, Target};
use crate::forms::{self, Local, Occurrence};
use crate::route::Route;
use crate::{App, load};
use rune::TextEdit;
use uuid::Uuid;

/// The reschedule dialog: "Reschedule tasks" (a date) or "Reschedule exact time" (a date and a time).
#[derive(Clone, Debug, Default)]
pub struct Reschedule {
  pub exact: bool,
  pub date: TextEdit,
  pub time: TextEdit,
  pub occurrence: Occurrence,
}

/// The page's selection and what it is doing.
#[derive(Clone, Debug, Default)]
pub struct Triage {
  /// Ticked tasks, in the order ticked.
  pub selected: Vec<Uuid>,
  /// "Select all {total} overdue": every overdue task on the server, by filter.
  pub all: bool,
  /// A bulk request is running: every control is disabled.
  pub pending: bool,
  /// The last result (`role="status"`); it stays until the next one.
  pub notice: Option<String>,
  pub reschedule: Option<Reschedule>,
  pub confirm_delete: bool,
}

/// "View all {total} overdue": opens triage with nothing selected.
pub fn open(app: &mut App) {
  app.triage = Triage::default();
  load::go(app, Route::Triage);
}

/// How many are selected: the server's total in all-mode, else the ticked rows.
#[must_use]
pub fn count(app: &App) -> i64 {
  if app.triage.all {
    total(app)
  } else {
    crate::format::len(app.triage.selected.len())
  }
}

/// The overdue total the first page reported.
#[must_use]
pub fn total(app: &App) -> i64 {
  app.tasks.data.as_ref().and_then(|l| l.total).unwrap_or(0)
}

/// A row's checkbox.
pub fn toggle(app: &mut App, id: Uuid) {
  let t = &mut app.triage;
  if t.all || t.pending {
    return;
  }
  if let Some(at) = t.selected.iter().position(|s| *s == id) {
    t.selected.remove(at);
  } else {
    t.selected.push(id);
  }
}

/// "Select all loaded": ticks every loaded row, or clears them all when they already are.
pub fn toggle_loaded(app: &mut App) {
  if app.triage.pending {
    return;
  }
  let loaded: Vec<Uuid> = app
    .tasks
    .data
    .as_ref()
    .map(|l| l.items.iter().map(|t| t.id).collect())
    .unwrap_or_default();
  let every = !loaded.is_empty() && !app.triage.all && app.triage.selected.len() == loaded.len();
  app.triage.all = false;
  app.triage.selected = if every { Vec::new() } else { loaded };
}

/// "Select all {total} overdue".
pub fn select_all(app: &mut App) {
  if !app.triage.pending {
    app.triage.all = true;
    app.triage.selected.clear();
  }
}

/// Runs `action` on the selection.
pub fn act(app: &mut App, action: Action) {
  if app.triage.pending || count(app) == 0 {
    return;
  }
  let target = if app.triage.all {
    Target::AllOverdue {
      expected_total: total(app),
    }
  } else {
    Target::Ids(app.triage.selected.clone())
  };
  let requests = bulk::requests(action, &target, &app.clock.day());
  app.triage.pending = true;
  let api = app.api.clone();
  app
    .effects
    .run(async move { bulk::send(&api, requests).await }, |app: &mut App, result| {
      let t = &mut app.triage;
      t.pending = false;
      match result {
        Ok(totals) => {
          t.notice = Some(bulk::done(totals));
          t.selected.clear();
          t.all = false;
          t.reschedule = None;
          t.confirm_delete = false;
        }
        Err(failure) => {
          let outcome = bulk::failed(&failure);
          t.notice = Some(outcome.notice);
          if outcome.clear_selection {
            t.selected.clear();
            t.all = false;
          }
        }
      }
      if app.triage.reschedule.is_none() {
        crate::pickers::reset(app);
      }
      load::refetch(app);
    });
}

/// "Reschedule date" (`exact == false`) or "Reschedule exact time".
pub fn open_reschedule(app: &mut App, exact: bool) {
  if !app.triage.pending {
    app.triage.reschedule = Some(Reschedule {
      exact,
      ..Reschedule::default()
    });
    crate::pickers::reset(app);
  }
}

/// "Cancel" or Escape in the reschedule dialog.
pub fn close_reschedule(app: &mut App) {
  if !app.triage.pending {
    app.triage.reschedule = None;
    crate::pickers::reset(app);
  }
}

/// What the reschedule dialog would apply: the action once its fields are valid, else `Err` with the message to show
/// (`None` while it is simply incomplete; "Apply" stays disabled either way).
pub fn reschedule_action(dialog: &Reschedule, zone: chrono_tz::Tz) -> Result<Action, Option<&'static str>> {
  let date = crate::format::parse_iso_date(dialog.date.text.trim()).ok_or(None)?;
  if !dialog.exact {
    return Ok(Action::SetDueDate(date));
  }
  let time = chrono::NaiveTime::parse_from_str(dialog.time.text.trim(), "%H:%M")
    .ok()
    .filter(|_| dialog.time.text.trim().len() == 5)
    .ok_or(None)?;
  match forms::resolve(date.and_time(time), zone) {
    Local::Gap => Err(Some("This local time does not exist. Choose another time.")),
    Local::One(at) => Ok(Action::SetDueInstant(at)),
    Local::Twice(earlier, later) => match dialog.occurrence {
      Some(0) => Ok(Action::SetDueInstant(earlier)),
      Some(_) => Ok(Action::SetDueInstant(later)),
      None => Err(None),
    },
  }
}

/// "Apply" in the reschedule dialog.
pub fn apply_reschedule(app: &mut App) {
  let zone = app.clock.zone;
  if let Some(Ok(action)) = app.triage.reschedule.as_ref().map(|d| reschedule_action(d, zone)) {
    act(app, action);
  }
}

/// "Delete" in the toolbar: asks first.
pub fn ask_delete(app: &mut App) {
  if !app.triage.pending {
    app.triage.confirm_delete = true;
  }
}

/// "Cancel" in the delete confirmation.
pub fn cancel_delete(app: &mut App) {
  if !app.triage.pending {
    app.triage.confirm_delete = false;
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono_tz::Europe::Madrid;

  fn dialog(exact: bool, date: &str, time: &str) -> Reschedule {
    Reschedule {
      exact,
      date: TextEdit::new(date),
      time: TextEdit::new(time),
      occurrence: None,
    }
  }

  #[test]
  fn apply_waits_for_a_valid_reschedule() {
    assert_eq!(reschedule_action(&dialog(false, "", ""), Madrid), Err(None));
    assert_eq!(
      reschedule_action(&dialog(false, "2026-11-23", ""), Madrid),
      Ok(Action::SetDueDate("2026-11-23".parse().unwrap()))
    );
    assert_eq!(reschedule_action(&dialog(true, "2026-11-23", ""), Madrid), Err(None));
    assert_eq!(
      reschedule_action(&dialog(true, "2026-11-23", "09:30"), Madrid),
      Ok(Action::SetDueInstant("2026-11-23T08:30:00Z".parse().unwrap()))
    );
    assert_eq!(
      reschedule_action(&dialog(true, "2026-03-29", "02:30"), Madrid),
      Err(Some("This local time does not exist. Choose another time."))
    );
    let mut repeated = dialog(true, "2026-10-25", "02:30");
    assert_eq!(reschedule_action(&repeated, Madrid), Err(None), "which occurrence?");
    repeated.occurrence = Some(0);
    assert_eq!(
      reschedule_action(&repeated, Madrid),
      Ok(Action::SetDueInstant("2026-10-25T00:30:00Z".parse().unwrap()))
    );
  }
}
