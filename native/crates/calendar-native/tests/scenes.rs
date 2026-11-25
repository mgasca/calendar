//! The named scenes don't depend on the machine: each one starts from the offline app, frozen at the fixtures' now,
//! whatever app the harness hands it (#1059).

use calendar_native::clock::Clock;
use calendar_native::fetch::Effects;
use calendar_native::{App, fixtures, spec};
use chrono::{DateTime, Utc};

/// The app a harness would hand a scene, on a clock stopped at `now` in place of the system clock.
fn harness_app(now: &str) -> App {
  let now: DateTime<Utc> = now.parse().unwrap();
  App::new(
    "http://127.0.0.1:9",
    Clock::fixed(chrono_tz::Pacific::Kiritimati, now),
    Effects::manual(),
  )
}

#[test]
fn every_scene_is_the_same_whatever_day_the_harness_starts_on() {
  // A Monday a week after the fixtures' Friday, and a day in another year: a scene that reads the harness's clock
  // before `scene` lands on a different route.
  for &(name, init) in spec().scenes {
    let mut early = harness_app("2026-11-23T08:00:00Z");
    let mut late = harness_app("2031-03-04T20:00:00Z");
    init(&mut early);
    init(&mut late);
    assert_eq!(early.route, late.route, "scene {name} depends on the harness's clock");
    assert_eq!(early.clock.now(), fixtures::now(), "scene {name} runs on the offline clock");
  }
}
