//! SQL forms of the pure rules in `calendar_domain::agenda::day_inclusion` (ports `AgendaQueries`). Keep each
//! predicate in step with its counterpart there; `tests/database/agenda_agreement.rs` asserts the two agree.
//! The range forms select a superset that the read model then splits into days with `day_inclusion`.
//!
//! The .NET per-day forms `AllDayOn`, `TimedOn` and `DueOn` had no caller and are not ported: a one-day
//! [`DateRangeWindow`] gives the same rows.

use std::ops::Bound;

use calendar_domain::time::{DateRangeWindow, DayWindow};
use diesel::dsl::not;
use diesel::prelude::*;
use diesel::sql_types::Bool;

use super::{Events, Tasks};
use crate::schema::{events, tasks};

/// All-day events covering at least one date of the range: `start_date < range.end_date AND end_date >
/// range.start_date`, as the generated `[start_date, end_date)` date range overlapping the range's dates
/// (`&&`, backed by the `GiST` index `ix_events_date_span`).
pub fn all_day_overlapping<'a, ST>(events: Events<'a, ST>, range: &DateRangeWindow) -> Events<'a, ST> {
  let dates = (Bound::Included(range.start_date()), Bound::Excluded(range.end_date()));
  events.filter(events::is_all_day.and(events::date_span.overlaps_with(dates)))
}

/// Timed events overlapping the range's `[start, end)`: the generated half-open span range overlaps it (`&&`,
/// backed by the `GiST` index `ix_events_span`), i.e. `starts_at < end AND ends_at > start`. A range with no
/// length (only dates a clock change skipped) matches nothing. Which days an event touches is decided per day
/// by `day_inclusion`, so a skipped date inside the range still shows none.
pub fn timed_overlapping<'a, ST>(events: Events<'a, ST>, range: &DateRangeWindow) -> Events<'a, ST> {
  let (start, end) = (range.start(), range.end());
  if end <= start {
    return events.filter(false.into_sql::<Bool>());
  }

  let window = (Bound::Included(start), Bound::Excluded(end));
  events.filter(not(events::is_all_day).and(events::span.overlaps_with(window)))
}

/// Tasks due on any day of the range, whether or not they are completed: `due_date` in
/// `[start_date, end_date)` or `due_at` in `[start, end)`.
pub fn due_within<'a, ST>(tasks: Tasks<'a, ST>, range: &DateRangeWindow) -> Tasks<'a, ST> {
  tasks.filter(
    tasks::due_date
      .ge(range.start_date())
      .and(tasks::due_date.lt(range.end_date()))
      .or(tasks::due_at.ge(range.start()).and(tasks::due_at.lt(range.end()))),
  )
}

/// Tasks due before the range's first day: `due_date < range.start_date` or `due_at < range.start`. Combined
/// with the overdue branches it limits an overdue list to what no day of the range already shows.
pub fn due_before<'a, ST>(tasks: Tasks<'a, ST>, range: &DateRangeWindow) -> Tasks<'a, ST> {
  tasks.filter(tasks::due_date.lt(range.start_date()).or(tasks::due_at.lt(range.start())))
}

/// The open branch of the overdue list: due before the window's day and not completed. Read from the
/// open-task due indexes (`ix_tasks_open_due_date`, `ix_tasks_open_due_at`).
///
/// The overdue list of a day is this branch plus [`overdue_completed_within`]. The two are disjoint and are
/// combined with `UNION ALL` (or counted separately) rather than one `OR`, so open tasks are never read from
/// the whole completed history.
pub fn overdue_open<'a, ST>(tasks: Tasks<'a, ST>, window: &DayWindow) -> Tasks<'a, ST> {
  past_due(tasks, window).filter(tasks::completed_at.is_null())
}

/// The completed branch of the overdue list: due before the window's day and completed within it. Read from
/// the completed-at index (`ix_tasks_completed_at`).
pub fn overdue_completed_within<'a, ST>(tasks: Tasks<'a, ST>, window: &DayWindow) -> Tasks<'a, ST> {
  past_due(tasks, window).filter(tasks::completed_at.ge(window.start()).and(tasks::completed_at.lt(window.end())))
}

fn past_due<'a, ST>(tasks: Tasks<'a, ST>, window: &DayWindow) -> Tasks<'a, ST> {
  tasks.filter(tasks::due_date.lt(window.date()).or(tasks::due_at.lt(window.start())))
}
