//! The date and time pickers (#1033), driven headlessly with the keyboard as the browser's controls are.

use calendar_native::route::Route;
use calendar_native::{App, dialogs, spec, view};
use rune::{Env, Key, KeyEvent, Runtime};

fn runtime(scene: &str) -> Runtime<App> {
  let state = rune::tooling::initial_state(&spec(), Some(scene));
  let mut rt = Runtime::new(
    state,
    view,
    (960.0, 1600.0),
    Env {
      system_dark: false,
      scale: 1.0,
    },
  );
  rt.frame(0.0);
  rt
}

fn settle(rt: &mut Runtime<App>) {
  rt.frame(1.0 / 60.0);
  rt.settle_all();
  rt.frame(1.0 / 60.0);
}

fn press(rt: &mut Runtime<App>, key: &str) {
  let (x, y) = rt.find(key).unwrap_or_else(|| panic!("no element keyed {key}"));
  rt.pointer_down(x, y);
  rt.pointer_up(x, y);
  settle(rt);
}

fn key(rt: &mut Runtime<App>, key: Key) {
  rt.key(KeyEvent::from(key));
  settle(rt);
}

/// The key of the element with focus, from the accessibility tree.
fn focused(rt: &Runtime<App>) -> Option<String> {
  fn find(node: &serde_json::Value) -> Option<String> {
    let is_focused = node["states"].as_array().is_some_and(|s| s.iter().any(|v| v == "focused"));
    if is_focused && let Some(key) = node["key"].as_str() {
      return Some(key.to_owned());
    }
    node.as_object()?.values().find_map(|v| match v {
      serde_json::Value::Array(items) => items.iter().find_map(find),
      serde_json::Value::Object(_) => find(v),
      _ => None,
    })
  }
  find(&rt.accessibility_json())
}

fn event(rt: &Runtime<App>) -> &dialogs::EventDialog {
  match &rt.state.dialog {
    Some(dialogs::Dialog::Event(d)) => d,
    _ => panic!("the event dialog is open"),
  }
}

#[test]
fn the_month_grid_opens_on_the_fields_date_and_moves_with_the_keys() {
  let mut rt = runtime("add-event");
  press(&mut rt, "event-start-date-choose");
  assert!(rt.find("event-start-date-calendar").is_some(), "the grid opens");
  assert_eq!(
    focused(&rt).as_deref(),
    Some("event-start-date-day-2026-11-20"),
    "on the field's date"
  );
  key(&mut rt, Key::Right);
  assert_eq!(focused(&rt).as_deref(), Some("event-start-date-day-2026-11-21"));
  key(&mut rt, Key::Down);
  assert_eq!(focused(&rt).as_deref(), Some("event-start-date-day-2026-11-28"));
  key(&mut rt, Key::Home);
  assert_eq!(
    focused(&rt).as_deref(),
    Some("event-start-date-day-2026-11-23"),
    "Home goes to Monday"
  );
  key(&mut rt, Key::End);
  assert_eq!(
    focused(&rt).as_deref(),
    Some("event-start-date-day-2026-11-29"),
    "End goes to Sunday"
  );
  key(&mut rt, Key::PageDown);
  assert_eq!(
    focused(&rt).as_deref(),
    Some("event-start-date-day-2026-12-29"),
    "Page Down: next month"
  );
  key(&mut rt, Key::Up);
  key(&mut rt, Key::Enter);
  assert_eq!(event(&rt).start_date.text, "2026-12-22", "Return chooses the focused day");
  assert!(
    rt.state.calendar.is_none() && rt.find("event-start-date-calendar").is_none(),
    "and closes the grid"
  );
  assert_eq!(
    focused(&rt).as_deref(),
    Some("event-start-date-choose"),
    "focus goes back to the button"
  );
}

#[test]
fn escape_closes_the_grid_but_not_the_dialog() {
  let mut rt = runtime("add-event");
  press(&mut rt, "event-end-date-choose");
  key(&mut rt, Key::Left);
  key(&mut rt, Key::Escape);
  assert!(rt.state.calendar.is_none(), "the grid closes");
  assert!(rt.state.dialog.is_some(), "the dialog stays");
  assert_eq!(event(&rt).end_date.text, "2026-11-20", "nothing is chosen");
  assert_eq!(focused(&rt).as_deref(), Some("event-end-date-choose"));
}

#[test]
fn a_pressed_day_is_chosen_and_the_previous_and_next_buttons_change_month() {
  let mut rt = runtime("add-event");
  press(&mut rt, "event-start-date-choose");
  press(&mut rt, "event-start-date-next-month");
  assert!(rt.find("event-start-date-day-2026-12-31").is_some(), "December shows");
  press(&mut rt, "event-start-date-day-2026-12-31");
  assert_eq!(event(&rt).start_date.text, "2026-12-31");
}

