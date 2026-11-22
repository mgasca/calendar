//! The Calendar API for the Rune UI.
//!
//! [`generated`] is generated from `contracts/openapi.json` by `calendar-client-gen` (`just contracts`) and is never
//! edited by hand. [`Api`] wraps it with the web app's conventions:
//!
//! - The client says what day it is: every call that depends on the day takes a [`Day`] (ADR-0021).
//! - A failed call is an [`ApiError`] with the status and the problem-details message, chosen as the web app's
//!   `problemMessage` chooses it (`frontend/apps/web/src/api/apiError.ts`).
//! - A 401 from any endpoint but `/api/auth/me` calls the `on_unauthorized` hook, as the web app raises
//!   `calendar:unauthorized`, so the shell can sign out.
//!
//! - [`Api::traced`] sends a W3C `traceparent` ([`TraceParent`]) on every call of one user action, so the API's spans,
//!   logs and metrics for that action share the app's trace id (#1010). The app exports no telemetry of its own.
//!
//! Cookies are the supplied `reqwest::Client`'s: a cookie store on the desktop, the browser's on the web.

#[rustfmt::skip]
#[allow(clippy::all, clippy::pedantic, dead_code, unused_imports, missing_docs)]
pub mod generated;

use chrono::NaiveDate;
use std::sync::Arc;

pub use generated::{AuthUserResponse, DayAgendaResponse, TaskPage, TaskResponse, WeekAgendaResponse};

/// What day it is for the user, and where: the client's date and IANA time zone (ADR-0021).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Day {
  pub today: NaiveDate,
  pub time_zone: String,
}

/// A failed API call: the HTTP status (none when the request never got a response) and the best human-readable
/// message from a problem-details body, when it has one.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{}", self.message.as_deref().unwrap_or("The request failed"))]
pub struct ApiError {
  pub status: Option<u16>,
  pub message: Option<String>,
}

impl ApiError {
  /// The message to show: the server's, else `fallback` (the web app's `apiError(result, fallback)`).
  #[must_use]
  pub fn message_or<'a>(&'a self, fallback: &'a str) -> &'a str {
    self.message.as_deref().unwrap_or(fallback)
  }

  /// Whether the server refused the call because the user is not signed in.
  #[must_use]
  pub fn is_unauthorized(&self) -> bool {
    self.status == Some(401)
  }

  fn from_op<E: std::fmt::Debug>(error: generated::ApiOpError<E>) -> Self {
    match error {
      generated::ApiOpError::Api(api) if (200..300).contains(&api.status) => ApiError {
        status: Some(api.status),
        message: Some(format!(
          "The response does not match the contract: {}",
          api.parse_error.as_deref().unwrap_or("unreadable body")
        )),
      },
      generated::ApiOpError::Api(api) => ApiError {
        status: Some(api.status),
        message: problem_message(&api.body),
      },
      generated::ApiOpError::Transport(transport) => ApiError {
        status: None,
        message: Some(transport.to_string()),
      },
    }
  }
}

/// A failed save: the error, and the response body for the form to read field errors from.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{error}")]
pub struct SaveError {
  pub error: ApiError,
  pub body: String,
}

/// The first field error, else `detail`, else `title`, of a problem-details body; `None` for any other body.
#[must_use]
pub fn problem_message(body: &str) -> Option<String> {
  let problem: serde_json::Value = serde_json::from_str(body).ok()?;
  let problem = problem.as_object()?;
  let field_error = problem.get("errors").and_then(serde_json::Value::as_object).and_then(|errors| {
    errors
      .values()
      .filter_map(serde_json::Value::as_array)
      .flatten()
      .find_map(|e| e.as_str())
  });
  field_error
    .or_else(|| {
      ["detail", "title"]
        .into_iter()
        .find_map(|key| problem.get(key)?.as_str().filter(|s| !s.is_empty()))
    })
    .map(str::to_owned)
}

type Hook = Arc<dyn Fn() + Send + Sync>;

/// A W3C Trace Context parent (`traceparent`, version `00`, sampled): the trace of one user action, and the app's span
/// within it. The caller picks the ids, so this crate needs no randomness.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TraceParent {
  trace_id: u128,
  span_id: u64,
}

impl TraceParent {
  /// The parent for `trace_id` and `span_id`, or `None` when either is zero, which W3C Trace Context makes invalid.
  #[must_use]
  pub fn new(trace_id: u128, span_id: u64) -> Option<Self> {
    (trace_id != 0 && span_id != 0).then_some(TraceParent { trace_id, span_id })
  }

