//! Ports `AgendaAgreementTests`, and the data half of `WeekAgendaAgreementTests`: the agenda's SQL must select
//! exactly what the pure rules in `calendar_domain::agenda::day_inclusion` select. Rows are arranged on and
//! around every window edge, for ordinary, DST, skipped-midnight and skipped-date days, and the repository's
//! answer is compared with the domain predicates evaluated in memory.
//!
//! The other half of `WeekAgendaAgreementTests` (a week's day equals the day agenda item for item and in the
//! same order) needs the read model's bucketing and ordering, which live in the API crate.

use std::collections::BTreeSet;

use calendar_domain::agenda::day_inclusion::{event_occurs_on, is_due_today, is_included_in_day, is_overdue};
use calendar_domain::events::CalendarEvent;
use calendar_domain::tasks::TodoTask;
use calendar_domain::time::{DateRangeWindow, DayWindow, time_zones};
use calendar_infrastructure::agenda::{self, AgendaRows};
use chrono::{DateTime, Days, NaiveDate, TimeDelta, Utc};
use uuid::Uuid;

use crate::repositories::{OWNER, all_day_event, fixture, seed, task, timed_event};

const DAY_SCENARIOS: [(&str, &str); 8] = [
  ("2026-10-26", "UTC"),
  ("2026-10-26", "Asia/Kolkata"),
  ("2026-11-01", "America/New_York"),
  ("2026-03-08", "America/New_York"),
  ("2026-09-06", "America/Santiago"),
  ("2024-10-06", "America/Asuncion"),
  ("2011-12-30", "Pacific/Apia"),
  ("2026-10-26", "Pacific/Kiritimati"),
];

const WEEK_SCENARIOS: [(&str, &str); 8] = [
  ("2026-10-28", "UTC"),
  ("2026-10-28", "Asia/Kolkata"),
  ("2026-10-28", "America/New_York"), // falls back on Sunday 2026-11-01
  ("2026-03-08", "America/New_York"), // springs forward on Sunday 2026-03-08
  ("2026-10-25", "Europe/Berlin"),    // falls back on Sunday 2026-10-25
  ("2026-09-06", "America/Santiago"), // skips midnight on Sunday 2026-09-06
  ("2011-12-30", "Pacific/Apia"),     // skips Friday 2011-12-30 entirely
  ("2026-10-28", "Pacific/Kiritimati"),
];

fn ids<T>(items: impl IntoIterator<Item = T>, id: impl Fn(T) -> Uuid) -> BTreeSet<Uuid> {
  items.into_iter().map(id).collect()
}

fn add_days(date: NaiveDate, days: i64) -> NaiveDate {
  if days >= 0 {
    date + Days::new(days.unsigned_abs())
  } else {
    date - Days::new(days.unsigned_abs())
  }
}

fn distinct_in_order(mut points: Vec<DateTime<Utc>>) -> Vec<DateTime<Utc>> {
  points.sort_unstable();
  points.dedup();
  points
}

/// Instants on and around both edges (whole seconds: PostgreSQL keeps microseconds).
fn day_edge_points(window: &DayWindow) -> Vec<DateTime<Utc>> {
  let (start, end) = (window.start(), window.end());
  let mut points = vec![
    start - TimeDelta::hours(26),
    start - TimeDelta::hours(1),
    start - TimeDelta::seconds(1),
    start,
    start + TimeDelta::seconds(1),
    end - TimeDelta::seconds(1),
    end,
    end + TimeDelta::seconds(1),
    end + TimeDelta::hours(1),
    end + TimeDelta::hours(26),
  ];
  if window.length() > TimeDelta::hours(2) {
    points.push(start + window.length() / 2);
  }
  distinct_in_order(points)
}

fn day_events(date: NaiveDate, zone_id: &str, window: &DayWindow) -> Vec<CalendarEvent> {
  let points = day_edge_points(window);
  let mut events = Vec::new();
  for i in 0..points.len() {
    for j in i + 1..points.len() {
      events.push(timed_event(OWNER, &format!("timed {i}-{j}"), points[i], points[j], zone_id));
    }
  }
  for start in -3..=3 {
    for end in start + 1..=4 {
      events.push(all_day_event(
        OWNER,
        &format!("all-day {start}..{end}"),
        add_days(date, start),
        add_days(date, end),
      ));
    }
  }
  events
}

fn tasks_around(dates: &[NaiveDate], points: &[DateTime<Utc>], completions: &[Option<DateTime<Utc>>]) -> Vec<TodoTask> {
  let mut tasks = Vec::new();
  for completed_at in completions {
    for date in dates {
      tasks.push(task(&format!("date {date}"), Some(*date), None, *completed_at));
    }
    for due_at in points {
      tasks.push(task(&format!("at {due_at}"), None, Some(*due_at), *completed_at));
    }
    tasks.push(task("undated", None, None, *completed_at));
  }
  tasks
}

