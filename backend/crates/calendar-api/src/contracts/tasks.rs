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

const TASK_PROPERTIES: [&str; 6] = ["title", "priority", "notes", "dueDate", "dueAt", "version"];

struct TaskFields {
  title: Option<String>,
  priority: Option<String>,
  notes: Option<String>,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
  version: Option<u32>,
}

fn read_task(value: &Value, path: &str, type_name: &str, with_version: bool) -> JsonResult<TaskFields> {
  let properties = if with_version {
    &TASK_PROPERTIES[..]
  } else {
    &TASK_PROPERTIES[..5]
  };
  let mut fields = TaskFields {
    title: None,
    priority: Some(default_priority()),
    notes: None,
    due_date: None,
    due_at: None,
    version: None,
  };
  let mut has_title = false;
  for (key, value) in json::object(value, path, type_name)? {
    let Some(name) = json::property(properties, key) else {
      continue;
    };
    let at = json::child(path, name);
    match name {
      "title" => {
        fields.title = json::string(value, &at)?;
        has_title = true;
      }
      "priority" => fields.priority = json::string(value, &at)?,
      "notes" => fields.notes = json::string(value, &at)?,
      "dueDate" => fields.due_date = json::date_opt(value, &at)?,
      "dueAt" => fields.due_at = json::instant_opt(value, &at)?,
      _ => fields.version = Some(json::uint32(value, &at)?),
    }
  }

  let mut missing = Vec::new();
  if !has_title {
    missing.push("title");
  }
  if with_version && fields.version.is_none() {
    missing.push("version");
  }
  if missing.is_empty() {
    Ok(fields)
  } else {
    Err(json::missing_required(path, type_name, &missing))
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
    let fields = read_task(value, path, Self::TYPE_NAME, false)?;
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
    let fields = read_task(value, path, Self::TYPE_NAME, true)?;
    Ok(Self {
      title: fields.title,
      priority: fields.priority,
      notes: fields.notes,
      due_date: fields.due_date,
      due_at: fields.due_at,
      version: fields.version.unwrap_or_default(),
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

impl FromJson for BulkTaskRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.BulkTaskRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let mut action = None;
    let (mut ids, mut filter, mut due_date, mut due_at) = (None, None, None, None);
    for (key, value) in json::object(value, path, Self::TYPE_NAME)? {
      let Some(name) = json::property(&["action", "ids", "filter", "dueDate", "dueAt"], key) else {
        continue;
      };
      let at = json::child(path, name);
      match name {
        "action" => action = Some(read_action(value, &at)?),
        "ids" => ids = read_ids(value, &at)?,
        "filter" => {
          filter = if value.is_null() {
            None
          } else {
            Some(OverdueTaskFilter::from_json(value, &at)?)
          }
        }
        "dueDate" => due_date = json::date_opt(value, &at)?,
        _ => due_at = json::instant_opt(value, &at)?,
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

impl FromJson for OverdueTaskFilter {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.OverdueTaskFilter";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let (mut view, mut today, mut time_zone, mut expected_total) = (None, None, None, None);
    for (key, value) in json::object(value, path, Self::TYPE_NAME)? {
      let Some(name) = json::property(&["view", "today", "timeZone", "expectedTotal"], key) else {
        continue;
      };
      let at = json::child(path, name);
      match name {
        "view" => view = Some(json::string(value, &at)?),
        "today" => today = Some(json::date(value, &at)?),
        "timeZone" => time_zone = Some(json::string(value, &at)?),
        _ => expected_total = Some(json::int32(value, &at)?),
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
        let missing: Vec<&str> = ["view", "today", "timeZone", "expectedTotal"]
          .into_iter()
          .zip(present)
          .filter_map(|(name, present)| (!present).then_some(name))
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
