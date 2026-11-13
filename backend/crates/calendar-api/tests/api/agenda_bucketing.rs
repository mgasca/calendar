//! Ports `AgendaBucketingTests.cs`: placing items by day index gives the same days as testing every item
//! against every day (issue #55). The reference below is the older implementation: filter every item with the
//! day-inclusion rules for each day, then order.
//!
//! The .NET test drew from `new Random(55)` and `Guid.NewGuid()`; this one draws everything from a fixed-seed
//! generator of its own, so the items differ but the run is repeatable.

use calendar_api::contracts::{AgendaTaskItem, TimedEventItem};
use calendar_api::endpoints::{agenda_builder, agenda_order};
use calendar_domain::agenda::day_inclusion;
use calendar_domain::time::{DateRangeWindow, time_zones};
use chrono::{DateTime, NaiveDate, TimeDelta, Utc};
use uuid::Uuid;

/// `SplitMix64`: a small deterministic generator, seeded like `new Random(seed)`.
struct SeededRandom(u64);

impl SeededRandom {
  fn next_u64(&mut self) -> u64 {
    self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = self.0;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
  }

  /// A value in `min..max` (`Random.Next(min, max)`).
  fn between(&mut self, min: i64, max: i64) -> i64 {
    let span = u64::try_from(max - min).expect("an ascending range");
    min + i64::try_from(self.next_u64() % span).expect("a small offset")
  }

  fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
    let index = usize::try_from(self.next_u64() % items.len() as u64).expect("an index");
    &items[index]
  }

  fn id(&mut self) -> Uuid {
    Uuid::from_u128((u128::from(self.next_u64()) << 64) | u128::from(self.next_u64()))
  }
}

fn indexed_buckets_match_per_day_filtering(zone_id: &str, year: i32, month: u32, day: u32) {
  let zone = time_zones::find_iana(zone_id).expect("a valid zone");
  let start_date = NaiveDate::from_ymd_opt(year, month, day).expect("a valid date");
  let range = DateRangeWindow::create(start_date, 7, zone).expect("a valid range");
  let mut random = SeededRandom(55);
  let tick = TimeDelta::nanoseconds(100);
  let mut instants: Vec<DateTime<Utc>> = range
    .days()
    .iter()
    .flat_map(|d| [d.start(), d.end(), d.start() - tick, d.start() + tick])
    .collect();
  for _ in 0..200 {
    instants.push(range.start() + TimeDelta::minutes(random.between(-2880, 14400)));
  }

  let events: Vec<TimedEventItem> = (0..500)
    .map(|i| {
      let mut start = *random.pick(&instants);
      let mut end = if i % 5 == 0 { start } else { *random.pick(&instants) };
      if end < start {
        (start, end) = (end, start);
      }

      TimedEventItem {
        id: random.id(),
        title: format!("Event {}", i % 8),
        location: None,
        has_notes: false,
        start,
        end,
        time_zone: zone_id.to_owned(),
        starts_before_day: false,
        ends_after_day: false,
      }
    })
    .collect();
  let tasks: Vec<AgendaTaskItem> = (0..500)
    .map(|i| AgendaTaskItem {
      id: random.id(),
      title: format!("Task {}", i % 8),
      priority: "medium".to_owned(),
      has_notes: false,
      due_date: (i % 3 == 0).then(|| range.start_date() + TimeDelta::days(random.between(-2, 9))),
      due_at: (i % 3 != 0).then(|| *random.pick(&instants)),
      completed_at: None,
      is_completed: false,
    })
    .collect();

  let actual = agenda_builder::bucket(&range, &events, &tasks);

  assert_eq!(actual.len(), range.days().len());
  for (i, window) in range.days().iter().enumerate() {
    let mut expected_events: Vec<TimedEventItem> = events
      .iter()
      .filter(|event| day_inclusion::timed_event_overlaps(event.start, event.end, window))
      .map(|event| TimedEventItem {
        starts_before_day: event.start < window.start(),
        ends_after_day: event.end > window.end(),
        ..event.clone()
      })
      .collect();
    expected_events.sort_by(agenda_order::timed_events);
    let mut expected_tasks: Vec<AgendaTaskItem> = tasks
      .iter()
      .filter(|task| day_inclusion::is_due_on(task.due_date, task.due_at, window))
      .cloned()
      .collect();
    expected_tasks.sort_by(agenda_order::due_tasks);

    assert_eq!(actual[i].window, *window, "day {i}");
    assert_eq!(actual[i].events, expected_events, "events on day {i}");
    assert_eq!(actual[i].tasks, expected_tasks, "tasks on day {i}");
  }

  // The comparison is only worth something when the days hold items (not asserted by the .NET test).
  assert!(actual.iter().any(|day| !day.events.is_empty()));
  assert!(actual.iter().any(|day| !day.tasks.is_empty()));
}

#[test]
fn indexed_buckets_match_per_day_filtering_new_york_spring_forward() {
  indexed_buckets_match_per_day_filtering("America/New_York", 2026, 3, 6);
}

#[test]
fn indexed_buckets_match_per_day_filtering_new_york_fall_back() {
  indexed_buckets_match_per_day_filtering("America/New_York", 2026, 10, 30);
}

#[test]
fn indexed_buckets_match_per_day_filtering_apia_skipped_date() {
  indexed_buckets_match_per_day_filtering("Pacific/Apia", 2011, 12, 28);
}
