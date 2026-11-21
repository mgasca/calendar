//! Dates, times and the phrases the views show, ported from the web app's `features/agenda/dayTime.ts`,
//! `EventTimes.tsx` and `features/week/weekDates.ts`, with its tests' expectations.
//!
//! The phrases are English, as the web app's are; the dates and times inside them come from [`Locale`], which
//! formats them in the user's locale as the web app's `Intl` calls do (#1032).

use crate::locale::Locale;
use chrono::{DateTime, Datelike, Days, NaiveDate, Utc};
use chrono_tz::Tz;

/// The years the app accepts, as the API's agenda endpoints do.
pub const MIN_YEAR: i32 = 1900;
pub const MAX_YEAR: i32 = 2200;

/// `value` as a date when it is `YYYY-MM-DD`, a real calendar date and within [`MIN_YEAR`]..=[`MAX_YEAR`].
#[must_use]
pub fn parse_iso_date(value: &str) -> Option<NaiveDate> {
  let bytes = value.as_bytes();
  let shape = bytes.len() == 10
    && bytes[4] == b'-'
    && bytes[7] == b'-'
    && bytes.iter().enumerate().all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit());
  let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok().filter(|_| shape)?;
  in_range(date).then_some(date)
}

/// Whether `date` is within the supported years.
#[must_use]
pub fn in_range(date: NaiveDate) -> bool {
  (MIN_YEAR..=MAX_YEAR).contains(&date.year())
}

/// Whole days from `from` to `to`, positive when `to` is later.
#[must_use]
pub fn days_between(from: NaiveDate, to: NaiveDate) -> i64 {
  (to - from).num_days()
}

/// `date` moved by `days`, or `None` outside the supported years.
#[must_use]
pub fn add_days(date: NaiveDate, days: i64) -> Option<NaiveDate> {
  let moved = if days >= 0 {
    date.checked_add_days(Days::new(days.unsigned_abs()))
  } else {
    date.checked_sub_days(Days::new(days.unsigned_abs()))
  }?;
  in_range(moved).then_some(moved)
}

/// The local date of `instant` in `zone`.
#[must_use]
pub fn local_date(instant: DateTime<Utc>, zone: Tz) -> NaiveDate {
  instant.with_timezone(&zone).date_naive()
}

/// "Today", "Yesterday", "Tomorrow", "3 days ago" or "In 3 days".
#[must_use]
pub fn relative_day(date: NaiveDate, today: NaiveDate) -> String {
  match days_between(today, date) {
    0 => "Today".to_owned(),
    -1 => "Yesterday".to_owned(),
    1 => "Tomorrow".to_owned(),
    days if days < 0 => format!("{} days ago", -days),
    days => format!("In {days} days"),
  }
}

/// "This week", "Last week", "Next week", "3 weeks ago" or "In 3 weeks".
#[must_use]
pub fn relative_week(week_start: NaiveDate, this_week: NaiveDate) -> String {
  match days_between(this_week, week_start) / 7 {
    0 => "This week".to_owned(),
    -1 => "Last week".to_owned(),
    1 => "Next week".to_owned(),
    weeks if weeks < 0 => format!("{} weeks ago", -weeks),
    weeks => format!("In {weeks} weeks"),
  }
}

/// The Monday of the ISO week holding `date`.
#[must_use]
pub fn iso_week_start(date: NaiveDate) -> NaiveDate {
  date - Days::new(u64::from(date.weekday().num_days_from_monday()))
}

/// The seven dates of the week starting on `week_start`.
#[must_use]
pub fn week_dates(week_start: NaiveDate) -> [NaiveDate; 7] {
  std::array::from_fn(|i| week_start + Days::new(i as u64))
}

/// Where a timed event stands relative to now on today's agenda.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventStatus {
  /// Ended: "Earlier".
  Past,
  /// In progress: "Now".
  Current,
  /// Starts earliest of those to come (every event starting then): "Next".
  Next,
  /// Starts later: no badge.
  Upcoming,
}

