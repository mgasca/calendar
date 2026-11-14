//! Ports `Endpoints/TaskEndpointsTests.cs` of `Calendar.Api.Tests`: one test per fact, and one per theory
//! that runs every row of the theory on an app (and database) of its own. The paging theory is one test per
//! view, because each is slow enough to want its own thread.
//!
//! `SerializationAndDeadlockErrors_AreRecognizedThroughDbUpdateException` is ported beside the function it
//! tests, in `calendar-infrastructure/src/error.rs`.

use crate::common::*;

const TASKS: &str = "/api/tasks";
const BULK: &str = "/api/tasks/bulk";
const NEW_YORK_TODAY: &str = "today=2026-10-26&timeZone=America/New_York";

fn task_uri(id: Uuid) -> String {
  format!("{TASKS}/{id}")
}

async fn create(app: &TestApp, payload: &Value) -> TaskResponse {
  let response = app.client().post_json(TASKS, payload).await;
  assert_eq!(response.status, StatusCode::CREATED, "{}", response.text());
  response.json()
}

async fn get_task(app: &TestApp, id: Uuid) -> TaskResponse {
  app.client().get(&task_uri(id)).await.success().json()
}

async fn get_status(app: &TestApp, id: Uuid) -> StatusCode {
  app.client().get(&task_uri(id)).await.status
}

/// `GET /api/tasks?view={query}`, which must answer 200.
async fn list(app: &TestApp, query: &str) -> TaskPage {
  app.client().get(&format!("{TASKS}?view={query}")).await.success().json()
}

/// Reads a whole view page by page, following each cursor.
async fn list_all(app: &TestApp, query: &str, limit: usize) -> Vec<TaskResponse> {
  let mut all = Vec::new();
  let mut cursor: Option<String> = None;
  loop {
    let suffix = cursor.as_ref().map_or_else(String::new, |cursor| format!("&cursor={cursor}"));
    let page = list(app, &format!("{query}&limit={limit}{suffix}")).await;
    assert!(page.items.len() <= limit, "limit {limit}: a page of {}", page.items.len());
    all.extend(page.items);
    cursor = page.next_cursor;
    if cursor.is_none() {
      return all;
    }
  }
}

async fn post_action(app: &TestApp, id: Uuid, action: &str) -> TaskResponse {
  let response = app.client().post(&format!("{TASKS}/{id}/{action}")).await;
  assert_eq!(response.status, StatusCode::OK, "{}", response.text());
  response.json()
}

async fn put(app: &TestApp, id: Uuid, payload: &Value) -> TaskResponse {
  let response = app.client().put_json(&task_uri(id), payload).await;
  assert_eq!(response.status, StatusCode::OK, "{}", response.text());
  response.json()
}

async fn bulk(app: &TestApp, payload: &Value) -> BulkTaskResponse {
  let response = app.client().post_json(BULK, payload).await;
  assert_eq!(response.status, StatusCode::OK, "{}", response.text());
  response.json()
}

/// The stored columns of a task, as PostgreSQL prints them, and its row version.
#[derive(Debug, Clone, PartialEq, Eq)]
struct StoredTask {
  title: String,
  priority: String,
  notes: Option<String>,
  completed_at: Option<String>,
  due_date: Option<String>,
  due_at: Option<String>,
  xmin: String,
}

impl StoredTask {
  /// Title, priority, notes, completion and deadline: everything but the row version.
  fn content(&self) -> Self {
    Self {
      xmin: String::new(),
      ..self.clone()
    }
  }

  fn completion_and_deadline(&self) -> (Option<&str>, Option<&str>, Option<&str>) {
    (self.completed_at.as_deref(), self.due_date.as_deref(), self.due_at.as_deref())
  }
}

/// Reads the task whoever owns it, as the app role (`ReadTaskAndXminAsync`).
async fn read_task_and_xmin(app: &TestApp, id: Uuid) -> StoredTask {
  let client = app.database().app_client().await;
  let row = client
    .query_one(
      "SELECT title::text, priority::text, notes::text, completed_at::text, due_date::text, due_at::text, xmin::text \
       FROM tasks WHERE id = $1",
      &[&id],
    )
    .await
    .expect("the task exists exactly once");
  StoredTask {
    title: row.get(0),
    priority: row.get(1),
    notes: row.get(2),
    completed_at: row.get(3),
    due_date: row.get(4),
    due_at: row.get(5),
    xmin: row.get(6),
  }
}

