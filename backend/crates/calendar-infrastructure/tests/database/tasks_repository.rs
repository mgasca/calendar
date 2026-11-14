//! The task repository against a real database: round trips, optimistic concurrency by `xmin`, the bulk
//! save by ids and the guarded set-based change of the open overdue tasks.

use calendar_domain::tasks::{Priority, TodoTask};
use calendar_domain::time::{DayWindow, IanaZone};
use calendar_infrastructure::tasks::{OverdueAction, TaskWrite};
use calendar_infrastructure::{Error, RowVersion, tasks};
use uuid::Uuid;

use crate::repositories::{OWNER, SqlLog, USER_B, date, fixture, seed, sorted, task, task_of, utc};
use crate::support::{scalar, strings, wait_until_blocked};

fn today() -> DayWindow {
  DayWindow::create(date(2026, 10, 26), IanaZone::UTC)
}

#[tokio::test]
async fn a_task_round_trips_with_its_version() {
  let mut f = fixture().await;
  let mut created = TodoTask::create(OWNER.0, " Buy milk ", Some(date(2026, 10, 26)), None, "high", Some("Two litres")).unwrap();
  created.complete(utc(2026, 10, 26, 15, 0));
  let timed = task("Call", None, Some(utc(2026, 10, 26, 14, 30)), None);
  let undated = TodoTask::create(OWNER.0, "Someday", None, None, "low", None).unwrap();

  let version = tasks::insert(&mut f.conn, OWNER, &created).await.unwrap();
  seed(&mut f.conn, &[], &[timed.clone(), undated.clone()]).await;

  let found = tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().unwrap();
  assert_eq!(found.entity, created);
  assert_eq!(found.version, version);
  assert_eq!(found.entity.title(), "Buy milk");
  assert_eq!(found.entity.priority(), Priority::High);
  assert_eq!(found.entity.completed_at(), Some(utc(2026, 10, 26, 15, 0)));
  assert_eq!(tasks::find(&mut f.conn, OWNER, timed.id()).await.unwrap().unwrap().entity, timed);
  assert_eq!(
    tasks::find(&mut f.conn, OWNER, undated.id()).await.unwrap().unwrap().entity,
    undated
  );
  assert!(tasks::find(&mut f.conn, OWNER, Uuid::new_v4()).await.unwrap().is_none());
}

#[tokio::test]
async fn update_replaces_the_editable_fields_and_returns_a_new_version() {
  let mut f = fixture().await;
  let mut edited = TodoTask::create(OWNER.0, "Buy milk", Some(date(2026, 10, 26)), None, "low", Some("Two litres")).unwrap();
  let created = tasks::insert(&mut f.conn, OWNER, &edited).await.unwrap();
  let loaded = tasks::find(&mut f.conn, OWNER, edited.id()).await.unwrap().unwrap();
  let log = SqlLog::record(&mut f.conn);

  edited
    .update(" Buy oat milk ", Some(date(2026, 10, 27)), None, "high", Some("Oat"))
    .unwrap();
  let updated = tasks::update(&mut f.conn, OWNER, &loaded, &edited, created).await.unwrap();

  assert_ne!(updated, created);
  let found = tasks::find(&mut f.conn, OWNER, edited.id()).await.unwrap().unwrap();
  assert_eq!(found.entity, edited);
  assert_eq!(found.version, updated);

  // The write is guarded by owner, id and version, and names neither the owner nor the version to set.
  let update = log
    .statements()
    .into_iter()
    .find(|sql| sql.starts_with("UPDATE"))
    .expect("an update");
  let (set, guard) = update.split_once("WHERE").unwrap();
  assert!(
    !set.contains("\"owner_id\"") && !set.contains("\"xmin\"") && !set.contains("\"id\""),
    "{update}"
  );
  assert!(
    guard.contains("\"owner_id\"") && guard.contains("\"id\"") && guard.contains("\"xmin\""),
    "{update}"
  );
}

