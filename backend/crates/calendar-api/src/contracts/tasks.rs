use calendar_domain::tasks::TodoTask;
use calendar_infrastructure::agenda::AgendaTaskRow;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::json::{self, FromJson, JsonError, JsonResult};
use crate::wire;

/// The priority a request has when it names none.
const DEFAULT_PRIORITY: &str = "medium";

fn default_priority() -> String {
  DEFAULT_PRIORITY.to_owned()
}

/// A property of a task request body.
#[derive(Debug, Clone, Copy)]
enum TaskProperty {
  Title,
  Priority,
  Notes,
  DueDate,
  DueAt,
  Version,
}

/// The properties every task request has, in declaration order.
const TASK_PROPERTIES: [(&str, TaskProperty); 5] = [
  ("title", TaskProperty::Title),
  ("priority", TaskProperty::Priority),
  ("notes", TaskProperty::Notes),
  ("dueDate", TaskProperty::DueDate),
  ("dueAt", TaskProperty::DueAt),
];

/// The property an update request adds after the shared ones.
const VERSION_PROPERTY: [(&str, TaskProperty); 1] = [("version", TaskProperty::Version)];

struct TaskFields {
  title: Option<String>,
  priority: Option<String>,
  notes: Option<String>,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
}

/// What a task body held, before its required properties are checked.
struct TaskBody {
  fields: TaskFields,
  has_title: bool,
  version: Option<u32>,
}

/// Reads the shared task properties and the `extra` ones; any other property is skipped.
fn read_task_body(value: &Value, path: &str, type_name: &str, extra: &[(&'static str, TaskProperty)]) -> JsonResult<TaskBody> {
  let mut body = TaskBody {
    fields: TaskFields {
      title: None,
      priority: Some(default_priority()),
      notes: None,
      due_date: None,
      due_at: None,
    },
    has_title: false,
    version: None,
  };
  let fields = &mut body.fields;
  for (key, value) in json::object(value, path, type_name)? {
    let Some((name, property)) = json::property(TASK_PROPERTIES.iter().chain(extra), key) else {
      continue;
    };
    let at = json::child(path, name);
    match property {
      TaskProperty::Title => {
        fields.title = json::string(value, &at)?;
        body.has_title = true;
      }
      TaskProperty::Priority => fields.priority = json::string(value, &at)?,
      TaskProperty::Notes => fields.notes = json::string(value, &at)?,
      TaskProperty::DueDate => fields.due_date = json::date_opt(value, &at)?,
      TaskProperty::DueAt => fields.due_at = json::instant_opt(value, &at)?,
      TaskProperty::Version => body.version = Some(json::uint32(value, &at)?),
    }
  }
  Ok(body)
}

/// Reads the task fields of a create request; `version` is not one of its properties.
fn read_task(value: &Value, path: &str, type_name: &str) -> JsonResult<TaskFields> {
  let body = read_task_body(value, path, type_name, &[])?;
  if body.has_title {
    Ok(body.fields)
  } else {
    Err(json::missing_required(path, type_name, &["title"]))
  }
}

/// Reads the task fields and the required `version` of an update request.
fn read_versioned_task(value: &Value, path: &str, type_name: &str) -> JsonResult<(TaskFields, u32)> {
  let body = read_task_body(value, path, type_name, &VERSION_PROPERTY)?;
  match (body.has_title, body.version) {
    (true, Some(version)) => Ok((body.fields, version)),
    (has_title, version) => {
      let missing: Vec<&str> = [(!has_title).then_some("title"), version.is_none().then_some("version")]
        .into_iter()
        .flatten()
        .collect();
      Err(json::missing_required(path, type_name, &missing))
    }
  }
}

/// Create a task, optionally due on a floating date or at an instant (not both).
#[derive(Debug, Clone, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub struct CreateTaskRequest {
  /// Task title; required, at most 200 characters after trimming.
  #[schema(value_type = String)]
  pub title: Option<String>,

  /// Priority level; defaults to medium. Allowed values: low, medium, high.
  #[schema(value_type = String, required = false)]
  pub priority: Option<String>,

  /// Optional notes, at most 4000 characters after trimming.
  pub notes: Option<String>,

  /// Floating due date (YYYY-MM-DD); mutually exclusive with `dueAt`.
  pub due_date: Option<NaiveDate>,

  /// Due instant, RFC 3339 with an explicit offset; mutually exclusive with `dueDate`.
  pub due_at: Option<DateTime<Utc>>,
}

impl FromJson for CreateTaskRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.CreateTaskRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let fields = read_task(value, path, Self::TYPE_NAME)?;
    Ok(Self {
      title: fields.title,
      priority: fields.priority,
      notes: fields.notes,
      due_date: fields.due_date,
      due_at: fields.due_at,
    })
  }
}