/// Adds the deadline properties that are given (`AddDeadline`).
fn with_deadline(mut payload: Value, due_date: Option<&str>, due_at: Option<&str>) -> Value {
  if let Some(due_date) = due_date {
    payload["dueDate"] = json!(due_date);
  }
  if let Some(due_at) = due_at {
    payload["dueAt"] = json!(due_at);
  }
  payload
}

fn london_overdue_filter() -> Value {
  json!({"view": "overdue", "today": "2026-10-26", "timeZone": "Europe/London", "expectedTotal": 1})
}

#[tokio::test]
async fn create_task_with_priority_and_notes_appears_in_list_and_agenda() {
  let app = TestApp::start().await;

  let created = create(
    &app,
    &json!({"title": "Plan trip", "dueDate": "2026-10-26", "priority": "high", "notes": "  Book tickets  "}),
  )
  .await;

  assert_eq!(created.priority, "high");
  assert_eq!(created.notes.as_deref(), Some("Book tickets"));
  let listed = list(&app, "upcoming&today=2026-10-26&timeZone=Europe/London").await;
  assert!(listed.items.contains(&created), "{listed:?}");
  let agenda: DayAgendaResponse = app
    .client()
    .get("/api/agenda/day?date=2026-10-26&timeZone=Europe/London")
    .await
    .success()
    .json();
  assert!(agenda.tasks.due_today.iter().any(|task| task.id == created.id && task.has_notes));
}

#[tokio::test]
async fn create_task_with_due_date_round_trips() {
  let app = TestApp::start().await;

  let created = create(&app, &json!({"title": " Pay rent ", "dueDate": "2026-10-26"})).await;

  assert_eq!(created.title, "Pay rent");
  assert_eq!(created.due_date, Some(date(2026, 10, 26)));
  assert_eq!(created.due_at, None);
  assert!(!created.is_completed);
  assert_eq!(created.completed_at, None);

  assert_eq!(get_task(&app, created.id).await, created);
}

#[tokio::test]
async fn create_task_with_due_at_stores_utc() {
  let app = TestApp::start().await;

  let created = create(&app, &json!({"title": "Call", "dueAt": "2026-10-26T09:30:00-04:00"})).await;

  assert_eq!(created.due_at, Some(utc(2026, 10, 26, 13, 30)));
  assert_eq!(created.due_date, None);
}

#[tokio::test]
async fn create_task_undated_is_allowed() {
  let app = TestApp::start().await;

  let created = create(&app, &json!({"title": "Someday"})).await;

  assert_eq!(created.due_date, None);
  assert_eq!(created.due_at, None);
}

#[tokio::test]
async fn create_task_invalid_returns_400_validation_problem() {
  let cases = [
    ("invalid priority", "priority", json!({"title": "T", "priority": "urgent"})),
    ("notes too long", "notes", json!({"title": "T", "notes": "a".repeat(4001)})),
    ("blank title", "title", json!({"title": " "})),
    ("title too long", "title", json!({"title": "a".repeat(201)})),
    (
      "both due values",
      "dueAt",
      json!({"title": "T", "dueDate": "2026-10-26", "dueAt": "2026-10-26T10:00:00Z"}),
    ),
    (
      "dueAt without offset",
      "dueAt",
      json!({"title": "T", "dueAt": "2026-10-26T10:00:00"}),
    ),
    ("due date out of range", "dueDate", json!({"title": "T", "dueDate": "0001-01-01"})),
  ];
  for (scenario, field, payload) in cases {
    let app = TestApp::start().await;

    let response = app.client().post_json(TASKS, &payload).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{scenario}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{scenario}");
    assert!(response.has_error(field), "{scenario}: {}", response.value()["errors"]);
  }
}

#[tokio::test]
async fn complete_sets_completed_at_from_the_clock_and_is_idempotent() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "T", "dueDate": "2026-10-26"})).await;

  let first = post_action(&app, created.id, "complete").await;
  assert!(first.is_completed);
  assert_eq!(first.completed_at, Some(app.clock.now()));

  app.clock.advance(TimeDelta::hours(2));
  let second = post_action(&app, created.id, "complete").await;

  assert_eq!(second, first); // keeps the first completion time
  assert_eq!(get_task(&app, created.id).await, first);
}