#[tokio::test]
async fn update_switches_between_deadline_kinds_and_clears_the_deadline() {
  let mut f = fixture().await;
  let mut edited = task("Call", Some(date(2026, 10, 26)), None, None);
  let v1 = tasks::insert(&mut f.conn, OWNER, &edited).await.unwrap();
  let loaded = tasks::find(&mut f.conn, OWNER, edited.id()).await.unwrap().unwrap();

  edited
    .update("Call", None, Some(utc(2026, 10, 26, 14, 30)), "medium", None)
    .unwrap();
  let v2 = tasks::update(&mut f.conn, OWNER, &loaded, &edited, v1).await.unwrap();
  let timed = tasks::find(&mut f.conn, OWNER, edited.id()).await.unwrap().unwrap();
  assert_eq!(
    (timed.entity.due_date(), timed.entity.due_at()),
    (None, Some(utc(2026, 10, 26, 14, 30)))
  );

  edited.update("Call", None, None, "medium", None).unwrap();
  tasks::update(&mut f.conn, OWNER, &timed, &edited, v2).await.unwrap();
  let undated = tasks::find(&mut f.conn, OWNER, edited.id()).await.unwrap().unwrap();
  assert_eq!((undated.entity.due_date(), undated.entity.due_at()), (None, None));
}

/// Ports the data half of `UpdateTask_AfterACompleteElsewhere_Returns409_AndLeavesTheTaskUnchanged`.
#[tokio::test]
async fn update_after_a_complete_elsewhere_conflicts_and_leaves_the_task_unchanged() {
  let mut f = fixture().await;
  let created = task("Buy milk", Some(date(2026, 10, 26)), None, None);
  let v1 = tasks::insert(&mut f.conn, OWNER, &created).await.unwrap();
  let loaded = tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().unwrap();
  let mut completed = created.clone();
  completed.complete(utc(2026, 10, 26, 15, 0));
  tasks::update(&mut f.conn, OWNER, &loaded, &completed, loaded.version)
    .await
    .unwrap();
  let latest = tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().unwrap();

  let mut stale = latest.entity.clone();
  stale.update("Stale write", Some(date(2026, 10, 27)), None, "medium", None).unwrap();
  let result = tasks::update(&mut f.conn, OWNER, &latest, &stale, v1).await;

  assert!(matches!(result, Err(Error::Conflict)), "{result:?}");
  assert_eq!(tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().unwrap(), latest);
}

/// Complete and reopen save with the version they loaded: only a write in between conflicts, and a change
/// that changes nothing (completing a completed task) writes nothing.
#[tokio::test]
async fn a_change_saved_with_the_loaded_version_conflicts_only_with_a_write_in_between() {
  let mut f = fixture().await;
  let created = task("Buy milk", None, None, None);
  tasks::insert(&mut f.conn, OWNER, &created).await.unwrap();
  let loaded = tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().unwrap();

  let mut completed = loaded.entity.clone();
  completed.complete(utc(2026, 10, 26, 15, 0));
  let v2 = tasks::update(&mut f.conn, OWNER, &loaded, &completed, loaded.version)
    .await
    .unwrap();
  assert_ne!(v2, loaded.version);

  // Idempotent: completing again changes nothing, so nothing is written and the version stays.
  let again = tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().unwrap();
  let mut same = again.entity.clone();
  same.complete(utc(2026, 10, 26, 16, 0));
  let log = SqlLog::record(&mut f.conn);
  assert_eq!(tasks::update(&mut f.conn, OWNER, &again, &same, again.version).await.unwrap(), v2);
  assert_eq!(
    tasks::update(&mut f.conn, OWNER, &again, &same, RowVersion(v2.0.wrapping_add(5)))
      .await
      .unwrap(),
    v2
  );
  assert_eq!(log.statements(), Vec::<String>::new());

  // A reopen that raced with the completion above: it loaded the open task.
  let mut reopened = loaded.entity.clone();
  reopened.update("Renamed", None, None, "medium", None).unwrap();
  let raced = tasks::update(&mut f.conn, OWNER, &loaded, &reopened, loaded.version).await;
  assert!(matches!(raced, Err(Error::Conflict)), "{raced:?}");
}

