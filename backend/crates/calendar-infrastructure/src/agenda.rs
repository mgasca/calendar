//! The read side of every agenda view: everything a range of days shows, read in one read-only snapshot
//! (ADR-0020) with a fixed number of queries, whatever the range's length. Splitting the rows into days and
//! ordering them is the read model's work (the API), with `calendar_domain::agenda::day_inclusion`.

use calendar_domain::tasks::Priority;
use calendar_domain::time::{DateRangeWindow, DayWindow};
use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::query_dsl::positional_order_dsl::PositionalOrderDsl;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use uuid::Uuid;

use crate::error::Error;
use crate::ownership::OwnerId;
use crate::queries::agenda::{all_day_overlapping, due_before, due_within, overdue_completed_within, overdue_open, timed_overlapping};
use crate::queries::task_list::local_due_date;
use crate::queries::{Tasks, owned_events, owned_tasks};
use crate::schema::{events, tasks};
use crate::sql::{coalesce, date_of};

/// An all-day event of an agenda.
#[derive(Debug, Clone, PartialEq, Eq, Queryable)]
pub struct AllDayEventRow {
  /// The event's id.
  pub id: Uuid,
  /// Its title.
  pub title: String,
  /// Its location, if any.
  pub location: Option<String>,
  /// Whether it has notes (the notes themselves are not read).
  pub has_notes: bool,
  /// Its first date.
  pub start_date: NaiveDate,
  /// The date after its last one.
  pub end_date: NaiveDate,
}

/// A timed event of an agenda.
#[derive(Debug, Clone, PartialEq, Eq, Queryable)]
pub struct TimedEventRow {
  /// The event's id.
  pub id: Uuid,
  /// Its title.
  pub title: String,
  /// Its location, if any.
  pub location: Option<String>,
  /// Whether it has notes (the notes themselves are not read).
  pub has_notes: bool,
  /// When it starts.
  pub start: DateTime<Utc>,
  /// When it ends.
  pub end: DateTime<Utc>,
  /// The IANA zone it was scheduled in.
  pub time_zone_id: String,
}

/// A task of an agenda.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgendaTaskRow {
  /// The task's id.
  pub id: Uuid,
  /// Its title.
  pub title: String,
  /// Its priority.
  pub priority: Priority,
  /// Whether it has notes (the notes themselves are not read).
  pub has_notes: bool,
  /// Its floating due date, if it has one.
  pub due_date: Option<NaiveDate>,
  /// Its due instant, if it has one.
  pub due_at: Option<DateTime<Utc>>,
  /// When it was completed; `None` while it is open.
  pub completed_at: Option<DateTime<Utc>>,
}

/// The overdue part of an agenda.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverdueRows {
  /// The first tasks of the overdue list, in its order: open ones first, then by local due date, timed
  /// before date-only, due instant and id.
  pub tasks: Vec<AgendaTaskRow>,
  /// How many tasks the whole list has.
  pub total: i64,
  /// How many of them are open.
  pub open_total: i64,
}

/// Everything an agenda view shows for a range of days, from one snapshot. Only [`OverdueRows::tasks`] is
/// ordered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgendaRows {
  /// All-day events covering any date of the range, once each.
  pub all_day_events: Vec<AllDayEventRow>,
  /// Timed events overlapping the range.
  pub timed_events: Vec<TimedEventRow>,
  /// Tasks due on any day of the range, open or completed.
  pub due_tasks: Vec<AgendaTaskRow>,
  /// The overdue tasks, or `None` when they were not requested.
  pub overdue: Option<OverdueRows>,
}

/// The columns of a task an agenda shows, in [`AgendaTaskColumns`] order.
type AgendaTaskTuple = (
  Uuid,
  String,
  String,
  bool,
  Option<NaiveDate>,
  Option<DateTime<Utc>>,
  Option<DateTime<Utc>>,
);

/// An overdue task with the three computed sort keys the `UNION ALL` is ordered by.
type OverdueTuple = (
  Uuid,
  String,
  String,
  bool,
  Option<NaiveDate>,
  Option<DateTime<Utc>>,
  Option<DateTime<Utc>>,
  bool,
  Option<NaiveDate>,
  bool,
);

