//! Task actions, as the web app's `useToggleTask.ts`, `useDeleteTask.ts` and `ConfirmDialog.tsx`.
//!
//! - **Complete and reopen** are optimistic: every loaded copy of the task flips at once. A failure rolls back that
//!   task alone and says why. After the last toggle of a burst settles, or straight after a failure, the page is
//!   fetched again, which also settles a 409.
//! - **Delete** asks first, waits for the server, then refetches.

use crate::route::Route;
use crate::{App, load};
use calendar_client::ApiError;
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// A task's completion as it was before an optimistic toggle.
type Completion = (bool, Option<Option<DateTime<Utc>>>);

/// The delete confirmation on screen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeleteDialog {
  pub id: Uuid,
  /// The task's title on Day and Week; `None` on My tasks, whose dialog says "1 task", as the web app's does.
  pub title: Option<String>,
  pub pending: bool,
  pub error: Option<String>,
}

/// Toggles in flight and the last toggle failure.
#[derive(Clone, Debug, Default)]
pub struct Actions {
  pub pending: std::collections::HashSet<Uuid>,
  pub in_flight: usize,
  pub toggle_error: Option<String>,
  pub delete: Option<DeleteDialog>,
}

/// Sets `completion` on every loaded copy of task `id`; returns its completion before, from the first copy found.
fn set_completion(app: &mut App, id: Uuid, completion: Completion) -> Option<Completion> {
  let mut before = None;
  let mut apply = |done: &mut bool, at: &mut Option<Option<DateTime<Utc>>>| {
    before.get_or_insert((*done, *at));
    (*done, *at) = completion;
  };
  if let Some(day) = &mut app.day.data {
    for task in day
      .tasks
      .due_today
      .iter_mut()
      .chain(day.tasks.overdue.iter_mut())
      .filter(|t| t.id == id)
    {
      apply(&mut task.is_completed, &mut task.completed_at);
    }
  }
  if let Some(week) = &mut app.week.data {
    let days = week.days.iter_mut().flat_map(|d| d.tasks.iter_mut());
    for task in days.chain(week.overdue.iter_mut().flatten()).filter(|t| t.id == id) {
      apply(&mut task.is_completed, &mut task.completed_at);
    }
  }
  if let Some(list) = &mut app.tasks.data {
    for task in list.items.iter_mut().filter(|t| t.id == id) {
      apply(&mut task.is_completed, &mut task.completed_at);
    }
  }
  before
}

/// The message a failed toggle shows, in the words of the page it happened on.
#[must_use]
pub fn toggle_message(route: Route, error: &ApiError) -> &'static str {
  let conflict = error.status == Some(409);
  match (route, conflict) {
    (Route::Tasks(_), true) => "That task changed elsewhere. The list has been refreshed; try again.",
    (Route::Tasks(_), false) => "Couldn\u{2019}t update the task. Try again.",
    (_, true) => "That task was changed elsewhere. The list has been refreshed; please try again.",
    (_, false) => "Couldn\u{2019}t update the task. Your change was undone.",
  }
}

/// Completes (`complete`) or reopens task `id`.
pub fn toggle(app: &mut App, id: Uuid, complete: bool) {
  if app.actions.pending.contains(&id) {
    return;
  }
  let now = app.clock.now();
  let Some(before) = set_completion(app, id, (complete, Some(complete.then_some(now)))) else {
    return;
  };
  app.actions.pending.insert(id);
  app.actions.in_flight += 1;
  app.actions.toggle_error = None;
  let api = app.api.clone();
  app.effects.run(
    async move {
      if complete {
        api.complete_task(id).await
      } else {
        api.reopen_task(id).await
      }
    },
    move |app: &mut App, result| {
      app.actions.pending.remove(&id);
      app.actions.in_flight = app.actions.in_flight.saturating_sub(1);
      let failed = if let Err(error) = &result {
        set_completion(app, id, before);
        app.actions.toggle_error = Some(toggle_message(app.route, error).to_owned());
        true
      } else {
        false
      };
      if failed || app.actions.in_flight == 0 {
        load::refetch(app);
      }
    },
  );
}

/// Opens the delete confirmation for task `id`.
pub fn ask_delete(app: &mut App, id: Uuid, title: Option<&str>) {
  app.actions.delete = Some(DeleteDialog {
    id,
    title: title.map(str::to_owned),
    pending: false,
    error: None,
  });
}

/// "Cancel" or Escape: closes the confirmation unless the delete is under way.
pub fn cancel_delete(app: &mut App) {
  if app.actions.delete.as_ref().is_some_and(|d| !d.pending) {
    app.actions.delete = None;
  }
}

/// "Delete" in the confirmation.
pub fn confirm_delete(app: &mut App) {
  let Some(dialog) = &mut app.actions.delete else { return };
  if dialog.pending {
    return;
  }
  dialog.pending = true;
  dialog.error = None;
  let id = dialog.id;
  let api = app.api.clone();
  app.effects.run(
    async move { api.delete_task(id).await },
    move |app: &mut App, result| match result {
      Ok(()) => {
        app.actions.delete = None;
        load::refetch(app);
      }
      Err(_) => {
        if let Some(dialog) = &mut app.actions.delete {
          dialog.pending = false;
          // Day and Week say why; My tasks keeps the dialog open without a message, as the web app's list does.
          if dialog.title.is_some() {
            dialog.error = Some("Couldn\u{2019}t delete the task. Try again, or cancel.".to_owned());
          }
        }
      }
    },
  );
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::route::TaskView;

  #[test]
  fn toggle_messages_are_the_web_apps_per_page() {
    let conflict = ApiError {
      status: Some(409),
      message: None,
    };
    let other = ApiError {
      status: Some(500),
      message: None,
    };
    assert_eq!(
      toggle_message(Route::Today, &conflict),
      "That task was changed elsewhere. The list has been refreshed; please try again."
    );
    assert_eq!(
      toggle_message(Route::Today, &other),
      "Couldn\u{2019}t update the task. Your change was undone."
    );
    let tasks = Route::Tasks(TaskView::Upcoming);
    assert_eq!(
      toggle_message(tasks, &conflict),
      "That task changed elsewhere. The list has been refreshed; try again."
    );
    assert_eq!(toggle_message(tasks, &other), "Couldn\u{2019}t update the task. Try again.");
  }
}
