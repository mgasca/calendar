//! The orderings of the agenda lists, shared by every agenda view (ports `AgendaOrder.cs`). Titles compare
//! ordinally and case-insensitively in memory, so the order does not depend on the database collation; the
//! id breaks ties.

use std::cmp::Ordering;

use crate::contracts::{AgendaTaskItem, AllDayEventItem, TimedEventItem};
use crate::text::ordinal_ignore_case_cmp;

/// All-day events by start date, then title, then id.
pub fn all_day_events(a: &AllDayEventItem, b: &AllDayEventItem) -> Ordering {
  a.start_date
    .cmp(&b.start_date)
    .then_with(|| ordinal_ignore_case_cmp(&a.title, &b.title))
    .then_with(|| a.id.cmp(&b.id))
}

/// Timed events by start, then title, then id.
pub fn timed_events(a: &TimedEventItem, b: &TimedEventItem) -> Ordering {
  a.start
    .cmp(&b.start)
    .then_with(|| ordinal_ignore_case_cmp(&a.title, &b.title))
    .then_with(|| a.id.cmp(&b.id))
}

/// Tasks due on a day: timed ones by due instant first, then date-only ones; then priority, title, and id.
pub fn due_tasks(a: &AgendaTaskItem, b: &AgendaTaskItem) -> Ordering {
  a.due_at
    .is_none()
    .cmp(&b.due_at.is_none())
    .then_with(|| a.due_at.cmp(&b.due_at))
    .then_with(|| priority_rank(&a.priority).cmp(&priority_rank(&b.priority)))
    .then_with(|| ordinal_ignore_case_cmp(&a.title, &b.title))
    .then_with(|| a.id.cmp(&b.id))
}

fn priority_rank(priority: &str) -> u8 {
  match priority {
    "high" => 0,
    "medium" => 1,
    "low" => 2,
    _ => 3,
  }
}
