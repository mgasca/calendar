//! Port of `Calendar.Domain.Tests/Time/DayWindowTests.cs`.
//!
//! One .NET tick (100 ns) is the smallest step the C# tests take around a boundary; `TICK` keeps that step.
//! `Create_WithNullZone_Throws` has no counterpart: a zone cannot be null here.

use calendar_domain::time::{DayWindow, IanaZone, time_zones};
use chrono::{DateTime, Days, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeDelta, TimeZone, Utc};

const TICK: TimeDelta = TimeDelta::nanoseconds(100);

fn zone(id: &str) -> IanaZone {
  time_zones::find_iana(id).unwrap()
}

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
  NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

fn window(year: i32, month: u32, day: u32, zone_id: &str) -> DayWindow {
  DayWindow::create(date(year, month, day), zone(zone_id))
}

fn local(year: i32, month: u32, day: u32) -> NaiveDateTime {
  date(year, month, day).and_time(NaiveTime::MIN)
}

fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
  Utc.with_ymd_and_hms(year, month, day, hour, minute, 0).unwrap()
}

fn hours(count: i64) -> TimeDelta {
  TimeDelta::hours(count)
}

/// The local time does not exist in the zone (the clock jumps over it).
fn is_invalid_time(zone: IanaZone, local: NaiveDateTime) -> bool {
  matches!(zone.tz().from_local_datetime(&local), LocalResult::None)
}

/// The local time occurs twice in the zone (the clock falls back over it).
fn is_ambiguous_time(zone: IanaZone, local: NaiveDateTime) -> bool {
  matches!(zone.tz().from_local_datetime(&local), LocalResult::Ambiguous(..))
}

#[test]
fn create_ordinary_day_is_24_hours() {
  let w = window(2026, 10, 26, "America/New_York");

  assert_eq!(w.start(), utc(2026, 10, 26, 4, 0));
  assert_eq!(w.end(), utc(2026, 10, 27, 4, 0));
  assert_eq!(w.length(), hours(24));
  assert_eq!(w.date(), date(2026, 10, 26));
}

#[test]
fn create_in_utc_matches_calendar_day() {
  let w = window(2026, 10, 26, "UTC");

  assert_eq!(w.start(), utc(2026, 10, 26, 0, 0));
  assert_eq!(w.end(), utc(2026, 10, 27, 0, 0));
}

#[test]
fn create_east_of_utc_starts_on_previous_utc_day() {
  let w = window(2026, 10, 26, "Asia/Kolkata");

  assert_eq!(w.start(), utc(2026, 10, 25, 18, 30));
  assert_eq!(w.length(), hours(24));
}

#[test]
fn create_new_york_spring_forward_is_23_hours() {
  let w = window(2026, 3, 8, "America/New_York");

  assert_eq!(w.start(), utc(2026, 3, 8, 5, 0));
  assert_eq!(w.end(), utc(2026, 3, 9, 4, 0));
  assert_eq!(w.length(), hours(23));
}

#[test]
fn create_new_york_fall_back_is_25_hours() {
  let w = window(2026, 11, 1, "America/New_York");

  assert_eq!(w.start(), utc(2026, 11, 1, 4, 0));
  assert_eq!(w.end(), utc(2026, 11, 2, 5, 0));
  assert_eq!(w.length(), hours(25));
}

#[test]
fn create_london_spring_forward_is_23_hours() {
  let w = window(2026, 3, 29, "Europe/London");

  assert_eq!(w.start(), utc(2026, 3, 29, 0, 0));
  assert_eq!(w.end(), utc(2026, 3, 29, 23, 0));
  assert_eq!(w.length(), hours(23));
}

#[test]
fn create_london_fall_back_is_25_hours() {
  let w = window(2026, 10, 25, "Europe/London");

  assert_eq!(w.start(), utc(2026, 10, 24, 23, 0));
  assert_eq!(w.end(), utc(2026, 10, 26, 0, 0));
  assert_eq!(w.length(), hours(25));
}

#[test]
fn create_santiago_skipped_midnight_starts_at_first_valid_instant() {
  // 2026-09-06 00:00 -04:00 jumps to 01:00 -03:00; local midnight does not exist.
  let santiago = zone("America/Santiago");
  assert!(is_invalid_time(santiago, local(2026, 9, 6)));

  let w = DayWindow::create(date(2026, 9, 6), santiago);

  assert_eq!(w.start(), utc(2026, 9, 6, 4, 0));
  assert_eq!(santiago.to_local(w.start()).time(), NaiveTime::from_hms_opt(1, 0, 0).unwrap());
  assert_eq!(w.end(), utc(2026, 9, 7, 3, 0));
  assert_eq!(w.length(), hours(23));
}

#[test]
fn create_santiago_skipped_midnight_previous_day_ends_at_same_instant() {
  let prev = window(2026, 9, 5, "America/Santiago");
  let skipped = window(2026, 9, 6, "America/Santiago");

  assert_eq!(prev.end(), skipped.start());
}

