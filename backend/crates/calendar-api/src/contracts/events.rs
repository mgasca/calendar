use calendar_infrastructure::agenda::{AllDayEventRow, TimedEventRow};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::json::{self, FromJson, JsonResult};
use crate::wire;

/// The fields an event is created or replaced from.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EventFields {
  /// The title as sent; `None` for an explicit `null`.
  pub title: Option<String>,
  /// Whether the event is all-day.
  pub all_day: bool,
  /// Start instant of a timed event.
  pub start: Option<DateTime<Utc>>,
  /// End instant of a timed event.
  pub end: Option<DateTime<Utc>>,
  /// Zone of a timed event.
  pub time_zone: Option<String>,
  /// First date of an all-day event.
  pub start_date: Option<NaiveDate>,
  /// Exclusive end date of an all-day event.
  pub end_date: Option<NaiveDate>,
  /// Location.
  pub location: Option<String>,
  /// Notes.
  pub notes: Option<String>,
}

/// A property of an event request body.
#[derive(Debug, Clone, Copy)]
enum EventProperty {
  Title,
  AllDay,
  Start,
  End,
  TimeZone,
  StartDate,
  EndDate,
  Location,
  Notes,
  Version,
}

/// The properties every event request has, in declaration order.
const EVENT_PROPERTIES: [(&str, EventProperty); 9] = [
  ("title", EventProperty::Title),
  ("allDay", EventProperty::AllDay),
  ("start", EventProperty::Start),
  ("end", EventProperty::End),
  ("timeZone", EventProperty::TimeZone),
  ("startDate", EventProperty::StartDate),
  ("endDate", EventProperty::EndDate),
  ("location", EventProperty::Location),
  ("notes", EventProperty::Notes),
];

/// The property an update request adds after the shared ones.
const VERSION_PROPERTY: [(&str, EventProperty); 1] = [("version", EventProperty::Version)];

/// What an event body held, before its required properties are checked.
struct EventBody {
  fields: EventFields,
  has_title: bool,
  version: Option<u32>,
}

/// Reads the shared event properties and the `extra` ones; any other property is skipped.
fn read_event_body(value: &Value, path: &str, type_name: &str, extra: &[(&'static str, EventProperty)]) -> JsonResult<EventBody> {
  let mut body = EventBody {
    fields: EventFields::default(),
    has_title: false,
    version: None,
  };
  let fields = &mut body.fields;
  for (key, value) in json::object(value, path, type_name)? {
    let Some((name, property)) = json::property(EVENT_PROPERTIES.iter().chain(extra), key) else {
      continue;
    };
    let at = json::child(path, name);
    match property {
      EventProperty::Title => {
        fields.title = json::string(value, &at)?;
        body.has_title = true;
      }
      EventProperty::AllDay => fields.all_day = json::boolean(value, &at)?,
      EventProperty::Start => fields.start = json::instant_opt(value, &at)?,
      EventProperty::End => fields.end = json::instant_opt(value, &at)?,
      EventProperty::TimeZone => fields.time_zone = json::string(value, &at)?,
      EventProperty::StartDate => fields.start_date = json::date_opt(value, &at)?,
      EventProperty::EndDate => fields.end_date = json::date_opt(value, &at)?,
      EventProperty::Location => fields.location = json::string(value, &at)?,
      EventProperty::Notes => fields.notes = json::string(value, &at)?,
      EventProperty::Version => body.version = Some(json::uint32(value, &at)?),
    }
  }
  Ok(body)
}

/// Reads the event fields of a create request; `version` is not one of its properties.
fn read_event(value: &Value, path: &str, type_name: &str) -> JsonResult<EventFields> {
  let body = read_event_body(value, path, type_name, &[])?;
  if body.has_title {
    Ok(body.fields)
  } else {
    Err(json::missing_required(path, type_name, &["title"]))
  }
}

/// Reads the event fields and the required `version` of an update request.
fn read_versioned_event(value: &Value, path: &str, type_name: &str) -> JsonResult<(EventFields, u32)> {
  let body = read_event_body(value, path, type_name, &VERSION_PROPERTY)?;
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

/// Create an event. Discriminated by `allDay`: a timed event needs `start`, `end` and
/// `timeZone`; an all-day event needs `startDate` and `endDate` (end exclusive) and no timed fields.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub struct CreateEventRequest {
  /// Event title; required, at most 200 characters after trimming.
  #[schema(value_type = String)]
  pub title: Option<String>,

  /// `true` for an all-day event (`startDate`/`endDate`),
  /// `false` for a timed one (`start`/`end`/`timeZone`).
  #[schema(required = false)]
  pub all_day: bool,

  /// Timed events: inclusive start instant, RFC 3339 with an explicit offset (e.g. 2026-10-26T14:00:00Z); `null` for all-day events.
  pub start: Option<DateTime<Utc>>,

  /// Timed events: exclusive end instant, after `start`; `null` for all-day events.
  pub end: Option<DateTime<Utc>>,

  /// Timed events: IANA time zone the event was created in, e.g. America/New_York; `null` for all-day events.
  pub time_zone: Option<String>,

  /// All-day events: first date (YYYY-MM-DD); `null` for timed events.
  pub start_date: Option<NaiveDate>,

  /// All-day events: exclusive end date (YYYY-MM-DD), after `startDate`; a one-day event on the 26th ends on the 27th.
  /// `null` for timed events.
  pub end_date: Option<NaiveDate>,

  /// Optional location, at most 200 characters.
  pub location: Option<String>,

  /// Optional notes, at most 4000 characters.
  pub notes: Option<String>,
}

/// The event fields of the request.
impl From<CreateEventRequest> for EventFields {
  fn from(request: CreateEventRequest) -> Self {
    Self {
      title: request.title,
      all_day: request.all_day,
      start: request.start,
      end: request.end,
      time_zone: request.time_zone,
      start_date: request.start_date,
      end_date: request.end_date,
      location: request.location,
      notes: request.notes,
    }
  }
}

impl FromJson for CreateEventRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.CreateEventRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let fields = read_event(value, path, Self::TYPE_NAME)?;
    Ok(Self {
      title: fields.title,
      all_day: fields.all_day,
      start: fields.start,
      end: fields.end,
      time_zone: fields.time_zone,
      start_date: fields.start_date,
      end_date: fields.end_date,
      location: fields.location,
      notes: fields.notes,
    })
  }
}

