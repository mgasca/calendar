//! The task list views against a real database: which tasks each shows, in which order, and that keyset
//! pages continue exactly where the previous one ended.

use calendar_domain::tasks::TodoTask;
use calendar_domain::time::{DayWindow, IanaZone, time_zones};
use calendar_infrastructure::queries::task_list::{DatedView, TaskListKey, TaskListView};
use calendar_infrastructure::{OwnerId, tasks};
use chrono::{DateTime, NaiveDate, TimeDelta, Utc};
use diesel_async::AsyncPgConnection;
use uuid::Uuid;

use crate::repositories::{OWNER, SqlLog, USER_B, date, fixture, seed, task, task_of, utc};

fn dated(today: NaiveDate, zone: &str) -> DatedView {
  let zone = time_zones::find_iana(zone).unwrap();
  DatedView {
    today: DayWindow::create(today, zone),
    zone,
  }
}

/// Every page of `view`, `page_size` tasks at a time, following the keys.
async fn all_pages(conn: &mut AsyncPgConnection, owner: OwnerId, view: &TaskListView, page_size: u32) -> Vec<TodoTask> {
  let mut all = Vec::new();
  let mut after: Option<TaskListKey> = None;
  loop {
    let page = tasks::list_page(conn, owner, view, after.as_ref(), page_size).await.unwrap();
    assert!(page.items.len() <= page_size as usize);
    assert!(!page.items.is_empty() || page.next.is_none());
    all.extend(page.items.into_iter().map(|row| row.entity));
    match page.next {
      Some(next) => after = Some(next),
      None => return all,
    }
  }
}

fn titles(tasks: &[TodoTask]) -> Vec<&str> {
  tasks.iter().map(TodoTask::title).collect()
}

/// The dated order, computed in memory with the domain's zone rules: local due date, timed before date-only,
/// due instant, id.
fn dated_order(zone: IanaZone) -> impl Fn(&TodoTask) -> (NaiveDate, bool, Option<DateTime<Utc>>, Uuid) {
  move |task| {
    let local = task.due_date().unwrap_or_else(|| zone.local_date(task.due_at().unwrap()));
    (local, task.due_at().is_none(), task.due_at(), task.id())
  }
}

/// Ports the data half of `ListTasks_DatedViews_SplitOnTheClientsDay_AndOrderByLocalDueDate`.
#[tokio::test]
async fn dated_views_split_on_the_clients_day_and_order_by_local_due_date() {
  let mut f = fixture().await;
  // In New York (UTC-4) 2026-10-26 starts at 04:00Z.
  let view = dated(date(2026, 10, 26), "America/New_York");
  seed(
    &mut f.conn,
    &[],
    &[
      task("yesterday", Some(date(2026, 10, 25)), None, None),
      // 03:59Z on the 26th is still the 25th in New York: overdue, and after the date-only task of the 24th.
      task("last night", None, Some(utc(2026, 10, 26, 3, 59)), None),
      task("two days ago", Some(date(2026, 10, 24)), None, None),
      task("midnight", None, Some(utc(2026, 10, 26, 4, 0)), None),
      task("today", Some(date(2026, 10, 26)), None, None),
      // 02:00Z on the 27th is 22:00 on the 26th in New York: listed on the 26th, before the date-only task.
      task("tonight", None, Some(utc(2026, 10, 27, 2, 0)), None),
      task("tomorrow", Some(date(2026, 10, 27)), None, None),
      task("undated", None, None, None),
      task("done overdue", Some(date(2026, 10, 20)), None, Some(utc(2026, 10, 26, 12, 0))),
      task("done upcoming", Some(date(2026, 10, 28)), None, Some(utc(2026, 10, 26, 12, 0))),
      task_of(USER_B, "theirs overdue", Some(date(2026, 10, 20)), None, None),
      task_of(USER_B, "theirs upcoming", Some(date(2026, 10, 28)), None, None),
    ],
  )
  .await;

  let overdue = all_pages(&mut f.conn, OWNER, &TaskListView::Overdue(view), 50).await;
  let upcoming = all_pages(&mut f.conn, OWNER, &TaskListView::Upcoming(view), 50).await;

  assert_eq!(titles(&overdue), ["two days ago", "last night", "yesterday"]);
  assert_eq!(titles(&upcoming), ["midnight", "tonight", "today", "tomorrow"]);
  assert_eq!(tasks::count_open_overdue(&mut f.conn, OWNER, &view.today).await.unwrap(), 3);
  assert_eq!(tasks::count_open_overdue(&mut f.conn, USER_B, &view.today).await.unwrap(), 1);
}