#[tokio::test]
async fn update_and_delete_of_a_task_that_is_gone_are_not_found() {
  let mut f = fixture().await;
  let created = task("Buy milk", None, None, None);
  let version = tasks::insert(&mut f.conn, OWNER, &created).await.unwrap();
  let loaded = tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().unwrap();
  tasks::delete(&mut f.conn, OWNER, created.id(), version).await.unwrap();
  assert!(tasks::find(&mut f.conn, OWNER, created.id()).await.unwrap().is_none());

  let mut edited = created.clone();
  edited.update("Too late", None, None, "medium", None).unwrap();
  let update = tasks::update(&mut f.conn, OWNER, &loaded, &edited, version).await;
  assert!(matches!(update, Err(Error::NotFound)), "{update:?}");
  let delete = tasks::delete(&mut f.conn, OWNER, created.id(), version).await;
  assert!(matches!(delete, Err(Error::NotFound)), "{delete:?}");
}

/// Ports the data half of `Delete_RemovesOpenAndCompletedTasks`, and what a delete with a stale version means.
#[tokio::test]
async fn delete_removes_open_and_completed_tasks_and_refuses_a_stale_version() {
  let mut f = fixture().await;
  let open = task("Open", None, None, None);
  let done = task("Done", None, None, Some(utc(2026, 10, 26, 15, 0)));
  let open_version = tasks::insert(&mut f.conn, OWNER, &open).await.unwrap();
  let done_version = tasks::insert(&mut f.conn, OWNER, &done).await.unwrap();

  let stale = tasks::delete(&mut f.conn, OWNER, open.id(), RowVersion(open_version.0.wrapping_add(5))).await;
  assert!(matches!(stale, Err(Error::Conflict)), "{stale:?}");

  tasks::delete(&mut f.conn, OWNER, open.id(), open_version).await.unwrap();
  tasks::delete(&mut f.conn, OWNER, done.id(), done_version).await.unwrap();
  let client = f.database.migrator_client().await;
  assert_eq!(scalar::<i64>(&client, "SELECT count(*) FROM tasks").await, 0);
}

/// Ports the data half of `OwnershipTests.AnotherUsersTask_*` and `BulkByIds_ReportsAnotherUsersTasksAsNotFound`.
#[tokio::test]
async fn another_users_task_is_invisible_and_cannot_be_written() {
  let mut f = fixture().await;
  let mine = task("Mine", Some(date(2026, 10, 20)), None, None);
  let theirs = task_of(USER_B, "Theirs", Some(date(2026, 10, 20)), None, None);
  seed(&mut f.conn, &[], &[mine.clone(), theirs.clone()]).await;
  let their_row = tasks::find(&mut f.conn, USER_B, theirs.id()).await.unwrap().unwrap();

  assert!(tasks::find(&mut f.conn, OWNER, theirs.id()).await.unwrap().is_none());
  let found = tasks::find_many(&mut f.conn, OWNER, &[mine.id(), theirs.id(), Uuid::new_v4()])
    .await
    .unwrap();
  assert_eq!(found.iter().map(|t| t.entity.id()).collect::<Vec<_>>(), [mine.id()]);

  let mut taken = theirs.clone();
  taken.complete(utc(2026, 10, 26, 15, 0));
  let update = tasks::update(&mut f.conn, OWNER, &their_row, &taken, their_row.version).await;
  assert!(matches!(update, Err(Error::OwnerMismatch)), "{update:?}");
  let delete = tasks::delete(&mut f.conn, OWNER, theirs.id(), their_row.version).await;
  assert!(matches!(delete, Err(Error::NotFound)), "{delete:?}");
  let batch = tasks::write_batch(
    &mut f.conn,
    OWNER,
    &[TaskWrite::Delete {
      id: theirs.id(),
      expected: their_row.version,
    }],
  )
  .await
  .unwrap();
  assert_eq!(batch, [false]);
  let insert = tasks::insert(&mut f.conn, OWNER, &task_of(USER_B, "Planted", None, None, None)).await;
  assert!(matches!(insert, Err(Error::OwnerMismatch)), "{insert:?}");

  assert_eq!(tasks::find(&mut f.conn, USER_B, theirs.id()).await.unwrap().unwrap(), their_row);
  let client = f.database.migrator_client().await;
  assert_eq!(scalar::<i64>(&client, "SELECT count(*) FROM tasks").await, 2);
}

