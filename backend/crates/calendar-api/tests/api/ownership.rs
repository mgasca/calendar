//! Ports `Endpoints/OwnershipTests.cs` and `CalendarDbContextOwnershipTests.cs` of `Calendar.Api.Tests`
//! (story 0017, ADR-0041): every endpoint sees only the signed-in user's rows, and another user's id answers
//! as if it did not exist. `app.client()` acts as user A; `app.client_as(USER_B)` as user B.

use crate::common::*;
use calendar_domain::time::{DateRangeWindow, IanaZone};
use calendar_infrastructure::queries::task_list::TaskListView;
use calendar_infrastructure::{Error, OwnerId, agenda, events, tasks};

const ZONE: &str = "UTC";
const BULK: &str = "/api/tasks/bulk";

fn today() -> NaiveDate {
  date(2026, 10, 26)
}

fn days(count: i64) -> TimeDelta {
  TimeDelta::days(count)
}

fn timed_event(owner: Uuid, title: &str) -> CalendarEvent {
  CalendarEvent::create(owner, title, utc(2026, 10, 26, 10, 0), utc(2026, 10, 26, 11, 0), ZONE, None, None).expect("a valid event")
}

fn all_day_event(owner: Uuid, title: &str) -> CalendarEvent {
  CalendarEvent::create_all_day(owner, title, today(), today() + days(1), None, None).expect("a valid event")
}

fn completed_task_of(owner: Uuid, title: &str, due_date: Option<NaiveDate>, completed_at: DateTime<Utc>) -> TodoTask {
  let mut task = task_of(owner, title, due_date, None);
  task.complete(completed_at);
  task
}

async fn list(client: &TestClient, view: &str) -> TaskPage {
  let query = if matches!(view, "upcoming" | "overdue") {
    format!("view={view}&today=2026-10-26&timeZone={ZONE}")
  } else {
    format!("view={view}")
  };
  let response = client.get(&format!("/api/tasks?{query}")).await;
  assert_eq!(response.status, StatusCode::OK, "{}", response.text());
  response.json()
}

/// The same shape of data for both users: one of each kind, titled with the owner's letter.
async fn seed_both_users(app: &TestApp) {
  let mut events = Vec::new();
  let mut tasks = Vec::new();
  for (owner, letter) in [(USER_A, "A"), (USER_B, "B")] {
    events.push(all_day_event(owner, &format!("{letter} all-day")));
    events.push(timed_event(owner, &format!("{letter} timed")));
    tasks.push(task_of(owner, &format!("{letter} due today"), Some(today()), None));
    tasks.push(task_of(owner, &format!("{letter} overdue"), Some(today() - days(3)), None));
    tasks.push(task_of(owner, &format!("{letter} upcoming"), Some(today() + days(5)), None));
    tasks.push(task_of(owner, &format!("{letter} no deadline"), None, None));
    tasks.push(completed_task_of(
      owner,
      &format!("{letter} completed"),
      Some(today() - days(10)),
      utc(2026, 10, 20, 9, 0),
    ));
  }

  app.seed(&events, &tasks).await;
}

/// The first column of every row of `sql`, read as the schema owner (who sees every user's rows).
async fn strings(app: &TestApp, sql: &str) -> Vec<String> {
  let client = app.database().migrator_client().await;
  client
    .query(sql, &[])
    .await
    .expect("the query runs")
    .iter()
    .map(|row| row.get(0))
    .collect()
}

/// `(title, is completed)` of every task, by title.
async fn tasks_by_title(app: &TestApp) -> Vec<(String, bool)> {
  let client = app.database().migrator_client().await;
  client
    .query("SELECT title::text, completed_at IS NOT NULL FROM tasks ORDER BY title", &[])
    .await
    .expect("the query runs")
    .iter()
    .map(|row| (row.get(0), row.get(1)))
    .collect()
}

async fn is_completed(app: &TestApp, id: Uuid) -> bool {
  let client = app.database().migrator_client().await;
  client
    .query_one("SELECT completed_at IS NOT NULL FROM tasks WHERE id = $1", &[&id])
    .await
    .expect("the task exists exactly once")
    .get(0)
}

fn titles<T>(items: &[T], title: impl Fn(&T) -> &str) -> Vec<&str> {
  items.iter().map(title).collect()
}