fn task_row((id, title, priority, has_notes, due_date, due_at, completed_at): AgendaTaskTuple) -> Result<AgendaTaskRow, Error> {
  let priority = Priority::parse(&priority).ok_or(Error::InvalidRow {
    entity: "task",
    reason: "the priority is not low, medium or high",
  })?;
  Ok(AgendaTaskRow {
    id,
    title,
    priority,
    has_notes,
    due_date,
    due_at,
    completed_at,
  })
}

/// Reads the owner's agenda for `range`.
///
/// `overdue_as_of` is the day overdue tasks are judged against (still open, or completed within it), or
/// `None` for no overdue list. Only tasks due before the range's first day are returned, so none repeats a
/// task of a day; at most `overdue_limit` of them are read, and the totals count them all.
///
/// All reads run in one `REPEATABLE READ, READ ONLY` transaction (ADR-0020 D1): a task completed or an event
/// added between them must not show up in some lists and not in others.
pub async fn read(
  conn: &mut AsyncPgConnection,
  owner: OwnerId,
  range: &DateRangeWindow,
  overdue_as_of: Option<&DayWindow>,
  overdue_limit: i64,
) -> Result<AgendaRows, Error> {
  conn
    .build_transaction()
    .repeatable_read()
    .read_only()
    .run(async |conn| {
      let all_day_events = all_day_overlapping(owned_events(owner), range)
        .select((
          events::id,
          events::title,
          events::location,
          events::notes.is_not_null(),
          events::start_date.assume_not_null(),
          events::end_date.assume_not_null(),
        ))
        .load::<AllDayEventRow>(conn)
        .await?;
      let timed_events = timed_overlapping(owned_events(owner), range)
        .select((
          events::id,
          events::title,
          events::location,
          events::notes.is_not_null(),
          events::starts_at.assume_not_null(),
          events::ends_at.assume_not_null(),
          events::time_zone_id.assume_not_null(),
        ))
        .load::<TimedEventRow>(conn)
        .await?;
      let due_tasks = due_within(owned_tasks(owner), range)
        .select((
          tasks::id,
          tasks::title,
          tasks::priority,
          tasks::notes.is_not_null(),
          tasks::due_date,
          tasks::due_at,
          tasks::completed_at,
        ))
        .load::<AgendaTaskTuple>(conn)
        .await?
        .into_iter()
        .map(task_row)
        .collect::<Result<Vec<_>, _>>()?;
      let overdue = match overdue_as_of {
        Some(as_of) => Some(read_overdue(conn, owner, range, as_of, overdue_limit).await?),
        None => None,
      };

      Ok(AgendaRows {
        all_day_events,
        timed_events,
        due_tasks,
        overdue,
      })
    })
    .await
}

/// The overdue list: two disjoint branches, each of which matches its own partial index. The totals are the
/// branches' counts; the list is their `UNION ALL`, ordered by the selected sort keys and limited.
async fn read_overdue(
  conn: &mut AsyncPgConnection,
  owner: OwnerId,
  range: &DateRangeWindow,
  as_of: &DayWindow,
  limit: i64,
) -> Result<OverdueRows, Error> {
  let zone = range.zone().id();
  let open = || due_before(overdue_open(owned_tasks(owner), as_of), range);
  let completed = || due_before(overdue_completed_within(owned_tasks(owner), as_of), range);
  let listed = |branch: Tasks<'static>| {
    branch.select((
      tasks::id,
      tasks::title,
      tasks::priority,
      tasks::notes.is_not_null(),
      tasks::due_date,
      tasks::due_at,
      tasks::completed_at,
      // The sort keys of `queries::task_list::order_by_dated`, as columns 8 to 10: a combined query can only
      // be ordered by its output columns.
      tasks::completed_at.is_not_null(),
      local_due_date!(zone),
      tasks::due_at.is_null(),
    ))
  };

  let open_total: i64 = open().count().get_result(conn).await?;
  let completed_total: i64 = completed().count().get_result(conn).await?;
  let tasks = listed(open())
    .union_all(listed(completed()))
    .positional_order_by((8, 9, 10, 6, 1))
    .limit(limit)
    .load::<OverdueTuple>(conn)
    .await?
    .into_iter()
    .map(|(id, title, priority, has_notes, due_date, due_at, completed_at, ..)| {
      task_row((id, title, priority, has_notes, due_date, due_at, completed_at))
    })
    .collect::<Result<Vec<_>, _>>()?;

  Ok(OverdueRows {
    tasks,
    total: open_total + completed_total,
    open_total,
  })
}
