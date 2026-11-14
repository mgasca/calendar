//! `/api/tasks`: the task list views, create, read, replace, delete, complete, reopen and bulk actions
//! (ports `TaskEndpoints.cs`).

use std::collections::HashMap;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use calendar_domain::error::InvalidOperationError;
use calendar_domain::tasks::TodoTask;
use calendar_domain::time::DayWindow;
use calendar_infrastructure::queries::task_list::{DatedView, TaskListView};
use calendar_infrastructure::tasks::{self, OverdueAction, TaskWrite};
use calendar_infrastructure::{Error, OwnerId, RowVersion};
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

use super::request::{self, QueryParams, RouteId};
use super::task_list_cursor::{self, TaskListViewKind};
use crate::auth::CurrentUser;
use crate::contracts::{
  BulkTaskAction, BulkTaskItemResult, BulkTaskRequest, BulkTaskResponse, CreateTaskRequest, HttpValidationProblemDetails,
  OverdueTaskFilter, ProblemDetails, TaskPage, TaskResponse, UpdateTaskRequest,
};
use crate::error::ApiError;
use crate::hosting::RequestOrigin;
use crate::json::{JsonBody, JsonContent};
use crate::problem::Problem;
use crate::state::AppState;
use crate::validation::FieldErrors;

const DEFAULT_PAGE_SIZE: i32 = 50;
const MAX_PAGE_SIZE: i32 = 200;
const MAX_BULK_IDS: usize = 500;

const APPLIED: &str = "applied";
const SKIPPED: &str = "skipped";
const NOT_FOUND: &str = "notFound";

