//! The task repository: every read and write the task endpoints perform, each scoped to an owner (ADR-0041).
//!
//! Optimistic concurrency is PostgreSQL's `xmin`, as it was with EF Core (ADR-0052): a write names the version
//! the row must still have. A write that affects no row is told apart by one more read: the row is gone
//! ([`Error::NotFound`]) or was changed ([`Error::Conflict`]).

#![allow(clippy::ref_option_ref, reason = "the AsChangeset derive borrows the Option<&str> fields")]

use calendar_domain::tasks::{Deadline, Priority, TodoTask, TodoTaskRecord};
use calendar_domain::time::DayWindow;
use chrono::{DateTime, NaiveDate, Utc};
use diesel::pg::Pg;
use diesel::prelude::*;
use diesel_async::{AsyncConnection, AsyncPgConnection, RunQueryDsl};
use uuid::Uuid;

use crate::error::Error;
use crate::ownership::{OwnerId, RowVersion, Versioned};
use crate::queries::task_list::{self, TaskListKey, TaskListView, is_open_overdue};
use crate::queries::{Tasks, owned_tasks};
use crate::schema::tasks;

#[derive(Queryable, Selectable)]
#[diesel(table_name = tasks, check_for_backend(Pg))]
struct TaskRow {
  id: Uuid,
  owner_id: Uuid,
  title: String,
  priority: String,
  notes: Option<String>,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
  completed_at: Option<DateTime<Utc>>,
  xmin: RowVersion,
}

impl TaskRow {
  fn into_versioned(self) -> Result<Versioned<TodoTask>, Error> {
    let priority = Priority::parse(&self.priority).ok_or(Error::InvalidRow {
      entity: "task",
      reason: "the priority is not low, medium or high",
    })?;
    Ok(Versioned {
      entity: TodoTask::restore(TodoTaskRecord {
        id: self.id,
        owner_id: self.owner_id,
        title: self.title,
        priority,
        notes: self.notes,
        due_date: self.due_date,
        due_at: self.due_at,
        completed_at: self.completed_at,
      }),
      version: self.xmin,
    })
  }
}

/// The columns an insert writes. `xmin` is the database's.
#[derive(Insertable)]
#[diesel(table_name = tasks)]
struct NewTask<'a> {
  id: Uuid,
  owner_id: Uuid,
  title: &'a str,
  priority: &'a str,
  notes: Option<&'a str>,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
  completed_at: Option<DateTime<Utc>>,
}

/// The columns an update may change: never the id, the owner or `xmin`.
#[derive(AsChangeset)]
#[diesel(table_name = tasks, treat_none_as_null = true)]
struct TaskChanges<'a> {
  title: &'a str,
  priority: &'a str,
  notes: Option<&'a str>,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
  completed_at: Option<DateTime<Utc>>,
}

impl<'a> TaskChanges<'a> {
  fn of(task: &'a TodoTask) -> Self {
    Self {
      title: task.title(),
      priority: task.priority().as_str(),
      notes: task.notes(),
      due_date: task.due_date(),
      due_at: task.due_at(),
      completed_at: task.completed_at(),
    }
  }
}

