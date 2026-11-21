//! Generated types from OpenAPI specification
//!
//! This file contains all the generated types for the API.
//! Do not edit manually - regenerate using the appropriate script.
#![allow(clippy::large_enum_variant)]
#![allow(clippy::format_in_format_args)]
#![allow(clippy::let_unit_value)]
#![allow(unreachable_patterns)]
use serde::{Deserialize, Serialize};
/// Serde normally maps both a missing `Option<T>` field and an
/// explicit JSON null to `None`. Wrapping the decoded value in
/// `Some` retains the field-presence bit for `Option<Option<T>>`.
mod tri_state_serde {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, D, T>(de: D) -> Result<Option<T>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        T::deserialize(de).map(Some)
    }
}
///The ISO week (Monday to Sunday) containing the requested date, from a single snapshot.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WeekAgendaResponse {
    ///All-day events covering any date of the week, once each, by start date then title.
    #[serde(rename = "allDayEvents")]
    pub all_day_events: Vec<AllDayEventItem>,
    ///The seven days, Monday first.
    pub days: Vec<AgendaDay>,
    /**Tasks overdue as of `today` (still open, or completed within today) that were due before the week's
Monday, capped at 20 and ordered open first, then completed today, by local due date, instant and id within
each group. Tasks due within the week are in their day instead. `null` when the whole
week is before `today`.*/
    pub overdue: Option<Vec<AgendaTaskItem>>,
    ///Number of open overdue tasks.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(rename = "overdueOpenTotal")]
    pub overdue_open_total: WeekAgendaResponseOverdueOpenTotal,
    ///Number of overdue tasks, including those completed today.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(rename = "overdueTotal")]
    pub overdue_total: WeekAgendaResponseOverdueTotal,
    ///Canonical IANA time zone id the week was resolved in.
    #[serde(rename = "timeZone")]
    pub time_zone: String,
    ///The Monday the week starts on (YYYY-MM-DD).
    #[serde(rename = "weekStart")]
    pub week_start: chrono::NaiveDate,
    pub window: AgendaWindow,
}
///Number of overdue tasks, including those completed today.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum WeekAgendaResponseOverdueTotal {
    Integer(i32),
    String(String),
}
///Number of open overdue tasks.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum WeekAgendaResponseOverdueOpenTotal {
    Integer(i32),
    String(String),
}
/**Replace a task's title, deadline, priority and notes, by the rules of `CreateTaskRequest`, plus the
`version` the client loaded. Neither deadline field clears the deadline. Completion is not changed.*/
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UpdateTaskRequest {
    ///Due instant, RFC 3339 with an explicit offset; mutually exclusive with `dueDate`.
    #[serde(
        rename = "dueAt",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///Floating due date (YYYY-MM-DD); mutually exclusive with `dueAt`.
    #[serde(
        rename = "dueDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_date: Option<Option<chrono::NaiveDate>>,
    ///Optional notes, at most 4000 characters after trimming.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub notes: Option<Option<String>>,
    ///Priority level; defaults to medium. Allowed values: low, medium, high.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    ///Task title; required, at most 200 characters after trimming.
    pub title: String,
    /**The task's `version` as last read; the update is refused with `409` when the task has changed
since.*/
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    pub version: UpdateTaskRequestVersion,
}
impl UpdateTaskRequest {
    /// Construct this request with every required wire field.
    pub fn new(title: String, version: UpdateTaskRequestVersion) -> Self {
        Self {
            title,
            version,
            due_at: None,
            due_date: None,
            notes: None,
            priority: None,
        }
    }
    /// Start a dependency-free builder with every required wire field.
    pub fn builder(
        title: String,
        version: UpdateTaskRequestVersion,
    ) -> UpdateTaskRequestBuilder {
        UpdateTaskRequestBuilder::new(title, version)
    }
}
/// Dependency-free builder for [`#struct_name`].
#[derive(Debug, Clone)]
#[must_use]
pub struct UpdateTaskRequestBuilder {
    value: UpdateTaskRequest,
}
impl UpdateTaskRequestBuilder {
    /// Start a builder with every required wire field.
    pub fn new(title: String, version: UpdateTaskRequestVersion) -> Self {
        Self {
            value: UpdateTaskRequest::new(title, version),
        }
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueAt", "` request field to a value."
    )]
    #[must_use]
    pub fn due_at(mut self, due_at: chrono::DateTime<chrono::Utc>) -> Self {
        self.value.due_at = Some(Some(due_at));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueAt", "` request field to JSON null."
    )]
    #[must_use]
    pub fn due_at_null(mut self) -> Self {
        self.value.due_at = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "dueAt", "` request field.")]
    #[must_use]
    pub fn due_at_absent(mut self) -> Self {
        self.value.due_at = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueDate", "` request field to a value."
    )]
    #[must_use]
    pub fn due_date(mut self, due_date: chrono::NaiveDate) -> Self {
        self.value.due_date = Some(Some(due_date));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueDate", "` request field to JSON null."
    )]
    #[must_use]
    pub fn due_date_null(mut self) -> Self {
        self.value.due_date = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "dueDate", "` request field.")]
    #[must_use]
    pub fn due_date_absent(mut self) -> Self {
        self.value.due_date = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to a value."
    )]
    #[must_use]
    pub fn notes(mut self, notes: String) -> Self {
        self.value.notes = Some(Some(notes));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to JSON null."
    )]
    #[must_use]
    pub fn notes_null(mut self) -> Self {
        self.value.notes = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "notes", "` request field.")]
    #[must_use]
    pub fn notes_absent(mut self) -> Self {
        self.value.notes = None;
        self
    }
    #[doc = concat!("Set the optional `", "priority", "` request field.")]
    #[must_use]
    pub fn priority(mut self, priority: String) -> Self {
        self.value.priority = Some(priority);
        self
    }
    /// Finish building the request model.
    pub fn build(self) -> UpdateTaskRequest {
        self.value
    }
}
/**The task's `version` as last read; the update is refused with `409` when the task has changed
since.*/
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum UpdateTaskRequestVersion {
    UnsignedInteger(u32),
    String(String),
}
/**Replace an event: the fields and rules of `CreateEventRequest`, plus the `version` the client loaded.
The kind can change (timed to all-day and back).*/
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UpdateEventRequest {
    /**`true` for an all-day event (`startDate`/`endDate`),
`false` for a timed one (`start`/`end`/`timeZone`).*/
    #[serde(rename = "allDay", skip_serializing_if = "Option::is_none")]
    pub all_day: Option<bool>,
    ///Timed events: exclusive end instant, after `start`; `null` for all-day events.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub end: Option<Option<chrono::DateTime<chrono::Utc>>>,
    /**All-day events: exclusive end date (YYYY-MM-DD), after `startDate`; a one-day event on the 26th ends on the 27th.
`null` for timed events.*/
    #[serde(
        rename = "endDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub end_date: Option<Option<chrono::NaiveDate>>,
    ///Optional location, at most 200 characters.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub location: Option<Option<String>>,
    ///Optional notes, at most 4000 characters.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub notes: Option<Option<String>>,
    ///Timed events: inclusive start instant, RFC 3339 with an explicit offset (e.g. 2026-10-26T14:00:00Z); `null` for all-day events.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub start: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///All-day events: first date (YYYY-MM-DD); `null` for timed events.
    #[serde(
        rename = "startDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub start_date: Option<Option<chrono::NaiveDate>>,
    ///Timed events: IANA time zone the event was created in, e.g. America/New_York; `null` for all-day events.
    #[serde(
        rename = "timeZone",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub time_zone: Option<Option<String>>,
    ///Event title; required, at most 200 characters after trimming.
    pub title: String,
    /**The event's `version` as last read; the update is refused with `409` when the event has changed
since.*/
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    pub version: UpdateEventRequestVersion,
}
impl UpdateEventRequest {
    /// Construct this request with every required wire field.
    pub fn new(title: String, version: UpdateEventRequestVersion) -> Self {
        Self {
            title,
            version,
            all_day: None,
            end: None,
            end_date: None,
            location: None,
            notes: None,
            start: None,
            start_date: None,
            time_zone: None,
        }
    }
    /// Start a dependency-free builder with every required wire field.
    pub fn builder(
        title: String,
        version: UpdateEventRequestVersion,
    ) -> UpdateEventRequestBuilder {
        UpdateEventRequestBuilder::new(title, version)
    }
}
/// Dependency-free builder for [`#struct_name`].
#[derive(Debug, Clone)]
#[must_use]
pub struct UpdateEventRequestBuilder {
    value: UpdateEventRequest,
}
impl UpdateEventRequestBuilder {
    /// Start a builder with every required wire field.
    pub fn new(title: String, version: UpdateEventRequestVersion) -> Self {
        Self {
            value: UpdateEventRequest::new(title, version),
        }
    }
    #[doc = concat!("Set the optional `", "allDay", "` request field.")]
    #[must_use]
    pub fn all_day(mut self, all_day: bool) -> Self {
        self.value.all_day = Some(all_day);
        self
    }
    #[doc = concat!("Set the optional nullable `", "end", "` request field to a value.")]
    #[must_use]
    pub fn end(mut self, end: chrono::DateTime<chrono::Utc>) -> Self {
        self.value.end = Some(Some(end));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "end", "` request field to JSON null."
    )]
    #[must_use]
    pub fn end_null(mut self) -> Self {
        self.value.end = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "end", "` request field.")]
    #[must_use]
    pub fn end_absent(mut self) -> Self {
        self.value.end = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "endDate", "` request field to a value."
    )]
    #[must_use]
    pub fn end_date(mut self, end_date: chrono::NaiveDate) -> Self {
        self.value.end_date = Some(Some(end_date));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "endDate", "` request field to JSON null."
    )]
    #[must_use]
    pub fn end_date_null(mut self) -> Self {
        self.value.end_date = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "endDate", "` request field.")]
    #[must_use]
    pub fn end_date_absent(mut self) -> Self {
        self.value.end_date = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "location", "` request field to a value."
    )]
    #[must_use]
    pub fn location(mut self, location: String) -> Self {
        self.value.location = Some(Some(location));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "location", "` request field to JSON null."
    )]
    #[must_use]
    pub fn location_null(mut self) -> Self {
        self.value.location = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "location", "` request field.")]
    #[must_use]
    pub fn location_absent(mut self) -> Self {
        self.value.location = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to a value."
    )]
    #[must_use]
    pub fn notes(mut self, notes: String) -> Self {
        self.value.notes = Some(Some(notes));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to JSON null."
    )]
    #[must_use]
    pub fn notes_null(mut self) -> Self {
        self.value.notes = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "notes", "` request field.")]
    #[must_use]
    pub fn notes_absent(mut self) -> Self {
        self.value.notes = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "start", "` request field to a value."
    )]
    #[must_use]
    pub fn start(mut self, start: chrono::DateTime<chrono::Utc>) -> Self {
        self.value.start = Some(Some(start));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "start", "` request field to JSON null."
    )]
    #[must_use]
    pub fn start_null(mut self) -> Self {
        self.value.start = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "start", "` request field.")]
    #[must_use]
    pub fn start_absent(mut self) -> Self {
        self.value.start = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "startDate", "` request field to a value."
    )]
    #[must_use]
    pub fn start_date(mut self, start_date: chrono::NaiveDate) -> Self {
        self.value.start_date = Some(Some(start_date));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "startDate", "` request field to JSON null."
    )]
    #[must_use]
    pub fn start_date_null(mut self) -> Self {
        self.value.start_date = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "startDate", "` request field.")]
    #[must_use]
    pub fn start_date_absent(mut self) -> Self {
        self.value.start_date = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "timeZone", "` request field to a value."
    )]
    #[must_use]
    pub fn time_zone(mut self, time_zone: String) -> Self {
        self.value.time_zone = Some(Some(time_zone));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "timeZone", "` request field to JSON null."
    )]
    #[must_use]
    pub fn time_zone_null(mut self) -> Self {
        self.value.time_zone = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "timeZone", "` request field.")]
    #[must_use]
    pub fn time_zone_absent(mut self) -> Self {
        self.value.time_zone = None;
        self
    }
    /// Finish building the request model.
    pub fn build(self) -> UpdateEventRequest {
        self.value
    }
}
/**The event's `version` as last read; the update is refused with `409` when the event has changed
since.*/
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum UpdateEventRequestVersion {
    UnsignedInteger(u32),
    String(String),
}
///One page of a task list view.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TaskPage {
    ///The page's tasks, in the view's order.
    pub items: Vec<TaskResponse>,
    ///Pass as `cursor` for the next page; `null` on the last page.
    #[serde(
        rename = "nextCursor",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub next_cursor: Option<Option<String>>,
    ///Total open overdue tasks, provided on the first overdue page only.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub total: Option<Option<TaskPageTotal>>,
}
///A task as stored.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TaskResponse {
    ///When the task was completed; `null` while it is open.
    #[serde(
        rename = "completedAt",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub completed_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///Due instant, or `null` if the task has no timed due.
    #[serde(
        rename = "dueAt",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///Floating due date, or `null` if the task has no date-only due.
    #[serde(
        rename = "dueDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_date: Option<Option<chrono::NaiveDate>>,
    ///Unique task id.
    pub id: uuid::Uuid,
    ///`true` once the task has been completed.
    #[serde(rename = "isCompleted")]
    pub is_completed: bool,
    ///Optional task notes.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub notes: Option<Option<String>>,
    ///Priority level: low, medium, or high.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    ///Task title.
    pub title: String,
    ///Opaque version of the stored task; send it back to update the task.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    pub version: TaskResponseVersion,
}
///Opaque version of the stored task; send it back to update the task.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum TaskResponseVersion {
    UnsignedInteger(u32),
    String(String),
}
///Total open overdue tasks, provided on the first overdue page only.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum TaskPageTotal {
    Integer(i32),
    String(String),
}
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ProblemDetails {
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub detail: Option<Option<String>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub instance: Option<Option<String>>,
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub status: Option<Option<ProblemDetailsStatus>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub title: Option<Option<String>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub r#type: Option<Option<String>>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ProblemDetailsStatus {
    Integer(i32),
    String(String),
}
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct HttpValidationProblemDetails {
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub detail: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<HttpValidationProblemDetailsErrors>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub instance: Option<Option<String>>,
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub status: Option<Option<HttpValidationProblemDetailsStatus>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub title: Option<Option<String>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub r#type: Option<Option<String>>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum HttpValidationProblemDetailsStatus {
    Integer(i32),
    String(String),
}
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct HttpValidationProblemDetailsErrors {
    /// Additional properties matching the spec's
    /// `additionalProperties` value schema.
    #[serde(flatten)]
    pub additional_properties: std::collections::BTreeMap<String, Vec<String>>,
}
///An event as stored. Fields of the other kind are `null`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventResponse {
    ///`true` for an all-day event, `false` for a timed one.
    #[serde(rename = "allDay")]
    pub all_day: bool,
    ///Timed events: exclusive end instant; `null` for all-day events.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub end: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///All-day events: exclusive end date; `null` for timed events.
    #[serde(
        rename = "endDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub end_date: Option<Option<chrono::NaiveDate>>,
    ///Unique event id.
    pub id: uuid::Uuid,
    ///Location, or `null` if none.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub location: Option<Option<String>>,
    ///Notes, or `null` if none.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub notes: Option<Option<String>>,
    ///Timed events: inclusive start instant; `null` for all-day events.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub start: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///All-day events: first date; `null` for timed events.
    #[serde(
        rename = "startDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub start_date: Option<Option<chrono::NaiveDate>>,
    ///Timed events: IANA time zone id; `null` for all-day events.
    #[serde(
        rename = "timeZone",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub time_zone: Option<Option<String>>,
    ///Event title.
    pub title: String,
    ///Opaque version of the stored event; send it back to update the event.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    pub version: EventResponseVersion,
}
///Opaque version of the stored event; send it back to update the event.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum EventResponseVersion {
    UnsignedInteger(u32),
    String(String),
}
///Everything for one local day, from a single snapshot.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DayAgendaResponse {
    ///All-day events covering the date, by start date then title.
    #[serde(rename = "allDayEvents")]
    pub all_day_events: Vec<AllDayEventItem>,
    ///The local calendar date (YYYY-MM-DD) in `timeZone`.
    pub date: chrono::NaiveDate,
    ///Timed events overlapping the window, by start then title.
    pub events: Vec<TimedEventItem>,
    pub tasks: AgendaTasks,
    ///Canonical IANA time zone id the day was resolved in.
    #[serde(rename = "timeZone")]
    pub time_zone: String,
    pub window: AgendaWindow,
}
///An all-day event in the day agenda (floating dates, end exclusive).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AllDayEventItem {
    ///Exclusive end date of the event.
    #[serde(rename = "endDate")]
    pub end_date: chrono::NaiveDate,
    ///Whether the event has notes.
    #[serde(rename = "hasNotes")]
    pub has_notes: bool,
    ///Unique event id.
    pub id: uuid::Uuid,
    ///Location, or `null` if none.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub location: Option<Option<String>>,
    ///First date of the event.
    #[serde(rename = "startDate")]
    pub start_date: chrono::NaiveDate,
    ///Event title.
    pub title: String,
}
/**Bulk action outcomes and totals. Explicit-id targets return one result per distinct id; filter targets return
an empty results array, with int BulkTaskResponse.Applied equal to the number of rows changed or deleted.*/
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BulkTaskResponse {
    ///Number of applied actions, or rows changed/deleted for a filter target.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    pub applied: BulkTaskResponseApplied,
    ///Number of ids that were not found.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(rename = "notFound")]
    pub not_found: BulkTaskResponseNotFound,
    ///One outcome per distinct explicit id; empty for a filter target.
    pub results: Vec<BulkTaskItemResult>,
    ///Number of skipped actions.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    pub skipped: BulkTaskResponseSkipped,
}
///Number of skipped actions.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum BulkTaskResponseSkipped {
    Integer(i32),
    String(String),
}
///Number of ids that were not found.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum BulkTaskResponseNotFound {
    Integer(i32),
    String(String),
}
///Number of applied actions, or rows changed/deleted for a filter target.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum BulkTaskResponseApplied {
    Integer(i32),
    String(String),
}
///Outcome for one requested task.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BulkTaskItemResult {
    ///Task id.
    pub id: uuid::Uuid,
    ///applied, skipped or notFound.
    pub outcome: String,
}
/**Apply one action to explicit task ids or a guarded overdue filter. Explicit ids return per-task results;
filter targets return no per-task results and use the aggregate counts.*/
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BulkTaskRequest {
    pub action: BulkTaskAction,
    ///New deadline instant, required for setDueInstant.
    #[serde(
        rename = "dueAt",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///New floating deadline, required for setDueDate.
    #[serde(
        rename = "dueDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_date: Option<Option<chrono::NaiveDate>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub filter: Option<Option<OverdueTaskFilter>>,
    ///Explicit task ids; mutually exclusive with OverdueTaskFilter? BulkTaskRequest.Filter.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub ids: Option<Option<Vec<String>>>,
}
impl BulkTaskRequest {
    /// Construct this request with every required wire field.
    pub fn new(action: BulkTaskAction) -> Self {
        Self {
            action,
            due_at: None,
            due_date: None,
            filter: None,
            ids: None,
        }
    }
    /// Start a dependency-free builder with every required wire field.
    pub fn builder(action: BulkTaskAction) -> BulkTaskRequestBuilder {
        BulkTaskRequestBuilder::new(action)
    }
}
/// Dependency-free builder for [`#struct_name`].
#[derive(Debug, Clone)]
#[must_use]
pub struct BulkTaskRequestBuilder {
    value: BulkTaskRequest,
}
impl BulkTaskRequestBuilder {
    /// Start a builder with every required wire field.
    pub fn new(action: BulkTaskAction) -> Self {
        Self {
            value: BulkTaskRequest::new(action),
        }
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueAt", "` request field to a value."
    )]
    #[must_use]
    pub fn due_at(mut self, due_at: chrono::DateTime<chrono::Utc>) -> Self {
        self.value.due_at = Some(Some(due_at));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueAt", "` request field to JSON null."
    )]
    #[must_use]
    pub fn due_at_null(mut self) -> Self {
        self.value.due_at = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "dueAt", "` request field.")]
    #[must_use]
    pub fn due_at_absent(mut self) -> Self {
        self.value.due_at = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueDate", "` request field to a value."
    )]
    #[must_use]
    pub fn due_date(mut self, due_date: chrono::NaiveDate) -> Self {
        self.value.due_date = Some(Some(due_date));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueDate", "` request field to JSON null."
    )]
    #[must_use]
    pub fn due_date_null(mut self) -> Self {
        self.value.due_date = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "dueDate", "` request field.")]
    #[must_use]
    pub fn due_date_absent(mut self) -> Self {
        self.value.due_date = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "filter", "` request field to a value."
    )]
    #[must_use]
    pub fn filter(mut self, filter: OverdueTaskFilter) -> Self {
        self.value.filter = Some(Some(filter));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "filter", "` request field to JSON null."
    )]
    #[must_use]
    pub fn filter_null(mut self) -> Self {
        self.value.filter = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "filter", "` request field.")]
    #[must_use]
    pub fn filter_absent(mut self) -> Self {
        self.value.filter = None;
        self
    }
    #[doc = concat!("Set the optional nullable `", "ids", "` request field to a value.")]
    #[must_use]
    pub fn ids(mut self, ids: Vec<String>) -> Self {
        self.value.ids = Some(Some(ids));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "ids", "` request field to JSON null."
    )]
    #[must_use]
    pub fn ids_null(mut self) -> Self {
        self.value.ids = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "ids", "` request field.")]
    #[must_use]
    pub fn ids_absent(mut self) -> Self {
        self.value.ids = None;
        self
    }
    /// Finish building the request model.
    pub fn build(self) -> BulkTaskRequest {
        self.value
    }
}
///Guarded overdue query and the count the client observed.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OverdueTaskFilter {
    ///Expected number of matching overdue tasks.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(rename = "expectedTotal")]
    pub expected_total: OverdueTaskFilterExpectedTotal,
    ///Client's IANA time zone.
    #[serde(rename = "timeZone")]
    pub time_zone: String,
    ///Client's current date.
    pub today: chrono::NaiveDate,
    ///The only supported filtered view.
    pub view: String,
}
///Expected number of matching overdue tasks.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum OverdueTaskFilterExpectedTotal {
    Integer(i32),
    String(String),
}
///Supported bulk task actions.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Default)]
pub enum BulkTaskAction {
    #[default]
    #[serde(rename = "complete")]
    Complete,
    #[serde(rename = "setDueDate")]
    SetDueDate,
    #[serde(rename = "setDueInstant")]
    SetDueInstant,
    #[serde(rename = "clearDeadline")]
    ClearDeadline,
    #[serde(rename = "delete")]
    Delete,
}
impl BulkTaskAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::SetDueDate => "setDueDate",
            Self::SetDueInstant => "setDueInstant",
            Self::ClearDeadline => "clearDeadline",
            Self::Delete => "delete",
        }
    }
}
impl ::std::fmt::Display for BulkTaskAction {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        f.write_str(self.as_str())
    }
}
impl AsRef<str> for BulkTaskAction {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
///Tasks relevant to the day, split into overdue and due-today groups.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgendaTasks {
    ///Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.
    #[serde(rename = "dueToday")]
    pub due_today: Vec<AgendaTaskItem>,
    ///Up to 20 overdue tasks, open first then completed within the day; each group is ordered by local due date, instant and id.
    pub overdue: Vec<AgendaTaskItem>,
    ///Number of open overdue tasks.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(rename = "overdueOpenTotal")]
    pub overdue_open_total: AgendaTasksOverdueOpenTotal,
    ///Number of overdue tasks, including those completed today.
    ///Constraint: pattern=`^-?(?:0|[1-9]\d*)$`
    #[serde(rename = "overdueTotal")]
    pub overdue_total: AgendaTasksOverdueTotal,
}
///Number of overdue tasks, including those completed today.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum AgendaTasksOverdueTotal {
    Integer(i32),
    String(String),
}
///Number of open overdue tasks.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum AgendaTasksOverdueOpenTotal {
    Integer(i32),
    String(String),
}
///One local day of a multi-day agenda: its timed events and the tasks due on it.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgendaDay {
    ///The local calendar date (YYYY-MM-DD).
    pub date: chrono::NaiveDate,
    /**Timed events overlapping the day, by start then title, with flags relative to this day. An event that
crosses midnight appears on every day it touches.*/
    pub events: Vec<TimedEventItem>,
    ///Tasks due on the day (open or completed): timed ones by due instant, then date-only ones by title.
    pub tasks: Vec<AgendaTaskItem>,
    pub window: AgendaWindow,
}
///A timed event in the day agenda.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TimedEventItem {
    ///Exclusive end instant.
    pub end: chrono::DateTime<chrono::Utc>,
    ///The event ends after the day's window (it continues into a later day).
    #[serde(rename = "endsAfterDay")]
    pub ends_after_day: bool,
    ///Whether the event has notes.
    #[serde(rename = "hasNotes")]
    pub has_notes: bool,
    ///Unique event id.
    pub id: uuid::Uuid,
    ///Location, or `null` if none.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub location: Option<Option<String>>,
    ///Inclusive start instant.
    pub start: chrono::DateTime<chrono::Utc>,
    ///The event began before the day's window (it continues from an earlier day).
    #[serde(rename = "startsBeforeDay")]
    pub starts_before_day: bool,
    ///IANA time zone id the event was created in.
    #[serde(rename = "timeZone")]
    pub time_zone: String,
    ///Event title.
    pub title: String,
}
///The day as UTC instants, `[start, end)`; may be shorter or longer than 24 hours across DST changes.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgendaWindow {
    ///Exclusive end of the day, as a UTC instant.
    pub end: chrono::DateTime<chrono::Utc>,
    ///Inclusive start of the day, as a UTC instant.
    pub start: chrono::DateTime<chrono::Utc>,
}
///A task in an agenda.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgendaTaskItem {
    ///When the task was completed; `null` while it is open.
    #[serde(
        rename = "completedAt",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub completed_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///Due instant, or `null` if the task has no timed due.
    #[serde(
        rename = "dueAt",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///Floating due date, or `null` if the task has no date-only due.
    #[serde(
        rename = "dueDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_date: Option<Option<chrono::NaiveDate>>,
    ///Whether the task has notes.
    #[serde(rename = "hasNotes")]
    pub has_notes: bool,
    ///Unique task id.
    pub id: uuid::Uuid,
    ///`true` once the task has been completed.
    #[serde(rename = "isCompleted")]
    pub is_completed: bool,
    ///Priority level: low, medium, or high.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    ///Task title.
    pub title: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthUserResponse {
    pub email: String,
    pub name: String,
    #[serde(rename = "pictureUrl")]
    pub picture_url: Option<String>,
}
/**Create an event. Discriminated by `allDay`: a timed event needs `start`, `end` and
`timeZone`; an all-day event needs `startDate` and `endDate` (end exclusive) and no timed fields.*/
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CreateEventRequest {
    /**`true` for an all-day event (`startDate`/`endDate`),
`false` for a timed one (`start`/`end`/`timeZone`).*/
    #[serde(rename = "allDay", skip_serializing_if = "Option::is_none")]
    pub all_day: Option<bool>,
    ///Timed events: exclusive end instant, after `start`; `null` for all-day events.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub end: Option<Option<chrono::DateTime<chrono::Utc>>>,
    /**All-day events: exclusive end date (YYYY-MM-DD), after `startDate`; a one-day event on the 26th ends on the 27th.
`null` for timed events.*/
    #[serde(
        rename = "endDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub end_date: Option<Option<chrono::NaiveDate>>,
    ///Optional location, at most 200 characters.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub location: Option<Option<String>>,
    ///Optional notes, at most 4000 characters.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub notes: Option<Option<String>>,
    ///Timed events: inclusive start instant, RFC 3339 with an explicit offset (e.g. 2026-10-26T14:00:00Z); `null` for all-day events.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub start: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///All-day events: first date (YYYY-MM-DD); `null` for timed events.
    #[serde(
        rename = "startDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub start_date: Option<Option<chrono::NaiveDate>>,
    ///Timed events: IANA time zone the event was created in, e.g. America/New_York; `null` for all-day events.
    #[serde(
        rename = "timeZone",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub time_zone: Option<Option<String>>,
    ///Event title; required, at most 200 characters after trimming.
    pub title: String,
}
impl CreateEventRequest {
    /// Construct this request with every required wire field.
    pub fn new(title: String) -> Self {
        Self {
            title,
            all_day: None,
            end: None,
            end_date: None,
            location: None,
            notes: None,
            start: None,
            start_date: None,
            time_zone: None,
        }
    }
    /// Start a dependency-free builder with every required wire field.
    pub fn builder(title: String) -> CreateEventRequestBuilder {
        CreateEventRequestBuilder::new(title)
    }
}
/// Dependency-free builder for [`#struct_name`].
#[derive(Debug, Clone)]
#[must_use]
pub struct CreateEventRequestBuilder {
    value: CreateEventRequest,
}
impl CreateEventRequestBuilder {
    /// Start a builder with every required wire field.
    pub fn new(title: String) -> Self {
        Self {
            value: CreateEventRequest::new(title),
        }
    }
    #[doc = concat!("Set the optional `", "allDay", "` request field.")]
    #[must_use]
    pub fn all_day(mut self, all_day: bool) -> Self {
        self.value.all_day = Some(all_day);
        self
    }
    #[doc = concat!("Set the optional nullable `", "end", "` request field to a value.")]
    #[must_use]
    pub fn end(mut self, end: chrono::DateTime<chrono::Utc>) -> Self {
        self.value.end = Some(Some(end));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "end", "` request field to JSON null."
    )]
    #[must_use]
    pub fn end_null(mut self) -> Self {
        self.value.end = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "end", "` request field.")]
    #[must_use]
    pub fn end_absent(mut self) -> Self {
        self.value.end = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "endDate", "` request field to a value."
    )]
    #[must_use]
    pub fn end_date(mut self, end_date: chrono::NaiveDate) -> Self {
        self.value.end_date = Some(Some(end_date));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "endDate", "` request field to JSON null."
    )]
    #[must_use]
    pub fn end_date_null(mut self) -> Self {
        self.value.end_date = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "endDate", "` request field.")]
    #[must_use]
    pub fn end_date_absent(mut self) -> Self {
        self.value.end_date = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "location", "` request field to a value."
    )]
    #[must_use]
    pub fn location(mut self, location: String) -> Self {
        self.value.location = Some(Some(location));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "location", "` request field to JSON null."
    )]
    #[must_use]
    pub fn location_null(mut self) -> Self {
        self.value.location = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "location", "` request field.")]
    #[must_use]
    pub fn location_absent(mut self) -> Self {
        self.value.location = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to a value."
    )]
    #[must_use]
    pub fn notes(mut self, notes: String) -> Self {
        self.value.notes = Some(Some(notes));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to JSON null."
    )]
    #[must_use]
    pub fn notes_null(mut self) -> Self {
        self.value.notes = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "notes", "` request field.")]
    #[must_use]
    pub fn notes_absent(mut self) -> Self {
        self.value.notes = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "start", "` request field to a value."
    )]
    #[must_use]
    pub fn start(mut self, start: chrono::DateTime<chrono::Utc>) -> Self {
        self.value.start = Some(Some(start));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "start", "` request field to JSON null."
    )]
    #[must_use]
    pub fn start_null(mut self) -> Self {
        self.value.start = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "start", "` request field.")]
    #[must_use]
    pub fn start_absent(mut self) -> Self {
        self.value.start = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "startDate", "` request field to a value."
    )]
    #[must_use]
    pub fn start_date(mut self, start_date: chrono::NaiveDate) -> Self {
        self.value.start_date = Some(Some(start_date));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "startDate", "` request field to JSON null."
    )]
    #[must_use]
    pub fn start_date_null(mut self) -> Self {
        self.value.start_date = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "startDate", "` request field.")]
    #[must_use]
    pub fn start_date_absent(mut self) -> Self {
        self.value.start_date = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "timeZone", "` request field to a value."
    )]
    #[must_use]
    pub fn time_zone(mut self, time_zone: String) -> Self {
        self.value.time_zone = Some(Some(time_zone));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "timeZone", "` request field to JSON null."
    )]
    #[must_use]
    pub fn time_zone_null(mut self) -> Self {
        self.value.time_zone = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "timeZone", "` request field.")]
    #[must_use]
    pub fn time_zone_absent(mut self) -> Self {
        self.value.time_zone = None;
        self
    }
    /// Finish building the request model.
    pub fn build(self) -> CreateEventRequest {
        self.value
    }
}
///Create a task, optionally due on a floating date or at an instant (not both).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CreateTaskRequest {
    ///Due instant, RFC 3339 with an explicit offset; mutually exclusive with `dueDate`.
    #[serde(
        rename = "dueAt",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    ///Floating due date (YYYY-MM-DD); mutually exclusive with `dueAt`.
    #[serde(
        rename = "dueDate",
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub due_date: Option<Option<chrono::NaiveDate>>,
    ///Optional notes, at most 4000 characters after trimming.
    #[serde(
        skip_serializing_if = "Option::is_none",
        default,
        deserialize_with = "tri_state_serde::deserialize"
    )]
    pub notes: Option<Option<String>>,
    ///Priority level; defaults to medium. Allowed values: low, medium, high.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    ///Task title; required, at most 200 characters after trimming.
    pub title: String,
}
impl CreateTaskRequest {
    /// Construct this request with every required wire field.
    pub fn new(title: String) -> Self {
        Self {
            title,
            due_at: None,
            due_date: None,
            notes: None,
            priority: None,
        }
    }
    /// Start a dependency-free builder with every required wire field.
    pub fn builder(title: String) -> CreateTaskRequestBuilder {
        CreateTaskRequestBuilder::new(title)
    }
}
/// Dependency-free builder for [`#struct_name`].
#[derive(Debug, Clone)]
#[must_use]
pub struct CreateTaskRequestBuilder {
    value: CreateTaskRequest,
}
impl CreateTaskRequestBuilder {
    /// Start a builder with every required wire field.
    pub fn new(title: String) -> Self {
        Self {
            value: CreateTaskRequest::new(title),
        }
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueAt", "` request field to a value."
    )]
    #[must_use]
    pub fn due_at(mut self, due_at: chrono::DateTime<chrono::Utc>) -> Self {
        self.value.due_at = Some(Some(due_at));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueAt", "` request field to JSON null."
    )]
    #[must_use]
    pub fn due_at_null(mut self) -> Self {
        self.value.due_at = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "dueAt", "` request field.")]
    #[must_use]
    pub fn due_at_absent(mut self) -> Self {
        self.value.due_at = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueDate", "` request field to a value."
    )]
    #[must_use]
    pub fn due_date(mut self, due_date: chrono::NaiveDate) -> Self {
        self.value.due_date = Some(Some(due_date));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "dueDate", "` request field to JSON null."
    )]
    #[must_use]
    pub fn due_date_null(mut self) -> Self {
        self.value.due_date = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "dueDate", "` request field.")]
    #[must_use]
    pub fn due_date_absent(mut self) -> Self {
        self.value.due_date = None;
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to a value."
    )]
    #[must_use]
    pub fn notes(mut self, notes: String) -> Self {
        self.value.notes = Some(Some(notes));
        self
    }
    #[doc = concat!(
        "Set the optional nullable `", "notes", "` request field to JSON null."
    )]
    #[must_use]
    pub fn notes_null(mut self) -> Self {
        self.value.notes = Some(None);
        self
    }
    #[doc = concat!("Omit the optional nullable `", "notes", "` request field.")]
    #[must_use]
    pub fn notes_absent(mut self) -> Self {
        self.value.notes = None;
        self
    }
    #[doc = concat!("Set the optional `", "priority", "` request field.")]
    #[must_use]
    pub fn priority(mut self, priority: String) -> Self {
        self.value.priority = Some(priority);
        self
    }
    /// Finish building the request model.
    pub fn build(self) -> CreateTaskRequest {
        self.value
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HealthResponse {
    pub status: String,
}
///Redeem a native sign-in's handover code for a session (the desktop app's loopback sign-in, ADR-0068).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NativeSessionRequest {
    ///The `code` the API sent to the app's loopback redirect after the person confirmed the sign-in.
    pub code: String,
    ///The PKCE code verifier whose S256 challenge the app sent to `GET /api/auth/native/start`.
    #[serde(rename = "codeVerifier")]
    pub code_verifier: String,
    ///The loopback redirect URI the app sent to `GET /api/auth/native/start`.
    #[serde(rename = "redirectUri")]
    pub redirect_uri: String,
}