#[tokio::test]
async fn reopen_clears_completion_and_is_idempotent() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "T"})).await;
  post_action(&app, created.id, "complete").await;

  let reopened = post_action(&app, created.id, "reopen").await;
  let again = post_action(&app, created.id, "reopen").await;

  assert!(!reopened.is_completed);
  assert_eq!(reopened.completed_at, None);
  assert_eq!(again, reopened);
}

#[tokio::test]
async fn reopen_of_an_open_task_returns_it_unchanged() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "T"})).await;

  assert_eq!(post_action(&app, created.id, "reopen").await, created);
}

#[tokio::test]
async fn actions_on_unknown_task_return_404_problem() {
  for action in ["complete", "reopen"] {
    let app = TestApp::start().await;

    let response = app.client().post(&format!("{TASKS}/{}/{action}", Uuid::new_v4())).await;

    assert_eq!(response.status, StatusCode::NOT_FOUND, "{action}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{action}");
  }
}

#[tokio::test]
async fn get_task_unknown_returns_404_problem() {
  let app = TestApp::start().await;

  let response = app.client().get(&task_uri(Uuid::new_v4())).await;

  assert_eq!(response.status, StatusCode::NOT_FOUND);
  assert_eq!(response.media_type(), Some("application/problem+json"));
}

#[tokio::test]
async fn list_tasks_dated_views_split_on_the_clients_day_and_order_by_local_due_date() {
  let app = TestApp::start().await;
  // In New York on 2026-10-26 (UTC-4). Instants whose UTC date differs from their local date land on the local one.
  let date_only_yesterday = create(&app, &json!({"title": "A", "dueDate": "2026-10-25"})).await;
  let late_yesterday_local = create(&app, &json!({"title": "B", "dueAt": "2026-10-26T03:00:00Z"})).await;
  let late_today_local = create(&app, &json!({"title": "C", "dueAt": "2026-10-27T02:00:00Z"})).await;
  let date_only_today = create(&app, &json!({"title": "D", "dueDate": "2026-10-26"})).await;
  let morning_today = create(&app, &json!({"title": "E", "dueAt": "2026-10-26T14:00:00Z"})).await;
  let tomorrow = create(&app, &json!({"title": "F", "dueDate": "2026-10-27"})).await;
  let done = create(&app, &json!({"title": "G", "dueDate": "2026-10-20"})).await;
  post_action(&app, done.id, "complete").await;
  let undated = create(&app, &json!({"title": "H"})).await;

  assert_eq!(
    list(&app, &format!("overdue&{NEW_YORK_TODAY}")).await.items,
    [late_yesterday_local, date_only_yesterday]
  );
  assert_eq!(
    list(&app, &format!("upcoming&{NEW_YORK_TODAY}")).await.items,
    [morning_today, late_today_local, date_only_today, tomorrow]
  );
  assert_eq!(list(&app, "no-deadline").await.items, [undated]);
  let completed: Vec<Uuid> = list(&app, "completed").await.items.iter().map(|task| task.id).collect();
  assert_eq!(completed, [done.id]);
}

#[tokio::test]
async fn list_tasks_completed_most_recent_first() {
  let app = TestApp::start().await;
  let first = create(&app, &json!({"title": "First"})).await;
  let second = create(&app, &json!({"title": "Second"})).await;
  post_action(&app, first.id, "complete").await;
  app.clock.advance(TimeDelta::minutes(5));
  post_action(&app, second.id, "complete").await;

  let completed: Vec<Uuid> = list(&app, "completed").await.items.iter().map(|task| task.id).collect();
  assert_eq!(completed, [second.id, first.id]);
}

/// `ListTasks_PagedWithCursors_ReturnsEveryTaskOnceInOrder` for one row of the theory.
async fn paged_with_cursors_returns_every_task_once_in_order(query: &str) {
  let app = TestApp::start().await;
  // Ties at every level: several tasks per local date, shared due instants, shared completion times.
  let due_dates = ["2026-10-20", "2026-10-20", "2026-10-26", "2026-10-26", "2026-10-30"];
  let due_ats = [
    "2026-10-20T15:00:00Z",
    "2026-10-20T15:00:00Z",
    "2026-10-26T15:00:00Z",
    "2026-10-30T15:00:00Z",
  ];
  for due_date in due_dates {
    create(&app, &json!({"title": "date", "dueDate": due_date})).await;
    let done = create(&app, &json!({"title": "done", "dueDate": due_date})).await;
    post_action(&app, done.id, "complete").await;
  }

  for due_at in due_ats {
    create(&app, &json!({"title": "timed", "dueAt": due_at})).await;
    app.clock.advance(TimeDelta::minutes(1));
    let done = create(&app, &json!({"title": "done", "dueAt": due_at})).await;
    post_action(&app, done.id, "complete").await;
  }

  for _ in 0..5 {
    create(&app, &json!({"title": "undated"})).await;
  }

  let whole = list(&app, &format!("{query}&limit=200")).await.items;
  assert_ne!(whole, Vec::<TaskResponse>::new());

  for limit in [1, 2, 3] {
    assert_eq!(list_all(&app, query, limit).await, whole, "limit {limit}");
  }
}