fn day_tasks(date: NaiveDate, window: &DayWindow) -> Vec<TodoTask> {
  let points = day_edge_points(window);
  let completions: Vec<Option<DateTime<Utc>>> = std::iter::once(None).chain(points.iter().copied().map(Some)).collect();
  let dates: Vec<NaiveDate> = (-2..=2).map(|offset| add_days(date, offset)).collect();
  tasks_around(&dates, &points, &completions)
}

#[tokio::test]
async fn the_agenda_selects_exactly_what_day_inclusion_selects() {
  for (date_text, zone_id) in DAY_SCENARIOS {
    let context = format!("{date_text} {zone_id}");
    let date: NaiveDate = date_text.parse().unwrap();
    let zone = time_zones::find_iana(zone_id).unwrap();
    let range = DateRangeWindow::create(date, 1, zone).unwrap();
    let window = range.days()[0];
    let events = day_events(date, zone_id, &window);
    let tasks = day_tasks(date, &window);
    let mut f = fixture().await;
    seed(&mut f.conn, &events, &tasks).await;
    assert!(events.len() > 40, "{context}");

    // A one-day range whose overdue list is judged against the day itself, as the day endpoint reads it.
    let agenda = agenda::read(&mut f.conn, OWNER, &range, Some(&window), 20).await.unwrap();
    let everything = agenda::read(&mut f.conn, OWNER, &range, Some(&window), 10_000).await.unwrap();

    let expected_all_day = ids(
      events.iter().filter(|e| e.is_all_day() && event_occurs_on(e, &window)),
      CalendarEvent::id,
    );
    let expected_timed = ids(
      events.iter().filter(|e| !e.is_all_day() && event_occurs_on(e, &window)),
      CalendarEvent::id,
    );
    let expected_due = ids(
      tasks.iter().filter(|t| is_included_in_day(t, &window) && is_due_today(t, &window)),
      TodoTask::id,
    );
    let expected_overdue: Vec<&TodoTask> = tasks
      .iter()
      .filter(|t| is_included_in_day(t, &window) && is_overdue(t, &window))
      .collect();
    let expected_overdue_ids = ids(expected_overdue.iter().copied(), TodoTask::id);

    assert_eq!(ids(&agenda.all_day_events, |e| e.id), expected_all_day, "{context}");
    assert_eq!(ids(&agenda.timed_events, |e| e.id), expected_timed, "{context}");
    assert_eq!(agenda.timed_events.len(), expected_timed.len(), "{context}");
    assert_eq!(ids(&agenda.due_tasks, |t| t.id), expected_due, "{context}");
    assert_eq!(agenda.due_tasks.len(), expected_due.len(), "{context}");
    let overdue = agenda.overdue.as_ref().unwrap();
    assert_eq!(overdue.tasks.len(), expected_overdue.len().min(20), "{context}");
    assert_eq!(overdue.total, i64::try_from(expected_overdue.len()).unwrap(), "{context}");
    assert!(overdue.tasks.iter().all(|t| expected_overdue_ids.contains(&t.id)), "{context}");
    // Beyond the .NET test: the open total, and the whole list rather than its first twenty.
    assert_eq!(
      overdue.open_total,
      i64::try_from(expected_overdue.iter().filter(|t| !t.is_completed()).count()).unwrap(),
      "{context}"
    );
    let all_overdue = everything.overdue.unwrap();
    assert_eq!(ids(&all_overdue.tasks, |t| t.id), expected_overdue_ids, "{context}");
    assert_eq!(all_overdue.tasks.len(), expected_overdue.len(), "{context}");

    // The scenario must actually select and reject things, or the comparison proves nothing.
    if window.length() > TimeDelta::zero() {
      assert!(!agenda.timed_events.is_empty(), "{context}");
      assert!(
        agenda.timed_events.len() < events.iter().filter(|e| !e.is_all_day()).count(),
        "{context}"
      );
    }
    assert!(!agenda.due_tasks.is_empty(), "{context}");
    assert!(!overdue.tasks.is_empty(), "{context}");
  }
}

/// Instants on and around every day edge, and the middle of each day.
fn week_edge_points(range: &DateRangeWindow) -> Vec<DateTime<Utc>> {
  let mut points = vec![
    range.start() - TimeDelta::hours(26),
    range.end() + TimeDelta::seconds(1),
    range.end() + TimeDelta::hours(26),
  ];
  for day in range.days() {
    points.extend([
      day.start() - TimeDelta::seconds(1),
      day.start(),
      day.start() + TimeDelta::seconds(1),
      day.end(),
    ]);
    if day.length() > TimeDelta::hours(2) {
      points.push(day.start() + day.length() / 2);
    }
  }
  distinct_in_order(points)
}

