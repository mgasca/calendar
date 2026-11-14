//! Port of `Calendar.Domain.Tests/Time/DateRangeWindowTests.cs`.
//!
//! `Create_WithoutZone_Throws` and `Create_WithoutDays_Throws` have no counterpart: a zone cannot be null, and
//! the day count is a `NonZeroUsize`, so neither a zero nor a negative count can be written.

use std::num::NonZeroUsize;

use calendar_domain::time::{DateRangeWindow, DayWindow, IanaZone};
use chrono::{Datelike, Days, NaiveDate, TimeDelta, Weekday};

use crate::support::{date, utc, zone};

fn day_count(count: usize) -> NonZeroUsize {
  NonZeroUsize::new(count).unwrap()
}

fn should_tile(range: &DateRangeWindow) {
  let days = range.days();
  assert_eq!(range.start(), days[0].start());
  assert_eq!(range.end(), days[days.len() - 1].end());
  for (i, day) in days.iter().enumerate() {
    assert_eq!(day.date(), range.start_date() + Days::new(u64::try_from(i).unwrap()));
    assert_eq!(*day, DayWindow::create(day.date(), range.zone()));
    if i > 0 {
      assert_eq!(day.start(), days[i - 1].end());
    }
  }
}

// ---- ranges of any length ----

#[test]
fn single_day_is_that_days_window() {
  let new_york = zone("America/New_York");

  let range = DateRangeWindow::single_day(date(2026, 10, 26), new_york);

  assert_eq!(range.days(), [DayWindow::create(date(2026, 10, 26), new_york)]);
  assert_eq!(range.start_date(), date(2026, 10, 26));
  assert_eq!(range.end_date(), date(2026, 10, 27));
  assert_eq!(range.start(), utc(2026, 10, 26, 4, 0));
  assert_eq!(range.end(), utc(2026, 10, 27, 4, 0));
  assert_eq!(range.zone(), new_york);
}

#[test]
fn create_seven_days_tiles_consecutive_days() {
  let range = DateRangeWindow::create(date(2026, 10, 28), day_count(7), zone("Asia/Kolkata"));

  assert_eq!(range.days().len(), 7);
  assert_eq!(range.start_date(), date(2026, 10, 28));
  assert_eq!(range.end_date(), date(2026, 11, 4));
  assert_eq!(range.start(), utc(2026, 10, 27, 18, 30));
  assert_eq!(range.end() - range.start(), TimeDelta::days(7));
  should_tile(&range);
}

#[test]
fn create_forty_two_days_covers_a_month_grid_across_a_dst_change() {
  // A six-week month grid for October 2026 in Berlin, which falls back on 2026-10-25.
  let range = DateRangeWindow::create(date(2026, 9, 28), day_count(42), zone("Europe/Berlin"));

  assert_eq!(range.days().len(), 42);
  assert_eq!(range.end_date(), date(2026, 11, 9));
  assert_eq!(range.start(), utc(2026, 9, 27, 22, 0));
  assert_eq!(range.end(), utc(2026, 11, 8, 23, 0));
  assert_eq!(range.end() - range.start(), TimeDelta::hours((42 * 24) + 1));
  should_tile(&range);
}

// ---- ISO weeks ----

#[test]
fn iso_week_snaps_any_date_to_its_monday() {
  let cases = [
    ("2026-10-26", "2026-10-26"), // Monday
    ("2026-10-28", "2026-10-26"), // Wednesday
    ("2026-11-01", "2026-10-26"), // Sunday
    ("2027-01-01", "2026-12-28"), // Friday; the week starts in the previous year (ISO 2026-W53)
    ("2027-01-03", "2026-12-28"), // Sunday of that week
    ("2026-01-01", "2025-12-29"), // ISO 2026-W01 starts in December 2025
    ("2024-12-31", "2024-12-30"), // ISO 2025-W01 starts in December 2024
    ("2024-02-29", "2024-02-26"), // leap day
  ];
  for (any_date, monday) in cases {
    let range = DateRangeWindow::iso_week(any_date.parse().unwrap(), IanaZone::UTC);

    assert_eq!(range.start_date(), monday.parse::<NaiveDate>().unwrap(), "{any_date}");
    assert_eq!(range.start_date().weekday(), Weekday::Mon, "{any_date}");
    assert_eq!(range.days().len(), 7, "{any_date}");
    assert_eq!(range.days()[6].date().weekday(), Weekday::Sun, "{any_date}");
  }
}