/// Selects whole task rows, the shape every read here returns.
fn rows(tasks: Tasks<'_>) -> Tasks<'_, diesel::dsl::SqlTypeOf<diesel::dsl::AsSelect<TaskRow, Pg>>> {
  tasks.select(TaskRow::as_select())
}

/// Inserts `task` for `owner` and returns the new row's version. A task of another owner is refused with
/// [`Error::OwnerMismatch`] before anything is sent.
pub async fn insert(conn: &mut AsyncPgConnection, owner: OwnerId, task: &TodoTask) -> Result<RowVersion, Error> {
  if task.owner_id() != owner.0 {
    return Err(Error::OwnerMismatch);
  }

  let version = diesel::insert_into(tasks::table)
    .values(NewTask {
      id: task.id(),
      owner_id: owner.0,
      title: task.title(),
      priority: task.priority().as_str(),
      notes: task.notes(),
      due_date: task.due_date(),
      due_at: task.due_at(),
      completed_at: task.completed_at(),
    })
    .returning(tasks::xmin)
    .get_result(conn)
    .await?;
  Ok(version)
}

/// The owner's task `id` with its version, or `None`.
pub async fn find(conn: &mut AsyncPgConnection, owner: OwnerId, id: Uuid) -> Result<Option<Versioned<TodoTask>>, Error> {
  rows(owned_tasks(owner).filter(tasks::id.eq(id)))
    .first::<TaskRow>(conn)
    .await
    .optional()?
    .map(TaskRow::into_versioned)
    .transpose()
}

/// The owner's tasks among `ids`, in no particular order. Ids that are missing or someone else's are absent.
pub async fn find_many(conn: &mut AsyncPgConnection, owner: OwnerId, ids: &[Uuid]) -> Result<Vec<Versioned<TodoTask>>, Error> {
  rows(owned_tasks(owner).filter(tasks::id.eq_any(ids)))
    .load::<TaskRow>(conn)
    .await?
    .into_iter()
    .map(TaskRow::into_versioned)
    .collect()
}

/// Saves `changed`, the entity of `loaded` after a domain change, provided the row still has `expected`.
/// Returns the row's version afterwards.
///
/// As with EF Core's change tracking, nothing is written when `changed` equals `loaded.entity`: the result is
/// then `loaded.version`, and `expected` is not checked (observed on the .NET API: an update that changes
/// nothing answers 200 with the current version, whatever version the request carried).
///
/// Pass the client's version as `expected` for an edit, or `loaded.version` for a change that must only not
/// race (complete, reopen). When the write matches no row: [`Error::Conflict`] if the owner still has the
/// task, [`Error::NotFound`] if not.
pub async fn update(
  conn: &mut AsyncPgConnection,
  owner: OwnerId,
  loaded: &Versioned<TodoTask>,
  changed: &TodoTask,
  expected: RowVersion,
) -> Result<RowVersion, Error> {
  if changed.owner_id() != owner.0 || changed.id() != loaded.entity.id() {
    return Err(Error::OwnerMismatch);
  }
  if *changed == loaded.entity {
    return Ok(loaded.version);
  }

  let written = update_row(conn, owner, changed, expected).await?;
  match written {
    Some(version) => Ok(version),
    None => Err(conflict_or_not_found(conn, owner, changed.id()).await?),
  }
}

/// Deletes the owner's task `id`, provided the row still has `expected`. [`Error::Conflict`] when the task
/// exists with another version, [`Error::NotFound`] when the owner has no such task.
pub async fn delete(conn: &mut AsyncPgConnection, owner: OwnerId, id: Uuid, expected: RowVersion) -> Result<(), Error> {
  if delete_row(conn, owner, id, expected).await? {
    Ok(())
  } else {
    Err(conflict_or_not_found(conn, owner, id).await?)
  }
}

/// One write of a [`write_batch`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskWrite {
  /// Save the task, if its row still has the version.
  Update {
    /// The changed entity.
    task: TodoTask,
    /// The version the task was loaded with.
    expected: RowVersion,
  },
  /// Delete the task, if its row still has the version.
  Delete {
    /// The task's id.
    id: Uuid,
    /// The version the task was loaded with.
    expected: RowVersion,
  },
}

/// Applies `writes` in one transaction and tells, for each in order, whether it was applied (`true`) or
/// skipped because the row had changed or gone since it was loaded (`false`). A skipped write does not stop
/// the others; any other failure rolls all of them back.
///
/// This is the bulk-by-ids save. The .NET endpoint saved all changes at once and, on a concurrency failure,
/// dropped the conflicting task and retried the rest; checking each write's row count inside one transaction
/// ends in the same state. Leave out tasks the domain change did not alter: EF Core wrote nothing for them.
pub async fn write_batch(conn: &mut AsyncPgConnection, owner: OwnerId, writes: &[TaskWrite]) -> Result<Vec<bool>, Error> {
  conn
    .transaction(async |conn| {
      let mut applied = Vec::with_capacity(writes.len());
      for write in writes {
        applied.push(match write {
          TaskWrite::Update { task, expected } => {
            if task.owner_id() != owner.0 {
              return Err(Error::OwnerMismatch);
            }
            update_row(conn, owner, task, *expected).await?.is_some()
          }
          TaskWrite::Delete { id, expected } => delete_row(conn, owner, *id, *expected).await?,
        });
      }
      Ok(applied)
    })
    .await
}

/// One page of a task list view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskPage {
  /// At most `page_size` tasks, in the view's order.
  pub items: Vec<Versioned<TodoTask>>,
  /// The key of the last item when another page follows, else `None`.
  pub next: Option<TaskListKey>,
}

/// The page of `view` after `after` (the first page when `None`), holding at most `page_size` tasks. One
/// extra row is read to learn whether another page follows.
pub async fn list_page(
  conn: &mut AsyncPgConnection,
  owner: OwnerId,
  view: &TaskListView,
  after: Option<&TaskListKey>,
  page_size: u32,
) -> Result<TaskPage, Error> {
  let size = usize::try_from(page_size).unwrap_or(usize::MAX);
  let mut items = rows(task_list::for_view(owned_tasks(owner), view, after))
    .limit(i64::from(page_size) + 1)
    .load::<TaskRow>(conn)
    .await?
    .into_iter()
    .map(TaskRow::into_versioned)
    .collect::<Result<Vec<_>, _>>()?;

  let more = items.len() > size;
  items.truncate(size);
  let next = if more {
    items.last().map(|last| task_list::key_of(view, &last.entity))
  } else {
    None
  };
  Ok(TaskPage { items, next })
}