/// Replace a task's title, deadline, priority and notes, by the rules of `CreateTaskRequest`, plus the
/// `version` the client loaded. Neither deadline field clears the deadline. Completion is not changed.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
  /// Task title; required, at most 200 characters after trimming.
  #[schema(value_type = String)]
  pub title: Option<String>,

  /// Priority level; defaults to medium. Allowed values: low, medium, high.
  #[schema(value_type = String, required = false)]
  pub priority: Option<String>,

  /// Optional notes, at most 4000 characters after trimming.
  pub notes: Option<String>,

  /// Floating due date (YYYY-MM-DD); mutually exclusive with `dueAt`.
  pub due_date: Option<NaiveDate>,

  /// Due instant, RFC 3339 with an explicit offset; mutually exclusive with `dueDate`.
  pub due_at: Option<DateTime<Utc>>,

  /// The task's `version` as last read; the update is refused with `409` when the task has changed
  /// since.
  pub version: u32,
}

impl FromJson for UpdateTaskRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.UpdateTaskRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let (fields, version) = read_versioned_task(value, path, Self::TYPE_NAME)?;
    Ok(Self {
      title: fields.title,
      priority: fields.priority,
      notes: fields.notes,
      due_date: fields.due_date,
      due_at: fields.due_at,
      version,
    })
  }
}

/// A task as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskResponse {
  /// Unique task id.
  pub id: Uuid,

  /// Task title.
  pub title: String,

  /// Priority level: low, medium, or high.
  #[serde(default = "default_priority")]
  #[schema(required = false)]
  pub priority: String,

  /// Optional task notes.
  pub notes: Option<String>,

  /// Floating due date, or `null` if the task has no date-only due.
  pub due_date: Option<NaiveDate>,

  /// Due instant, or `null` if the task has no timed due.
  #[serde(serialize_with = "wire::instant_opt")]
  pub due_at: Option<DateTime<Utc>>,

  /// When the task was completed; `null` while it is open.
  #[serde(serialize_with = "wire::instant_opt")]
  pub completed_at: Option<DateTime<Utc>>,

  /// `true` once the task has been completed.
  pub is_completed: bool,

  /// Opaque version of the stored task; send it back to update the task.
  pub version: u32,
}

impl TaskResponse {
  /// Maps a task to its response, with the `version` of its row.
  pub fn from_task(task: &TodoTask, version: u32) -> Self {
    Self {
      id: task.id(),
      title: task.title().to_owned(),
      priority: task.priority().as_str().to_owned(),
      notes: task.notes().map(str::to_owned),
      due_date: task.due_date(),
      due_at: task.due_at(),
      completed_at: task.completed_at(),
      is_completed: task.is_completed(),
      version,
    }
  }
}

/// A task in an agenda.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgendaTaskItem {
  /// Unique task id.
  pub id: Uuid,

  /// Task title.
  pub title: String,

  /// Priority level: low, medium, or high.
  #[serde(default = "default_priority")]
  #[schema(required = false)]
  pub priority: String,

  /// Whether the task has notes.
  pub has_notes: bool,

  /// Floating due date, or `null` if the task has no date-only due.
  pub due_date: Option<NaiveDate>,

  /// Due instant, or `null` if the task has no timed due.
  #[serde(serialize_with = "wire::instant_opt")]
  pub due_at: Option<DateTime<Utc>>,

  /// When the task was completed; `null` while it is open.
  #[serde(serialize_with = "wire::instant_opt")]
  pub completed_at: Option<DateTime<Utc>>,

  /// `true` once the task has been completed.
  pub is_completed: bool,
}

impl From<AgendaTaskRow> for AgendaTaskItem {
  fn from(row: AgendaTaskRow) -> Self {
    Self {
      id: row.id,
      title: row.title,
      priority: row.priority.as_str().to_owned(),
      has_notes: row.has_notes,
      due_date: row.due_date,
      due_at: row.due_at,
      completed_at: row.completed_at,
      is_completed: row.completed_at.is_some(),
    }
  }
}

/// One page of a task list view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPage {
  /// The page's tasks, in the view's order.
  pub items: Vec<TaskResponse>,

  /// Pass as `cursor` for the next page; `null` on the last page.
  pub next_cursor: Option<String>,

  /// Total open overdue tasks, provided on the first overdue page only.
  pub total: Option<i32>,
}

/// Apply one action to explicit task ids or a guarded overdue filter. Explicit ids return per-task results;
/// filter targets return no per-task results and use the aggregate counts.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub struct BulkTaskRequest {
  /// Action to apply.
  #[schema(value_type = BulkTaskAction)]
  pub action: Option<BulkTaskAction>,

  /// Explicit task ids; mutually exclusive with OverdueTaskFilter? BulkTaskRequest.Filter.
  pub ids: Option<Vec<Uuid>>,

  /// Overdue filter target; mutually exclusive with IReadOnlyList&lt;Guid&gt;? BulkTaskRequest.Ids.
  pub filter: Option<OverdueTaskFilter>,

  /// New floating deadline, required for setDueDate.
  pub due_date: Option<NaiveDate>,

  /// New deadline instant, required for setDueInstant.
  pub due_at: Option<DateTime<Utc>>,
}

