//! Ports `AgendaAgreementTests.cs`: the agenda's SQL must select exactly what the pure rules in
//! `calendar_domain::agenda::day_inclusion` select. This arranges rows on and around every window edge, for
//! ordinary, DST, skipped-midnight and skipped-date days, and compares the API's answer with the domain
//! predicates evaluated in memory.

mod common;

use calendar_domain::agenda::day_inclusion;
use calendar_domain::time::{DayWindow, time_zones};
use calendar_infrastructure::{OwnerId, events, tasks};
use chrono::Days;
use common::*;

fn add_days(date: NaiveDate, days: i64) -> NaiveDate {
  if days >= 0 {
    date + Days::new(days.unsigned_abs())
  } else {
    date - Days::new(days.unsigned_abs())
  }
}

fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
  ids.sort_unstable();
  ids
}

/// Instants on and around both edges (whole seconds: PostgreSQL keeps microseconds).
fn edge_points(window: &DayWindow) -> Vec<DateTime<Utc>> {
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
  points.sort_unstable();
  points.dedup();
  points
}

fn build_events(date: NaiveDate, zone_id: &str, window: &DayWindow) -> Vec<CalendarEvent> {
  let points = edge_points(window);
  let mut built = Vec::new();
  for i in 0..points.len() {
    for j in i + 1..points.len() {
      built
        .push(CalendarEvent::create(OWNER, &format!("timed {i}-{j}"), points[i], points[j], zone_id, None, None).expect("a valid event"));
    }
  }

  for start in -3..=3_i64 {
    for end in start + 1..=4 {
      built.push(
        CalendarEvent::create_all_day(
          OWNER,
          &format!("all-day {start}..{end}"),
          add_days(date, start),
          add_days(date, end),
          None,
          None,
        )
        .expect("a valid event"),
      );
    }
  }

  built
}

fn build_tasks(date: NaiveDate, window: &DayWindow) -> Vec<TodoTask> {
  let points = edge_points(window);
  let completions: Vec<Option<DateTime<Utc>>> = std::iter::once(None).chain(points.iter().copied().map(Some)).collect();
  let mut built = Vec::new();
  for completed_at in completions {
    for offset in -2..=2_i64 {
      built.push(build_task(
        &format!("date {offset}"),
        Some(add_days(date, offset)),
        None,
        completed_at,
      ));
    }

    for due_at in &points {
      built.push(build_task(
        &format!("at {}", due_at.to_rfc3339()),
        None,
        Some(*due_at),
        completed_at,
      ));
    }

    built.push(build_task("undated", None, None, completed_at));
  }

  built
}

fn build_task(title: &str, due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>, completed_at: Option<DateTime<Utc>>) -> TodoTask {
  let mut built = task(title, due_date, due_at);
  if let Some(at) = completed_at {
    built.complete(at);
  }
  built
}

async fn api_selects_exactly_what_day_inclusion_selects(date_text: &str, zone_id: &str) {
  let app = TestApp::start().await;
  let date: NaiveDate = date_text.parse().expect("a valid date");
  let zone = time_zones::find_iana(zone_id).expect("a valid zone");
  let window = DayWindow::create(date, zone);

  let seeded_events = build_events(date, zone_id, &window);
  let seeded_tasks = build_tasks(date, &window);
  app.seed(&seeded_events, &seeded_tasks).await;

  // The rows are read back from the database, as the schema owner, so the comparison is with what is stored.
  let mut connection = app.database().migrator_connection().await;
  let mut stored_events = Vec::new();
  for event in &seeded_events {
    let found = events::find(&mut connection, OwnerId(OWNER), event.id())
      .await
      .expect("the event is read")
      .expect("the event is stored");
    stored_events.push(found.entity);
  }
  let mut stored_tasks = Vec::new();
  for seeded in &seeded_tasks {
    let found = tasks::find(&mut connection, OwnerId(OWNER), seeded.id())
      .await
      .expect("the task is read")
      .expect("the task is stored");
    stored_tasks.push(found.entity);
  }
  assert_eq!(stored_events, seeded_events);
  assert_eq!(stored_tasks, seeded_tasks);
  assert!(stored_events.len() > 40);

  let agenda = app.get_agenda(date_text, zone_id).await;

  let expected_all_day: Vec<Uuid> = stored_events
    .iter()
    .filter(|event| event.is_all_day() && day_inclusion::event_occurs_on(event, &window))
    .map(CalendarEvent::id)
    .collect();
  let expected_timed: Vec<Uuid> = stored_events
    .iter()
    .filter(|event| !event.is_all_day() && day_inclusion::event_occurs_on(event, &window))
    .map(CalendarEvent::id)
    .collect();
  let expected_due: Vec<Uuid> = stored_tasks
    .iter()
    .filter(|task| day_inclusion::is_included_in_day(task, &window) && day_inclusion::is_due_today(task, &window))
    .map(TodoTask::id)
    .collect();
  let expected_overdue: Vec<Uuid> = stored_tasks
    .iter()
    .filter(|task| day_inclusion::is_included_in_day(task, &window) && day_inclusion::is_overdue(task, &window))
    .map(TodoTask::id)
    .collect();

  assert_eq!(
    sorted(agenda.all_day_events.iter().map(|event| event.id).collect()),
    sorted(expected_all_day)
  );
  assert_eq!(sorted(agenda.events.iter().map(|event| event.id).collect()), sorted(expected_timed));
  assert_eq!(
    sorted(agenda.tasks.due_today.iter().map(|task| task.id).collect()),
    sorted(expected_due)
  );
  assert_eq!(agenda.tasks.overdue.len(), expected_overdue.len().min(20));
  assert_eq!(
    agenda.tasks.overdue_total,
    i32::try_from(expected_overdue.len()).expect("a small count")
  );
  assert!(agenda.tasks.overdue.iter().all(|task| expected_overdue.contains(&task.id)));

  // The scenario must actually select and reject things, or the comparison proves nothing.
  if window.length() > TimeDelta::zero() {
    assert_ne!(agenda.events, Vec::new());
    assert!(agenda.events.len() < stored_events.iter().filter(|event| !event.is_all_day()).count());
  }

  assert_ne!(agenda.tasks.due_today, Vec::new());
  assert_ne!(agenda.tasks.overdue, Vec::new());
}

macro_rules! scenarios {
  ($($name:ident: $date:literal, $zone:literal;)*) => {
    $(
      #[tokio::test]
      async fn $name() {
        api_selects_exactly_what_day_inclusion_selects($date, $zone).await;
      }
    )*
  };
}

scenarios! {
  api_selects_exactly_what_day_inclusion_selects_utc: "2026-10-26", "UTC";
  api_selects_exactly_what_day_inclusion_selects_kolkata: "2026-10-26", "Asia/Kolkata";
  api_selects_exactly_what_day_inclusion_selects_new_york_fall_back: "2026-11-01", "America/New_York";
  api_selects_exactly_what_day_inclusion_selects_new_york_spring_forward: "2026-03-08", "America/New_York";
  api_selects_exactly_what_day_inclusion_selects_santiago_skipped_midnight: "2026-09-06", "America/Santiago";
  api_selects_exactly_what_day_inclusion_selects_asuncion_skipped_midnight: "2024-10-06", "America/Asuncion";
  api_selects_exactly_what_day_inclusion_selects_apia_skipped_date: "2011-12-30", "Pacific/Apia";
  api_selects_exactly_what_day_inclusion_selects_kiritimati: "2026-10-26", "Pacific/Kiritimati";
}