#[tokio::test]
async fn list_tasks_paged_with_cursors_returns_every_task_once_in_order_upcoming() {
  paged_with_cursors_returns_every_task_once_in_order(&format!("upcoming&{NEW_YORK_TODAY}")).await;
}

#[tokio::test]
async fn list_tasks_paged_with_cursors_returns_every_task_once_in_order_overdue() {
  paged_with_cursors_returns_every_task_once_in_order(&format!("overdue&{NEW_YORK_TODAY}")).await;
}

#[tokio::test]
async fn list_tasks_paged_with_cursors_returns_every_task_once_in_order_completed() {
  paged_with_cursors_returns_every_task_once_in_order("completed").await;
}

#[tokio::test]
async fn list_tasks_paged_with_cursors_returns_every_task_once_in_order_no_deadline() {
  paged_with_cursors_returns_every_task_once_in_order("no-deadline").await;
}

#[tokio::test]
async fn list_tasks_last_page_has_no_cursor() {
  let app = TestApp::start().await;
  create(&app, &json!({"title": "Only"})).await;

  let page = list(&app, "no-deadline&limit=1").await;

  assert_eq!(page.items.len(), 1);
  assert_eq!(page.next_cursor, None);
}

#[tokio::test]
async fn list_tasks_overdue_total_matches_bulk_filter_for_dst_window() {
  let app = TestApp::start().await;
  create(&app, &json!({"title": "Floating overdue", "dueDate": "2026-10-31"})).await;
  create(&app, &json!({"title": "Instant overdue", "dueAt": "2026-10-31T20:00:00Z"})).await;
  create(&app, &json!({"title": "Due today", "dueDate": "2026-11-01"})).await;
  let completed = create(&app, &json!({"title": "Completed overdue", "dueDate": "2026-10-20"})).await;
  post_action(&app, completed.id, "complete").await;

  let first = list(&app, "overdue&today=2026-11-01&timeZone=America/New_York&limit=1").await;
  let cursor = first.next_cursor.as_deref().expect("a second page follows");
  let second = list(
    &app,
    &format!(
      "overdue&today=2026-11-01&timeZone=America/New_York&limit=1&cursor={}",
      escape(cursor)
    ),
  )
  .await;
  assert_eq!(first.total, Some(2));
  assert_eq!(second.total, None);

  let result = bulk(
    &app,
    &json!({
      "action": "delete",
      "filter": {"view": "overdue", "today": "2026-11-01", "timeZone": "America/New_York", "expectedTotal": first.total},
    }),
  )
  .await;
  assert_eq!(Some(result.applied), first.total);
}

#[tokio::test]
async fn bulk_tasks_numeric_unknown_action_returns_400() {
  let app = TestApp::start().await;
  let task = create(&app, &json!({"title": "Keep"})).await;

  let response = app.client().post_json(BULK, &json!({"action": 99, "ids": [task.id]})).await;

  assert_eq!(response.status, StatusCode::BAD_REQUEST);
  assert_eq!(get_status(&app, task.id).await, StatusCode::OK);
}

#[tokio::test]
async fn list_tasks_invalid_returns_400_validation_problem() {
  let cases = [
    ("missing view", "", "view"),
    ("unknown view", "?view=soon", "view"),
    ("upcoming without today", "?view=upcoming&timeZone=America/New_York", "today"),
    ("overdue without time zone", "?view=overdue&today=2026-10-26", "timeZone"),
    ("unknown time zone", "?view=overdue&today=2026-10-26&timeZone=Mars/Base", "timeZone"),
    ("limit zero", "?view=completed&limit=0", "limit"),
    ("limit too large", "?view=completed&limit=201", "limit"),
    ("malformed cursor", "?view=completed&cursor=not-a-cursor", "cursor"),
  ];
  for (scenario, query, field) in cases {
    let app = TestApp::start().await;

    let response = app.client().get(&format!("{TASKS}{query}")).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{scenario}");
    assert!(response.has_error(field), "{scenario}: {}", response.value()["errors"]);
  }
}

