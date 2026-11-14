//! Ports `WeekAgendaAgreementTests.cs`: the week and day read models must never disagree. For rows arranged
//! on and around every day edge of a week, in ordinary, DST, skipped-midnight and skipped-date weeks,
//! `days[i]` of the week equals the day agenda for `weekStart + i`, item for item and in the same order.

use crate::common::*;
use calendar_domain::time::{DateRangeWindow, time_zones};

/// Instants on and around every day edge, and the middle of each day (whole seconds: PostgreSQL keeps
/// microseconds).
fn edge_points(range: &DateRangeWindow) -> Vec<DateTime<Utc>> {
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
  points.sort_unstable();
  points.dedup();
  points
}

fn build_events(range: &DateRangeWindow, zone_id: &str) -> Vec<CalendarEvent> {
  let points = edge_points(range);
  let mut built = Vec::new();
  for i in 0..points.len() {
    // Short events near each point, events crossing one or two day edges, and a few long ones.
    let mut ends: Vec<usize> = Vec::new();
    for j in [i + 1, i + 2, i + 4, i + 9, points.len() - 1] {
      if j > i && j < points.len() && !ends.contains(&j) {
        ends.push(j);
      }
    }
    for j in ends {
      for title in [format!("timed {i}-{j}"), format!("Timed {i}-{j}")] {
        // The pair differs only by case: ties broken by id.
        built.push(CalendarEvent::create(OWNER, &title, points[i], points[j], zone_id, None, None).expect("a valid event"));
      }
    }
  }

  for start in -2..=8_i64 {
    for length in [1, 2, 9_i64] {
      built.push(
        CalendarEvent::create_all_day(
          OWNER,
          &format!("all-day {start}+{length}"),
          range.start_date() + TimeDelta::days(start),
          range.start_date() + TimeDelta::days(start + length),
          None,
          None,
        )
        .expect("a valid event"),
      );
    }
  }

  built
}

fn build_tasks(range: &DateRangeWindow) -> Vec<TodoTask> {
  let points = edge_points(range);
  let monday = range.days()[0];
  let completions = [
    None,
    Some(monday.start() - TimeDelta::seconds(1)),
    Some(monday.start()),
    Some(monday.start() + TimeDelta::hours(1)),
    Some(monday.end()),
    Some(range.end()),
  ];
  let mut built = Vec::new();
  for completed_at in completions {
    for offset in -2..=8_i64 {
      built.push(task_with(
        OWNER,
        &format!("date {offset}"),
        Some(range.start_date() + TimeDelta::days(offset)),
        None,
        completed_at,
      ));
    }

    for due_at in &points {
      built.push(task_with(
        OWNER,
        &format!("at {}", due_at.to_rfc3339()),
        None,
        Some(*due_at),
        completed_at,
      ));
    }

    built.push(task_with(OWNER, "undated", None, None, completed_at));
  }

  built
}

async fn each_day_of_the_week_equals_the_day_agenda(date_text: &str, zone_id: &str) {
  let app = TestApp::start().await;
  let zone = time_zones::find_iana(zone_id).expect("a valid zone");
  let range = DateRangeWindow::iso_week(date_text.parse().expect("a valid date"), zone);
  let week_start = range.start_date().to_string();
  app.seed(&build_events(&range, zone_id), &build_tasks(&range)).await;

  // With today on the Monday, the week's overdue list is the Monday's: nothing due in the week is overdue yet.
  let week = app.get_week_agenda(date_text, zone_id, &week_start).await;

  assert_eq!(week.week_start, range.start_date());
  assert_eq!(week.days.len(), 7);
  for (date, week_day) in range.start_date().iter_days().zip(&week.days) {
    let day = app.get_agenda(&date.to_string(), zone_id).await;

    assert_eq!(week_day.date, day.date);
    assert_eq!(week_day.window, day.window);
    assert_eq!(week_day.events, day.events, "events on {date}");
    assert_eq!(week_day.tasks, day.tasks.due_today, "tasks on {date}");
    let covering: Vec<AllDayEventItem> = week
      .all_day_events
      .iter()
      .filter(|event| event.start_date <= date && event.end_date > date)
      .cloned()
      .collect();
    assert_eq!(covering, day.all_day_events, "all-day events on {date}");

    if date == range.start_date() {
      assert_eq!(week.overdue.as_ref().expect("an overdue list"), &day.tasks.overdue);
      assert_ne!(day.tasks.overdue, Vec::new());
    }
  }

  // The scenario must place things on several days, or the comparison proves little.
  assert!(week.days.iter().filter(|day| !day.events.is_empty()).count() > 4);
  assert_eq!(week.days.iter().filter(|day| !day.tasks.is_empty()).count(), 7);
  assert_ne!(week.all_day_events, Vec::new());
}

scenarios! {
  each_day_of_the_week_equals_the_day_agenda;
  each_day_of_the_week_equals_the_day_agenda_utc: "2026-10-28", "UTC";
  each_day_of_the_week_equals_the_day_agenda_kolkata: "2026-10-28", "Asia/Kolkata";
  // Falls back on Sunday 2026-11-01.
  each_day_of_the_week_equals_the_day_agenda_new_york_fall_back: "2026-10-28", "America/New_York";
  // Springs forward on Sunday 2026-03-08.
  each_day_of_the_week_equals_the_day_agenda_new_york_spring_forward: "2026-03-08", "America/New_York";
  // Falls back on Sunday 2026-10-25.
  each_day_of_the_week_equals_the_day_agenda_berlin_fall_back: "2026-10-25", "Europe/Berlin";
  // Skips midnight on Sunday 2026-09-06.
  each_day_of_the_week_equals_the_day_agenda_santiago_skipped_midnight: "2026-09-06", "America/Santiago";
  // Skips Friday 2011-12-30 entirely.
  each_day_of_the_week_equals_the_day_agenda_apia_skipped_date: "2011-12-30", "Pacific/Apia";
  each_day_of_the_week_equals_the_day_agenda_kiritimati: "2026-10-28", "Pacific/Kiritimati";
}