#[test]
fn the_time_spin_buttons_step_and_take_typed_digits() {
  let mut rt = runtime("add-event");
  assert_eq!(event(&rt).start_time.text, "10:00");
  press(&mut rt, "event-start-time-hour");
  key(&mut rt, Key::Up);
  assert_eq!(event(&rt).start_time.text, "11:00");
  key(&mut rt, Key::Down);
  key(&mut rt, Key::Down);
  assert_eq!(event(&rt).start_time.text, "09:00");
  key(&mut rt, Key::Text("1".into()));
  key(&mut rt, Key::Text("4".into()));
  assert_eq!(event(&rt).start_time.text, "14:00", "two digits make the hour");
  assert_eq!(
    focused(&rt).as_deref(),
    Some("event-start-time-minute"),
    "then focus moves to the minutes"
  );
  key(&mut rt, Key::Text("4".into()));
  key(&mut rt, Key::Text("5".into()));
  assert_eq!(event(&rt).start_time.text, "14:45");
  key(&mut rt, Key::PageUp);
  assert_eq!(event(&rt).start_time.text, "14:55", "Page Up steps ten minutes");
}

#[test]
fn the_all_day_box_hides_the_spin_buttons_and_keeps_the_times() {
  let mut rt = runtime("add-event");
  press(&mut rt, "event-all-day");
  assert!(rt.find("event-start-time-hour").is_none());
  press(&mut rt, "event-all-day");
  assert!(rt.find("event-start-time-hour").is_some());
  assert_eq!(
    (event(&rt).start_time.text.as_str(), event(&rt).end_time.text.as_str()),
    ("10:00", "11:00")
  );
}

#[test]
fn a_12_hour_locale_adds_am_and_pm() {
  let mut rt = runtime("add-event");
  rt.state.locale = calendar_native::locale::Locale::parse("en-US").unwrap();
  settle(&mut rt);
  assert!(rt.find("event-start-time-period").is_some(), "AM/PM shows");
  press(&mut rt, "event-start-time-period");
  key(&mut rt, Key::Text("p".into()));
  assert_eq!(event(&rt).start_time.text, "22:00", "P takes 10 AM to 10 PM");
  press(&mut rt, "event-start-time-hour");
  key(&mut rt, Key::Up);
  key(&mut rt, Key::Up);
  assert_eq!(
    event(&rt).start_time.text,
    "12:00",
    "the hour stays in its half of the day: 11 PM, then 12 PM"
  );
}

#[test]
fn an_empty_due_time_steps_from_midnight() {
  let mut rt = runtime("edit-task");
  press(&mut rt, "deadline-time");
  let due = |rt: &Runtime<App>| match &rt.state.dialog {
    Some(dialogs::Dialog::Task(d)) => d.due_time.text.clone(),
    _ => panic!("the task dialog is open"),
  };
  assert_eq!(due(&rt), "");
  press(&mut rt, "task-due-time-minute");
  key(&mut rt, Key::Down);
  assert_eq!(due(&rt), "00:59");
}

#[test]
fn choosing_a_day_from_go_to_date_opens_it() {
  let mut rt = runtime("today");
  press(&mut rt, "go-to-date-choose");
  key(&mut rt, Key::Right);
  key(&mut rt, Key::Enter);
  assert_eq!(rt.state.route, Route::Day("2026-11-21".parse().unwrap()));
  assert!(rt.state.calendar.is_none());
}

#[test]
fn a_closed_form_leaves_no_grid_or_half_typed_time_behind() {
  // Pre-merge review of #1048: every event form shares its keys, so a grid left open showed in the next one.
  let mut rt = runtime("add-event");
  press(&mut rt, "event-start-date-choose");
  press(&mut rt, "event-end-time-hour");
  key(&mut rt, Key::Text("1".into()));
  assert!(rt.state.calendar.is_some() || rt.state.spin_typed.is_some());
  press(&mut rt, "event-cancel");
  assert!(rt.state.dialog.is_none());
  press(&mut rt, "add-event");
  assert!(
    rt.find("event-start-date-calendar").is_none(),
    "the new form opens with its grid closed"
  );
  assert!(rt.state.calendar.is_none() && rt.state.spin_typed.is_none());
  press(&mut rt, "event-end-time-hour");
  key(&mut rt, Key::Text("4".into()));
  assert_eq!(event(&rt).end_time.text, "04:00", "a digit starts the hour afresh");
}