  /// The trace id as 32 lowercase hex digits, as the API's telemetry records it.
  #[must_use]
  pub fn trace_id(&self) -> String {
    format!("{:032x}", self.trace_id)
  }

  /// The `traceparent` header value.
  #[must_use]
  pub fn header(&self) -> String {
    format!("00-{:032x}-{:016x}-01", self.trace_id, self.span_id)
  }
}

/// The API, with the session cookie of the `reqwest::Client` it was made with.
#[derive(Clone)]
pub struct Api {
  client: generated::HttpClient,
  on_unauthorized: Option<Hook>,
}

impl std::fmt::Debug for Api {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("Api").finish_non_exhaustive()
  }
}

impl Api {
  /// The API at `origin` (scheme, host and port, no path), through `client`.
  #[must_use]
  pub fn new(origin: &str, client: reqwest::Client) -> Self {
    Api {
      client: generated::HttpClient::with_client(client).with_base_url(origin.trim_end_matches('/')),
      on_unauthorized: None,
    }
  }

  /// Calls `hook` when any endpoint but `/api/auth/me` answers 401.
  #[must_use]
  pub fn on_unauthorized(mut self, hook: impl Fn() + Send + Sync + 'static) -> Self {
    self.on_unauthorized = Some(Arc::new(hook));
    self
  }

  /// This API with `parent` as the `traceparent` of every call made through it: one user action's requests. The
  /// 401 signal and the cookies are the same as this one's.
  #[must_use]
  pub fn traced(&self, parent: &TraceParent) -> Self {
    Api {
      client: self.client.clone().with_header("traceparent", parent.header()),
      on_unauthorized: self.on_unauthorized.clone(),
    }
  }

  /// The generated client, for operations this wrapper does not cover yet.
  #[must_use]
  pub fn generated(&self) -> &generated::HttpClient {
    &self.client
  }

  /// Maps a generated call's result, and signals a 401 unless `path` is `/api/auth/me`.
  pub async fn run<T, E: std::fmt::Debug>(
    &self,
    path: &str,
    call: impl Future<Output = Result<T, generated::ApiOpError<E>>>,
  ) -> Result<T, ApiError> {
    let error = match call.await {
      Ok(value) => return Ok(value),
      Err(error) => ApiError::from_op(error),
    };
    if error.is_unauthorized()
      && path != "/api/auth/me"
      && let Some(hook) = &self.on_unauthorized
    {
      hook();
    }
    Err(error)
  }

  /// [`Api::run`] for a form's save: the error keeps the response body, whose 400 `errors` map onto the form's fields.
  pub async fn run_save<T, E: std::fmt::Debug>(
    &self,
    path: &str,
    call: impl Future<Output = Result<T, generated::ApiOpError<E>>>,
  ) -> Result<T, SaveError> {
    let mut body = String::new();
    let result = self
      .run(path, async {
        call.await.inspect_err(|error| {
          if let generated::ApiOpError::Api(api) = error {
            body.clone_from(&api.body);
          }
        })
      })
      .await;
    result.map_err(|error| SaveError { error, body })
  }

  /// `POST /api/tasks/bulk`: one action on the listed ids, or on every overdue task the filter names.
  pub async fn bulk_tasks(&self, request: generated::BulkTaskRequest) -> Result<generated::BulkTaskResponse, ApiError> {
    self.run("/api/tasks/bulk", self.client.bulk_tasks(request)).await
  }

  /// `POST /api/events`.
  pub async fn create_event(&self, request: generated::CreateEventRequest) -> Result<generated::EventResponse, SaveError> {
    self.run_save("/api/events", self.client.create_event(request)).await
  }

  /// `GET /api/events/{id}`: the event as stored, with its version, for the edit form.
  pub async fn event(&self, id: uuid::Uuid) -> Result<generated::EventResponse, ApiError> {
    self.run("/api/events/{id}", self.client.get_event(id.to_string())).await
  }

  /// `PUT /api/events/{id}`.
  pub async fn update_event(&self, id: uuid::Uuid, request: generated::UpdateEventRequest) -> Result<generated::EventResponse, SaveError> {
    self
      .run_save("/api/events/{id}", self.client.update_event(id.to_string(), request))
      .await
  }

  /// `DELETE /api/events/{id}`.
  pub async fn delete_event(&self, id: uuid::Uuid) -> Result<(), ApiError> {
    self.run("/api/events/{id}", self.client.delete_event(id.to_string())).await
  }

  /// `POST /api/tasks`.
  pub async fn create_task(&self, request: generated::CreateTaskRequest) -> Result<TaskResponse, SaveError> {
    self.run_save("/api/tasks", self.client.create_task(request)).await
  }

