//! The Week's shortcuts, "+N more" and first scroll (#1034), driven headlessly as the web app's `WeekView.test.tsx`
//! drives them.

use calendar_native::route::Route;
use calendar_native::{App, dialogs, spec, view};
use chrono::NaiveDate;
use rune::{Env, Key, KeyEvent, Mods, Runtime};

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

fn send(rt: &mut Runtime<App>, key: Key, mods: Mods) {
  rt.key(KeyEvent { key, mods });
  settle(rt);
}

fn plain(rt: &mut Runtime<App>, key: Key) {
  send(rt, key, Mods::default());
}

fn d(s: &str) -> NaiveDate {
  s.parse().unwrap()
}

fn week(rt: &Runtime<App>) -> Option<NaiveDate> {
  match rt.state.route {
    Route::Week(start) => Some(start),
    _ => None,
  }
}

/// The week the data on screen is for: a scene has no API, so a moved route keeps the loaded week until a test
/// loads another.
fn load(rt: &mut Runtime<App>, start: NaiveDate) {
  let mut data = calendar_native::fixtures::week();
  data.week_start = start;
  rt.state.week.finish(Ok(data));
  settle(rt);
}

/// The hour the grid's viewport starts at: where the label of `hour` sits within it.
fn top_hour(rt: &Runtime<App>) -> f32 {
  let (_, viewport) = rt.find("week-hours").expect("the hours show");
  let top = viewport - 560.0 / 2.0;
  let (_, seven) = rt.find("hour-7").expect("07:00 is labelled");
  // A label's centre is half an hour (20 points) below its hour.
  7.0 - (seven - 20.0 - top) / 40.0
}

#[test]
fn the_arrows_change_week_and_t_comes_back() {
  let mut rt = runtime("week");
  plain(&mut rt, Key::Right);
  assert_eq!(week(&rt), Some(d("2026-11-23")));
  plain(&mut rt, Key::Right);
  plain(&mut rt, Key::Left);
  assert_eq!(week(&rt), Some(d("2026-11-23")));
  plain(&mut rt, Key::Text("t".into()));
  assert_eq!(week(&rt), Some(d("2026-11-16")), "t goes to this week");
  plain(&mut rt, Key::Text("T".into()));
  assert_eq!(week(&rt), Some(d("2026-11-16")), "only a lower-case t");
}

#[test]
fn the_keys_are_ignored_with_a_modifier_or_a_dialog_open() {
  let mut rt = runtime("week");
  for mods in [
    Mods {
      ctrl: true,
      cmd: true,
      ..Mods::default()
    },
    Mods {
      alt: true,
      ..Mods::default()
    },
    Mods {
      shift: true,
      ..Mods::default()
    },
    Mods {
      logo: true,
      ..Mods::default()
    },
  ] {
    send(&mut rt, Key::Right, mods);
  }
  assert_eq!(week(&rt), Some(d("2026-11-16")), "a modifier leaves the week");
  plain(&mut rt, Key::Right);
  load(&mut rt, d("2026-11-23"));
  dialogs::add_task(&mut rt.state, None);
  settle(&mut rt);
  // Focus on a dialog control that isn't a text field, as the web test focuses Cancel (#1039).
  press(&mut rt, "priority-high");
  plain(&mut rt, Key::Text("t".into()));
  assert_eq!(week(&rt), Some(d("2026-11-23")), "an open dialog keeps the week behind it");
  assert!(rt.state.dialog.is_some());
}

#[test]
fn inside_the_grid_the_arrows_scroll_and_t_still_works() {
  let mut rt = runtime("week");
  plain(&mut rt, Key::Right);
  load(&mut rt, d("2026-11-23"));
  press(&mut rt, "week-hours");
  plain(&mut rt, Key::Left);
  assert_eq!(week(&rt), Some(d("2026-11-23")), "← is the grid's");
  plain(&mut rt, Key::Text("t".into()));
  assert_eq!(week(&rt), Some(d("2026-11-16")), "t works from inside the grid");
}

#[test]
fn a_busy_day_shows_more_and_opens_that_day() {
  let mut rt = runtime("week-busy");
  for n in 1..=2 {
    assert!(
      rt.find(&format!("week-event-2026-11-18-30000000-0000-4000-8000-0000000000{:02}", 10 + n))
        .is_some()
    );
  }
  let chip = "week-more-2026-11-18-975";
  assert!(rt.find(chip).is_some(), "+2 more shows from 16:15, where the hidden two start");
  press(&mut rt, chip);
  assert_eq!(rt.state.route, Route::Day(d("2026-11-18")));
}

#[test]
fn the_grid_opens_an_hour_before_now_this_week_and_at_seven_otherwise() {
  let mut rt = runtime("week");
  // The fixtures' now is 10:00 in Madrid.
  assert!(
    (top_hour(&rt) - 9.0).abs() < 0.05,
    "this week opens at 09:00, not {}",
    top_hour(&rt)
  );
  plain(&mut rt, Key::Right);
  load(&mut rt, d("2026-11-23"));
  assert!(
    (top_hour(&rt) - 7.0).abs() < 0.05,
    "another week opens at 07:00, not {}",
    top_hour(&rt)
  );
  // A refetch of the same week leaves the scroll where the user put it.
  rt.state.scrolled_week = Some(d("2026-11-23"));
  rt.state.clock.set_now("2026-11-20T15:00:00Z".parse().unwrap());
  load(&mut rt, d("2026-11-23"));
  assert!((top_hour(&rt) - 7.0).abs() < 0.05, "a refetch doesn't move it");
}
