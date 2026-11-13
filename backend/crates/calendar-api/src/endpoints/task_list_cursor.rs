//! The opaque `cursor` of the task list: the view and the key of a page's last task, as base64url JSON
//! (ports `TaskListCursor.cs`, in the same format, so a cursor issued by the .NET API still continues its
//! list). A cursor only continues the view it was issued for.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use calendar_infrastructure::queries::task_list::TaskListKey;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::wire;

/// Which task list a request or a cursor is for. The numbers are the cursor's `View` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskListViewKind {
  /// `upcoming`
  Upcoming = 0,
  /// `overdue`
  Overdue = 1,
  /// `completed`
  Completed = 2,
  /// `no-deadline`
  NoDeadline = 3,
}

impl TaskListViewKind {
  /// The view a `view` query value names, exactly as written.
  pub fn parse(view: &str) -> Option<Self> {
    match view {
      "upcoming" => Some(Self::Upcoming),
      "overdue" => Some(Self::Overdue),
      "completed" => Some(Self::Completed),
      "no-deadline" => Some(Self::NoDeadline),
      _ => None,
    }
  }

  /// Whether the view depends on the client's `today` and `timeZone`.
  pub fn is_dated(self) -> bool {
    matches!(self, Self::Upcoming | Self::Overdue)
  }

  fn number(self) -> i64 {
    self as i64
  }
}

impl TryFrom<i64> for TaskListViewKind {
  /// The number, when no view has it.
  type Error = i64;

  /// The view a cursor's `View` number names.
  fn try_from(number: i64) -> Result<Self, Self::Error> {
    match number {
      0 => Ok(Self::Upcoming),
      1 => Ok(Self::Overdue),
      2 => Ok(Self::Completed),
      3 => Ok(Self::NoDeadline),
      _ => Err(number),
    }
  }
}

/// The cursor that continues `view` after the task with `key`.
pub fn encode(view: TaskListViewKind, key: &TaskListKey) -> String {
  let mut payload = Map::new();
  payload.insert("View".to_owned(), json!(view.number()));
  payload.insert("Id".to_owned(), json!(key.id.to_string()));
  payload.insert("DueDate".to_owned(), json!(key.due_date.map(|date| date.to_string())));
  payload.insert("Instant".to_owned(), json!(key.instant.map(wire::format_instant)));
  URL_SAFE_NO_PAD.encode(Value::Object(payload).to_string())
}

