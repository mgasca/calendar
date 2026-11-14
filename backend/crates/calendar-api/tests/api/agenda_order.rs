//! Ports `AgendaOrderTests.cs`: the agenda orderings are unchanged by evaluating their keys lazily (issue
//! #54). The reference orders below are a copy of the comparers as they were before short-circuiting: every
//! key is computed on every comparison and the first difference wins.
//!
//! The .NET test drew from `new Random(54)`; this one draws from the shared fixed-seed generator
//! (`common::SeededRandom`), so the items differ but the run is as repeatable.

use std::cmp::Ordering;

use crate::common::{SeededRandom, date, utc};
use calendar_api::contracts::{AgendaTaskItem, AllDayEventItem, TimedEventItem};
use calendar_api::endpoints::agenda_order;
use chrono::{Days, TimeDelta};
use uuid::Uuid;

/// `StringComparer.OrdinalIgnoreCase.Compare` for the ASCII titles of this test.
fn ordinal_ignore_case(a: &str, b: &str) -> Ordering {
  a.to_ascii_uppercase().as_bytes().cmp(b.to_ascii_uppercase().as_bytes())
}

fn first_difference(comparisons: &[Ordering]) -> Ordering {
  for comparison in comparisons {
    if *comparison != Ordering::Equal {
      return *comparison;
    }
  }
  Ordering::Equal
}

fn rank(priority: &str) -> u8 {
  match priority {
    "high" => 0,
    "medium" => 1,
    "low" => 2,
    _ => 3,
  }
}

fn original_due(a: &AgendaTaskItem, b: &AgendaTaskItem) -> Ordering {
  first_difference(&[
    a.due_at.is_none().cmp(&b.due_at.is_none()),
    a.due_at.cmp(&b.due_at), // `Nullable.Compare`: null sorts first, as `None` does
    rank(&a.priority).cmp(&rank(&b.priority)),
    ordinal_ignore_case(&a.title, &b.title),
    a.id.cmp(&b.id),
  ])
}

fn original_all_day(a: &AllDayEventItem, b: &AllDayEventItem) -> Ordering {
  first_difference(&[
    a.start_date.cmp(&b.start_date),
    ordinal_ignore_case(&a.title, &b.title),
    a.id.cmp(&b.id),
  ])
}

fn original_timed(a: &TimedEventItem, b: &TimedEventItem) -> Ordering {
  first_difference(&[a.start.cmp(&b.start), ordinal_ignore_case(&a.title, &b.title), a.id.cmp(&b.id)])
}

fn ordered<T: Clone>(items: &[T], compare: impl Fn(&T, &T) -> Ordering) -> Vec<T> {
  let mut items = items.to_vec();
  items.sort_by(compare); // stable, as `Enumerable.Order` is
  items
}

#[test]
fn ordering_matches_original_comparers_across_ties_and_dst() {
  let mut random = SeededRandom(54);
  let zone = "America/New_York";
  let dates = [
    date(2026, 3, 7),
    date(2026, 3, 8),
    date(2026, 3, 9),
    date(2026, 10, 31),
    date(2026, 11, 1),
    date(2026, 11, 2),
  ];
  let instants = [
    utc(2026, 3, 8, 6, 30),
    utc(2026, 3, 8, 7, 30),
    utc(2026, 11, 1, 5, 30),
    utc(2026, 11, 1, 6, 30),
  ];
  let titles = ["alpha", "ALPHA", "Beta", "beta"];
  let priorities = ["high", "medium", "low", "other"];
  let mut tasks = Vec::new();
  let mut all_day = Vec::new();
  let mut timed = Vec::new();
  for _ in 0..2000 {
    // `new Guid(random.Next(), (short)random.Next(short.MaxValue), (short)random.Next(short.MaxValue), new byte[8])`
    let id = Uuid::from_fields(
      u32::try_from(random.below(0x7FFF_FFFF)).expect("31 bits"),
      u16::try_from(random.below(0x7FFF)).expect("15 bits"),
      u16::try_from(random.below(0x7FFF)).expect("15 bits"),
      &[0; 8],
    );
    let title = *random.pick(&titles);
    let date = *random.pick(&dates);
    let instant = *random.pick(&instants);
    let date_only = random.below(2) == 0;
    tasks.push(AgendaTaskItem {
      id,
      title: title.to_owned(),
      priority: (*random.pick(&priorities)).to_owned(),
      has_notes: false,
      due_date: date_only.then_some(date),
      due_at: (!date_only).then_some(instant),
      completed_at: None,
      is_completed: false,
    });
    all_day.push(AllDayEventItem {
      id,
      title: title.to_owned(),
      location: None,
      has_notes: false,
      start_date: date,
      end_date: date + Days::new(1),
    });
    timed.push(TimedEventItem {
      id,
      title: title.to_owned(),
      location: None,
      has_notes: false,
      start: instant,
      end: instant + TimeDelta::hours(1),
      time_zone: zone.to_owned(),
      starts_before_day: false,
      ends_after_day: false,
    });
  }

  // The reference orders are the comparers as they were before short-circuiting (issue #54).
  assert_eq!(ordered(&tasks, agenda_order::due_tasks), ordered(&tasks, original_due));
  assert_eq!(ordered(&all_day, agenda_order::all_day_events), ordered(&all_day, original_all_day));
  assert_eq!(ordered(&timed, agenda_order::timed_events), ordered(&timed, original_timed));
}