impl EventStatus {
  /// The badge text, if any.
  #[must_use]
  pub fn badge(self) -> Option<&'static str> {
    match self {
      EventStatus::Past => Some("Earlier"),
      EventStatus::Current => Some("Now"),
      EventStatus::Next => Some("Next"),
      EventStatus::Upcoming => None,
    }
  }
}

/// The status of each event, given its `(start, end)`, in order.
#[must_use]
pub fn event_statuses(events: &[(DateTime<Utc>, DateTime<Utc>)], now: DateTime<Utc>) -> Vec<EventStatus> {
  let next_start = events.iter().map(|(start, _)| *start).filter(|start| *start > now).min();
  events
    .iter()
    .map(|(start, end)| {
      if *end <= now {
        EventStatus::Past
      } else if *start <= now {
        EventStatus::Current
      } else if Some(*start) == next_start {
        EventStatus::Next
      } else {
        EventStatus::Upcoming
      }
    })
    .collect()
}

/// The time text of a timed event within one day; `relative` when the day shown is today.
#[must_use]
pub fn event_times(
  locale: &Locale,
  start: DateTime<Utc>,
  end: DateTime<Utc>,
  starts_before_day: bool,
  ends_after_day: bool,
  relative: bool,
  zone: Tz,
) -> String {
  let (before, after) = if relative {
    ("yesterday", "tomorrow")
  } else {
    ("the previous day", "the next day")
  };
  match (starts_before_day, ends_after_day) {
    (true, true) => format!("Continues from {before} to {after}"),
    (true, false) => format!("Continues from {before}, until {}", locale.time(end, zone)),
    (false, true) => format!("From {}, continues {after}", locale.time(start, zone)),
    (false, false) => format!("{} – {}", locale.time(start, zone), locale.time(end, zone)),
  }
}

/// How late an overdue task is: "Overdue", "Overdue since yesterday" or "Overdue by 3 days".
#[must_use]
pub fn describe_overdue(due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>, today: NaiveDate, zone: Tz) -> String {
  let Some(due) = due_date.or_else(|| due_at.map(|at| local_date(at, zone))) else {
    return "Overdue".to_owned();
  };
  match days_between(due, today) {
    days if days <= 0 => "Overdue".to_owned(),
    1 => "Overdue since yesterday".to_owned(),
    days => format!("Overdue by {days} days"),
  }
}

/// A timed task that is still open and due at or before `now`.
#[must_use]
pub fn is_past_due(is_completed: bool, due_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
  !is_completed && due_at.is_some_and(|at| at <= now)
}

/// Open items first, then completed ones; otherwise the server's order.
#[must_use]
pub fn open_first<T: Clone>(items: &[T], is_completed: impl Fn(&T) -> bool) -> Vec<T> {
  items
    .iter()
    .filter(|t| !is_completed(t))
    .chain(items.iter().filter(|t| is_completed(t)))
    .cloned()
    .collect()
}

/// A collection's length as a count (lengths never come near `i64::MAX`).
#[must_use]
pub fn len(n: usize) -> i64 {
  i64::try_from(n).unwrap_or(i64::MAX)
}