#[tokio::test]
async fn day_and_week_agendas_show_only_the_callers_rows() {
  let app = TestApp::start().await;
  seed_both_users(&app).await;

  let day_a = app.get_agenda("2026-10-26", ZONE).await;
  assert_eq!(titles(&day_a.all_day_events, |e| &e.title), ["A all-day"]);
  assert_eq!(titles(&day_a.events, |e| &e.title), ["A timed"]);
  assert_eq!(titles(&day_a.tasks.due_today, |t| &t.title), ["A due today"]);
  assert_eq!(titles(&day_a.tasks.overdue, |t| &t.title), ["A overdue"]);
  assert_eq!(day_a.tasks.overdue_total, 1);
  assert_eq!(day_a.tasks.overdue_open_total, 1);

  let response = app
    .client_as(USER_B)
    .get(&format!("/api/agenda/day?date=2026-10-26&timeZone={ZONE}"))
    .await;
  let day_b: DayAgendaResponse = response.json();
  assert_eq!(titles(&day_b.all_day_events, |e| &e.title), ["B all-day"]);
  assert_eq!(titles(&day_b.events, |e| &e.title), ["B timed"]);
  assert_eq!(titles(&day_b.tasks.due_today, |t| &t.title), ["B due today"]);
  assert_eq!(titles(&day_b.tasks.overdue, |t| &t.title), ["B overdue"]);
  assert_eq!(day_b.tasks.overdue_total, 1);

  let week_a = app.get_week_agenda("2026-10-26", ZONE, "2026-10-26").await;
  assert_eq!(titles(&week_a.all_day_events, |e| &e.title), ["A all-day"]);
  let week_events: Vec<&str> = week_a.days.iter().flat_map(|day| &day.events).map(|e| e.title.as_str()).collect();
  assert_eq!(week_events, ["A timed"]);
  // "A upcoming" is due five days later, still inside the ISO week.
  let week_tasks: Vec<&str> = week_a.days.iter().flat_map(|day| &day.tasks).map(|t| t.title.as_str()).collect();
  assert_eq!(week_tasks, ["A due today", "A upcoming"]);
  let overdue = week_a
    .overdue
    .as_deref()
    .expect("the week holds today, so it lists the overdue tasks");
  assert_eq!(titles(overdue, |t| &t.title), ["A overdue"]);
  assert_eq!(week_a.overdue_total, 1);
}

#[tokio::test]
async fn task_list_views_show_only_the_callers_rows() {
  for view in ["upcoming", "overdue", "completed", "no-deadline"] {
    let app = TestApp::start().await;
    seed_both_users(&app).await;

    let page_a = list(&app.client(), view).await;
    assert!(page_a.items.iter().all(|task| task.title.starts_with("A ")), "{view}: {page_a:?}");
    assert_ne!(page_a.items, Vec::<TaskResponse>::new(), "{view}");
    if view == "overdue" {
      assert_eq!(page_a.total, Some(1));
    }

    let page_b = list(&app.client_as(USER_B), view).await;
    assert!(page_b.items.iter().all(|task| task.title.starts_with("B ")), "{view}: {page_b:?}");
    assert_eq!(page_b.items.len(), page_a.items.len(), "{view}");
  }
}

#[tokio::test]
async fn another_users_event_is_not_found_and_the_owners_is_found() {
  let app = TestApp::start().await;
  let event_of_b = timed_event(USER_B, "B timed");
  app.seed(std::slice::from_ref(&event_of_b), &[]).await;
  let uri = format!("/api/events/{}", event_of_b.id());

  let as_a = app.client().get(&uri).await;
  assert_eq!(as_a.status, StatusCode::NOT_FOUND);

  let as_b = app.client_as(USER_B).get(&uri).await;
  assert_eq!(as_b.status, StatusCode::OK);
}