/// Decodes a cursor issued for `view`; `None` when it is malformed, incomplete or for another view.
pub fn try_decode(cursor: &str, view: TaskListViewKind) -> Option<TaskListKey> {
  let bytes = URL_SAFE_NO_PAD.decode(cursor.trim_end_matches('=')).ok()?;
  let payload: Value = serde_json::from_slice(&bytes).ok()?;
  let payload = payload.as_object()?;

  let issued_for = TaskListViewKind::try_from(payload.get("View").map_or(Some(0), Value::as_i64)?).ok()?;
  let id = match payload.get("Id") {
    Some(value) => crate::json::guid(value, "$.Id").ok()?,
    None => Uuid::nil(),
  };
  let due_date = match payload.get("DueDate") {
    None | Some(Value::Null) => None,
    Some(value) => Some(wire::parse_date(value.as_str()?)?),
  };
  let instant = match payload.get("Instant") {
    None | Some(Value::Null) => None,
    Some(value) => Some(wire::parse_explicit_offset(value.as_str()?)?),
  };

  let complete = !id.is_nil()
    && match issued_for {
      TaskListViewKind::Upcoming | TaskListViewKind::Overdue => due_date.is_some(),
      TaskListViewKind::Completed => instant.is_some(),
      TaskListViewKind::NoDeadline => true,
    };
  (complete && issued_for == view).then_some(TaskListKey { id, due_date, instant })
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::{NaiveDate, TimeZone, Utc};

  fn key() -> TaskListKey {
    TaskListKey {
      id: Uuid::from_u128(0x1234),
      due_date: NaiveDate::from_ymd_opt(2026, 10, 26),
      instant: Some(Utc.with_ymd_and_hms(2026, 10, 26, 15, 0, 0).unwrap()),
    }
  }

  #[test]
  fn a_view_number_converts_back_to_its_view() {
    for view in [
      TaskListViewKind::Upcoming,
      TaskListViewKind::Overdue,
      TaskListViewKind::Completed,
      TaskListViewKind::NoDeadline,
    ] {
      assert_eq!(TaskListViewKind::try_from(view.number()), Ok(view));
    }
    assert_eq!(TaskListViewKind::try_from(4), Err(4));
    assert_eq!(TaskListViewKind::try_from(-1), Err(-1));
  }

  #[test]
  fn a_cursor_round_trips_for_its_view_only() {
    let cursor = encode(TaskListViewKind::Upcoming, &key());
    assert_eq!(try_decode(&cursor, TaskListViewKind::Upcoming), Some(key()));
    assert_eq!(try_decode(&cursor, TaskListViewKind::Overdue), None);
    assert_eq!(try_decode(&cursor, TaskListViewKind::Completed), None);
  }

  #[test]
  fn the_format_is_the_dotnet_one() {
    let cursor = encode(TaskListViewKind::Completed, &TaskListKey { due_date: None, ..key() });
    let json = String::from_utf8(URL_SAFE_NO_PAD.decode(&cursor).unwrap()).unwrap();
    assert_eq!(
      json,
      r#"{"View":2,"Id":"00000000-0000-0000-0000-000000001234","DueDate":null,"Instant":"2026-10-26T15:00:00+00:00"}"#
    );
    // A cursor the .NET API issued (base64url of the same JSON) decodes.
    assert_eq!(
      try_decode(&cursor, TaskListViewKind::Completed),
      Some(TaskListKey { due_date: None, ..key() })
    );
  }

  #[test]
  fn incomplete_and_malformed_cursors_are_refused() {
    let encode_json = |json: &str| URL_SAFE_NO_PAD.encode(json);
    for (json, view) in [
      (
        r#"{"View":0,"Id":"00000000-0000-0000-0000-000000000000","DueDate":"2026-10-26","Instant":null}"#,
        TaskListViewKind::Upcoming,
      ),
      (
        r#"{"View":0,"Id":"00000000-0000-0000-0000-000000001234","DueDate":null,"Instant":null}"#,
        TaskListViewKind::Upcoming,
      ),
      (
        r#"{"View":1,"Id":"00000000-0000-0000-0000-000000001234","DueDate":null,"Instant":null}"#,
        TaskListViewKind::Overdue,
      ),
      (
        r#"{"View":2,"Id":"00000000-0000-0000-0000-000000001234","DueDate":null,"Instant":null}"#,
        TaskListViewKind::Completed,
      ),
      (
        r#"{"View":3,"Id":"nope","DueDate":null,"Instant":null}"#,
        TaskListViewKind::NoDeadline,
      ),
      (
        r#"{"View":"3","Id":"00000000-0000-0000-0000-000000001234"}"#,
        TaskListViewKind::NoDeadline,
      ),
      (
        r#"{"View":4,"Id":"00000000-0000-0000-0000-000000001234"}"#,
        TaskListViewKind::NoDeadline,
      ),
      ("null", TaskListViewKind::NoDeadline),
      ("[]", TaskListViewKind::NoDeadline),
      ("not json", TaskListViewKind::NoDeadline),
    ] {
      assert_eq!(try_decode(&encode_json(json), view), None, "{json}");
    }
    assert_eq!(try_decode("", TaskListViewKind::Completed), None);
    assert_eq!(try_decode("xx", TaskListViewKind::Completed), None);
    assert_eq!(try_decode("!!!", TaskListViewKind::Completed), None);

    let no_deadline = encode_json(r#"{"View":3,"Id":"00000000-0000-0000-0000-000000001234"}"#);
    assert!(try_decode(&no_deadline, TaskListViewKind::NoDeadline).is_some());
  }
}
