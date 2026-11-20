//! The shell and the named scenes' element trees, driven headlessly with Rune's `Runtime`: no window, no GPU.

use calendar_native::route::{Route, TaskView};
use calendar_native::{App, Nav, spec, view};
use rune::{Env, Runtime};

fn runtime(scene: &str, dark: bool) -> Runtime<App> {
  let state = rune::tooling::initial_state(&spec(), Some(scene));
  let mut rt = Runtime::new(
    state,
    view,
    // Tall enough that every row of the fixtures is on screen, so a press lands on it.
    (960.0, 1600.0),
    Env {
      system_dark: dark,
      scale: 1.0,
    },
  );
  rt.frame(0.0);
  rt
}

fn press(rt: &mut Runtime<App>, key: &str) {
  let (x, y) = rt.find(key).unwrap_or_else(|| panic!("no element keyed {key}"));
  rt.pointer_down(x, y);
  rt.pointer_up(x, y);
  rt.frame(1.0 / 60.0);
  // Let the new layout land before the next `find`: a press can add or move controls.
  rt.settle_all();
  rt.frame(1.0 / 60.0);
}

fn shows(rt: &Runtime<App>, keys: &[&str]) {
  for key in keys {
    assert!(rt.find(key).is_some(), "the page shows {key}");
  }
}

#[test]
fn the_app_opens_on_today_with_its_sections() {
  let rt = runtime("today", false);
  assert_eq!(rt.state.route, Route::Today);
  shows(
    &rt,
    &[
      "app-title",
      "nav",
      "user-name",
      "sign-out",
      "day-title",
      "day-summary",
      "all-day",
      "schedule",
      "tasks",
      "overdue",
      "due",
    ],
  );
  assert!(rt.find("day-today").is_none(), "no \"Today\" button on today");
}

#[test]
fn each_nav_item_opens_its_page() {
  let mut rt = runtime("today", true);
  press(&mut rt, Nav::Week.key());
  assert!(matches!(rt.state.route, Route::Week(_)));
  press(&mut rt, Nav::Tasks.key());
  assert_eq!(rt.state.route, Route::Tasks(TaskView::Upcoming));
  press(&mut rt, Nav::Today.key());
  assert_eq!(rt.state.route, Route::Today);
}

#[test]
fn day_navigation_moves_a_day_and_back_to_today() {
  let mut rt = runtime("today", false);
  press(&mut rt, "day-next");
  let tomorrow = calendar_native::fixtures::now().date_naive().succ_opt().unwrap();
  assert_eq!(rt.state.route, Route::Day(tomorrow));
  shows(&rt, &["day-today"]);
  press(&mut rt, "day-today");
  assert_eq!(rt.state.route, Route::Today);
}

#[test]
fn the_states_read_as_the_web_apps() {
  shows(&runtime("today-empty", false), &["day-empty"]);
  shows(&runtime("today-loading", false), &["day-loading"]);
  shows(&runtime("today-error", false), &["day-error", "day-retry"]);
  shows(
    &runtime("week", false),
    &["week-title", "week-summary", "all-day-band", "hours", "now-line", "week-overdue"],
  );
  shows(
    &runtime("tasks", false),
    &["task-views", "view-upcoming", "task-list", "tasks-more"],
  );
  shows(&runtime("signed-out", false), &["session-message"]);
}

#[test]
fn a_task_view_tab_opens_that_view() {
  let mut rt = runtime("tasks", false);
  press(&mut rt, "view-no-deadline");
  assert_eq!(rt.state.route, Route::Tasks(TaskView::NoDeadline));
}

// Task actions (#1005): the real controls, in an offline app whose requests stay queued.

const BOOK_FLIGHTS: &str = "00000000-0000-4000-8000-000000000003";

#[test]
fn pressing_a_checkbox_completes_the_task_and_disables_it_until_the_server_answers() {
  let mut rt = runtime("today", false);
  let key = format!("task-{BOOK_FLIGHTS}-check");
  press(&mut rt, &key);
  let id = BOOK_FLIGHTS.parse().unwrap();
  let task = rt
    .state
    .day
    .data
    .as_ref()
    .unwrap()
    .tasks
    .due_today
    .iter()
    .find(|t| t.id == id)
    .unwrap();
  assert!(task.is_completed, "optimistic");
  assert!(rt.state.actions.pending.contains(&id));
  assert_eq!(rt.state.effects.pending(), 1, "one request queued");
  press(&mut rt, &key);
  assert_eq!(rt.state.effects.pending(), 1, "the checkbox is disabled while it runs");
}

#[test]
fn delete_opens_the_confirmation_and_cancel_closes_it() {
  let mut rt = runtime("today", false);
  press(&mut rt, &format!("task-{BOOK_FLIGHTS}-delete"));
  assert_eq!(rt.state.actions.delete.as_ref().map(|d| d.title.as_str()), Some("Book flights"));
  shows(&rt, &["delete-dialog", "confirm-delete", "cancel-delete"]);
  press(&mut rt, "cancel-delete");
  assert!(rt.state.actions.delete.is_none());
  assert!(rt.find("delete-dialog").is_none());
  press(&mut rt, &format!("task-{BOOK_FLIGHTS}-delete"));
  press(&mut rt, "confirm-delete");
  assert!(
    rt.state.actions.delete.as_ref().is_some_and(|d| d.pending),
    "Delete starts the request"
  );
}

#[test]
fn the_toggle_error_is_an_alert() {
  shows(&runtime("today-toggle-error", false), &["toggle-error"]);
}
