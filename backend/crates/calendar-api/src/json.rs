//! Reads request bodies the way `System.Text.Json` did with ASP.NET Core's web defaults, so that a client
//! sees the same acceptance rules and the same error for the same body:
//!
//! - property names match ignoring case, unknown properties are ignored, and of two properties with the same
//!   name the later one wins;
//! - numbers may be written as strings (`"version": "7"`);
//! - a failure names the JSON path of the value (`$.dueDate`, `$.ids[0]`) and reads "The JSON value could not
//!   be converted to <.NET type>.";
//! - `required` properties are checked once the object has been read.
//!
//! Each request type implements [`FromJson`] by hand with the helpers here.

use axum::body::Bytes;
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::header::CONTENT_TYPE;
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::problem::Problem;
use crate::text::ordinal_ignore_case_eq;
use crate::wire;

/// The largest request body read, as Kestrel's default limit.
const MAX_BODY_BYTES: usize = 30_000_000;

/// The message of a `ExplicitOffsetConverter` failure.
pub const INSTANT_MESSAGE: &str = "Expected an instant with an explicit offset, e.g. 2026-10-26T14:00:00Z or 2026-10-26T10:00:00-04:00.";

/// Why a body could not be read: the JSON path of the offending value and the message for the client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonError {
  /// `$` for the document itself, else a path such as `$.filter.today` or `$.ids[0]`.
  pub path: String,
  /// The first line of the `JsonException` message .NET produced.
  pub message: String,
}

impl JsonError {
  /// A failure at `path`.
  pub fn new(path: &str, message: impl Into<String>) -> Self {
    Self {
      path: path.to_owned(),
      message: message.into(),
    }
  }

  /// "The JSON value could not be converted to `type_name`."
  pub fn conversion(path: &str, type_name: &str) -> Self {
    Self::new(path, format!("The JSON value could not be converted to {type_name}."))
  }

  /// The field name the problem response reports: the path without its leading `$.`.
  pub fn field(&self) -> &str {
    self.path.strip_prefix("$.").unwrap_or(&self.path)
  }
}

/// The result of reading a JSON value.
pub type JsonResult<T> = Result<T, JsonError>;

/// A request type read from a JSON object.
pub trait FromJson: Sized {
  /// The .NET type name error messages mention, e.g. `Calendar.Api.Contracts.CreateTaskRequest`.
  const TYPE_NAME: &'static str;

  /// Reads the value at `path`.
  fn from_json(value: &Value, path: &str) -> JsonResult<Self>;
}

/// The properties of the JSON object at `path`, in document order.
pub fn object<'a>(value: &'a Value, path: &str, type_name: &str) -> JsonResult<&'a Map<String, Value>> {
  value.as_object().ok_or_else(|| JsonError::conversion(path, type_name))
}