/// The bulk-by-ids save: each write applies if its row still has the version it was loaded with; a row that
/// changed or went is skipped without stopping the others.
#[tokio::test]
async fn write_batch_applies_what_is_unchanged_and_skips_what_changed_since_it_was_loaded() {
  let mut f = fixture().await;
  let seeded: Vec<TodoTask> = (0..5)
    .map(|i| task(&format!("task {i}"), Some(date(2026, 10, 20)), None, None))
    .collect();
  seed(&mut f.conn, &[], &seeded).await;
  let ids: Vec<Uuid> = seeded.iter().map(TodoTask::id).collect();
  let mut loaded = tasks::find_many(&mut f.conn, OWNER, &ids).await.unwrap();
  loaded.sort_by_key(|t| ids.iter().position(|id| *id == t.entity.id()));

  // Meanwhile task 1 is changed and task 3 deleted elsewhere.
  let mut renamed = loaded[1].entity.clone();
  renamed
    .update("changed elsewhere", Some(date(2026, 10, 20)), None, "medium", None)
    .unwrap();
  tasks::update(&mut f.conn, OWNER, &loaded[1], &renamed, loaded[1].version)
    .await
    .unwrap();
  tasks::delete(&mut f.conn, OWNER, ids[3], loaded[3].version).await.unwrap();

  let now = utc(2026, 10, 26, 15, 0);
  let writes: Vec<TaskWrite> = loaded
    .iter()
    .enumerate()
    .map(|(i, row)| {
      if i == 4 {
        TaskWrite::Delete {
          id: row.entity.id(),
          expected: row.version,
        }
      } else {
        let mut completed = row.entity.clone();
        completed.complete(now);
        TaskWrite::Update {
          task: completed,
          expected: row.version,
        }
      }
    })
    .collect();
  let applied = tasks::write_batch(&mut f.conn, OWNER, &writes).await.unwrap();

  assert_eq!(applied, [true, false, true, false, true]);
  let client = f.database.migrator_client().await;
  assert_eq!(
    strings(&client, "SELECT title FROM tasks WHERE completed_at IS NOT NULL ORDER BY title").await,
    ["task 0", "task 2"]
  );
  assert_eq!(
    strings(&client, "SELECT title FROM tasks WHERE completed_at IS NULL ORDER BY title").await,
    ["changed elsewhere"]
  );
}

#[tokio::test]
async fn write_batch_is_one_transaction() {
  let mut f = fixture().await;
  let mine = task("Mine", None, None, None);
  let version = tasks::insert(&mut f.conn, OWNER, &mine).await.unwrap();
  let mut completed = mine.clone();
  completed.complete(utc(2026, 10, 26, 15, 0));
  let log = SqlLog::record(&mut f.conn);

  // The second write is refused, which rolls the first one back.
  let result = tasks::write_batch(
    &mut f.conn,
    OWNER,
    &[
      TaskWrite::Update {
        task: completed,
        expected: version,
      },
      TaskWrite::Update {
        task: task_of(USER_B, "Theirs", None, None, None),
        expected: version,
      },
    ],
  )
  .await;

  assert!(matches!(result, Err(Error::OwnerMismatch)), "{result:?}");
  let statements = log.statements();
  assert_eq!(statements.first().map(String::as_str), Some("<begin>"));
  assert_eq!(statements.last().map(String::as_str), Some("ROLLBACK"));
  assert!(statements.iter().any(|sql| sql.starts_with("UPDATE")), "{statements:?}");
  let found = tasks::find(&mut f.conn, OWNER, mine.id()).await.unwrap().unwrap();
  assert_eq!((found.entity, found.version), (mine, version));
}

/// Five open overdue tasks of the owner as of 2026-10-26 UTC, plus rows the filter must leave alone.
async fn seed_overdue(conn: &mut diesel_async::AsyncPgConnection) -> Vec<TodoTask> {
  let overdue = vec![
    task("date -6", Some(date(2026, 10, 20)), None, None),
    task("date -1", Some(date(2026, 10, 25)), None, None),
    task("at -2d", None, Some(utc(2026, 10, 24, 12, 0)), None),
    task("at -1m", None, Some(utc(2026, 10, 25, 23, 59)), None),
    task("at -30d", None, Some(utc(2026, 9, 26, 0, 0)), None),
  ];
  let others = vec![
    task("due today", Some(date(2026, 10, 26)), None, None),
    task("due at midnight", None, Some(utc(2026, 10, 26, 0, 0)), None),
    task("undated", None, None, None),
    task("completed overdue", Some(date(2026, 10, 20)), None, Some(utc(2026, 10, 21, 9, 0))),
    task_of(USER_B, "theirs", Some(date(2026, 10, 20)), None, None),
  ];
  seed(conn, &[], &overdue).await;
  seed(conn, &[], &others).await;
  overdue
}