/// "1 event" or "3 events".
#[must_use]
pub fn count(n: i64, one: &str, many: &str) -> String {
  format!("{n} {}", if n == 1 { one } else { many })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
  }
  fn t(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
  }

  #[test]
  fn dates_are_validated_as_the_web_app_validates_them() {
    assert_eq!(parse_iso_date("2026-10-26"), Some(d("2026-10-26")));
    for bad in [
      "2026-02-30",
      "2026-1-05",
      "26-10-2026",
      "1899-12-31",
      "2201-01-01",
      "2026-10-26x",
      "+026-10-26",
    ] {
      assert_eq!(parse_iso_date(bad), None, "{bad}");
    }
    assert!(parse_iso_date("1900-01-01").is_some() && parse_iso_date("2200-12-31").is_some());
    assert_eq!(add_days(d("2200-12-31"), 1), None);
    assert_eq!(add_days(d("1900-01-01"), -1), None);
  }

  #[test]
  fn relative_days_and_weeks() {
    assert_eq!(relative_day(d("2026-10-26"), d("2026-10-26")), "Today");
    assert_eq!(relative_day(d("2026-10-25"), d("2026-10-26")), "Yesterday");
    assert_eq!(relative_day(d("2026-10-27"), d("2026-10-26")), "Tomorrow");
    assert_eq!(relative_day(d("2026-10-20"), d("2026-10-26")), "6 days ago");
    assert_eq!(relative_day(d("2026-11-02"), d("2026-10-26")), "In 7 days");
    assert_eq!(relative_week(d("2026-10-19"), d("2026-10-26")), "Last week");
    assert_eq!(relative_week(d("2026-11-09"), d("2026-10-26")), "In 2 weeks");
  }

  #[test]
  fn weeks_start_on_monday() {
    assert_eq!(iso_week_start(d("2026-11-01")), d("2026-10-26"));
    assert_eq!(iso_week_start(d("2026-10-26")), d("2026-10-26"));
    assert_eq!(week_dates(d("2026-10-26"))[6], d("2026-11-01"));
  }

  #[test]
  fn times_are_in_the_users_zone() {
    let madrid = chrono_tz::Europe::Madrid;
    assert_eq!(local_date(t("2026-10-26T23:30:00Z"), madrid), d("2026-10-27"));
  }

  #[test]
  fn event_times_say_how_an_event_crosses_the_day() {
    let (s, e, z) = (t("2026-10-26T08:00:00Z"), t("2026-10-26T09:00:00Z"), chrono_tz::UTC);
    let gb = &Locale::parse("en-GB").unwrap();
    assert_eq!(event_times(gb, s, e, false, false, true, z), "08:00 – 09:00");
    assert_eq!(event_times(gb, s, e, true, true, true, z), "Continues from yesterday to tomorrow");
    assert_eq!(
      event_times(gb, s, e, true, false, false, z),
      "Continues from the previous day, until 09:00"
    );
    assert_eq!(event_times(gb, s, e, false, true, false, z), "From 08:00, continues the next day");
  }

  #[test]
  fn statuses_mark_every_event_that_starts_next() {
    use EventStatus::{Current, Next, Past, Upcoming};
    let now = t("2026-10-26T10:00:00Z");
    let events = [
      (t("2026-10-26T08:00:00Z"), t("2026-10-26T09:00:00Z")),
      (t("2026-10-26T09:30:00Z"), t("2026-10-26T10:30:00Z")),
      (t("2026-10-26T11:00:00Z"), t("2026-10-26T12:00:00Z")),
      (t("2026-10-26T11:00:00Z"), t("2026-10-26T11:15:00Z")),
      (t("2026-10-26T13:00:00Z"), t("2026-10-26T14:00:00Z")),
    ];
    assert_eq!(event_statuses(&events, now), [Past, Current, Next, Next, Upcoming]);
    assert_eq!(Upcoming.badge(), None);
  }

  #[test]
  fn overdue_is_counted_in_the_users_days() {
    let today = d("2026-10-26");
    let due_at = Some(t("2026-10-24T23:30:00Z"));
    assert_eq!(
      describe_overdue(None, due_at, today, chrono_tz::Europe::Madrid),
      "Overdue since yesterday"
    );
    assert_eq!(describe_overdue(None, due_at, today, chrono_tz::UTC), "Overdue by 2 days");
    assert_eq!(describe_overdue(None, None, today, chrono_tz::UTC), "Overdue");
    assert_eq!(describe_overdue(Some(today), None, today, chrono_tz::UTC), "Overdue");
  }

  #[test]
  fn open_tasks_come_first_in_server_order() {
    let items = [(1, true), (2, false), (3, true), (4, false)];
    assert_eq!(open_first(&items, |i| i.1).iter().map(|i| i.0).collect::<Vec<_>>(), [2, 4, 1, 3]);
    assert!(is_past_due(false, Some(t("2026-10-26T09:00:00Z")), t("2026-10-26T09:00:00Z")));
    assert!(!is_past_due(true, Some(t("2026-10-26T09:00:00Z")), t("2026-10-26T10:00:00Z")));
    assert_eq!(count(1, "event", "events"), "1 event");
    assert_eq!(count(0, "event", "events"), "0 events");
  }
}