/// The declared property `key` names, ignoring case, or `None` for an unknown property.
pub fn property(names: &[&'static str], key: &str) -> Option<&'static str> {
  names.iter().copied().find(|name| ordinal_ignore_case_eq(name, key))
}

/// The path of property `name` of the object at `path`.
pub fn child(path: &str, name: &str) -> String {
  format!("{path}.{name}")
}

/// The failure of an object that lacks `required` properties, listing the `missing` ones in declaration order.
pub fn missing_required(path: &str, type_name: &str, missing: &[&str]) -> JsonError {
  let names: Vec<String> = missing.iter().map(|name| format!("'{name}'")).collect();
  JsonError::new(
    path,
    format!(
      "JSON deserialization for type '{type_name}' was missing required properties including: {}.",
      names.join(", ")
    ),
  )
}

/// A `string?`: text or `null`.
pub fn string(value: &Value, path: &str) -> JsonResult<Option<String>> {
  match value {
    Value::Null => Ok(None),
    Value::String(text) => Ok(Some(text.clone())),
    _ => Err(JsonError::conversion(path, "System.String")),
  }
}

/// A `bool`.
pub fn boolean(value: &Value, path: &str) -> JsonResult<bool> {
  value.as_bool().ok_or_else(|| JsonError::conversion(path, "System.Boolean"))
}

/// An integer written as a JSON number without fraction or exponent, or as a string holding one.
fn integer(value: &Value) -> Option<i128> {
  match value {
    Value::Number(number) => number.as_i64().map(i128::from).or_else(|| number.as_u64().map(i128::from)),
    Value::String(text) => {
      let digits = text.strip_prefix('-').unwrap_or(text);
      if digits.is_empty() || digits.len() > 20 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
      }
      text.parse().ok()
    }
    _ => None,
  }
}

/// A `uint`.
pub fn uint32(value: &Value, path: &str) -> JsonResult<u32> {
  integer(value)
    .and_then(|number| u32::try_from(number).ok())
    .ok_or_else(|| JsonError::conversion(path, "System.UInt32"))
}

/// An `int`.
pub fn int32(value: &Value, path: &str) -> JsonResult<i32> {
  integer(value)
    .and_then(|number| i32::try_from(number).ok())
    .ok_or_else(|| JsonError::conversion(path, "System.Int32"))
}

/// An integer of any size a JSON number or numeric string holds, for enum values; `None` when it is neither.
pub fn enum_number(value: &Value) -> Option<i128> {
  integer(value)
}

/// A `DateOnly?`: `YYYY-MM-DD` or `null`.
pub fn date_opt(value: &Value, path: &str) -> JsonResult<Option<NaiveDate>> {
  match value {
    Value::Null => Ok(None),
    other => date_as(other, path, "System.Nullable`1[System.DateOnly]").map(Some),
  }
}

/// A `DateOnly`: `YYYY-MM-DD`.
pub fn date(value: &Value, path: &str) -> JsonResult<NaiveDate> {
  date_as(value, path, "System.DateOnly")
}

fn date_as(value: &Value, path: &str, type_name: &str) -> JsonResult<NaiveDate> {
  value
    .as_str()
    .and_then(wire::parse_date)
    .ok_or_else(|| JsonError::conversion(path, type_name))
}

/// A `DateTimeOffset?` read by `ExplicitOffsetConverter`: an instant with an explicit offset, or `null`.
pub fn instant_opt(value: &Value, path: &str) -> JsonResult<Option<DateTime<Utc>>> {
  match value {
    Value::Null => Ok(None),
    other => other
      .as_str()
      .and_then(wire::parse_explicit_offset)
      .map(Some)
      .ok_or_else(|| JsonError::new(path, INSTANT_MESSAGE)),
  }
}

/// A `Guid` in its hyphenated form, the only one `System.Text.Json` reads.
pub fn guid(value: &Value, path: &str) -> JsonResult<Uuid> {
  value
    .as_str()
    .filter(|text| text.len() == 36)
    .and_then(|text| Uuid::try_parse(text).ok())
    .ok_or_else(|| JsonError::conversion(path, "System.Guid"))
}

/// Whether the request declares a JSON body: `application/json` or any `+json` media type.
pub fn has_json_content_type(headers: &HeaderMap) -> bool {
  headers
    .get(CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .and_then(|value| value.split(';').next())
    .map(str::trim)
    .is_some_and(|media| media.eq_ignore_ascii_case("application/json") || media.to_ascii_lowercase().ends_with("+json"))
}

/// Requires a JSON content type. Put it before the authentication extractor of a body endpoint: in ASP.NET
/// Core a request with another content type matched no endpoint and fell through to the anonymous `404`.
#[derive(Debug, Clone, Copy)]
pub struct JsonContent;

impl<S: Sync> FromRequestParts<S> for JsonContent {
  type Rejection = Problem;

  fn from_request_parts(parts: &mut Parts, _state: &S) -> impl Future<Output = Result<Self, Self::Rejection>> {
    std::future::ready(if has_json_content_type(&parts.headers) {
      Ok(Self)
    } else {
      Err(Problem::not_found())
    })
  }
}

/// The request body, read as `T`.
#[derive(Debug, Clone)]
pub struct JsonBody<T>(pub T);

impl<S: Sync, T: FromJson> FromRequest<S> for JsonBody<T> {
  type Rejection = Problem;

  async fn from_request(request: Request, _state: &S) -> Result<Self, Self::Rejection> {
    if !has_json_content_type(request.headers()) {
      return Err(Problem::not_found());
    }
    let bytes = axum::body::to_bytes(request.into_body(), MAX_BODY_BYTES)
      .await
      .map_err(|_| Problem::status(StatusCode::PAYLOAD_TOO_LARGE))?;
    read_body(&bytes).map(Self)
  }
}

/// Reads a whole body as `T`, or the `400` problem .NET answered.
pub fn read_body<T: FromJson>(bytes: &Bytes) -> Result<T, Problem> {
  if bytes.iter().all(u8::is_ascii_whitespace) {
    // No body at all: a binding failure that names no field.
    return Err(Problem::bad_request());
  }
  let value: Value = serde_json::from_slice(bytes).map_err(|error| Problem::binding("$", syntax_message(&error)))?;
  if value.is_null() {
    return Err(Problem::bad_request());
  }
  T::from_json(&value, "$").map_err(|error| Problem::binding(error.field().to_owned(), error.message))
}

/// The message for malformed JSON. `System.Text.Json` has a message per kind of syntax error and reports the
/// path it had reached; this keeps its most common message and otherwise says what is wrong in general terms.
fn syntax_message(error: &serde_json::Error) -> &'static str {
  if error.is_eof() {
    "Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed."
  } else {
    "The request body is not valid JSON."
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn numbers_may_be_strings_but_must_be_integers_in_range() {
    assert_eq!(uint32(&json!(7), "$.version"), Ok(7));
    assert_eq!(uint32(&json!("7"), "$.version"), Ok(7));
    assert_eq!(uint32(&json!(4_294_967_295_u32), "$.version"), Ok(u32::MAX));
    for invalid in [
      json!(-1),
      json!(1.5),
      json!(1e2),
      json!(4_294_967_296_u64),
      json!("abc"),
      json!(""),
      json!(" 7"),
      json!(null),
      json!(true),
    ] {
      let error = uint32(&invalid, "$.version").unwrap_err();
      assert_eq!(error.message, "The JSON value could not be converted to System.UInt32.");
      assert_eq!(error.field(), "version");
    }
    assert_eq!(int32(&json!("-3"), "$.n"), Ok(-3));
    assert_eq!(
      int32(&json!(2_147_483_648_u32), "$.n").unwrap_err().message,
      "The JSON value could not be converted to System.Int32."
    );
  }

  #[test]
  fn dates_instants_and_guids_have_their_dotnet_messages() {
    assert_eq!(date_opt(&json!(null), "$.dueDate"), Ok(None));
    assert_eq!(
      date_opt(&json!("2026-10-26"), "$.dueDate"),
      Ok(NaiveDate::from_ymd_opt(2026, 10, 26))
    );
    assert_eq!(
      date_opt(&json!("2026-1-1"), "$.dueDate").unwrap_err().message,
      "The JSON value could not be converted to System.Nullable`1[System.DateOnly]."
    );
    assert_eq!(
      date(&json!(null), "$.filter.today").unwrap_err().message,
      "The JSON value could not be converted to System.DateOnly."
    );
    assert_eq!(instant_opt(&json!(null), "$.dueAt"), Ok(None));
    assert_eq!(instant_opt(&json!(5), "$.dueAt").unwrap_err().message, INSTANT_MESSAGE);
    assert_eq!(instant_opt(&json!("2026-10-26T10:00:00"), "$.dueAt").unwrap_err().field(), "dueAt");
    assert!(guid(&json!("00000000-0000-0000-0000-00000000000A"), "$.ids[0]").is_ok());
    for invalid in [
      json!("{00000000-0000-0000-0000-000000000001}"),
      json!("00000000000000000000000000000001"),
      json!(null),
      json!("x"),
    ] {
      let error = guid(&invalid, "$.ids[0]").unwrap_err();
      assert_eq!(
        (error.field(), error.message.as_str()),
        ("ids[0]", "The JSON value could not be converted to System.Guid.")
      );
    }
  }

  #[test]
  fn property_names_match_ignoring_case() {
    assert_eq!(property(&["title", "dueDate"], "DUEDATE"), Some("dueDate"));
    assert_eq!(property(&["title", "dueDate"], "due_date"), None);
  }

  #[test]
  fn missing_required_properties_are_listed() {
    let error = missing_required("$.filter", "Calendar.Api.Contracts.OverdueTaskFilter", &["view", "today"]);
    assert_eq!(error.field(), "filter");
    assert_eq!(
      error.message,
      "JSON deserialization for type 'Calendar.Api.Contracts.OverdueTaskFilter' was missing required properties including: 'view', 'today'."
    );
  }

  #[test]
  fn json_content_types() {
    let with = |value: &'static str| {
      let mut headers = HeaderMap::new();
      headers.insert(CONTENT_TYPE, value.parse().unwrap());
      headers
    };
    assert!(has_json_content_type(&with("application/json")));
    assert!(has_json_content_type(&with("Application/JSON; charset=utf-8")));
    assert!(has_json_content_type(&with("application/problem+json")));
    assert!(!has_json_content_type(&with("text/plain")));
    assert!(!has_json_content_type(&HeaderMap::new()));
  }
}
