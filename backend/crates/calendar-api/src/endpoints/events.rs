//! `/api/events`: create, read, replace and delete events (ports `EventEndpoints.cs`).

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use calendar_domain::error::ArgumentError;
use calendar_domain::events::CalendarEvent;
use calendar_infrastructure::{Error, RowVersion, events};
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

use super::request::{self, RouteId};
use crate::auth::CurrentUser;
use crate::contracts::{CreateEventRequest, EventFields, EventResponse, HttpValidationProblemDetails, ProblemDetails, UpdateEventRequest};
use crate::error::ApiError;
use crate::hosting::RequestOrigin;
use crate::json::{JsonBody, JsonContent};
use crate::problem::Problem;
use crate::state::AppState;
use crate::validation::FieldErrors;

// Creates an event owned by the signed-in user.
#[utoipa::path(
  post,
  path = "/api/events",
  operation_id = "CreateEvent",
  tag = "Events",
  request_body = CreateEventRequest,
  responses(
    (status = 201, description = "Created", body = EventResponse),
    (status = 400, description = "Bad Request", body = HttpValidationProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn create(
  _json: JsonContent,
  CurrentUser(user): CurrentUser,
  State(state): State<AppState>,
  origin: RequestOrigin,
  JsonBody(request): JsonBody<CreateEventRequest>,
) -> Result<Response, ApiError> {
  let fields = EventFields::from(request);
  let shape = check_shape(&fields)?;
  let created = new_event(user.owner.0, &fields, shape).map_err(FieldErrors::from_domain)?;

  let mut connection = state.db().await?;
  let version = events::insert(&mut connection, user.owner, &created).await?;
  let location = format!("{}/api/events/{}", origin.base_url(), created.id());
  request::created(&location, &to_response(&created, version))
}

// Reads one of the signed-in user's events.
#[utoipa::path(
  get,
  path = "/api/events/{id}",
  operation_id = "GetEvent",
  tag = "Events",
  params(("id" = Uuid, Path)),
  responses(
    (status = 200, description = "OK", body = EventResponse),
    (status = 404, description = "Not Found", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn get(RouteId(id): RouteId, CurrentUser(user): CurrentUser, State(state): State<AppState>) -> Result<Response, ApiError> {
  let mut connection = state.db().await?;
  match events::find(&mut connection, user.owner, id).await? {
    Some(found) => request::ok(&to_response(&found.entity, found.version)),
    None => Err(not_found().into()),
  }
}

// Replaces an event, provided it is unchanged since the client read its `version`; a stale version answers
// `409` and changes nothing.
#[utoipa::path(
  put,
  path = "/api/events/{id}",
  operation_id = "UpdateEvent",
  tag = "Events",
  params(("id" = Uuid, Path)),
  request_body = UpdateEventRequest,
  responses(
    (status = 200, description = "OK", body = EventResponse),
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
  JsonBody(request): JsonBody<UpdateEventRequest>,
) -> Result<Response, ApiError> {
  let (fields, version) = request.into_parts();
  let shape = check_shape(&fields)?;

  let owner = user.owner;
  let mut connection = state.db().await?;
  let Some(found) = events::find(&mut connection, owner, id).await? else {
    return Err(not_found().into());
  };

  let mut changed = found.entity.clone();
  apply(&mut changed, &fields, shape).map_err(FieldErrors::from_domain)?;

  match events::update(&mut connection, owner, &found, &changed, RowVersion(version)).await {
    Ok(version) => request::ok(&to_response(&changed, version)),
    Err(Error::Conflict) => Err(conflict().into()),
    Err(Error::NotFound) => Err(not_found().into()),
    Err(error) => Err(error.into()),
  }
}

// Deletes an event whatever changed since the client read it.
#[utoipa::path(
  delete,
  path = "/api/events/{id}",
  operation_id = "DeleteEvent",
  tag = "Events",
  params(("id" = Uuid, Path)),
  responses(
    (status = 204, description = "No Content"),
    (status = 404, description = "Not Found", body = ProblemDetails, content_type = "application/problem+json"),
    (status = 409, description = "Conflict", body = ProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn delete(RouteId(id): RouteId, CurrentUser(user): CurrentUser, State(state): State<AppState>) -> Result<Response, ApiError> {
  let owner = user.owner;
  let mut connection = state.db().await?;
  let Some(found) = events::find(&mut connection, owner, id).await? else {
    return Err(not_found().into());
  };
  // Only a write between this request's read and its delete fails the version check.
  match events::delete(&mut connection, owner, id, found.version).await {
    Ok(()) => Ok(StatusCode::NO_CONTENT.into_response()),
    Err(Error::Conflict) => Err(conflict().into()),
    Err(Error::NotFound) => Err(not_found().into()),
    Err(error) => Err(error.into()),
  }
}

/// The kind of an event with the fields that kind requires, as validation found them.
#[derive(Debug, Clone, Copy)]
enum EventShape<'a> {
  AllDay {
    start_date: NaiveDate,
    end_date: NaiveDate,
  },
  Timed {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    time_zone: &'a str,
  },
}

/// The fields each kind of event requires and forbids, shared by create and update: the event's shape, or
/// every field error.
fn check_shape(request: &EventFields) -> Result<EventShape<'_>, FieldErrors> {
  let mut errors = FieldErrors::new();
  let shape = if request.all_day {
    errors.require(
      request.start_date.is_some(),
      "startDate",
      "startDate is required for an all-day event.",
    );
    errors.require(request.end_date.is_some(), "endDate", "endDate is required for an all-day event.");
    errors.forbid(request.start.is_some(), "start", "start is only for timed events; use startDate.");
    errors.forbid(request.end.is_some(), "end", "end is only for timed events; use endDate.");
    errors.forbid(request.time_zone.is_some(), "timeZone", "timeZone is only for timed events.");
    errors.check_date(request.start_date, "startDate");
    errors.check_date(request.end_date, "endDate");
    match (request.start_date, request.end_date) {
      (Some(start_date), Some(end_date)) => Some(EventShape::AllDay { start_date, end_date }),
      _ => None,
    }
  } else {
    errors.require(request.start.is_some(), "start", "start is required for a timed event.");
    errors.require(request.end.is_some(), "end", "end is required for a timed event.");
    errors.require(request.time_zone.is_some(), "timeZone", "timeZone is required for a timed event.");
    errors.forbid(
      request.start_date.is_some(),
      "startDate",
      "startDate is only for all-day events; use start.",
    );
    errors.forbid(
      request.end_date.is_some(),
      "endDate",
      "endDate is only for all-day events; use end.",
    );
    match (request.start, request.end, request.time_zone.as_deref()) {
      (Some(start), Some(end), Some(time_zone)) => Some(EventShape::Timed { start, end, time_zone }),
      _ => None,
    }
  };
  match (errors.any(), shape) {
    (false, Some(shape)) => Ok(shape),
    _ => Err(errors),
  }
}

fn new_event(owner: Uuid, fields: &EventFields, shape: EventShape<'_>) -> Result<CalendarEvent, ArgumentError> {
  let title = fields.title.as_deref().unwrap_or_default();
  let (location, notes) = (fields.location.as_deref(), fields.notes.as_deref());
  match shape {
    EventShape::AllDay { start_date, end_date } => CalendarEvent::create_all_day(owner, title, start_date, end_date, location, notes),
    EventShape::Timed { start, end, time_zone } => CalendarEvent::create(owner, title, start, end, time_zone, location, notes),
  }
}

fn apply(event: &mut CalendarEvent, fields: &EventFields, shape: EventShape<'_>) -> Result<(), ArgumentError> {
  let title = fields.title.as_deref().unwrap_or_default();
  let (location, notes) = (fields.location.as_deref(), fields.notes.as_deref());
  match shape {
    EventShape::AllDay { start_date, end_date } => event.update_all_day(title, start_date, end_date, location, notes),
    EventShape::Timed { start, end, time_zone } => event.update(title, start, end, time_zone, location, notes),
  }
}

fn not_found() -> Problem {
  Problem::titled(StatusCode::NOT_FOUND, "Event not found.")
}

fn conflict() -> Problem {
  Problem::titled(StatusCode::CONFLICT, "The event was changed elsewhere. Load it again and retry.")
}

fn to_response(event: &CalendarEvent, version: RowVersion) -> EventResponse {
  EventResponse {
    id: event.id(),
    title: event.title().to_owned(),
    all_day: event.is_all_day(),
    location: event.location().map(str::to_owned),
    notes: event.notes().map(str::to_owned),
    start: event.start(),
    end: event.end(),
    time_zone: event.time_zone_id().map(str::to_owned),
    start_date: event.start_date(),
    end_date: event.end_date(),
    version: version.0,
  }
}