/// A property of a bulk request body.
#[derive(Debug, Clone, Copy)]
enum BulkProperty {
  Action,
  Ids,
  Filter,
  DueDate,
  DueAt,
}

/// The properties of a bulk request, in declaration order.
const BULK_PROPERTIES: [(&str, BulkProperty); 5] = [
  ("action", BulkProperty::Action),
  ("ids", BulkProperty::Ids),
  ("filter", BulkProperty::Filter),
  ("dueDate", BulkProperty::DueDate),
  ("dueAt", BulkProperty::DueAt),
];

impl FromJson for BulkTaskRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.BulkTaskRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let mut action = None;
    let (mut ids, mut filter, mut due_date, mut due_at) = (None, None, None, None);
    for (key, value) in json::object(value, path, Self::TYPE_NAME)? {
      let Some((name, property)) = json::property(&BULK_PROPERTIES, key) else {
        continue;
      };
      let at = json::child(path, name);
      match property {
        BulkProperty::Action => action = Some(read_action(value, &at)?),
        BulkProperty::Ids => ids = read_ids(value, &at)?,
        BulkProperty::Filter => {
          filter = if value.is_null() {
            None
          } else {
            Some(OverdueTaskFilter::from_json(value, &at)?)
          }
        }
        BulkProperty::DueDate => due_date = json::date_opt(value, &at)?,
        BulkProperty::DueAt => due_at = json::instant_opt(value, &at)?,
      }
    }

    let Some(action) = action else {
      return Err(json::missing_required(path, Self::TYPE_NAME, &["action"]));
    };
    Ok(Self {
      action,
      ids,
      filter,
      due_date,
      due_at,
    })
  }
}

fn read_ids(value: &Value, path: &str) -> JsonResult<Option<Vec<Uuid>>> {
  match value {
    Value::Null => Ok(None),
    Value::Array(items) => items
      .iter()
      .enumerate()
      .map(|(index, item)| json::guid(item, &format!("{path}[{index}]")))
      .collect::<JsonResult<Vec<_>>>()
      .map(Some),
    _ => Err(JsonError::conversion(
      path,
      "System.Collections.Generic.IReadOnlyList`1[System.Guid]",
    )),
  }
}

/// Supported bulk task actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub enum BulkTaskAction {
  /// Complete an open task.
  Complete,

  /// Set a floating due date.
  SetDueDate,

  /// Set a due instant.
  SetDueInstant,

  /// Clear the task deadline.
  ClearDeadline,

  /// Delete the task.
  Delete,
}

impl BulkTaskAction {
  const NAMES: [(&'static str, Self); 5] = [
    ("complete", Self::Complete),
    ("setDueDate", Self::SetDueDate),
    ("setDueInstant", Self::SetDueInstant),
    ("clearDeadline", Self::ClearDeadline),
    ("delete", Self::Delete),
  ];
}

/// Reads an action: a member name (case-sensitive), or the member's number as a JSON number or numeric
/// string. .NET read any `int` into the enum, so a number that names no member is `None`, which the endpoint
/// then refuses with "Action is not supported."
fn read_action(value: &Value, path: &str) -> JsonResult<Option<BulkTaskAction>> {
  if let Some((_, action)) = value
    .as_str()
    .and_then(|text| BulkTaskAction::NAMES.iter().find(|(name, _)| *name == text))
  {
    return Ok(Some(*action));
  }
  match json::enum_number(value) {
    Some(number) if i32::try_from(number).is_ok() => Ok(
      usize::try_from(number)
        .ok()
        .and_then(|index| BulkTaskAction::NAMES.get(index))
        .map(|(_, action)| *action),
    ),
    _ => Err(JsonError::conversion(path, "Calendar.Api.Contracts.BulkTaskAction")),
  }
}

/// Guarded overdue query and the count the client observed.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub struct OverdueTaskFilter {
  /// The only supported filtered view.
  #[schema(value_type = String)]
  pub view: Option<String>,

  /// Client's current date.
  pub today: NaiveDate,

  /// Client's IANA time zone.
  #[schema(value_type = String)]
  pub time_zone: Option<String>,

  /// Expected number of matching overdue tasks.
  pub expected_total: i32,
}

/// A property of an overdue filter.
#[derive(Debug, Clone, Copy)]
enum FilterProperty {
  View,
  Today,
  TimeZone,
  ExpectedTotal,
}