/// Ports the data half of `ListTasks_Completed_MostRecentFirst`, with the id as the tie-break.
#[tokio::test]
async fn completed_lists_the_most_recently_completed_first_then_id_descending() {
  let mut f = fixture().await;
  let at = utc(2026, 10, 26, 12, 0);
  let seeded = vec![
    task("first", None, None, Some(utc(2026, 10, 24, 12, 0))),
    task("tie a", Some(date(2026, 10, 1)), None, Some(at)),
    task("tie b", None, Some(utc(2026, 10, 1, 9, 0)), Some(at)),
    task("tie c", None, None, Some(at)),
    task("last", None, None, Some(utc(2026, 10, 27, 12, 0))),
    task("open", None, None, None),
    task_of(USER_B, "theirs", None, None, Some(at)),
  ];
  seed(&mut f.conn, &[], &seeded).await;

  let mut expected: Vec<TodoTask> = seeded
    .iter()
    .filter(|t| t.is_completed() && t.owner_id() == OWNER.0)
    .cloned()
    .collect();
  expected.sort_by_key(|t| std::cmp::Reverse((t.completed_at(), t.id())));
  assert_eq!(expected.first().unwrap().title(), "last");
  assert_eq!(expected.last().unwrap().title(), "first");

  for page_size in [1, 2, 50] {
    let listed = all_pages(&mut f.conn, OWNER, &TaskListView::Completed, page_size).await;
    assert_eq!(listed, expected, "page size {page_size}");
  }
}

#[tokio::test]
async fn no_deadline_lists_open_undated_tasks_by_id() {
  let mut f = fixture().await;
  let mut seeded: Vec<TodoTask> = (0..7).map(|i| task(&format!("undated {i}"), None, None, None)).collect();
  seed(&mut f.conn, &[], &seeded).await;
  seed(
    &mut f.conn,
    &[],
    &[
      task("dated", Some(date(2026, 10, 26)), None, None),
      task("timed", None, Some(utc(2026, 10, 26, 9, 0)), None),
      task("done", None, None, Some(utc(2026, 10, 26, 9, 0))),
      task_of(USER_B, "theirs", None, None, None),
    ],
  )
  .await;
  seeded.sort_by_key(TodoTask::id);

  for page_size in [1, 3, 7, 50] {
    let listed = all_pages(&mut f.conn, OWNER, &TaskListView::NoDeadline, page_size).await;
    assert_eq!(listed, seeded, "page size {page_size}");
  }
}