/// How many open tasks of the owner are overdue as of `today`: the overdue view's total, and the count a
/// bulk-by-filter must still find.
pub async fn count_open_overdue(conn: &mut AsyncPgConnection, owner: OwnerId, today: &DayWindow) -> Result<i64, Error> {
  let total = task_list::open_overdue_for(owned_tasks(owner), today)
    .count()
    .get_result(conn)
    .await?;
  Ok(total)
}

/// What a bulk-by-filter does to every open overdue task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverdueAction {
  /// Complete them at this instant (pass `TodoTask::normalize_completion_time(now)`).
  Complete(DateTime<Utc>),
  /// Give them this deadline (`TodoTask::for_due_date`, `for_due_instant` or `without_deadline`). Tasks that
  /// already have exactly it are not written and not counted.
  SetDeadline(Deadline),
  /// Delete them.
  Delete,
}

/// Applies `action` to the owner's open overdue tasks as of `today`, in one serializable transaction, and
/// returns how many rows it changed.
///
/// The transaction first counts those tasks. If the count is not `expected_total`, or PostgreSQL aborts the
/// transaction with a serialization failure or a deadlock, nothing is changed and the result is
/// [`Error::Conflict`]: the client decided on a list that is no longer the one in the database.
pub async fn apply_to_open_overdue(
  conn: &mut AsyncPgConnection,
  owner: OwnerId,
  today: &DayWindow,
  expected_total: i64,
  action: OverdueAction,
) -> Result<usize, Error> {
  let (date, start) = (today.date(), today.start());
  let result = conn
    .build_transaction()
    .serializable()
    .run(async |conn| {
      let matching: i64 = task_list::open_overdue_for(owned_tasks(owner), today)
        .count()
        .get_result(conn)
        .await?;
      if matching != expected_total {
        return Err(Error::Conflict);
      }

      let overdue = tasks::table
        .filter(tasks::owner_id.eq(owner.0))
        .filter(is_open_overdue(date, start));
      let applied = match action {
        OverdueAction::Complete(at) => diesel::update(overdue).set(tasks::completed_at.eq(Some(at))).execute(conn).await?,
        OverdueAction::SetDeadline((due_date, due_at)) => {
          // Only rows whose deadline differs: `IS DISTINCT FROM` is the null-aware `<>`.
          diesel::update(overdue)
            .filter(
              tasks::due_date
                .is_distinct_from(due_date)
                .or(tasks::due_at.is_distinct_from(due_at)),
            )
            .set((tasks::due_date.eq(due_date), tasks::due_at.eq(due_at)))
            .execute(conn)
            .await?
        }
        OverdueAction::Delete => diesel::delete(overdue).execute(conn).await?,
      };
      Ok(applied)
    })
    .await;

  match result {
    Err(error) if error.is_serialization_or_deadlock() => Err(Error::Conflict),
    other => other,
  }
}

async fn update_row(
  conn: &mut AsyncPgConnection,
  owner: OwnerId,
  task: &TodoTask,
  expected: RowVersion,
) -> Result<Option<RowVersion>, Error> {
  let version = diesel::update(
    tasks::table
      .filter(tasks::owner_id.eq(owner.0))
      .filter(tasks::id.eq(task.id()))
      .filter(tasks::xmin.eq(expected)),
  )
  .set(TaskChanges::of(task))
  .returning(tasks::xmin)
  .get_result(conn)
  .await
  .optional()?;
  Ok(version)
}

async fn delete_row(conn: &mut AsyncPgConnection, owner: OwnerId, id: Uuid, expected: RowVersion) -> Result<bool, Error> {
  let deleted = diesel::delete(
    tasks::table
      .filter(tasks::owner_id.eq(owner.0))
      .filter(tasks::id.eq(id))
      .filter(tasks::xmin.eq(expected)),
  )
  .execute(conn)
  .await?;
  Ok(deleted > 0)
}

/// After a write that matched no row: the error that says why.
async fn conflict_or_not_found(conn: &mut AsyncPgConnection, owner: OwnerId, id: Uuid) -> Result<Error, Error> {
  let exists: i64 = owned_tasks(owner).filter(tasks::id.eq(id)).count().get_result(conn).await?;
  Ok(if exists > 0 { Error::Conflict } else { Error::NotFound })
}
