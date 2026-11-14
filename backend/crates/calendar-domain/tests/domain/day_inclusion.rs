//! Port of `Calendar.Domain.Tests/Agenda/DayInclusionTests.cs`.
//!
//! `Event_Null_Throws` and `Task_Null_Throws` have no counterpart: a reference cannot be null here. One .NET
//! tick (100 ns) is the smallest step the C# tests take around a boundary; `TICK` keeps that step.

use calendar_domain::agenda::day_inclusion;
use calendar_domain::events::CalendarEvent;
use calendar_domain::tasks::TodoTask;
use calendar_domain::time::{DayWindow, time_zones};
use chrono::{DateTime, Days, NaiveDate, TimeDelta, TimeZone, Utc};
use uuid::Uuid;

const ZONE: &str = "America/New_York";
const TICK: TimeDelta = TimeDelta::nanoseconds(100);

fn owner() -> Uuid {
  Uuid::from_u128(0x0a0b_0c0d_0e0f_4a1b_8c2d_3e4f_5a6b_7c8d)
}

fn today() -> NaiveDate {
  NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
}

fn day(offset: i64) -> NaiveDate {
  today() + TimeDelta::days(offset)
}

/// New York, 2026-10-26: `[04:00Z, 2026-10-27T04:00Z)`.
fn window() -> DayWindow {
  DayWindow::create(today(), time_zones::find_iana(ZONE).unwrap())
}

fn at(day_offset: i64, hour: u32, minute: u32) -> DateTime<Utc> {
  Utc.with_ymd_and_hms(2026, 10, 26, hour, minute, 0).unwrap() + TimeDelta::days(day_offset)
}

fn timed(start: DateTime<Utc>, end: DateTime<Utc>) -> CalendarEvent {
  CalendarEvent::create(owner(), "E", start, end, ZONE, None, None).unwrap()
}

fn all_day(start_offset: i64, end_offset: i64) -> CalendarEvent {
  CalendarEvent::create_all_day(owner(), "E", day(start_offset), day(end_offset), None, None).unwrap()
}

fn task(title: &str, due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>) -> TodoTask {
  TodoTask::create(owner(), title, due_date, due_at, "medium", None).unwrap()
}

fn due_on(due_date: NaiveDate) -> TodoTask {
  task("T", Some(due_date), None)
}

fn due_at(due_at: DateTime<Utc>) -> TodoTask {
  task("T", None, Some(due_at))
}

fn undated() -> TodoTask {
  task("T", None, None)
}

fn hours(count: i64) -> TimeDelta {
  TimeDelta::hours(count)
}

// ---- events ----

#[test]
fn event_timed_inside_window_included() {
  assert!(day_inclusion::event_occurs_on(&timed(at(0, 14, 0), at(0, 15, 0)), &window()));
}

#[test]
fn event_timed_overnight_from_yesterday_included() {
  assert!(day_inclusion::event_occurs_on(&timed(at(-1, 23, 0), at(0, 6, 0)), &window()));
}

#[test]
fn event_timed_continuing_into_tomorrow_included() {
  assert!(day_inclusion::event_occurs_on(&timed(at(0, 22, 0), at(1, 6, 0)), &window()));
}

#[test]
fn event_timed_spanning_whole_day_included() {
  assert!(day_inclusion::event_occurs_on(&timed(at(-2, 0, 0), at(3, 0, 0)), &window()));
}

#[test]
fn event_timed_ending_exactly_at_window_start_excluded() {
  assert!(!day_inclusion::event_occurs_on(&timed(at(0, 2, 0), window().start()), &window()));
}

#[test]
fn event_timed_starting_exactly_at_window_end_excluded() {
  assert!(!day_inclusion::event_occurs_on(
    &timed(window().end(), window().end() + hours(1)),
    &window()
  ));
}

#[test]
fn event_timed_one_tick_inside_edges_included() {
  let w = window();
  assert!(day_inclusion::event_occurs_on(&timed(w.start() - hours(1), w.start() + TICK), &w));
  assert!(day_inclusion::event_occurs_on(&timed(w.end() - TICK, w.end() + hours(1)), &w));
}

#[test]
fn event_timed_is_evaluated_in_the_viewers_zone_not_utc_date() {
  // 02:00Z on the 26th is still the 25th in New York.
  assert!(!day_inclusion::event_occurs_on(&timed(at(0, 2, 0), at(0, 3, 0)), &window()));
  // 02:00Z on the 27th is the evening of the 26th in New York.
  assert!(day_inclusion::event_occurs_on(&timed(at(1, 2, 0), at(1, 3, 0)), &window()));
}

#[test]
fn event_all_day_uses_dates_with_exclusive_end() {
  let cases = [
    (0, 1, true),
    (-2, 1, true),
    (-1, 2, true),
    (0, 3, true),
    (-3, 0, false), // ends (exclusive) on today
    (1, 2, false),
    (-1, 0, false),
  ];
  for (start_offset, end_offset, expected) in cases {
    assert_eq!(
      day_inclusion::event_occurs_on(&all_day(start_offset, end_offset), &window()),
      expected,
      "{start_offset}..{end_offset}"
    );
  }
}

