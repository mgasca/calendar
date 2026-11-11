//! Ports `CalendarDbContextOwnershipTests`: the data-layer guarantees of ADR-0041. A call for a user reads and
//! saves only that user's rows.
//!
//! The .NET half about a context without a user ("sees nothing") has no counterpart: there is no repository
//! call without an owner, so that state cannot be expressed.

use calendar_domain::time::{DateRangeWindow, DayWindow, IanaZone};
use calendar_infrastructure::queries::task_list::{DatedView, TaskListView};
use calendar_infrastructure::{Error, OwnerId, agenda, events, tasks};

use crate::repositories::{USER_A, USER_B, all_day_event, date, fixture, seed, task_of, utc};
use crate::support::strings;

#[tokio::test]
async fn a_call_for_a_user_sees_only_that_users_rows() {
  let mut f = fixture().await;
  let day = date(2026, 10, 26);
  let today = DayWindow::create(day, IanaZone::UTC);
  let range = DateRangeWindow::create(day, 1, IanaZone::UTC).unwrap();
  let dated = DatedView {
    today,
    zone: IanaZone::UTC,
  };
  for (owner, name) in [(USER_A, "A"), (USER_B, "B")] {
    seed(
      &mut f.conn,
      &[all_day_event(owner, name, day, date(2026, 10, 27))],
      &[
        task_of(owner, &format!("{name} due"), Some(day), None, None),
        task_of(owner, &format!("{name} overdue"), Some(date(2026, 10, 20)), None, None),
        task_of(owner, &format!("{name} undated"), None, None, None),
        task_of(owner, &format!("{name} done"), None, None, Some(utc(2026, 10, 26, 9, 0))),
      ],
    )
    .await;
  }

  for (owner, name) in [(USER_A, "A"), (USER_B, "B")] {
    let rows = agenda::read(&mut f.conn, owner, &range, Some(&today), 20).await.unwrap();
    assert_eq!(rows.all_day_events.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), [name]);
    assert_eq!(
      rows.due_tasks.iter().map(|t| t.title.clone()).collect::<Vec<_>>(),
      [format!("{name} due")]
    );
    let overdue = rows.overdue.unwrap();
    assert_eq!(
      overdue.tasks.iter().map(|t| t.title.clone()).collect::<Vec<_>>(),
      [format!("{name} overdue")]
    );
    assert_eq!((overdue.total, overdue.open_total), (1, 1));

    // Ports the data half of `OwnershipTests.TaskListViews_ShowOnlyTheCallersRows`.
    for (view, title) in [
      (TaskListView::Upcoming(dated), "due"),
      (TaskListView::Overdue(dated), "overdue"),
      (TaskListView::Completed, "done"),
      (TaskListView::NoDeadline, "undated"),
    ] {
      let page = tasks::list_page(&mut f.conn, owner, &view, None, 50).await.unwrap();
      let titles: Vec<&str> = page.items.iter().map(|t| t.entity.title()).collect();
      assert_eq!(titles, [format!("{name} {title}")], "{view:?}");
    }
    assert_eq!(tasks::count_open_overdue(&mut f.conn, owner, &today).await.unwrap(), 1);
  }

  // A user with no rows sees nothing, though the tables are not empty.
  let nobody = OwnerId(uuid::Uuid::new_v4());
  let rows = agenda::read(&mut f.conn, nobody, &range, Some(&today), 20).await.unwrap();
  assert!(rows.all_day_events.is_empty() && rows.due_tasks.is_empty());
  assert_eq!(rows.overdue.unwrap().total, 0);
  assert_eq!(tasks::count_open_overdue(&mut f.conn, nobody, &today).await.unwrap(), 0);
}

#[tokio::test]
async fn a_call_for_a_user_refuses_to_save_a_row_owned_by_anyone_else() {
  let mut f = fixture().await;
  let day = date(2026, 10, 26);

  let task = tasks::insert(&mut f.conn, USER_A, &task_of(USER_B, "theirs", None, None, None)).await;
  assert!(matches!(task, Err(Error::OwnerMismatch)), "{task:?}");
  let event = events::insert(&mut f.conn, USER_A, &all_day_event(USER_B, "theirs", day, date(2026, 10, 27))).await;
  assert!(matches!(event, Err(Error::OwnerMismatch)), "{event:?}");

  tasks::insert(&mut f.conn, USER_A, &task_of(USER_A, "mine", None, None, None))
    .await
    .unwrap();

  let client = f.database.migrator_client().await;
  assert_eq!(strings(&client, "SELECT title FROM tasks").await, ["mine"]);
  assert_eq!(strings(&client, "SELECT title FROM events").await, Vec::<String>::new());
  // Ports the data half of `OwnershipTests.CreatedRows_BelongToTheCaller`.
  assert_eq!(strings(&client, "SELECT owner_id::text FROM tasks").await, [USER_A.0.to_string()]);
}