#[tokio::test]
async fn list_tasks_cursor_from_another_view_returns_400() {
  let app = TestApp::start().await;
  create(&app, &json!({"title": "One"})).await;
  create(&app, &json!({"title": "Two"})).await;
  let cursor = list(&app, "no-deadline&limit=1").await.next_cursor.expect("a second page follows");

  let response = app.client().get(&format!("{TASKS}?view=completed&cursor={cursor}")).await;

  assert_eq!(response.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn bulk_tasks_applies_actions_and_reports_skipped_and_missing_ids() {
  let app = TestApp::start().await;
  let open = create(&app, &json!({"title": "Open", "dueDate": "2026-10-20"})).await;
  let completed = create(&app, &json!({"title": "Done"})).await;
  post_action(&app, completed.id, "complete").await;
  let missing = Uuid::new_v4();

  let result = bulk(
    &app,
    &json!({"action": "setDueDate", "ids": [open.id, completed.id, missing], "dueDate": "2026-10-27"}),
  )
  .await;

  assert_eq!(result.applied, 1);
  assert_eq!(result.skipped, 1);
  assert_eq!(result.not_found, 1);
  let outcomes: Vec<&str> = result.results.iter().map(|item| item.outcome.as_str()).collect();
  assert_eq!(outcomes, ["applied", "skipped", "notFound"]);
  assert_eq!(get_task(&app, open.id).await.due_date, Some(date(2026, 10, 27)));
}

#[tokio::test]
async fn bulk_tasks_complete_is_idempotent_and_filter_count_guards_changes() {
  let app = TestApp::start().await;
  let overdue = create(&app, &json!({"title": "Overdue", "dueDate": "2026-10-20"})).await;
  post_action(&app, overdue.id, "complete").await;
  let complete = bulk(&app, &json!({"action": "complete", "ids": [overdue.id]})).await;
  assert_eq!(complete.applied, 1);

  let conflict = app
    .client()
    .post_json(BULK, &json!({"action": "delete", "filter": london_overdue_filter()}))
    .await;

  assert_eq!(conflict.status, StatusCode::CONFLICT);
  assert_eq!(get_status(&app, overdue.id).await, StatusCode::OK);
}

#[tokio::test]
async fn bulk_tasks_id_target_can_set_instant_clear_deadline_and_delete() {
  let app = TestApp::start().await;
  let task = create(&app, &json!({"title": "Edit", "dueDate": "2026-10-20"})).await;

  bulk(
    &app,
    &json!({"action": "setDueInstant", "ids": [task.id], "dueAt": "2026-10-27T09:30:00-04:00"}),
  )
  .await;
  assert_eq!(get_task(&app, task.id).await.due_at, Some(utc(2026, 10, 27, 13, 30)));

  bulk(&app, &json!({"action": "clearDeadline", "ids": [task.id]})).await;
  assert_eq!(get_task(&app, task.id).await.due_date, None);
  assert_eq!(get_task(&app, task.id).await.due_at, None);

  bulk(&app, &json!({"action": "delete", "ids": [task.id]})).await;
  assert_eq!(get_status(&app, task.id).await, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn bulk_tasks_filter_target_applies_actions_and_updates_agenda_overdue_counts() {
  async fn apply_to_overdue(app: &TestApp, action: &str, due_date: Option<&str>, due_at: Option<&str>) {
    let payload = with_deadline(json!({"action": action, "filter": london_overdue_filter()}), due_date, due_at);
    let result = bulk(app, &payload).await;
    assert_eq!(result.applied, 1, "{action}");
    assert_eq!(result.skipped, 0, "{action}");
    assert_eq!(result.not_found, 0, "{action}");
    assert_eq!(result.results, Vec::<BulkTaskItemResult>::new(), "{action}");
  }

  let app = TestApp::start().await;
  let completed = create(&app, &json!({"title": "Complete", "dueDate": "2026-10-20"})).await;
  apply_to_overdue(&app, "complete", None, None).await;
  create(&app, &json!({"title": "Date", "dueDate": "2026-10-20"})).await;
  apply_to_overdue(&app, "setDueDate", Some("2026-10-27"), None).await;
  create(&app, &json!({"title": "Instant", "dueDate": "2026-10-20"})).await;
  apply_to_overdue(&app, "setDueInstant", None, Some("2026-10-27T12:00:00Z")).await;
  create(&app, &json!({"title": "Clear", "dueDate": "2026-10-20"})).await;
  apply_to_overdue(&app, "clearDeadline", None, None).await;
  create(&app, &json!({"title": "Delete", "dueDate": "2026-10-20"})).await;
  apply_to_overdue(&app, "delete", None, None).await;

  assert_eq!(
    list(&app, "overdue&today=2026-10-26&timeZone=Europe/London").await.items,
    Vec::<TaskResponse>::new()
  );
  let agenda: DayAgendaResponse = app
    .client()
    .get("/api/agenda/day?date=2026-10-26&timeZone=Europe/London")
    .await
    .success()
    .json();
  assert_eq!(agenda.tasks.overdue_open_total, 0);
  assert_eq!(agenda.tasks.overdue_total, 1);
  let overdue: Vec<Uuid> = agenda.tasks.overdue.iter().map(|item| item.id).collect();
  assert_eq!(overdue, [completed.id]);
}

#[tokio::test]
async fn bulk_tasks_filter_target_matches_per_id_rows_for_every_action() {
  async fn assert_agreement(app: &TestApp, action: &str, due_date: Option<&str>, due_at: Option<&str>) {
    let matching = json!({"title": "Matching task", "priority": "high", "notes": "same", "dueDate": "2026-10-20"});
    let by_id = create(app, &matching).await;
    let by_filter = create(app, &matching).await;
    let before_id = read_task_and_xmin(app, by_id.id).await;
    let before_filter = read_task_and_xmin(app, by_filter.id).await;

    let per_id = bulk(app, &with_deadline(json!({"action": action, "ids": [by_id.id]}), due_date, due_at)).await;
    assert_eq!(per_id.applied, 1, "{action}");
    assert_eq!(per_id.skipped, 0, "{action}");
    assert_eq!(per_id.not_found, 0, "{action}");
    assert_eq!(per_id.results.len(), 1, "{action}");
    assert_eq!(per_id.results[0].outcome, "applied", "{action}");

    let set_based = bulk(
      app,
      &with_deadline(json!({"action": action, "filter": london_overdue_filter()}), due_date, due_at),
    )
    .await;
    assert_eq!(set_based.applied, 1, "{action}");
    assert_eq!(set_based.skipped, 0, "{action}");
    assert_eq!(set_based.not_found, 0, "{action}");
    assert_eq!(set_based.results, Vec::<BulkTaskItemResult>::new(), "{action}");

    if action == "delete" {
      assert_eq!(get_status(app, by_id.id).await, StatusCode::NOT_FOUND);
      assert_eq!(get_status(app, by_filter.id).await, StatusCode::NOT_FOUND);
      return;
    }

    let after_id = read_task_and_xmin(app, by_id.id).await;
    let after_filter = read_task_and_xmin(app, by_filter.id).await;
    assert_eq!(after_id.content(), after_filter.content(), "{action}");
    assert_ne!(after_id.xmin, before_id.xmin, "{action}");
    assert_ne!(after_filter.xmin, before_filter.xmin, "{action}");
  }

  let app = TestApp::start().await;
  assert_agreement(&app, "complete", None, None).await;
  assert_agreement(&app, "setDueDate", Some("2026-10-27"), None).await;
  assert_agreement(&app, "setDueInstant", None, Some("2026-10-27T09:30:00-04:00")).await;
  assert_agreement(&app, "clearDeadline", None, None).await;
  assert_agreement(&app, "delete", None, None).await;
}

#[tokio::test]
async fn bulk_tasks_filter_target_no_op_deadline_changes_do_not_update_rows() {
  async fn assert_no_op(app: &TestApp, action: &str, due_date: Option<&str>, due_at: Option<&str>) {
    // As the .NET test did, the unused deadline property is sent as an explicit null.
    let task = json!({"title": "No-op deadline", "dueDate": if due_at.is_none() { due_date } else { None }, "dueAt": due_at});
    let by_id = create(app, &task).await;
    let before_id = read_task_and_xmin(app, by_id.id).await;
    let per_id = bulk(app, &with_deadline(json!({"action": action, "ids": [by_id.id]}), due_date, due_at)).await;
    assert_eq!(per_id.applied, 1, "{action}");
    assert_eq!(read_task_and_xmin(app, by_id.id).await.xmin, before_id.xmin, "{action}");
    post_action(app, by_id.id, "complete").await;

    let by_filter = create(app, &task).await;
    let before_filter = read_task_and_xmin(app, by_filter.id).await;
    let set_based = bulk(
      app,
      &with_deadline(json!({"action": action, "filter": london_overdue_filter()}), due_date, due_at),
    )
    .await;
    assert_eq!(set_based.applied, 0, "{action}");
    assert_eq!(set_based.skipped, 0, "{action}");
    assert_eq!(set_based.not_found, 0, "{action}");
    assert_eq!(set_based.results, Vec::<BulkTaskItemResult>::new(), "{action}");

    let after_filter = read_task_and_xmin(app, by_filter.id).await;
    assert_eq!(after_filter.xmin, before_filter.xmin, "{action}");
    assert_eq!(
      after_filter.completion_and_deadline(),
      before_filter.completion_and_deadline(),
      "{action}"
    );
    post_action(app, by_filter.id, "complete").await;
  }

  let app = TestApp::start().await;
  assert_no_op(&app, "setDueDate", Some("2026-10-20"), None).await;
  assert_no_op(&app, "setDueInstant", None, Some("2026-10-20T09:30:00Z")).await;
}

#[tokio::test]
async fn bulk_tasks_invalid_request_returns_validation_problem() {
  let no_ids: [Uuid; 0] = [];
  let cases = [
    (json!({"action": "delete"}), "target"),
    (
      json!({
        "action": "delete",
        "ids": no_ids,
        "filter": {"view": "overdue", "today": "2026-10-26", "timeZone": "Europe/London", "expectedTotal": 0},
      }),
      "target",
    ),
    (json!({"action": "delete", "ids": no_ids}), "ids"),
    (json!({"action": "setDueDate", "ids": [Uuid::new_v4()]}), "dueDate"),
    (
      json!({"action": "complete", "ids": [Uuid::new_v4()], "dueDate": "2026-10-27"}),
      "dueDate",
    ),
    (
      json!({
        "action": "delete",
        "filter": {"view": "overdue", "today": "2026-10-26", "timeZone": "Mars/Base", "expectedTotal": -1},
      }),
      "filter.timeZone",
    ),
  ];
  for (payload, field) in cases {
    let app = TestApp::start().await;

    let response = app.client().post_json(BULK, &payload).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{payload}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{payload}");
    assert!(response.has_error(field), "{payload}: {}", response.value()["errors"]);
  }
}

#[tokio::test]
async fn delete_removes_open_and_completed_tasks() {
  for completed in [false, true] {
    let app = TestApp::start().await;
    let task = create(&app, &json!({"title": "Remove"})).await;
    if completed {
      post_action(&app, task.id, "complete").await;
    }

    let response = app.client().delete(&task_uri(task.id)).await;

    assert_eq!(response.status, StatusCode::NO_CONTENT, "completed: {completed}");
    assert_eq!(get_status(&app, task.id).await, StatusCode::NOT_FOUND, "completed: {completed}");
  }
}

#[tokio::test]
async fn update_task_replaces_the_editable_fields_and_returns_a_new_version() {
  let app = TestApp::start().await;
  let created = create(
    &app,
    &json!({"title": "Buy milk", "dueDate": "2026-10-26", "priority": "low", "notes": "Two litres"}),
  )
  .await;

  let response = app
    .client()
    .put_json(
      &task_uri(created.id),
      &json!({"title": " Buy oat milk ", "dueDate": "2026-10-27", "priority": "high", "notes": "Oat", "version": created.version}),
    )
    .await;

  assert_eq!(response.status, StatusCode::OK);
  let updated: TaskResponse = response.json();
  assert_eq!(updated.id, created.id);
  assert_eq!(updated.title, "Buy oat milk");
  assert_eq!(updated.due_date, Some(date(2026, 10, 27)));
  assert_eq!(updated.priority, "high");
  assert_eq!(updated.notes.as_deref(), Some("Oat"));
  assert!(!updated.is_completed);
  assert_ne!(updated.version, created.version);
  assert_eq!(get_task(&app, created.id).await, updated);

  // Moved to tomorrow: it leaves the 26th and is due on the 27th.
  assert_eq!(
    app.get_agenda("2026-10-26", "UTC").await.tasks.due_today,
    Vec::<AgendaTaskItem>::new()
  );
  let due = app.get_agenda("2026-10-27", "UTC").await.tasks.due_today;
  assert_eq!(due.len(), 1);
  assert_eq!(due[0].title, "Buy oat milk");
}

#[tokio::test]
async fn update_task_switches_between_deadline_kinds_and_clears_the_deadline() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "Call", "dueDate": "2026-10-26"})).await;

  let timed = put(
    &app,
    created.id,
    &json!({"title": "Call", "dueAt": "2026-10-26T15:30:00+01:00", "version": created.version}),
  )
  .await;
  let undated = put(&app, created.id, &json!({"title": "Call", "version": timed.version})).await;

  assert_eq!(timed.due_date, None);
  assert_eq!(timed.due_at, Some(utc(2026, 10, 26, 14, 30)));
  assert_eq!(timed.priority, "medium");
  assert_eq!(undated.due_date, None);
  assert_eq!(undated.due_at, None);
}

