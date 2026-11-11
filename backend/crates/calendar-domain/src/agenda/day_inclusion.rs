//! Pure rules deciding what the "Today" view shows for a [`DayWindow`].
//!
//! Each rule is a simple comparison against the window's date, start and end so it can be mirrored one-to-one in
//! a database query.

use chrono::{DateTime, NaiveDate, TimeDelta, Utc};

use crate::events::{CalendarEvent, EventSchedule};
use crate::tasks::TodoTask;
use crate::time::DayWindow;

/// Timed: `start < window.end && end > window.start`, never for an empty window (a date that a clock change
/// skipped entirely has no time on it). All-day: `start_date <= window.date && end_date > window.date` (end
/// exclusive).
pub fn event_occurs_on(event: &CalendarEvent, window: &DayWindow) -> bool {
  match *event.schedule() {
    EventSchedule::AllDay { start_date, end_date } => all_day_event_covers(start_date, end_date, window),
    EventSchedule::Timed { start, end, .. } => timed_event_overlaps(start, end, window),
  }
}

/// The timed-event rule of [`event_occurs_on`] on raw values, for read models that hold projections:
/// `start < window.end && end > window.start`, never for an empty window.
pub fn timed_event_overlaps(start: DateTime<Utc>, end: DateTime<Utc>, window: &DayWindow) -> bool {
  window.length() > TimeDelta::zero() && start < window.end() && end > window.start()
}

/// The all-day rule of [`event_occurs_on`] on raw values: `start_date <= window.date && end_date > window.date`
/// (end exclusive).
pub fn all_day_event_covers(start_date: NaiveDate, end_date: NaiveDate, window: &DayWindow) -> bool {
  start_date <= window.date() && end_date > window.date()
}

/// Due today: the due date is the window's date, or the due instant is within `[window.start, window.end)`.
pub fn is_due_today(task: &TodoTask, window: &DayWindow) -> bool {
  is_due_on(task.due_date(), task.due_at(), window)
}

/// The rule of [`is_due_today`] on raw due values, for read models that hold projections.
pub fn is_due_on(due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>, window: &DayWindow) -> bool {
  due_date == Some(window.date()) || due_at.is_some_and(|at| window.contains(at))
}

/// Overdue: the due date is before the window's date, or the due instant is before the window's start.
/// Independent of completion. A timed task due earlier today is "due today", not overdue.
pub fn is_overdue(task: &TodoTask, window: &DayWindow) -> bool {
  is_overdue_on(task.due_date(), task.due_at(), window)
}

/// The rule of [`is_overdue`] on raw due values, for read models that hold projections.
pub fn is_overdue_on(due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>, window: &DayWindow) -> bool {
  due_date.is_some_and(|date| date < window.date()) || due_at.is_some_and(|at| at < window.start())
}

/// Shown in Today: due today (complete or not), or overdue and either incomplete or completed within the window.
/// Undated tasks never match.
pub fn is_included_in_day(task: &TodoTask, window: &DayWindow) -> bool {
  is_due_today(task, window) || (is_overdue(task, window) && task.completed_at().is_none_or(|completed_at| window.contains(completed_at)))
}
