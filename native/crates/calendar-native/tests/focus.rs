//! The notice's timing and where focus goes after a dialog (#1035), as the web app's `Notification.test.tsx`,
//! `EditEvent.test.tsx` and `WeekView.test.tsx` check them.

use calendar_native::dialogs::{Dialog, Notice};
use calendar_native::{App, focus, spec, view};
use rune::accesskit::Action;
use rune::{Env, Runtime};

/// A scene with the app's own `poll` and window `on_key`, as the window runs it.
fn runtime(scene: &str) -> Runtime<App> {
  let spec = spec();
  let state = rune::tooling::initial_state(&spec, Some(scene));
  let mut rt = Runtime::new(
    state,
    view,
    (960.0, 1600.0),
    Env {
      system_dark: false,
      scale: 1.0,
    },
  );
  rt.poll = spec.poll;
  rt.on_key = spec.on_key;
  settle(&mut rt);
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

/// Moves focus to `key` as assistive technology or Tab would, without pressing it.
fn focus_on(rt: &mut Runtime<App>, key: &str) {
  assert!(rt.accessibility_action(key, Action::Focus, None), "{key} takes focus");
  settle(rt);
}

/// Waits `seconds` on the window's clock, a frame a second, polling as the window does.
fn wait(rt: &mut Runtime<App>, seconds: u32) {
  for _ in 0..seconds {
    rt.frame(1.0);
  }
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

fn show_notice(rt: &mut Runtime<App>, text: &str) {
  rt.state.notice = Some(Notice {
    text: text.to_owned(),
    show_day: Some("2026-11-23".parse().unwrap()),
    ..Notice::default()
  });
  settle(rt);
}

const DESIGN_REVIEW_TITLE: &str = "event-20000000-0000-4000-8000-000000000002-title";

#[test]
fn a_notice_goes_after_six_seconds() {
  let mut rt = runtime("today");
  show_notice(&mut rt, "Planning added for Mon 23 Nov.");
  assert!(rt.find("notice").is_some());
  wait(&mut rt, 5);
  assert!(rt.state.notice.is_some(), "still there at five seconds");
  wait(&mut rt, 2);
  assert!(rt.state.notice.is_none() && rt.find("notice").is_none(), "gone after six");
}

#[test]
fn the_pointer_over_a_notice_pauses_it_and_leaving_starts_the_full_time_again() {
  let mut rt = runtime("today");
  show_notice(&mut rt, "Task saved.");
  wait(&mut rt, 4);
  let (x, y) = rt.find("notice-message").unwrap();
  rt.pointer_move(x, y);
  settle(&mut rt);
  wait(&mut rt, 10);
  assert!(rt.state.notice.is_some(), "paused while hovered");
  rt.pointer_leave();
  settle(&mut rt);
  wait(&mut rt, 5);
  assert!(rt.state.notice.is_some(), "the full six seconds start again");
  wait(&mut rt, 2);
  assert!(rt.state.notice.is_none());
}

#[test]
fn focus_inside_a_notice_pauses_it_and_dismiss_hands_focus_back() {
  let mut rt = runtime("today");
  focus_on(&mut rt, "day-week");
  show_notice(&mut rt, "Task saved.");
  focus_on(&mut rt, "notice-dismiss");
  wait(&mut rt, 10);
  assert!(rt.state.notice.is_some(), "paused while focus is inside");
  press(&mut rt, "notice-dismiss");
  assert!(rt.state.notice.is_none());
  assert_eq!(focused(&rt).as_deref(), Some("day-week"), "focus goes back where it came from");
}

#[test]
fn a_notice_never_takes_focus_and_a_new_one_replaces_it() {
  let mut rt = runtime("today");
  focus_on(&mut rt, "day-week");
  show_notice(&mut rt, "First.");
  assert_eq!(focused(&rt).as_deref(), Some("day-week"));
  show_notice(&mut rt, "Second.");
  assert_eq!(rt.state.notice.as_ref().map(|n| n.text.as_str()), Some("Second."));
  assert!(rt.find("notice-dismiss").is_some(), "Dismiss notification");
}

#[test]
fn show_day_dismisses_then_goes_there() {
  let mut rt = runtime("today");
  show_notice(&mut rt, "Planning added for Mon 23 Nov.");
  press(&mut rt, "notice-show-day");
  assert!(rt.state.notice.is_none());
  assert_eq!(rt.state.route, calendar_native::route::Route::Day("2026-11-23".parse().unwrap()));
}

#[test]
fn cancel_returns_focus_to_add_event() {
  let mut rt = runtime("today");
  press(&mut rt, "add-event");
  assert!(rt.state.dialog.is_some());
  press(&mut rt, "event-cancel");
  settle(&mut rt);
  assert_eq!(focused(&rt).as_deref(), Some("add-event"));
}

#[test]
fn closing_an_edit_returns_focus_to_the_title_that_opened_it() {
  let mut rt = runtime("today");
  press(&mut rt, DESIGN_REVIEW_TITLE);
  assert!(rt.state.dialog.is_some(), "the event opens (loading)");
  press(&mut rt, "form-cancel");
  assert!(
    rt.state.dialog.is_none(),
    "a dialog still loading its event closes, as the web app's does"
  );
  settle(&mut rt);
  assert_eq!(focused(&rt).as_deref(), Some(DESIGN_REVIEW_TITLE));
}

#[test]
fn after_a_delete_or_when_the_opener_is_gone_the_heading_takes_focus() {
  let mut rt = runtime("today");
  rt.state.focus.opener = Some(DESIGN_REVIEW_TITLE.to_owned());
  focus::closed(&mut rt.state, true);
  settle(&mut rt);
  assert_eq!(focused(&rt).as_deref(), Some("day-title"), "a delete goes to the heading");
  // An item that moved off the view: its title isn't shown.
  rt.state.focus.opener = Some("event-30000000-0000-4000-8000-000000000099-title".to_owned());
  focus::closed(&mut rt.state, false);
  settle(&mut rt);
  settle(&mut rt);
  assert_eq!(
    focused(&rt).as_deref(),
    Some("day-title"),
    "a missing opener falls back to the heading"
  );
}

#[test]
fn keep_event_returns_focus_to_delete_event() {
  let mut rt = runtime("add-event");
  if let Some(Dialog::Event(d)) = &mut rt.state.dialog {
    d.id = Some("20000000-0000-4000-8000-000000000002".parse().unwrap());
  }
  settle(&mut rt);
  press(&mut rt, "event-delete");
  assert_eq!(focused(&rt).as_deref(), Some("event-keep"), "the question focuses Keep event");
  press(&mut rt, "event-keep");
  assert_eq!(focused(&rt).as_deref(), Some("event-delete"));
}