/// Ports the data half of `ListTasks_PagedWithCursors_ReturnsEveryTaskOnceInOrder` for the dated views: ties on
/// the local date, on the instant, and timed tasks whose local date differs from their UTC date, across every
/// page boundary.
#[tokio::test]
async fn dated_views_page_through_every_task_once_in_order() {
  for zone_id in ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"] {
    let mut f = fixture().await;
    let view = dated(date(2026, 10, 26), zone_id);
    let zone = view.zone;
    let mut seeded = Vec::new();
    for day in 20..=31 {
      // Two date-only tasks per date (tie on everything but the id).
      seeded.push(task(&format!("date {day} a"), Some(date(2026, 10, day)), None, None));
      seeded.push(task(&format!("date {day} b"), Some(date(2026, 10, day)), None, None));
      // Timed tasks around both ends of the UTC day, two of them at the same instant.
      for (hour, minute) in [(0, 0), (0, 0), (7, 30), (10, 0), (13, 59), (23, 59)] {
        seeded.push(task(
          &format!("at {day} {hour}:{minute}"),
          None,
          Some(utc(2026, 10, day, hour, minute)),
          None,
        ));
      }
    }
    seeded.push(task("at the window start", None, Some(view.today.start()), None));
    seeded.push(task(
      "just before the window start",
      None,
      Some(view.today.start() - TimeDelta::seconds(1)),
      None,
    ));
    seed(&mut f.conn, &[], &seeded).await;
    seed(
      &mut f.conn,
      &[],
      &[
        task("undated", None, None, None),
        task("done", Some(date(2026, 10, 22)), None, Some(utc(2026, 10, 26, 9, 0))),
        task_of(USER_B, "theirs", Some(date(2026, 10, 22)), None, None),
      ],
    )
    .await;

    let is_overdue = |t: &TodoTask| match (t.due_date(), t.due_at()) {
      (Some(due), _) => due < view.today.date(),
      (None, Some(at)) => at < view.today.start(),
      (None, None) => unreachable!(),
    };
    let mut expected_overdue: Vec<TodoTask> = seeded.iter().filter(|t| is_overdue(t)).cloned().collect();
    let mut expected_upcoming: Vec<TodoTask> = seeded.iter().filter(|t| !is_overdue(t)).cloned().collect();
    expected_overdue.sort_by_key(dated_order(zone));
    expected_upcoming.sort_by_key(dated_order(zone));
    assert!(expected_overdue.len() > 20 && expected_upcoming.len() > 20, "{zone_id}");

    for page_size in [1, 2, 3, 7, 200] {
      let overdue = all_pages(&mut f.conn, OWNER, &TaskListView::Overdue(view), page_size).await;
      assert_eq!(
        titles(&overdue),
        titles(&expected_overdue),
        "{zone_id}, overdue, page size {page_size}"
      );
      assert_eq!(overdue, expected_overdue, "{zone_id}, overdue, page size {page_size}");
      let upcoming = all_pages(&mut f.conn, OWNER, &TaskListView::Upcoming(view), page_size).await;
      assert_eq!(
        titles(&upcoming),
        titles(&expected_upcoming),
        "{zone_id}, upcoming, page size {page_size}"
      );
      assert_eq!(upcoming, expected_upcoming, "{zone_id}, upcoming, page size {page_size}");
    }
    assert_eq!(
      tasks::count_open_overdue(&mut f.conn, OWNER, &view.today).await.unwrap(),
      i64::try_from(expected_overdue.len()).unwrap()
    );
  }
}

/// Ports the data half of `ListTasks_LastPage_HasNoCursor` and `TaskVersion_IsTheSameInListsGetAndActions`.
#[tokio::test]
async fn a_page_reads_one_extra_row_and_carries_each_tasks_version() {
  let mut f = fixture().await;
  let seeded: Vec<TodoTask> = (0..3).map(|i| task(&format!("undated {i}"), None, None, None)).collect();
  seed(&mut f.conn, &[], &seeded).await;
  let log = SqlLog::record(&mut f.conn);

  let exact = tasks::list_page(&mut f.conn, OWNER, &TaskListView::NoDeadline, None, 3)
    .await
    .unwrap();
  let short = tasks::list_page(&mut f.conn, OWNER, &TaskListView::NoDeadline, None, 2)
    .await
    .unwrap();

  assert_eq!(exact.items.len(), 3);
  assert_eq!(exact.next, None);
  assert_eq!(short.items.len(), 2);
  assert_eq!(
    short.next,
    Some(TaskListKey {
      id: short.items[1].entity.id(),
      due_date: None,
      instant: None
    })
  );
  let statements = log.statements();
  assert!(
    statements[0].contains("LIMIT $2") && statements[0].contains("binds: [") && statements[0].contains(", 4]"),
    "{}",
    statements[0]
  );
  assert!(statements[1].contains(", 3]"), "{}", statements[1]);
  for row in exact.items {
    let found = tasks::find(&mut f.conn, OWNER, row.entity.id()).await.unwrap().unwrap();
    assert_eq!(found, row);
  }
}

/// The key of a timed task carries its local date in the view's zone, which is what the SQL seeks on.
#[tokio::test]
async fn the_key_of_a_dated_page_is_the_local_due_date_and_the_instant() {
  let mut f = fixture().await;
  let view = dated(date(2026, 10, 20), "Pacific/Kiritimati");
  let timed = task("timed", None, Some(utc(2026, 10, 26, 11, 0)), None);
  seed(
    &mut f.conn,
    &[],
    &[timed.clone(), task("later", Some(date(2026, 10, 28)), None, None)],
  )
  .await;

  let page = tasks::list_page(&mut f.conn, OWNER, &TaskListView::Upcoming(view), None, 1)
    .await
    .unwrap();

  // 11:00Z is 01:00 the next day in Kiritimati (UTC+14).
  assert_eq!(
    page.next,
    Some(TaskListKey {
      id: timed.id(),
      due_date: Some(date(2026, 10, 27)),
      instant: Some(utc(2026, 10, 26, 11, 0)),
    })
  );
}
