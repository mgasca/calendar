//! The task list views: which tasks each shows and in which order (ports `TaskListQueries`). Every comparison
//! runs in the database, so a page continues exactly where the previous one ended, whatever the database's
//! uuid or collation ordering.

use calendar_domain::tasks::TodoTask;
use calendar_domain::time::{DayWindow, IanaZone};
use chrono::{DateTime, NaiveDate, Utc};
use diesel::dsl::auto_type;
use diesel::prelude::*;
use uuid::Uuid;

use super::Tasks;
use crate::schema::tasks;
use crate::sql::{coalesce, date_of};

/// A dated view's notion of "today": the client's day and zone (ADR-0021).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DatedView {
  /// The client's day in `zone`. A task is overdue when its due date is before it, or its due instant
  /// before the day starts.
  pub today: DayWindow,
  /// The zone timed tasks are sorted in: on their local date there.
  pub zone: IanaZone,
}

/// The task list views.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskListView {
  /// Open tasks due today or later, by local due date, then due instant (date-only last), then id.
  Upcoming(DatedView),
  /// Open tasks due before today, in the same order as [`TaskListView::Upcoming`].
  Overdue(DatedView),
  /// Completed tasks, most recently completed first, then id descending.
  Completed,
  /// Open tasks with no due date or instant, by id.
  NoDeadline,
}

/// The last task of a page, from which the next page continues. `due_date` is its local due date (dated
/// views), and `instant` its due instant (dated views) or completion instant ([`TaskListView::Completed`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskListKey {
  /// The task's id.
  pub id: Uuid,
  /// The local due date, for the dated views.
  pub due_date: Option<NaiveDate>,
  /// The due instant (dated views) or the completion instant (completed view).
  pub instant: Option<DateTime<Utc>>,
}

/// The local due date: a date-only task's own date, or a timed task's instant `AT TIME ZONE` in SQL. It leads
/// both the seek and the order of the dated views.
macro_rules! local_due_date {
  ($zone:expr) => {
    coalesce(tasks::due_date, date_of(tasks::due_at.at_time_zone($zone)).nullable())
  };
}
pub(crate) use local_due_date;

/// Open overdue tasks as one `OR` predicate, backed by both partial open-task due indexes. A predicate rather
/// than a query fragment, because the set-based bulk update and delete need it too.
#[auto_type]
pub(crate) fn is_open_overdue(date: NaiveDate, start: DateTime<Utc>) -> _ {
  tasks::completed_at
    .is_null()
    .and(tasks::due_date.lt(date).or(tasks::due_at.lt(start)))
}

/// Open overdue tasks as of `today`: the overdue view's rows, its total, and what a bulk-by-filter touches.
pub fn open_overdue_for<'a, ST>(tasks: Tasks<'a, ST>, today: &DayWindow) -> Tasks<'a, ST> {
  tasks.filter(is_open_overdue(today.date(), today.start()))
}

/// The tasks of `view`, ordered, after `after` when given.
///
/// As in .NET, a key that lacks what its view seeks on (the completion instant for the completed view, the
/// due date for the dated ones) is ignored; the API's cursor decoding refuses such keys before they get here.
pub fn for_view<'a, ST>(tasks: Tasks<'a, ST>, view: &TaskListView, after: Option<&TaskListKey>) -> Tasks<'a, ST> {
  match view {
    TaskListView::Completed => completed(tasks, after),
    TaskListView::NoDeadline => no_deadline(tasks, after),
    TaskListView::Upcoming(dated) => self::dated(tasks, false, dated, after),
    TaskListView::Overdue(dated) => self::dated(tasks, true, dated, after),
  }
}

/// The key of `task`, from which the page after it continues in `view`.
pub fn key_of(view: &TaskListView, task: &TodoTask) -> TaskListKey {
  match view {
    TaskListView::Completed => TaskListKey {
      id: task.id(),
      due_date: None,
      instant: task.completed_at(),
    },
    TaskListView::NoDeadline => TaskListKey {
      id: task.id(),
      due_date: None,
      instant: None,
    },
    TaskListView::Upcoming(dated) | TaskListView::Overdue(dated) => TaskListKey {
      id: task.id(),
      due_date: task.due_date().or_else(|| task.due_at().map(|at| dated.zone.local_date(at))),
      instant: task.due_at(),
    },
  }
}

fn completed<'a, ST>(tasks: Tasks<'a, ST>, after: Option<&TaskListKey>) -> Tasks<'a, ST> {
  let mut tasks = tasks.filter(tasks::completed_at.is_not_null());
  if let Some(&TaskListKey { id, instant: Some(at), .. }) = after {
    tasks = tasks.filter(tasks::completed_at.lt(at).or(tasks::completed_at.eq(at).and(tasks::id.lt(id))));
  }

  tasks.order((tasks::completed_at.desc(), tasks::id.desc()))
}

fn no_deadline<'a, ST>(tasks: Tasks<'a, ST>, after: Option<&TaskListKey>) -> Tasks<'a, ST> {
  let mut tasks = tasks.filter(
    tasks::completed_at
      .is_null()
      .and(tasks::due_date.is_null())
      .and(tasks::due_at.is_null()),
  );
  if let Some(key) = after {
    tasks = tasks.filter(tasks::id.gt(key.id));
  }

  tasks.order(tasks::id.asc())
}

fn dated<'a, ST>(tasks: Tasks<'a, ST>, overdue: bool, view: &DatedView, after: Option<&TaskListKey>) -> Tasks<'a, ST> {
  let (date, start) = (view.today.date(), view.today.start());
  let zone = view.zone.id();
  let mut tasks = if overdue {
    open_overdue_for(tasks, &view.today)
  } else {
    tasks.filter(
      tasks::completed_at
        .is_null()
        .and(tasks::due_date.ge(date).or(tasks::due_at.ge(start))),
    )
  };

  // The seek predicate, expanded by hand around the nullable keys: date-only tasks (no instant) follow timed
  // ones on the same local date.
  if let Some(&TaskListKey {
    id,
    due_date: Some(after_date),
    instant,
  }) = after
  {
    tasks = match instant {
      Some(at) => tasks.filter(
        local_due_date!(zone).gt(after_date).or(
          local_due_date!(zone).eq(after_date).and(
            tasks::due_at
              .is_null()
              .or(tasks::due_at.gt(at))
              .or(tasks::due_at.eq(at).and(tasks::id.gt(id))),
          ),
        ),
      ),
      None => tasks.filter(
        local_due_date!(zone).gt(after_date).or(
          local_due_date!(zone)
            .eq(after_date)
            .and(tasks::due_at.is_null())
            .and(tasks::id.gt(id)),
        ),
      ),
    };
  }

  order_by_dated(tasks, zone)
}

/// Orders open tasks first, then by local due date, timed first, instant and id.
pub fn order_by_dated<'a, ST>(tasks: Tasks<'a, ST>, zone: &'a str) -> Tasks<'a, ST> {
  tasks.order((
    tasks::completed_at.is_not_null().asc(),
    local_due_date!(zone).asc(),
    tasks::due_at.is_null().asc(),
    tasks::due_at.asc(),
    tasks::id.asc(),
  ))
}