/// The properties of an overdue filter, in declaration order.
const FILTER_PROPERTIES: [(&str, FilterProperty); 4] = [
  ("view", FilterProperty::View),
  ("today", FilterProperty::Today),
  ("timeZone", FilterProperty::TimeZone),
  ("expectedTotal", FilterProperty::ExpectedTotal),
];

impl FromJson for OverdueTaskFilter {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.OverdueTaskFilter";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let (mut view, mut today, mut time_zone, mut expected_total) = (None, None, None, None);
    for (key, value) in json::object(value, path, Self::TYPE_NAME)? {
      let Some((name, property)) = json::property(&FILTER_PROPERTIES, key) else {
        continue;
      };
      let at = json::child(path, name);
      match property {
        FilterProperty::View => view = Some(json::string(value, &at)?),
        FilterProperty::Today => today = Some(json::date(value, &at)?),
        FilterProperty::TimeZone => time_zone = Some(json::string(value, &at)?),
        FilterProperty::ExpectedTotal => expected_total = Some(json::int32(value, &at)?),
      }
    }

    match (view, today, time_zone, expected_total) {
      (Some(view), Some(today), Some(time_zone), Some(expected_total)) => Ok(Self {
        view,
        today,
        time_zone,
        expected_total,
      }),
      (view, today, time_zone, expected_total) => {
        let present = [view.is_some(), today.is_some(), time_zone.is_some(), expected_total.is_some()];
        let missing: Vec<&str> = FILTER_PROPERTIES
          .into_iter()
          .zip(present)
          .filter_map(|((name, _), present)| (!present).then_some(name))
          .collect();
        Err(json::missing_required(path, Self::TYPE_NAME, &missing))
      }
    }
  }
}

/// Outcome for one requested task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkTaskItemResult {
  /// Task id.
  pub id: Uuid,

  /// applied, skipped or notFound.
  pub outcome: String,
}

/// Bulk action outcomes and totals. Explicit-id targets return one result per distinct id; filter targets return
/// an empty results array, with int BulkTaskResponse.Applied equal to the number of rows changed or deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkTaskResponse {
  /// One outcome per distinct explicit id; empty for a filter target.
  pub results: Vec<BulkTaskItemResult>,

  /// Number of applied actions, or rows changed/deleted for a filter target.
  pub applied: i32,

  /// Number of skipped actions.
  pub skipped: i32,

  /// Number of ids that were not found.
  pub not_found: i32,
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn missing(type_name: &str, names: &str) -> String {
    format!("JSON deserialization for type 'Calendar.Api.Contracts.{type_name}' was missing required properties including: {names}.")
  }

  #[test]
  fn a_create_request_needs_a_title_and_ignores_version() {
    let error = CreateTaskRequest::from_json(&json!({ "notes": "n" }), "$").unwrap_err();
    assert_eq!(error.message, missing("CreateTaskRequest", "'title'"));

    let request = CreateTaskRequest::from_json(&json!({ "Title": "t", "version": "not a number" }), "$").unwrap();
    assert_eq!((request.title.as_deref(), request.priority.as_deref()), (Some("t"), Some("medium")));
  }

  #[test]
  fn an_update_request_needs_a_title_and_a_version() {
    for (body, names) in [
      (json!({}), "'title', 'version'"),
      (json!({ "title": "t" }), "'version'"),
      (json!({ "version": 3 }), "'title'"),
    ] {
      let error = UpdateTaskRequest::from_json(&body, "$").unwrap_err();
      assert_eq!(error.message, missing("UpdateTaskRequest", names), "{body}");
    }

    let request = UpdateTaskRequest::from_json(&json!({ "title": "t", "VERSION": 7, "priority": "high" }), "$").unwrap();
    assert_eq!((request.version, request.priority.as_deref()), (7, Some("high")));
  }

  #[test]
  fn a_bulk_request_reads_every_property_and_its_filter() {
    let request = BulkTaskRequest::from_json(
      &json!({
        "action": "setDueInstant",
        "dueAt": "2026-10-26T15:00:00Z",
        "dueDate": "2026-10-26",
        "filter": { "view": "overdue", "today": "2026-10-26", "timeZone": "UTC", "expectedTotal": 2 },
      }),
      "$",
    )
    .unwrap();
    assert_eq!(request.action, Some(BulkTaskAction::SetDueInstant));
    assert!(request.due_at.is_some() && request.due_date.is_some());
    assert_eq!(request.filter.map(|filter| filter.expected_total), Some(2));

    let error = BulkTaskRequest::from_json(&json!({ "action": "delete", "filter": { "view": "overdue" } }), "$").unwrap_err();
    assert_eq!(error.message, missing("OverdueTaskFilter", "'today', 'timeZone', 'expectedTotal'"));
  }
}