#[test]
fn event_all_day_is_floating_ignores_window_instants() {
  // Same date in a zone far east: window starts on the previous UTC day, but the all-day date matches by date only.
  let tokyo = DayWindow::create(today(), time_zones::find_iana("Asia/Tokyo").unwrap());

  assert!(day_inclusion::event_occurs_on(&all_day(0, 1), &tokyo));
  assert!(!day_inclusion::event_occurs_on(&all_day(-1, 0), &tokyo));
}

// ---- tasks: due today ----

#[test]
fn task_due_date_today_is_due_today() {
  let task = due_on(today());

  assert!(day_inclusion::is_due_today(&task, &window()));
  assert!(!day_inclusion::is_overdue(&task, &window()));
}

#[test]
fn task_due_date_other_day_is_not_due_today() {
  for (offset, expected) in [(-1, false), (1, false)] {
    assert_eq!(day_inclusion::is_due_today(&due_on(day(offset)), &window()), expected, "{offset}");
  }
}

#[test]
fn task_due_at_in_window_is_due_today_even_if_already_past_local_time() {
  let w = window();
  let early = due_at(w.start());
  let late = due_at(w.end() - TICK);

  assert!(day_inclusion::is_due_today(&early, &w));
  assert!(day_inclusion::is_due_today(&late, &w));
  assert!(!day_inclusion::is_overdue(&early, &w));
}

#[test]
fn task_due_at_outside_window_is_not_due_today() {
  let w = window();
  assert!(!day_inclusion::is_due_today(&due_at(w.start() - TICK), &w));
  assert!(!day_inclusion::is_due_today(&due_at(w.end()), &w));
}

// ---- tasks: overdue ----

#[test]
fn task_due_date_before_today_is_overdue() {
  let task = due_on(day(-1));

  assert!(day_inclusion::is_overdue(&task, &window()));
  assert!(!day_inclusion::is_due_today(&task, &window()));
}

#[test]
fn task_due_at_before_window_start_is_overdue() {
  assert!(day_inclusion::is_overdue(&due_at(window().start() - TICK), &window()));
}

#[test]
fn task_due_in_future_is_neither_due_today_nor_overdue() {
  let w = window();
  let by_date = due_on(day(1));
  let by_instant = due_at(w.end());

  assert!(!day_inclusion::is_overdue(&by_date, &w));
  assert!(!day_inclusion::is_overdue(&by_instant, &w));
  assert!(!day_inclusion::is_included_in_day(&by_date, &w));
  assert!(!day_inclusion::is_included_in_day(&by_instant, &w));
}

#[test]
fn task_undated_is_never_included_even_when_completed_today() {
  let w = window();
  let open = undated();
  let mut done = undated();
  done.complete(w.start() + hours(1));

  assert!(!day_inclusion::is_due_today(&open, &w));
  assert!(!day_inclusion::is_overdue(&open, &w));
  assert!(!day_inclusion::is_included_in_day(&open, &w));
  assert!(!day_inclusion::is_included_in_day(&done, &w));
}

// ---- tasks: included in day ----

#[test]
fn task_incomplete_overdue_included() {
  let w = window();
  assert!(day_inclusion::is_included_in_day(&due_on(day(-5)), &w));
  assert!(day_inclusion::is_included_in_day(&due_at(w.start() - TimeDelta::days(5)), &w));
}

#[test]
fn task_overdue_completed_within_window_included() {
  let w = window();
  let mut by_date = due_on(day(-5));
  by_date.complete(w.start());
  let mut by_instant = due_at(w.start() - TimeDelta::days(5));
  by_instant.complete(w.end() - TICK);

  assert!(day_inclusion::is_included_in_day(&by_date, &w));
  assert!(day_inclusion::is_included_in_day(&by_instant, &w));
}

#[test]
fn task_overdue_completed_before_window_excluded() {
  let w = window();
  let mut task = due_on(day(-5));
  task.complete(w.start() - TICK);

  assert!(!day_inclusion::is_included_in_day(&task, &w));
}

#[test]
fn task_overdue_completed_after_window_excluded() {
  let w = window();
  let mut task = due_on(day(-5));
  task.complete(w.end());

  assert!(!day_inclusion::is_included_in_day(&task, &w));
}

#[test]
fn task_due_today_completed_any_time_included() {
  let w = window();
  let mut earlier = due_on(today());
  earlier.complete(w.start() - TimeDelta::days(3));
  let mut later = due_at(w.start() + hours(3));
  later.complete(w.end() + TimeDelta::days(3));

  assert!(day_inclusion::is_included_in_day(&earlier, &w));
  assert!(day_inclusion::is_included_in_day(&later, &w));
}

#[test]
fn task_reopened_overdue_returns_to_today() {
  let w = window();
  let mut task = due_on(day(-2));
  task.complete(w.start() - TimeDelta::days(1));
  assert!(!day_inclusion::is_included_in_day(&task, &w));

  task.reopen();

  assert!(day_inclusion::is_included_in_day(&task, &w));
}