/// Replace an event: the fields and rules of `CreateEventRequest`, plus the `version` the client loaded.
/// The kind can change (timed to all-day and back).
#[derive(Debug, Clone, PartialEq, Eq, ToSchema)]
#[schema(rename_all = "camelCase")]
pub struct UpdateEventRequest {
  /// Event title; required, at most 200 characters after trimming.
  #[schema(value_type = String)]
  pub title: Option<String>,

  /// `true` for an all-day event (`startDate`/`endDate`),
  /// `false` for a timed one (`start`/`end`/`timeZone`).
  #[schema(required = false)]
  pub all_day: bool,

  /// Timed events: inclusive start instant, RFC 3339 with an explicit offset (e.g. 2026-10-26T14:00:00Z); `null` for all-day events.
  pub start: Option<DateTime<Utc>>,

  /// Timed events: exclusive end instant, after `start`; `null` for all-day events.
  pub end: Option<DateTime<Utc>>,

  /// Timed events: IANA time zone the event was created in, e.g. America/New_York; `null` for all-day events.
  pub time_zone: Option<String>,

  /// All-day events: first date (YYYY-MM-DD); `null` for timed events.
  pub start_date: Option<NaiveDate>,

  /// All-day events: exclusive end date (YYYY-MM-DD), after `startDate`; a one-day event on the 26th ends on the 27th.
  /// `null` for timed events.
  pub end_date: Option<NaiveDate>,

  /// Optional location, at most 200 characters.
  pub location: Option<String>,

  /// Optional notes, at most 4000 characters.
  pub notes: Option<String>,

  /// The event's `version` as last read; the update is refused with `409` when the event has changed
  /// since.
  pub version: u32,
}

impl UpdateEventRequest {
  /// The event fields of the request and the `version` it expects.
  pub fn into_parts(self) -> (EventFields, u32) {
    let fields = EventFields {
      title: self.title,
      all_day: self.all_day,
      start: self.start,
      end: self.end,
      time_zone: self.time_zone,
      start_date: self.start_date,
      end_date: self.end_date,
      location: self.location,
      notes: self.notes,
    };
    (fields, self.version)
  }
}

impl FromJson for UpdateEventRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.UpdateEventRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let (fields, version) = read_versioned_event(value, path, Self::TYPE_NAME)?;
    Ok(Self {
      title: fields.title,
      all_day: fields.all_day,
      start: fields.start,
      end: fields.end,
      time_zone: fields.time_zone,
      start_date: fields.start_date,
      end_date: fields.end_date,
      location: fields.location,
      notes: fields.notes,
      version,
    })
  }
}