const UNTOUCHED: &str = "SELECT title FROM tasks WHERE title IN ('due today', 'due at midnight', 'undated', 'theirs') \
                         AND completed_at IS NULL AND (due_date, due_at) IS NOT DISTINCT FROM \
                         (CASE title WHEN 'due today' THEN DATE '2026-10-26' WHEN 'theirs' THEN DATE '2026-10-20' END, \
                          CASE title WHEN 'due at midnight' THEN TIMESTAMPTZ '2026-10-26 00:00+00' END) ORDER BY title";

/// Ports the data half of `BulkTasks_FilterTarget_AppliesActionsAndUpdatesAgendaOverdueCounts` and
/// `OwnershipTests.BulkByFilter_OnlyTouchesTheCallersOverdueTasks`.
#[tokio::test]
async fn the_filtered_change_touches_exactly_the_owners_open_overdue_tasks() {
  let completed_at = utc(2026, 10, 26, 15, 0);
  let cases: [(OverdueAction, &str, &[&str]); 5] = [
    (
      OverdueAction::Complete(completed_at),
      "SELECT title FROM tasks WHERE completed_at = '2026-10-26 15:00+00' ORDER BY title",
      &["at -1m", "at -2d", "at -30d", "date -1", "date -6"],
    ),
    (
      OverdueAction::SetDeadline(TodoTask::for_due_date(date(2026, 11, 2))),
      "SELECT title FROM tasks WHERE due_date = '2026-11-02' AND due_at IS NULL ORDER BY title",
      &["at -1m", "at -2d", "at -30d", "date -1", "date -6"],
    ),
    (
      OverdueAction::SetDeadline(TodoTask::for_due_instant(utc(2026, 11, 2, 9, 0))),
      "SELECT title FROM tasks WHERE due_at = '2026-11-02 09:00+00' AND due_date IS NULL ORDER BY title",
      &["at -1m", "at -2d", "at -30d", "date -1", "date -6"],
    ),
    (
      OverdueAction::SetDeadline(TodoTask::without_deadline()),
      "SELECT title FROM tasks WHERE due_at IS NULL AND due_date IS NULL AND title <> 'undated' ORDER BY title",
      &["at -1m", "at -2d", "at -30d", "date -1", "date -6"],
    ),
    (
      OverdueAction::Delete,
      "SELECT title FROM tasks WHERE title LIKE 'at %' OR title LIKE 'date %'",
      &[],
    ),
  ];
  for (action, changed_sql, changed) in cases {
    let mut f = fixture().await;
    seed_overdue(&mut f.conn).await;
    assert_eq!(tasks::count_open_overdue(&mut f.conn, OWNER, &today()).await.unwrap(), 5);

    let applied = tasks::apply_to_open_overdue(&mut f.conn, OWNER, &today(), 5, action).await.unwrap();

    assert_eq!(applied, 5, "{action:?}");
    let client = f.database.migrator_client().await;
    assert_eq!(strings(&client, changed_sql).await, changed, "{action:?}");
    assert_eq!(
      strings(&client, UNTOUCHED).await,
      ["due at midnight", "due today", "theirs", "undated"],
      "{action:?}"
    );
    assert_eq!(
      scalar::<String>(&client, "SELECT completed_at::text FROM tasks WHERE title = 'completed overdue'").await,
      "2026-10-21 09:00:00+00"
    );
    assert_eq!(
      tasks::count_open_overdue(&mut f.conn, OWNER, &today()).await.unwrap(),
      0,
      "{action:?}"
    );
    assert_eq!(
      tasks::count_open_overdue(&mut f.conn, USER_B, &today()).await.unwrap(),
      1,
      "{action:?}"
    );
  }
}

