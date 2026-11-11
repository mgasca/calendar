//! The shared read side of every agenda view (ports `AgendaBuilder.cs`). It reads a [`DateRangeWindow`] from
//! one snapshot with a fixed number of queries, whatever its length, and splits the results into days in
//! memory with the domain's day-inclusion rules, so the per-day rules have one implementation. Nothing here
//! knows how long a view's range is.

use calendar_domain::agenda::day_inclusion;
use calendar_domain::time::{DateRangeWindow, DayWindow};
use calendar_infrastructure::{OwnerId, agenda};
use diesel_async::AsyncPgConnection;

use super::agenda_order;
use crate::contracts::{AgendaTaskItem, AllDayEventItem, TimedEventItem};
use crate::error::ApiError;

/// The most overdue tasks an agenda lists; the totals count them all.
pub const OVERDUE_LIMIT: i64 = 20;

/// Everything an agenda view shows for a range of days, read from one snapshot and already ordered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgendaSnapshot {
  /// The days that were read.
  pub range: DateRangeWindow,
  /// All-day events covering any date of the range, once each.
  pub all_day_events: Vec<AllDayEventItem>,
  /// One entry per day of `range`, in date order.
  pub days: Vec<AgendaSnapshotDay>,
  /// The overdue tasks, or `None` when they were not requested.
  pub overdue: Option<Vec<AgendaTaskItem>>,
  /// The total number of overdue tasks.
  pub overdue_total: i32,
  /// The number of open overdue tasks.
  pub overdue_open_total: i32,
}

/// One day of an [`AgendaSnapshot`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgendaSnapshotDay {
  /// The day.
  pub window: DayWindow,
  /// Timed events overlapping the day, with continuation flags relative to it.
  pub events: Vec<TimedEventItem>,
  /// Tasks due on the day, open or completed.
  pub tasks: Vec<AgendaTaskItem>,
}

/// Reads and buckets the agenda of `owner` for `range`.
///
/// `overdue_as_of` is the day overdue tasks are judged against (still open, or completed within it), or
/// `None` for no overdue list. Only tasks due before the range's first day are returned, so none repeats a
/// task in a day. All reads share one snapshot (ADR-0020 D1).
pub async fn read(
  connection: &mut AsyncPgConnection,
  owner: OwnerId,
  range: &DateRangeWindow,
  overdue_as_of: Option<&DayWindow>,
) -> Result<AgendaSnapshot, ApiError> {
  let rows = agenda::read(connection, owner, range, overdue_as_of, OVERDUE_LIMIT).await?;

  let mut all_day_events: Vec<AllDayEventItem> = rows.all_day_events.into_iter().map(Into::into).collect();
  all_day_events.sort_by(agenda_order::all_day_events);
  let timed: Vec<TimedEventItem> = rows.timed_events.into_iter().map(Into::into).collect();
  let due: Vec<AgendaTaskItem> = rows.due_tasks.into_iter().map(Into::into).collect();
  let (overdue, overdue_total, overdue_open_total) = match rows.overdue {
    Some(overdue) => (
      Some(overdue.tasks.into_iter().map(Into::into).collect()),
      i32::try_from(overdue.total).unwrap_or(i32::MAX),
      i32::try_from(overdue.open_total).unwrap_or(i32::MAX),
    ),
    None => (None, 0, 0),
  };

  Ok(AgendaSnapshot {
    range: range.clone(),
    all_day_events,
    days: bucket(range, &timed, &due),
    overdue,
    overdue_total,
    overdue_open_total,
  })
}

/// Splits the range's items into its days. Each item is tested only against the days its instants or date can
/// fall on (found by binary search over the sorted day boundaries), and the day-inclusion rules still decide,
/// so the work is linear in the items rather than days × items.
pub fn bucket(range: &DateRangeWindow, timed: &[TimedEventItem], due: &[AgendaTaskItem]) -> Vec<AgendaSnapshotDay> {
  let days = range.days();
  let mut events_by_day: Vec<Vec<TimedEventItem>> = vec![Vec::new(); days.len()];
  let mut tasks_by_day: Vec<Vec<AgendaTaskItem>> = vec![Vec::new(); days.len()];

  for event in timed {
    // Ends and starts are monotonic, including repeated boundaries for skipped dates.
    let first = days.partition_point(|day| day.end() <= event.start);
    let end = days.partition_point(|day| day.start() < event.end);
    for index in first..end {
      let day = &days[index];
      if day_inclusion::timed_event_overlaps(event.start, event.end, day) {
        events_by_day[index].push(TimedEventItem {
          starts_before_day: event.start < day.start(),
          ends_after_day: event.end > day.end(),
          ..event.clone()
        });
      }
    }
  }

  for task in due {
    let date_index = task
      .due_date
      .and_then(|date| usize::try_from((date - range.start_date()).num_days()).ok())
      .filter(|index| *index < days.len());
    if let Some(index) = date_index
      && day_inclusion::is_due_on(task.due_date, task.due_at, &days[index])
    {
      tasks_by_day[index].push(task.clone());
    }

    if let Some(at) = task.due_at {
      let index = days.partition_point(|day| day.start() <= at).checked_sub(1);
      if let Some(index) = index.filter(|index| Some(*index) != date_index)
        && day_inclusion::is_due_on(task.due_date, task.due_at, &days[index])
      {
        tasks_by_day[index].push(task.clone());
      }
    }
  }

  days
    .iter()
    .zip(events_by_day)
    .zip(tasks_by_day)
    .map(|((window, mut events), mut tasks)| {
      events.sort_by(agenda_order::timed_events);
      tasks.sort_by(agenda_order::due_tasks);
      AgendaSnapshotDay {
        window: *window,
        events,
        tasks,
      }
    })
    .collect()
}