/// An event as stored. Fields of the other kind are `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventResponse {
  /// Unique event id.
  pub id: Uuid,

  /// Event title.
  pub title: String,

  /// `true` for an all-day event, `false` for a timed one.
  pub all_day: bool,

  /// Location, or `null` if none.
  pub location: Option<String>,

  /// Notes, or `null` if none.
  pub notes: Option<String>,

  /// Timed events: inclusive start instant; `null` for all-day events.
  #[serde(serialize_with = "wire::instant_opt")]
  pub start: Option<DateTime<Utc>>,

  /// Timed events: exclusive end instant; `null` for all-day events.
  #[serde(serialize_with = "wire::instant_opt")]
  pub end: Option<DateTime<Utc>>,

  /// Timed events: IANA time zone id; `null` for all-day events.
  pub time_zone: Option<String>,

  /// All-day events: first date; `null` for timed events.
  pub start_date: Option<NaiveDate>,

  /// All-day events: exclusive end date; `null` for timed events.
  pub end_date: Option<NaiveDate>,

  /// Opaque version of the stored event; send it back to update the event.
  pub version: u32,
}

/// An all-day event in the day agenda (floating dates, end exclusive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AllDayEventItem {
  /// Unique event id.
  pub id: Uuid,

  /// Event title.
  pub title: String,

  /// Location, or `null` if none.
  pub location: Option<String>,

  /// Whether the event has notes.
  pub has_notes: bool,

  /// First date of the event.
  pub start_date: NaiveDate,

  /// Exclusive end date of the event.
  pub end_date: NaiveDate,
}

impl From<AllDayEventRow> for AllDayEventItem {
  fn from(row: AllDayEventRow) -> Self {
    Self {
      id: row.id,
      title: row.title,
      location: row.location,
      has_notes: row.has_notes,
      start_date: row.start_date,
      end_date: row.end_date,
    }
  }
}

/// A timed event in the day agenda.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TimedEventItem {
  /// Unique event id.
  pub id: Uuid,

  /// Event title.
  pub title: String,

  /// Location, or `null` if none.
  pub location: Option<String>,

  /// Whether the event has notes.
  pub has_notes: bool,

  /// Inclusive start instant.
  #[serde(serialize_with = "wire::instant")]
  pub start: DateTime<Utc>,

  /// Exclusive end instant.
  #[serde(serialize_with = "wire::instant")]
  pub end: DateTime<Utc>,

  /// IANA time zone id the event was created in.
  pub time_zone: String,

  /// The event began before the day's window (it continues from an earlier day).
  pub starts_before_day: bool,

  /// The event ends after the day's window (it continues into a later day).
  pub ends_after_day: bool,
}

/// The day-relative flags are left `false`; the agenda sets them for each day it places the event on.
impl From<TimedEventRow> for TimedEventItem {
  fn from(row: TimedEventRow) -> Self {
    Self {
      id: row.id,
      title: row.title,
      location: row.location,
      has_notes: row.has_notes,
      start: row.start,
      end: row.end,
      time_zone: row.time_zone_id,
      starts_before_day: false,
      ends_after_day: false,
    }
  }
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
    let error = CreateEventRequest::from_json(&json!({ "notes": "n" }), "$").unwrap_err();
    assert_eq!(error.message, missing("CreateEventRequest", "'title'"));

    let request = CreateEventRequest::from_json(&json!({ "TITLE": "t", "version": "not a number", "other": 1 }), "$").unwrap();
    assert_eq!(request.title.as_deref(), Some("t"));
  }

  #[test]
  fn an_update_request_needs_a_title_and_a_version() {
    for (body, names) in [
      (json!({}), "'title', 'version'"),
      (json!({ "title": "t" }), "'version'"),
      (json!({ "version": 3 }), "'title'"),
    ] {
      let error = UpdateEventRequest::from_json(&body, "$").unwrap_err();
      assert_eq!(error.message, missing("UpdateEventRequest", names), "{body}");
    }

    let request = UpdateEventRequest::from_json(&json!({ "title": "t", "Version": "7", "allDay": true }), "$").unwrap();
    assert_eq!((request.version, request.all_day), (7, true));

    let error = UpdateEventRequest::from_json(&json!({ "title": "t", "version": -1 }), "$").unwrap_err();
    assert_eq!(error.path, "$.version");
  }
}