  /// `GET /api/tasks/{id}`: the task as stored, with its version, for the edit form.
  pub async fn task(&self, id: uuid::Uuid) -> Result<TaskResponse, ApiError> {
    self.run("/api/tasks/{id}", self.client.get_task(id.to_string())).await
  }

  /// `PUT /api/tasks/{id}`.
  pub async fn update_task(&self, id: uuid::Uuid, request: generated::UpdateTaskRequest) -> Result<TaskResponse, SaveError> {
    self
      .run_save("/api/tasks/{id}", self.client.update_task(id.to_string(), request))
      .await
  }

  /// `GET /api/auth/me`: the signed-in user. A 401 here means "signed out" and calls no hook.
  pub async fn me(&self) -> Result<AuthUserResponse, ApiError> {
    self.run("/api/auth/me", self.client.get_current_user()).await
  }

  /// `GET /api/agenda/day` for `date`, as seen from the user's `day`.
  pub async fn day_agenda(&self, date: NaiveDate, day: &Day) -> Result<DayAgendaResponse, ApiError> {
    self
      .run("/api/agenda/day", self.client.get_day_agenda(date.to_string(), &day.time_zone))
      .await
  }

  /// `GET /api/agenda/week` for the week that holds `date`, as seen from the user's `day`.
  pub async fn week_agenda(&self, date: NaiveDate, day: &Day) -> Result<WeekAgendaResponse, ApiError> {
    self
      .run(
        "/api/agenda/week",
        self.client.get_week_agenda(date.to_string(), &day.time_zone, day.today.to_string()),
      )
      .await
  }

  /// `POST /api/tasks/{id}/complete`: the task as completed.
  pub async fn complete_task(&self, id: uuid::Uuid) -> Result<TaskResponse, ApiError> {
    self
      .run("/api/tasks/{id}/complete", self.client.complete_task(id.to_string()))
      .await
  }

  /// `POST /api/tasks/{id}/reopen`: the task as open again.
  pub async fn reopen_task(&self, id: uuid::Uuid) -> Result<TaskResponse, ApiError> {
    self.run("/api/tasks/{id}/reopen", self.client.reopen_task(id.to_string())).await
  }

  /// `DELETE /api/tasks/{id}`.
  pub async fn delete_task(&self, id: uuid::Uuid) -> Result<(), ApiError> {
    self.run("/api/tasks/{id}", self.client.delete_task(id.to_string())).await
  }

  /// `GET /api/tasks` for `view`, a page of at most `limit` tasks after `cursor`.
  pub async fn tasks(&self, view: &str, day: &Day, limit: Option<i32>, cursor: Option<&str>) -> Result<TaskPage, ApiError> {
    let today = day.today.to_string();
    self
      .run(
        "/api/tasks",
        self.client.list_tasks(view, Some(&today), Some(&day.time_zone), limit, cursor),
      )
      .await
  }
}

/// A task's `version` as read goes back unchanged in an update: the contract types them separately.
impl From<generated::TaskResponseVersion> for generated::UpdateTaskRequestVersion {
  fn from(version: generated::TaskResponseVersion) -> Self {
    match version {
      generated::TaskResponseVersion::UnsignedInteger(n) => Self::UnsignedInteger(n),
      generated::TaskResponseVersion::String(s) => Self::String(s),
    }
  }
}

/// The HTTP client crate the session layer builds `Api` with.
pub use reqwest;

/// A count the contract types as `integer | string` (a large integer travels as a string): its value, or 0 when it
/// is neither.
#[must_use]
pub fn as_count<T: serde::Serialize>(value: &T) -> i64 {
  match serde_json::to_value(value) {
    Ok(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0),
    Ok(serde_json::Value::String(s)) => s.parse().unwrap_or(0),
    _ => 0,
  }
}

/// An event's `version` as read goes back unchanged in an update.
impl From<generated::EventResponseVersion> for generated::UpdateEventRequestVersion {
  fn from(version: generated::EventResponseVersion) -> Self {
    match version {
      generated::EventResponseVersion::UnsignedInteger(n) => Self::UnsignedInteger(n),
      generated::EventResponseVersion::String(s) => Self::String(s),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn counts_read_from_either_form() {
    use generated::AgendaTasksOverdueTotal as Total;
    assert_eq!(as_count(&Total::Integer(3)), 3);
    assert_eq!(as_count(&Total::String("21".into())), 21);
    assert_eq!(as_count(&Total::String("x".into())), 0);
  }
}