// Creates a task owned by the signed-in user.
#[utoipa::path(
  post,
  path = "/api/tasks",
  operation_id = "CreateTask",
  tag = "Tasks",
  request_body = CreateTaskRequest,
  responses(
    (status = 201, description = "Created", body = TaskResponse),
    (status = 400, description = "Bad Request", body = HttpValidationProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn create(
  _json: JsonContent,
  CurrentUser(user): CurrentUser,
  State(state): State<AppState>,
  origin: RequestOrigin,
  JsonBody(request): JsonBody<CreateTaskRequest>,
) -> Result<Response, ApiError> {
  let mut errors = FieldErrors::new();
  errors.check_date(request.due_date, "dueDate");
  if errors.any() {
    return Err(errors.into_problem().into());
  }
  let created = match TodoTask::create(
    user.owner.0,
    request.title.as_deref().unwrap_or_default(),
    request.due_date,
    request.due_at,
    request.priority.as_deref().unwrap_or_default(),
    request.notes.as_deref(),
  ) {
    Ok(created) => created,
    Err(error) => {
      errors.add_domain_error(&error);
      return Err(errors.into_problem().into());
    }
  };

  let mut connection = state.db().await?;
  let version = tasks::insert(&mut connection, user.owner, &created).await?;
  let location = format!("{}/api/tasks/{}", origin.base_url(), created.id());
  request::created(&location, &TaskResponse::from_task(&created, version.0))
}

// One page of a task list view. The dated views take the client's `today` and `timeZone`, since the server
// never decides what day it is (ADR-0021).
#[utoipa::path(
  get,
  path = "/api/tasks",
  operation_id = "ListTasks",
  tag = "Tasks",
  params(
    ("view" = String, Query),
    ("today" = Option<NaiveDate>, Query),
    ("timeZone" = Option<String>, Query),
    ("limit" = Option<i32>, Query),
    ("cursor" = Option<String>, Query),
  ),
  responses(
    (status = 200, description = "OK", body = TaskPage),
    (status = 400, description = "Bad Request", body = HttpValidationProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn list(CurrentUser(user): CurrentUser, State(state): State<AppState>, query: QueryParams) -> Result<Response, ApiError> {
  let view = query.get("view");
  let today = query.date("today")?;
  let time_zone = query.get("timeZone");
  let limit = query.int("limit")?;
  let cursor = query.get("cursor");

  let mut errors = FieldErrors::new();
  let kind = view.as_deref().and_then(TaskListViewKind::parse);
  errors.require(
    kind.is_some(),
    "view",
    "view is required: upcoming, overdue, completed or no-deadline.",
  );

  let (mut today_date, mut zone) = (None, None);
  if kind.is_some_and(TaskListViewKind::is_dated) {
    today_date = errors.require_date(today, "today");
    zone = errors.require_time_zone(time_zone.as_deref(), "timeZone");
  }

  let page_size = limit.unwrap_or(DEFAULT_PAGE_SIZE);
  errors.require(
    (1..=MAX_PAGE_SIZE).contains(&page_size),
    "limit",
    format!("limit must be between 1 and {MAX_PAGE_SIZE}."),
  );

  let mut after = None;
  if let (Some(cursor), Some(kind)) = (cursor.as_deref(), kind) {
    after = task_list_cursor::try_decode(cursor, kind);
    errors.require(after.is_some(), "cursor", "cursor is not valid for this view.");
  }

  let (false, Some(kind)) = (errors.any(), kind) else {
    return Err(errors.into_problem().into());
  };
  let dated = match (today_date, zone) {
    (Some(date), Some(zone)) => Some(DatedView {
      today: DayWindow::create(date, zone),
      zone,
    }),
    _ => None,
  };
  let list_view = match (kind, dated) {
    (TaskListViewKind::Upcoming, Some(dated)) => TaskListView::Upcoming(dated),
    (TaskListViewKind::Overdue, Some(dated)) => TaskListView::Overdue(dated),
    (TaskListViewKind::Completed, _) => TaskListView::Completed,
    (TaskListViewKind::NoDeadline, _) => TaskListView::NoDeadline,
    (TaskListViewKind::Upcoming | TaskListViewKind::Overdue, None) => {
      return Err(ApiError::internal("a dated task view passed validation without today and timeZone"));
    }
  };

  let owner = user.owner;
  let mut connection = state.db().await?;
  let page = tasks::list_page(&mut connection, owner, &list_view, after.as_ref(), page_size.unsigned_abs()).await?;
  let total = match (kind, after, dated) {
    (TaskListViewKind::Overdue, None, Some(dated)) => Some(count(tasks::count_open_overdue(&mut connection, owner, &dated.today).await?)),
    _ => None,
  };

  request::ok(&TaskPage {
    items: page
      .items
      .iter()
      .map(|task| TaskResponse::from_task(&task.entity, task.version.0))
      .collect(),
    next_cursor: page.next.map(|key| task_list_cursor::encode(kind, &key)),
    total,
  })
}

// Reads one of the signed-in user's tasks.
#[utoipa::path(
  get,
  path = "/api/tasks/{id}",
  operation_id = "GetTask",
  tag = "Tasks",
  params(("id" = Uuid, Path)),
  responses(
    (status = 200, description = "OK", body = TaskResponse),
    (status = 404, description = "Not Found", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn get(RouteId(id): RouteId, CurrentUser(user): CurrentUser, State(state): State<AppState>) -> Result<Response, ApiError> {
  let mut connection = state.db().await?;
  match tasks::find(&mut connection, user.owner, id).await? {
    Some(found) => request::ok(&TaskResponse::from_task(&found.entity, found.version.0)),
    None => Err(not_found().into()),
  }
}

// Replaces a task's title, deadline, priority and notes, provided it is unchanged since the client read its
// `version` (a complete or reopen counts as a change); a stale version answers `409` and changes nothing.
#[utoipa::path(
  put,
  path = "/api/tasks/{id}",
  operation_id = "UpdateTask",
  tag = "Tasks",
  params(("id" = Uuid, Path)),
  request_body = UpdateTaskRequest,
  responses(
    (status = 200, description = "OK", body = TaskResponse),
    (status = 400, description = "Bad Request", body = HttpValidationProblemDetails, content_type = "application/problem+json"),
    (status = 404, description = "Not Found", body = ProblemDetails, content_type = "application/problem+json"),
    (status = 409, description = "Conflict", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn update(
  RouteId(id): RouteId,
  _json: JsonContent,
  CurrentUser(user): CurrentUser,
  State(state): State<AppState>,
  JsonBody(request): JsonBody<UpdateTaskRequest>,
) -> Result<Response, ApiError> {
  let mut errors = FieldErrors::new();
  errors.check_date(request.due_date, "dueDate");
  if errors.any() {
    return Err(errors.into_problem().into());
  }

  let owner = user.owner;
  let mut connection = state.db().await?;
  let Some(found) = tasks::find(&mut connection, owner, id).await? else {
    return Err(not_found().into());
  };

  let mut changed = found.entity.clone();
  if let Err(error) = changed.update(
    request.title.as_deref().unwrap_or_default(),
    request.due_date,
    request.due_at,
    request.priority.as_deref().unwrap_or_default(),
    request.notes.as_deref(),
  ) {
    errors.add_domain_error(&error);
    return Err(errors.into_problem().into());
  }

  match tasks::update(&mut connection, owner, &found, &changed, RowVersion(request.version)).await {
    Ok(version) => request::ok(&TaskResponse::from_task(&changed, version.0)),
    Err(Error::Conflict) => Err(Problem::titled(StatusCode::CONFLICT, "The task was changed elsewhere. Load it again and retry.").into()),
    Err(Error::NotFound) => Err(not_found().into()),
    Err(error) => Err(error.into()),
  }
}

// Deletes a task.
#[utoipa::path(
  delete,
  path = "/api/tasks/{id}",
  operation_id = "DeleteTask",
  tag = "Tasks",
  params(("id" = Uuid, Path)),
  responses(
    (status = 204, description = "No Content"),
    (status = 404, description = "Not Found", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn delete(RouteId(id): RouteId, CurrentUser(user): CurrentUser, State(state): State<AppState>) -> Result<Response, ApiError> {
  let owner = user.owner;
  let mut connection = state.db().await?;
  let Some(found) = tasks::find(&mut connection, owner, id).await? else {
    return Err(not_found().into());
  };
  match tasks::delete(&mut connection, owner, id, found.version).await {
    Ok(()) => Ok(StatusCode::NO_CONTENT.into_response()),
    // Changed or deleted between this request's read and its delete: the .NET endpoint answered 404 for both.
    Err(Error::Conflict | Error::NotFound) => Err(not_found().into()),
    Err(error) => Err(error.into()),
  }
}

// Applies one action to explicit task ids, or to every open overdue task when the client's count still holds.
#[utoipa::path(
  post,
  path = "/api/tasks/bulk",
  operation_id = "BulkTasks",
  tag = "Tasks",
  request_body = BulkTaskRequest,
  responses(
    (status = 200, description = "OK", body = BulkTaskResponse),
    (status = 400, description = "Bad Request", body = ProblemDetails, content_type = "application/problem+json"),
    (status = 409, description = "Conflict", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn bulk(
  _json: JsonContent,
  CurrentUser(user): CurrentUser,
  State(state): State<AppState>,
  JsonBody(request): JsonBody<BulkTaskRequest>,
) -> Result<Response, ApiError> {
  let owner = user.owner;
  let action = request.action;
  let mut errors = FieldErrors::new();
  errors.require(action.is_some(), "action", "Action is not supported.");
  errors.require(
    request.ids.is_none() != request.filter.is_none(),
    "target",
    "Provide exactly one of ids or filter.",
  );
  errors.forbid(
    request.due_date.is_some() && action != Some(BulkTaskAction::SetDueDate),
    "dueDate",
    "dueDate is only valid for setDueDate.",
  );
  errors.forbid(
    request.due_at.is_some() && action != Some(BulkTaskAction::SetDueInstant),
    "dueAt",
    "dueAt is only valid for setDueInstant.",
  );
  if action == Some(BulkTaskAction::SetDueDate) {
    errors.require(request.due_date.is_some(), "dueDate", "dueDate is required for setDueDate.");
    errors.check_date(request.due_date, "dueDate");
  }
  if action == Some(BulkTaskAction::SetDueInstant) {
    errors.require(request.due_at.is_some(), "dueAt", "dueAt is required for setDueInstant.");
  }

  let mut ids = Vec::new();
  if let Some(requested) = &request.ids {
    errors.require(!requested.is_empty(), "ids", "At least one id is required.");
    errors.require(
      requested.len() <= MAX_BULK_IDS,
      "ids",
      format!("At most {MAX_BULK_IDS} ids are allowed."),
    );
    for id in requested {
      if !ids.contains(id) {
        ids.push(*id);
      }
    }
  }

  if let Some(filter) = &request.filter {
    let window = check_filter(filter, &mut errors);
    if let (false, Some(window)) = (errors.any(), window) {
      let change = BulkChange::of(action, request.due_date, request.due_at, state.now())?;
      let mut connection = state.db().await?;
      return match tasks::apply_to_open_overdue(
        &mut connection,
        owner,
        &window,
        i64::from(filter.expected_total),
        change.for_filter(),
      )
      .await
      {
        Ok(applied) => request::ok(&BulkTaskResponse {
          results: Vec::new(),
          applied: i32::try_from(applied).unwrap_or(i32::MAX),
          skipped: 0,
          not_found: 0,
        }),
        Err(Error::Conflict) => Err(
          Problem::titled(
            StatusCode::CONFLICT,
            "The overdue task count changed. Review the updated count and try again.",
          )
          .into(),
        ),
        Err(error) => Err(error.into()),
      };
    }
  }

  if errors.any() {
    return Err(errors.into_problem().into());
  }

  let change = BulkChange::of(action, request.due_date, request.due_at, state.now())?;
  let mut connection = state.db().await?;
  request::ok(&apply_to_ids(&mut connection, owner, &ids, change).await?)
}

/// Validates an overdue filter; returns the client's day when its date and zone are usable.
fn check_filter(filter: &OverdueTaskFilter, errors: &mut FieldErrors) -> Option<DayWindow> {
  errors.require(
    filter.view.as_deref() == Some("overdue"),
    "filter.view",
    "Only the overdue view is supported.",
  );
  errors.check_date(Some(filter.today), "filter.today");
  let zone = errors.require_time_zone(filter.time_zone.as_deref(), "filter.timeZone");
  errors.require(
    filter.expected_total >= 0,
    "filter.expectedTotal",
    "expectedTotal cannot be negative.",
  );
  if errors.any() {
    return None;
  }
  zone.map(|zone| DayWindow::create(filter.today, zone))
}

/// A validated bulk action with the values it needs.
#[derive(Debug, Clone, Copy)]
enum BulkChange {
  Complete(DateTime<Utc>),
  SetDueDate(NaiveDate),
  SetDueInstant(DateTime<Utc>),
  ClearDeadline,
  Delete,
}

impl BulkChange {
  fn of(
    action: Option<BulkTaskAction>,
    due_date: Option<NaiveDate>,
    due_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
  ) -> Result<Self, ApiError> {
    match (action, due_date, due_at) {
      (Some(BulkTaskAction::Complete), _, _) => Ok(Self::Complete(now)),
      (Some(BulkTaskAction::SetDueDate), Some(date), _) => Ok(Self::SetDueDate(date)),
      (Some(BulkTaskAction::SetDueInstant), _, Some(instant)) => Ok(Self::SetDueInstant(instant)),
      (Some(BulkTaskAction::ClearDeadline), _, _) => Ok(Self::ClearDeadline),
      (Some(BulkTaskAction::Delete), _, _) => Ok(Self::Delete),
      _ => Err(ApiError::internal("a bulk action passed validation without the value it needs")),
    }
  }

  /// The set-based form, for a filter target.
  fn for_filter(self) -> OverdueAction {
    match self {
      Self::Complete(now) => OverdueAction::Complete(now),
      Self::SetDueDate(date) => OverdueAction::SetDeadline(TodoTask::for_due_date(date)),
      Self::SetDueInstant(instant) => OverdueAction::SetDeadline(TodoTask::for_due_instant(instant)),
      Self::ClearDeadline => OverdueAction::SetDeadline(TodoTask::without_deadline()),
      Self::Delete => OverdueAction::Delete,
    }
  }

  /// Applies the change to one loaded task. A delete changes no entity.
  fn apply(self, task: &mut TodoTask) -> Result<(), InvalidOperationError> {
    match self {
      Self::Complete(now) => {
        task.complete(now);
        Ok(())
      }
      Self::SetDueDate(date) => task.set_due_date(date),
      Self::SetDueInstant(instant) => task.set_due_at(instant),
      Self::ClearDeadline => task.clear_deadline(),
      Self::Delete => Ok(()),
    }
  }
}

/// Applies `change` to each of the owner's tasks among `ids` and reports one outcome per id, in request order.
async fn apply_to_ids(
  connection: &mut diesel_async::AsyncPgConnection,
  owner: OwnerId,
  ids: &[Uuid],
  change: BulkChange,
) -> Result<BulkTaskResponse, ApiError> {
  let mut outcomes: HashMap<Uuid, &'static str> = ids.iter().map(|id| (*id, NOT_FOUND)).collect();
  let mut writes = Vec::new();
  let mut written = Vec::new();
  for found in tasks::find_many(connection, owner, ids).await? {
    let id = found.entity.id();
    let mut changed = found.entity.clone();
    if change.apply(&mut changed).is_err() {
      // A completed task's deadline cannot be changed.
      outcomes.insert(id, SKIPPED);
      continue;
    }
    outcomes.insert(id, APPLIED);
    if matches!(change, BulkChange::Delete) {
      writes.push(TaskWrite::Delete {
        id,
        expected: found.version,
      });
      written.push(id);
    } else if changed != found.entity {
      // A task the change leaves as it is counts as applied and is not written.
      writes.push(TaskWrite::Update {
        task: changed,
        expected: found.version,
      });
      written.push(id);
    }
  }

  // A task that changed or went away since it was loaded is skipped; the others are still written.
  let applied = tasks::write_batch(connection, owner, &writes).await?;
  for (id, applied) in written.into_iter().zip(applied) {
    if !applied {
      outcomes.insert(id, SKIPPED);
    }
  }

  let results: Vec<BulkTaskItemResult> = ids
    .iter()
    .map(|id| BulkTaskItemResult {
      id: *id,
      outcome: outcomes.get(id).copied().unwrap_or(NOT_FOUND).to_owned(),
    })
    .collect();
  let count_of = |outcome: &str| count(results.iter().filter(|result| result.outcome == outcome).count());
  Ok(BulkTaskResponse {
    applied: count_of(APPLIED),
    skipped: count_of(SKIPPED),
    not_found: count_of(NOT_FOUND),
    results,
  })
}

// Completes a task; completing a completed task changes nothing.
#[utoipa::path(
  post,
  path = "/api/tasks/{id}/complete",
  operation_id = "CompleteTask",
  tag = "Tasks",
  params(("id" = Uuid, Path)),
  responses(
    (status = 200, description = "OK", body = TaskResponse),
    (status = 404, description = "Not Found", body = ProblemDetails, content_type = "application/problem+json"),
    (status = 409, description = "Conflict", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn complete(RouteId(id): RouteId, CurrentUser(user): CurrentUser, State(state): State<AppState>) -> Result<Response, ApiError> {
  let now = state.now();
  change(&state, user.owner, id, |task| task.complete(now)).await
}

// Reopens a task; reopening an open task changes nothing.
#[utoipa::path(
  post,
  path = "/api/tasks/{id}/reopen",
  operation_id = "ReopenTask",
  tag = "Tasks",
  params(("id" = Uuid, Path)),
  responses(
    (status = 200, description = "OK", body = TaskResponse),
    (status = 404, description = "Not Found", body = ProblemDetails, content_type = "application/problem+json"),
    (status = 409, description = "Conflict", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn reopen(RouteId(id): RouteId, CurrentUser(user): CurrentUser, State(state): State<AppState>) -> Result<Response, ApiError> {
  change(&state, user.owner, id, TodoTask::reopen).await
}

/// Loads, applies an idempotent change and saves only when something changed.
async fn change(state: &AppState, owner: OwnerId, id: Uuid, apply: impl FnOnce(&mut TodoTask)) -> Result<Response, ApiError> {
  let mut connection = state.db().await?;
  let Some(found) = tasks::find(&mut connection, owner, id).await? else {
    return Err(not_found().into());
  };
  let mut changed = found.entity.clone();
  apply(&mut changed);
  match tasks::update(&mut connection, owner, &found, &changed, found.version).await {
    Ok(version) => request::ok(&TaskResponse::from_task(&changed, version.0)),
    Err(Error::Conflict | Error::NotFound) => {
      Err(Problem::titled(StatusCode::CONFLICT, "The task was changed by another request. Try again.").into())
    }
    Err(error) => Err(error.into()),
  }
}

fn not_found() -> Problem {
  Problem::titled(StatusCode::NOT_FOUND, "Task not found.")
}

/// A count as the contract's `int`.
fn count(value: impl TryInto<i32>) -> i32 {
  value.try_into().unwrap_or(i32::MAX)
}