#[tokio::test]
async fn another_users_event_is_not_found_for_update_and_delete_and_stays_unchanged() {
  let app = TestApp::start().await;
  let event_of_b = timed_event(USER_B, "B timed");
  app.seed(std::slice::from_ref(&event_of_b), &[]).await;
  let uri = format!("/api/events/{}", event_of_b.id());
  let as_b = app.client_as(USER_B);
  let before: EventResponse = as_b.get(&uri).await.success().json();

  let update = app
    .client()
    .put_json(
      &uri,
      &json!({"title": "Taken over", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27", "version": before.version}),
    )
    .await;
  let delete = app.client().delete(&uri).await;

  assert_eq!(update.status, StatusCode::NOT_FOUND);
  assert_eq!(delete.status, StatusCode::NOT_FOUND);
  assert_eq!(as_b.get(&uri).await.success().json::<EventResponse>(), before);

  // The owner can do both.
  let own_update = as_b
    .put_json(
      &uri,
      &json!({"title": "B moved", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27", "version": before.version}),
    )
    .await;
  assert_eq!(own_update.status, StatusCode::OK);
  assert_eq!(as_b.delete(&uri).await.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn created_rows_belong_to_the_caller() {
  let app = TestApp::start().await;
  let as_b = app.client_as(USER_B);
  let created_event = as_b
    .post_json(
      "/api/events",
      &json!({"title": "B's event", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27"}),
    )
    .await;
  let created_task = as_b.post_json("/api/tasks", &json!({"title": "B's task"})).await;
  assert_eq!(created_event.status, StatusCode::CREATED);
  assert_eq!(created_task.status, StatusCode::CREATED);
  let event_id = created_event.json::<EventResponse>().id;
  let task_id = created_task.json::<TaskResponse>().id;

  let event_owners = strings(&app, &format!("SELECT owner_id::text FROM events WHERE id = '{event_id}'")).await;
  let task_owners = strings(&app, &format!("SELECT owner_id::text FROM tasks WHERE id = '{task_id}'")).await;
  assert_eq!(event_owners, [USER_B.to_string()]);
  assert_eq!(task_owners, [USER_B.to_string()]);

  // The creator sees them; user A does not.
  assert_eq!(as_b.get(&format!("/api/events/{event_id}")).await.status, StatusCode::OK);
  assert_eq!(
    app.client().get(&format!("/api/events/{event_id}")).await.status,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    app.client().get(&format!("/api/tasks/{task_id}")).await.status,
    StatusCode::NOT_FOUND
  );
}

#[tokio::test]
async fn another_users_task_is_not_found_for_read_complete_reopen_and_delete_and_stays_unchanged() {
  let app = TestApp::start().await;
  let open = task_of(USER_B, "B open", Some(today()), None);
  let completed = completed_task_of(USER_B, "B completed", Some(today()), utc(2026, 10, 25, 12, 0));
  app.seed(&[], &[open.clone(), completed.clone()]).await;
  let open_uri = format!("/api/tasks/{}", open.id());
  let complete_uri = format!("/api/tasks/{}/complete", open.id());
  let reopen_uri = format!("/api/tasks/{}/reopen", completed.id());

  let as_a = app.client();
  assert_eq!(as_a.get(&open_uri).await.status, StatusCode::NOT_FOUND);
  assert_eq!(as_a.post(&complete_uri).await.status, StatusCode::NOT_FOUND);
  assert_eq!(as_a.post(&reopen_uri).await.status, StatusCode::NOT_FOUND);
  assert_eq!(as_a.delete(&open_uri).await.status, StatusCode::NOT_FOUND);

  assert_eq!(
    tasks_by_title(&app).await,
    [("B completed".to_owned(), true), ("B open".to_owned(), false)]
  );

  // The owner can do all of it.
  let as_b = app.client_as(USER_B);
  assert_eq!(as_b.post(&complete_uri).await.status, StatusCode::OK);
  assert_eq!(as_b.post(&reopen_uri).await.status, StatusCode::OK);
  assert_eq!(as_b.delete(&open_uri).await.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn another_users_task_is_not_found_for_update_and_stays_unchanged() {
  let app = TestApp::start().await;
  let task_of_b = task_of(USER_B, "B open", Some(today()), None);
  app.seed(&[], std::slice::from_ref(&task_of_b)).await;
  let uri = format!("/api/tasks/{}", task_of_b.id());
  let as_b = app.client_as(USER_B);
  let before: TaskResponse = as_b.get(&uri).await.success().json();

  let update = app
    .client()
    .put_json(&uri, &json!({"title": "Taken over", "version": before.version}))
    .await;

  assert_eq!(update.status, StatusCode::NOT_FOUND);
  assert_eq!(as_b.get(&uri).await.success().json::<TaskResponse>(), before);

  // The owner can.
  let own = as_b.put_json(&uri, &json!({"title": "B renamed", "version": before.version})).await;
  assert_eq!(own.status, StatusCode::OK);
}

#[tokio::test]
async fn bulk_by_ids_reports_another_users_tasks_as_not_found_and_leaves_them_unchanged() {
  let app = TestApp::start().await;
  let mine = task_of(USER_A, "A open", Some(today()), None);
  let theirs = task_of(USER_B, "B open", Some(today()), None);
  app.seed(&[], &[mine.clone(), theirs.clone()]).await;

  let response = app
    .client()
    .post_json(BULK, &json!({"action": "complete", "ids": [mine.id(), theirs.id()]}))
    .await;
  assert_eq!(response.status, StatusCode::OK);
  let body: BulkTaskResponse = response.json();
  let results: Vec<(Uuid, &str)> = body.results.iter().map(|r| (r.id, r.outcome.as_str())).collect();
  assert_eq!(results, [(mine.id(), "applied"), (theirs.id(), "notFound")]);
  assert_eq!(body.applied, 1);
  assert_eq!(body.not_found, 1);

  assert!(!is_completed(&app, theirs.id()).await);
  assert!(is_completed(&app, mine.id()).await);
}

#[tokio::test]
async fn bulk_by_filter_only_touches_the_callers_overdue_tasks() {
  let app = TestApp::start().await;
  let mine = task_of(USER_A, "A overdue", Some(today() - days(1)), None);
  let theirs = task_of(USER_B, "B overdue", Some(today() - days(1)), None);
  let theirs_too = task_of(USER_B, "B overdue too", Some(today() - days(2)), None);
  app.seed(&[], &[mine, theirs, theirs_too]).await;

  // The count guard is per caller too: A sees one overdue task, not three.
  assert_eq!(list(&app.client(), "overdue").await.total, Some(1));
  let response = app
    .client()
    .post_json(
      BULK,
      &json!({"action": "delete", "filter": {"view": "overdue", "today": "2026-10-26", "timeZone": ZONE, "expectedTotal": 1}}),
    )
    .await;
  assert_eq!(response.status, StatusCode::OK);
  assert_eq!(response.json::<BulkTaskResponse>().applied, 1);

  let remaining = strings(&app, "SELECT title::text FROM tasks ORDER BY title").await;
  assert_eq!(remaining, ["B overdue", "B overdue too"]);
}

/// Ports `CalendarDbContextOwnershipTests.AContextWithAUser_SeesOnlyThatUsersRows_AndOneWithout_SeesNothing`
/// on the app's own connection (as `calendar_app`).
///
/// The Rust data layer has no call without an owner, so "a context without a user sees nothing" becomes "a
/// user with no rows sees nothing, though the tables are not empty".
#[tokio::test]
async fn a_call_for_a_user_sees_only_that_users_rows_and_one_for_nobody_sees_nothing() {
  let app = TestApp::start().await;
  app
    .seed(
      &[all_day_event(USER_A, "A"), all_day_event(USER_B, "B")],
      &[task_of(USER_A, "A", None, None), task_of(USER_B, "B", None, None)],
    )
    .await;
  let mut connection = app.state().db().await.expect("the API connects");
  let range = DateRangeWindow::single_day(today(), IanaZone::UTC);

  let as_a = OwnerId(USER_A);
  let page = tasks::list_page(&mut connection, as_a, &TaskListView::NoDeadline, None, 200)
    .await
    .expect("the tasks are listed");
  assert_eq!(titles(&page.items, |task| task.entity.title()), ["A"]);
  let rows = agenda::read(&mut connection, as_a, &range, None, 20)
    .await
    .expect("the agenda is read");
  assert_eq!(titles(&rows.all_day_events, |event| &event.title), ["A"]);
  assert_eq!(page.items.len(), 1);

  let nobody = OwnerId(Uuid::new_v4());
  let page = tasks::list_page(&mut connection, nobody, &TaskListView::NoDeadline, None, 200)
    .await
    .expect("the tasks are listed");
  assert_eq!(page.items.len(), 0);
  let rows = agenda::read(&mut connection, nobody, &range, None, 20)
    .await
    .expect("the agenda is read");
  assert_eq!(rows.all_day_events.len(), 0);
  assert_eq!(strings(&app, "SELECT count(*)::text FROM tasks").await, ["2"]);
}

/// Ports `CalendarDbContextOwnershipTests.AContextWithAUser_RefusesToSaveARowOwnedByAnyoneElse_OnEveryOverload`.
/// The four `SaveChanges` overloads of the .NET context are one insert function per entity here.
#[tokio::test]
async fn a_call_for_a_user_refuses_to_save_a_row_owned_by_anyone_else() {
  let app = TestApp::start().await;
  let mut connection = app.state().db().await.expect("the API connects");
  let as_a = OwnerId(USER_A);

  let task = tasks::insert(&mut connection, as_a, &task_of(USER_B, "theirs", None, None)).await;
  assert!(matches!(task, Err(Error::OwnerMismatch)), "{task:?}");

  let event = events::insert(&mut connection, as_a, &all_day_event(USER_B, "theirs")).await;
  assert!(matches!(event, Err(Error::OwnerMismatch)), "{event:?}");

  tasks::insert(&mut connection, as_a, &task_of(USER_A, "mine", None, None))
    .await
    .expect("the caller's own task is saved");

  assert_eq!(strings(&app, "SELECT title::text FROM tasks").await, ["mine"]);
  assert_eq!(strings(&app, "SELECT count(*)::text FROM events").await, ["0"]);
}