#[test]
fn iso_week_week_one_can_start_in_december() {
  let monday = DateRangeWindow::iso_week_start(date(2026, 1, 1));

  assert_eq!(monday, date(2025, 12, 29));
  assert_eq!(monday.iso_week().year(), 2026);
  assert_eq!(monday.iso_week().week(), 1);
}

#[test]
fn iso_week_start_agrees_with_the_iso_calendar_across_year_boundaries() {
  let mut day = date(2019, 12, 1);
  while day <= date(2032, 1, 31) {
    let expected = NaiveDate::from_isoywd_opt(day.iso_week().year(), day.iso_week().week(), Weekday::Mon).unwrap();

    assert_eq!(DateRangeWindow::iso_week_start(day), expected, "{day}");
    day = day + Days::new(1);
  }
}

#[test]
fn iso_week_berlin_fall_back_week_has_169_hours() {
  // Berlin falls back on Sunday 2026-10-25 at 03:00 CEST: that day is 25 hours long.
  let range = DateRangeWindow::iso_week(date(2026, 10, 25), zone("Europe/Berlin"));

  assert_eq!(range.start_date(), date(2026, 10, 19));
  assert_eq!(range.start(), utc(2026, 10, 18, 22, 0));
  assert_eq!(range.end(), utc(2026, 10, 25, 23, 0));
  assert_eq!(range.end() - range.start(), TimeDelta::hours(169));
  assert_eq!(range.days()[6].length(), TimeDelta::hours(25));
  assert!(range.days()[..6].iter().all(|day| day.length() == TimeDelta::hours(24)));
  should_tile(&range);
}

#[test]
fn iso_week_santiago_spring_forward_week_has_167_hours_and_the_skipped_midnight_starts_at_the_transition() {
  // Santiago skips local midnight on Sunday 2026-09-06 (00:00 -04 becomes 01:00 -03).
  let range = DateRangeWindow::iso_week(date(2026, 9, 2), zone("America/Santiago"));

  assert_eq!(range.start_date(), date(2026, 8, 31));
  assert_eq!(range.start(), utc(2026, 8, 31, 4, 0));
  assert_eq!(range.end(), utc(2026, 9, 7, 3, 0));
  assert_eq!(range.end() - range.start(), TimeDelta::hours(167));
  assert_eq!(range.days()[6].start(), utc(2026, 9, 6, 4, 0));
  assert_eq!(range.days()[6].length(), TimeDelta::hours(23));
  should_tile(&range);
}

#[test]
fn iso_week_with_a_skipped_date_has_an_empty_day() {
  // Pacific/Apia skipped Friday 2011-12-30 entirely when it moved across the date line.
  let range = DateRangeWindow::iso_week(date(2011, 12, 30), zone("Pacific/Apia"));

  assert_eq!(range.start_date(), date(2011, 12, 26));
  assert_eq!(range.days().len(), 7);
  let skipped = range.days()[4];
  assert_eq!(skipped.date(), date(2011, 12, 30));
  assert_eq!(skipped.length(), TimeDelta::zero());
  assert_eq!(skipped.start(), utc(2011, 12, 30, 10, 0));
  assert_eq!(range.start(), utc(2011, 12, 26, 10, 0));
  assert_eq!(range.end(), utc(2012, 1, 1, 10, 0));
  assert_eq!(range.end() - range.start(), TimeDelta::hours(6 * 24));
  should_tile(&range);
}