fn week_events(range: &DateRangeWindow, zone_id: &str) -> Vec<CalendarEvent> {
  let points = week_edge_points(range);
  let mut events = Vec::new();
  for i in 0..points.len() {
    // Short events near each point, events crossing one or two day edges, and a few long ones.
    let mut ends = vec![i + 1, i + 2, i + 4, i + 9, points.len() - 1];
    ends.retain(|j| *j > i && *j < points.len());
    ends.sort_unstable();
    ends.dedup();
    for j in ends {
      events.push(timed_event(OWNER, &format!("timed {i}-{j}"), points[i], points[j], zone_id));
      events.push(timed_event(OWNER, &format!("Timed {i}-{j}"), points[i], points[j], zone_id));
    }
  }
  for start in -2..=8 {
    for length in [1, 2, 9] {
      events.push(all_day_event(
        OWNER,
        &format!("all-day {start}+{length}"),
        add_days(range.start_date(), start),
        add_days(range.start_date(), start + length),
      ));
    }
  }
  events
}

fn week_tasks(range: &DateRangeWindow) -> Vec<TodoTask> {
  let monday = range.days()[0];
  let completions = [
    None,
    Some(monday.start() - TimeDelta::seconds(1)),
    Some(monday.start()),
    Some(monday.start() + TimeDelta::hours(1)),
    Some(monday.end()),
    Some(range.end()),
  ];
  let dates: Vec<NaiveDate> = (-2..=8).map(|offset| add_days(range.start_date(), offset)).collect();
  tasks_around(&dates, &week_edge_points(range), &completions)
}

fn selected(rows: &AgendaRows) -> (BTreeSet<Uuid>, BTreeSet<Uuid>, BTreeSet<Uuid>) {
  (
    ids(&rows.all_day_events, |e| e.id),
    ids(&rows.timed_events, |e| e.id),
    ids(&rows.due_tasks, |t| t.id),
  )
}

/// The range read and the day read must never disagree: a week selects exactly what its seven days select,
/// each day read on its own selects what `day_inclusion` puts on it, and with today on the Monday the week's
/// overdue list is the Monday's (nothing due in the week is overdue yet).
#[tokio::test]
async fn a_week_selects_exactly_what_its_days_select() {
  for (date_text, zone_id) in WEEK_SCENARIOS {
    let context = format!("{date_text} {zone_id}");
    let zone = time_zones::find_iana(zone_id).unwrap();
    let range = DateRangeWindow::iso_week(date_text.parse().unwrap(), zone);
    let monday = range.days()[0];
    let events = week_events(&range, zone_id);
    let tasks = week_tasks(&range);
    let mut f = fixture().await;
    seed(&mut f.conn, &events, &tasks).await;

    let week = agenda::read(&mut f.conn, OWNER, &range, Some(&monday), 20).await.unwrap();
    assert_eq!(range.days().len(), 7, "{context}");

    let mut union = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    let mut days_with_events = 0;
    for (i, window) in range.days().iter().enumerate() {
      let day_range = DateRangeWindow::create(window.date(), 1, zone).unwrap();
      let day = agenda::read(&mut f.conn, OWNER, &day_range, Some(window), 20).await.unwrap();
      let on_day = format!("{context}, {}", window.date());

      let expected = (
        ids(
          events.iter().filter(|e| e.is_all_day() && event_occurs_on(e, window)),
          CalendarEvent::id,
        ),
        ids(
          events.iter().filter(|e| !e.is_all_day() && event_occurs_on(e, window)),
          CalendarEvent::id,
        ),
        ids(tasks.iter().filter(|t| is_due_today(t, window)), TodoTask::id),
      );
      assert_eq!(selected(&day), expected, "{on_day}");
      assert!(!expected.2.is_empty(), "{on_day}");
      days_with_events += usize::from(!expected.1.is_empty());
      union.0.extend(expected.0);
      union.1.extend(expected.1);
      union.2.extend(expected.2);

      if i == 0 {
        let overdue = day.overdue.unwrap();
        assert_eq!(week.overdue.as_ref(), Some(&overdue), "{on_day}");
        assert!(!overdue.tasks.is_empty(), "{on_day}");
      }
    }

    assert_eq!(selected(&week), union, "{context}");
    assert_eq!(week.timed_events.len(), union.1.len(), "{context}");
    assert_eq!(week.due_tasks.len(), union.2.len(), "{context}");

    // The scenario must place things on several days, or the comparison proves little.
    assert!(days_with_events > 4, "{context}");
    assert!(!week.all_day_events.is_empty(), "{context}");
  }
}