#[tokio::test]
async fn update_task_of_a_completed_task_keeps_it_completed() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "Done", "dueDate": "2026-10-26"})).await;
  let completed = post_action(&app, created.id, "complete").await;

  let updated = put(
    &app,
    created.id,
    &json!({"title": "Done well", "dueDate": "2026-10-20", "version": completed.version}),
  )
  .await;

  assert!(updated.is_completed);
  assert_eq!(updated.completed_at, completed.completed_at);
  assert_eq!(updated.title, "Done well");
}

#[tokio::test]
async fn update_task_after_a_complete_elsewhere_returns_409_and_leaves_the_task_unchanged() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "Buy milk", "dueDate": "2026-10-26"})).await;
  let completed = post_action(&app, created.id, "complete").await;

  let stale = app
    .client()
    .put_json(
      &task_uri(created.id),
      &json!({"title": "Stale write", "dueDate": "2026-10-27", "version": created.version}),
    )
    .await;

  assert_eq!(stale.status, StatusCode::CONFLICT);
  assert_eq!(stale.media_type(), Some("application/problem+json"));
  assert_eq!(get_task(&app, created.id).await, completed);
}

#[tokio::test]
async fn update_task_invalid_returns_400_with_the_field_and_leaves_the_task_unchanged() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "Buy milk"})).await;
  let uri = task_uri(created.id);
  let client = app.client();

  let blank = client.put_json(&uri, &json!({"title": "  ", "version": created.version})).await;
  let both = client
    .put_json(
      &uri,
      &json!({"title": "A", "dueDate": "2026-10-26", "dueAt": "2026-10-26T10:00:00Z", "version": created.version}),
    )
    .await;
  let priority = client
    .put_json(&uri, &json!({"title": "A", "priority": "urgent", "version": created.version}))
    .await;
  let no_version = client.put_json(&uri, &json!({"title": "A"})).await;

  for (response, field) in [(blank, "title"), (both, "dueAt"), (priority, "priority")] {
    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{field}");
    assert!(response.has_error(field), "{field}: {}", response.text());
  }

  assert_eq!(no_version.status, StatusCode::BAD_REQUEST);
  assert_eq!(get_task(&app, created.id).await, created);
}

#[tokio::test]
async fn update_task_unknown_returns_404_problem() {
  let app = TestApp::start().await;

  let response = app
    .client()
    .put_json(&task_uri(Uuid::new_v4()), &json!({"title": "A", "version": 1}))
    .await;

  assert_eq!(response.status, StatusCode::NOT_FOUND);
  assert_eq!(response.media_type(), Some("application/problem+json"));
}

#[tokio::test]
async fn task_version_is_the_same_in_lists_get_and_actions() {
  let app = TestApp::start().await;
  let created = create(&app, &json!({"title": "Versioned"})).await;
  let completed = post_action(&app, created.id, "complete").await;

  let page = list(&app, "completed").await;

  assert_eq!(page.items.len(), 1);
  assert_eq!(page.items[0].version, completed.version);
  assert_eq!(get_task(&app, created.id).await.version, completed.version);
  assert_ne!(completed.version, created.version);
}
