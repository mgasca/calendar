//! `/api/agenda`: the day and week views (ports `AgendaEndpoints.cs`). The client supplies the date, the zone
//! and, for the week, what day it is: the server never decides that (ADR-0021).

use axum::extract::State;
use axum::response::Response;
use calendar_domain::time::{DateRangeWindow, DayWindow};
use calendar_infrastructure::OwnerId;
use chrono::{DateTime, Utc};

use super::agenda_builder;
use super::request::{self, QueryParams};
use crate::auth::CurrentUser;
use crate::contracts::{AgendaDay, AgendaTasks, AgendaWindow, DayAgendaResponse, HttpValidationProblemDetails, WeekAgendaResponse};
use crate::error::ApiError;
use crate::state::AppState;
use crate::validation::FieldErrors;

// Everything for one local day.
#[utoipa::path(
  get,
  path = "/api/agenda/day",
  operation_id = "GetDayAgenda",
  tag = "Agenda",
  summary = "Everything for one local day: all-day events, timed events, and due-today and overdue tasks.",
  params(("date" = chrono::NaiveDate, Query), ("timeZone" = String, Query)),
  responses(
    (status = 200, description = "OK", body = DayAgendaResponse),
    (status = 400, description = "Bad Request", body = HttpValidationProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn get_day(CurrentUser(user): CurrentUser, State(state): State<AppState>, query: QueryParams) -> Result<Response, ApiError> {
  let date = query.date("date")?;
  let time_zone = query.get("timeZone");

  let mut errors = FieldErrors::new();
  let day = errors.require_date(date, "date");
  let zone = errors.require_time_zone(time_zone.as_deref(), "timeZone");
  let (false, Some(day), Some(zone)) = (errors.any(), day, zone) else {
    return Err(errors.into_problem().into());
  };

  // A one-day range whose overdue list is judged against the day itself.
  let range = DateRangeWindow::single_day(day, zone);
  let as_of = range.days().first().copied();
  let mut connection = state.db().await?;
  let mut snapshot = agenda_builder::read(&mut connection, OwnerId(user.user_id), &range, as_of.as_ref()).await?;
  let only = snapshot
    .days
    .pop()
    .ok_or_else(|| ApiError::internal("a one-day agenda has no day"))?;

  request::ok(&DayAgendaResponse {
    date: only.window.date(),
    time_zone: zone.id().to_owned(),
    window: window(only.window.start(), only.window.end()),
    all_day_events: snapshot.all_day_events,
    events: only.events,
    tasks: AgendaTasks {
      overdue: snapshot.overdue.unwrap_or_default(),
      overdue_total: snapshot.overdue_total,
      overdue_open_total: snapshot.overdue_open_total,
      due_today: only.tasks,
    },
  })
}

// The ISO week containing a local date.
#[utoipa::path(
  get,
  path = "/api/agenda/week",
  operation_id = "GetWeekAgenda",
  tag = "Agenda",
  summary = "The ISO week (Monday to Sunday) containing a local date: all-day events once per week, timed events and due tasks per day, and the tasks overdue as of today that were due before the week.",
  params(("date" = chrono::NaiveDate, Query), ("timeZone" = String, Query), ("today" = chrono::NaiveDate, Query)),
  responses(
    (status = 200, description = "OK", body = WeekAgendaResponse),
    (status = 400, description = "Bad Request", body = HttpValidationProblemDetails, content_type = "application/problem+json"),
  )
)]
pub async fn get_week(CurrentUser(user): CurrentUser, State(state): State<AppState>, query: QueryParams) -> Result<Response, ApiError> {
  let date = query.date("date")?;
  let time_zone = query.get("timeZone");
  let today = query.date("today")?;

  let mut errors = FieldErrors::new();
  let any_date = errors.require_date(date, "date");
  let zone = errors.require_time_zone(time_zone.as_deref(), "timeZone");
  let today = errors.require_date(today, "today");
  let (false, Some(any_date), Some(zone), Some(today)) = (errors.any(), any_date, zone, today) else {
    return Err(errors.into_problem().into());
  };

  let week = DateRangeWindow::iso_week(any_date, zone);

  // The server never decides what day it is (ADR-0021): overdue is judged against the client's today, and a
  // week that is wholly in the past has no overdue list (ADR-0024).
  let overdue_as_of = (today < week.end_date()).then(|| DayWindow::create(today, zone));
  let mut connection = state.db().await?;
  let snapshot = agenda_builder::read(&mut connection, OwnerId(user.user_id), &week, overdue_as_of.as_ref()).await?;

  request::ok(&WeekAgendaResponse {
    week_start: week.start_date(),
    time_zone: zone.id().to_owned(),
    window: window(week.start(), week.end()),
    all_day_events: snapshot.all_day_events,
    days: snapshot
      .days
      .into_iter()
      .map(|day| AgendaDay {
        date: day.window.date(),
        window: window(day.window.start(), day.window.end()),
        events: day.events,
        tasks: day.tasks,
      })
      .collect(),
    overdue: snapshot.overdue,
    overdue_total: snapshot.overdue_total,
    overdue_open_total: snapshot.overdue_open_total,
  })
}

fn window(start: DateTime<Utc>, end: DateTime<Utc>) -> AgendaWindow {
  AgendaWindow { start, end }
}