#[test]
fn task_due_at_on_dst_fall_back_day_uses_the_long_window() {
  let long_day = DayWindow::create(NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(), time_zones::find_iana(ZONE).unwrap());
  let late_evening = due_at(Utc.with_ymd_and_hms(2026, 11, 2, 4, 30, 0).unwrap()); // 23:30 EST on the 1st

  assert!(day_inclusion::is_due_today(&late_evening, &long_day));
}

#[test]
fn task_overdue_completed_exactly_at_window_end_excluded() {
  let w = window();
  let mut task = due_on(day(-2));
  task.complete(w.end());

  assert!(!day_inclusion::is_included_in_day(&task, &w));
}

#[test]
fn task_overdue_completed_one_tick_before_window_end_included() {
  let w = window();
  let mut task = due_on(day(-2));
  task.complete(w.end() - TICK);

  assert!(day_inclusion::is_included_in_day(&task, &w));
}

#[test]
fn task_due_at_exactly_window_end_is_tomorrow_not_included() {
  let w = window();
  let task = due_at(w.end());

  assert!(!day_inclusion::is_due_today(&task, &w));
  assert!(!day_inclusion::is_overdue(&task, &w));
  assert!(!day_inclusion::is_included_in_day(&task, &w));
}

#[test]
fn task_due_at_exactly_window_start_is_due_today_not_overdue() {
  let w = window();
  let task = due_at(w.start());

  assert!(day_inclusion::is_due_today(&task, &w));
  assert!(!day_inclusion::is_overdue(&task, &w));
}

#[test]
fn event_timed_on_date_skipped_by_clock_change_never_occurs() {
  let apia = time_zones::find_iana("Pacific/Apia").unwrap();
  let skipped = DayWindow::create(NaiveDate::from_ymd_opt(2011, 12, 30).unwrap(), apia);
  let spanning = CalendarEvent::create(
    owner(),
    "E",
    skipped.start() - TimeDelta::days(1),
    skipped.start() + TimeDelta::days(1),
    "Pacific/Apia",
    None,
    None,
  )
  .unwrap();

  assert_eq!(skipped.length(), TimeDelta::zero());
  assert!(!day_inclusion::event_occurs_on(&spanning, &skipped));
}

// ---- raw-value forms used by the agenda read models ----

#[test]
fn raw_forms_agree_with_the_entity_rules_for_timed_events() {
  let cases = [
    (-1, 23, 0, 6, true),
    (0, 14, 0, 15, true),
    (0, 2, 0, 4, false), // ends at window start
    (1, 4, 1, 5, false), // starts at window end
  ];
  for (start_day, start_hour, end_day, end_hour, expected) in cases {
    let event = timed(at(start_day, start_hour, 0), at(end_day, end_hour, 0));

    assert_eq!(day_inclusion::event_occurs_on(&event, &window()), expected);
    assert_eq!(
      day_inclusion::timed_event_overlaps(event.start().unwrap(), event.end().unwrap(), &window()),
      expected
    );
  }
}

#[test]
fn raw_forms_agree_with_the_entity_rules_for_all_day_events() {
  for (start_offset, end_offset, expected) in [(-1, 0, false), (-1, 1, true), (0, 1, true), (1, 2, false)] {
    let event = all_day(start_offset, end_offset);

    assert_eq!(day_inclusion::event_occurs_on(&event, &window()), expected);
    assert_eq!(
      day_inclusion::all_day_event_covers(event.start_date().unwrap(), event.end_date().unwrap(), &window()),
      expected
    );
  }
}

#[test]
fn raw_forms_agree_with_the_entity_rules_for_due_tasks() {
  let w = window();
  let tasks = [
    task("date today", Some(today()), None),
    task("date yesterday", Some(day(-1)), None),
    task("at start", None, Some(w.start())),
    task("at end", None, Some(w.end())),
    task("undated", None, None),
  ];

  let raw: Vec<bool> = tasks
    .iter()
    .map(|t| day_inclusion::is_due_on(t.due_date(), t.due_at(), &w))
    .collect();
  let entity: Vec<bool> = tasks.iter().map(|t| day_inclusion::is_due_today(t, &w)).collect();
  assert_eq!(raw, entity);
  assert_eq!(raw.iter().filter(|due| **due).count(), 2);
}

// ---- beyond the C# suite ----

#[test]
fn raw_overdue_form_agrees_with_the_entity_rule_and_ignores_missing_values() {
  let w = window();
  let tasks = [
    task("date today", Some(today()), None),
    task("date yesterday", Some(day(-1)), None),
    task("before start", None, Some(w.start() - TICK)),
    task("at start", None, Some(w.start())),
    task("undated", None, None),
  ];

  let raw: Vec<bool> = tasks
    .iter()
    .map(|t| day_inclusion::is_overdue_on(t.due_date(), t.due_at(), &w))
    .collect();
  let entity: Vec<bool> = tasks.iter().map(|t| day_inclusion::is_overdue(t, &w)).collect();
  assert_eq!(raw, entity);
  assert_eq!(raw, [false, true, true, false, false]);
  assert_eq!(day(-1) + Days::new(1), today());
}