#[test]
fn create_other_skipped_midnight_zones_start_at_transition() {
  for (id, y, mo, d) in [("America/Havana", 2026, 3, 8), ("Asia/Beirut", 2026, 3, 29)] {
    let z = zone(id);
    assert!(is_invalid_time(z, local(y, mo, d)), "{id}");

    let w = DayWindow::create(date(y, mo, d), z);

    assert!(!is_invalid_time(z, z.to_local(w.start()).naive_local()), "{id}");
    assert_eq!(z.local_date(w.start()), date(y, mo, d), "{id}");
    assert_eq!(z.local_date(w.start() - TICK), date(y, mo, d) - Days::new(1), "{id}");
    assert_eq!(w.length(), hours(23), "{id}");
  }
}

#[test]
fn create_ambiguous_midnight_starts_at_first_occurrence() {
  // Havana falls back 01:00 -> 00:00 on 2026-11-01, so local midnight happens twice.
  let havana = zone("America/Havana");
  assert!(is_ambiguous_time(havana, local(2026, 11, 1)));

  let w = DayWindow::create(date(2026, 11, 1), havana);

  assert_eq!(w.start(), utc(2026, 11, 1, 4, 0)); // 00:00 CDT (-04:00), the first occurrence
  assert_eq!(w.length(), hours(25));
}

#[test]
fn create_consecutive_days_tile_without_gaps_across_dst_change() {
  let new_york = zone("America/New_York");
  let day = date(2026, 10, 29); // 2026-11-01 minus three days

  for i in 0..=6 {
    let a = DayWindow::create(day + Days::new(i), new_york);
    let b = DayWindow::create(day + Days::new(i + 1), new_york);
    assert_eq!(a.end(), b.start());
  }
}

#[test]
fn contains_is_half_open() {
  let w = window(2026, 10, 26, "UTC");

  assert!(w.contains(w.start()));
  assert!(w.contains(w.end() - TICK));
  assert!(!w.contains(w.end()));
  assert!(!w.contains(w.start() - TICK));
}

#[test]
fn create_gap_starting_at_midnight_starts_at_transition() {
  // The clock jumps 00:00 -> 01:00 (the .NET BCL did not flag 00:00 as invalid here); the previous local date
  // must not leak into the window.
  for (id, y, mo, d, expected_utc_hour) in [("America/Asuncion", 2024, 10, 6, 4), ("America/Coyhaique", 2024, 9, 8, 4)] {
    let z = zone(id);

    let w = DayWindow::create(date(y, mo, d), z);

    assert_eq!(w.start(), utc(y, mo, d, expected_utc_hour, 0), "{id}");
    assert_eq!(z.local_date(w.start()), date(y, mo, d), "{id}");
    assert_eq!(z.local_date(w.start() - TICK), date(y, mo, d) - Days::new(1), "{id}");
  }
}

#[test]
fn create_date_skipped_entirely_is_empty_at_the_transition() {
  // Pacific/Apia jumped from 2011-12-29 23:59:59 (-10) to 2011-12-31 00:00 (+14).
  let apia = zone("Pacific/Apia");
  let skipped = DayWindow::create(date(2011, 12, 30), apia);
  let before = DayWindow::create(date(2011, 12, 29), apia);
  let after = DayWindow::create(date(2011, 12, 31), apia);

  assert_eq!(skipped.length(), TimeDelta::zero());
  assert_eq!(skipped.start(), utc(2011, 12, 30, 10, 0));
  assert_eq!(before.end(), skipped.start());
  assert_eq!(after.start(), skipped.end());
  assert!(!skipped.contains(skipped.start()));
}

#[test]
fn create_consecutive_days_tile_in_every_zone_across_years() {
  let mut failures = Vec::new();
  for tz in chrono_tz::TZ_VARIANTS {
    let z = time_zones::try_find_iana(tz.name()).unwrap_or_else(|| panic!("{} does not resolve", tz.name()));
    let day = date(2023, 12, 25);
    let mut previous = DayWindow::create(day, z);
    for i in 1..=800 {
      let current = DayWindow::create(day + Days::new(i), z);
      let first_local = z.local_date(current.start());
      let last_before = z.local_date(current.start() - TICK);
      if previous.end() != current.start()
        || current.length() < TimeDelta::zero()
        || (current.length() > TimeDelta::zero() && (first_local < current.date() || last_before >= current.date()))
      {
        failures.push(format!("{} {}", z.id(), current.date()));
      }

      previous = current;
    }
  }

  assert!(failures.is_empty(), "{failures:?}");
}

// ---- beyond the C# suite ----

#[test]
fn try_create_is_none_at_the_limits_of_the_date_range_instead_of_panicking() {
  assert_eq!(DayWindow::try_create(NaiveDate::MAX, IanaZone::UTC), None);
  assert_eq!(DayWindow::try_create(NaiveDate::MIN, IanaZone::UTC), None);
  assert!(DayWindow::try_create(date(1900, 1, 1), zone("Pacific/Apia")).is_some());
  assert!(DayWindow::try_create(date(2200, 12, 31), zone("Pacific/Apia")).is_some());
}