/// Ports the data half of `BulkTasks_CompleteIsIdempotentAndFilterCountGuardsChanges`: the count the client saw
/// must still hold.
#[tokio::test]
async fn the_filtered_change_is_refused_when_the_count_changed() {
  let mut f = fixture().await;
  seed_overdue(&mut f.conn).await;
  let log = SqlLog::record(&mut f.conn);

  for wrong in [4, 6, 0] {
    let result = tasks::apply_to_open_overdue(&mut f.conn, OWNER, &today(), wrong, OverdueAction::Delete).await;
    assert!(matches!(result, Err(Error::Conflict)), "{result:?}");
  }

  let statements = log.statements();
  assert!(
    statements.iter().any(|sql| sql.contains("ISOLATION LEVEL SERIALIZABLE")),
    "{statements:?}"
  );
  assert_eq!(statements.iter().filter(|sql| *sql == "<rollback>").count(), 3, "{statements:?}");
  assert!(!statements.iter().any(|sql| sql.starts_with("DELETE")), "{statements:?}");
  assert_eq!(tasks::count_open_overdue(&mut f.conn, OWNER, &today()).await.unwrap(), 5);
}

/// Ports the data half of `BulkTasks_FilterTarget_NoOpDeadlineChangesDoNotUpdateRows`: a task that already has
/// the deadline is neither written (its version stays) nor counted.
#[tokio::test]
async fn the_filtered_deadline_change_skips_tasks_that_already_have_the_deadline() {
  let cases = [
    (TodoTask::for_due_date(date(2026, 10, 25)), "date -1"),
    (TodoTask::for_due_instant(utc(2026, 10, 24, 12, 0)), "at -2d"),
  ];
  for (deadline, already) in cases {
    let mut f = fixture().await;
    let overdue = seed_overdue(&mut f.conn).await;
    let same = overdue.iter().find(|t| t.title() == already).unwrap();
    let before = tasks::find(&mut f.conn, OWNER, same.id()).await.unwrap().unwrap();

    let applied = tasks::apply_to_open_overdue(&mut f.conn, OWNER, &today(), 5, OverdueAction::SetDeadline(deadline))
      .await
      .unwrap();

    assert_eq!(applied, 4, "{deadline:?}");
    assert_eq!(
      tasks::find(&mut f.conn, OWNER, same.id()).await.unwrap().unwrap(),
      before,
      "{deadline:?}"
    );
    let ids = sorted(overdue.iter().map(TodoTask::id).collect());
    let after = tasks::find_many(&mut f.conn, OWNER, &ids).await.unwrap();
    assert!(
      after.iter().all(|t| (t.entity.due_date(), t.entity.due_at()) == deadline),
      "{deadline:?}"
    );
  }
}

/// The serializable transaction's other guard: a concurrent write to a task the change touches aborts it with
/// SQLSTATE 40001, which is the same conflict to the client as a changed count.
#[tokio::test]
async fn the_filtered_change_reports_a_serialization_failure_as_a_conflict() {
  let mut f = fixture().await;
  let overdue = seed_overdue(&mut f.conn).await;
  let mut other = f.database.app_client().await;
  let admin = f.database.admin_client().await;

  // Another request has changed one of the tasks and not committed yet.
  let racing = other.transaction().await.unwrap();
  racing
    .execute("UPDATE tasks SET title = 'renamed' WHERE id = $1", &[&overdue[0].id()])
    .await
    .unwrap();

  let mut conn = f.conn;
  let bulk = tokio::spawn(async move {
    let result = tasks::apply_to_open_overdue(&mut conn, OWNER, &today(), 5, OverdueAction::Complete(utc(2026, 10, 26, 15, 0))).await;
    (conn, result)
  });
  // Wait until the bulk change is blocked on that row, then let the other request win.
  wait_until_blocked(&admin, &bulk).await;
  racing.commit().await.unwrap();
  let (mut conn, result) = bulk.await.unwrap();

  assert!(matches!(result, Err(Error::Conflict)), "{result:?}");
  assert_eq!(tasks::count_open_overdue(&mut conn, OWNER, &today()).await.unwrap(), 5);
}
