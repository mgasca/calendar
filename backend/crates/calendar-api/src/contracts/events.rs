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

const EVENT_PROPERTIES: [&str; 10] = [
  "title",
  "allDay",
  "start",
  "end",
  "timeZone",
  "startDate",
  "endDate",
  "location",
  "notes",
  "version",
];

/// Reads the shared event fields, and `version` when `with_version`.
fn read_event(value: &Value, path: &str, type_name: &str, with_version: bool) -> JsonResult<(EventFields, Option<u32>)> {
  let properties = if with_version {
    &EVENT_PROPERTIES[..]
  } else {
    &EVENT_PROPERTIES[..9]
  };
  let mut fields = EventFields::default();
  let mut has_title = false;
  let mut version = None;
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
      "allDay" => fields.all_day = json::boolean(value, &at)?,
      "start" => fields.start = json::instant_opt(value, &at)?,
      "end" => fields.end = json::instant_opt(value, &at)?,
      "timeZone" => fields.time_zone = json::string(value, &at)?,
      "startDate" => fields.start_date = json::date_opt(value, &at)?,
      "endDate" => fields.end_date = json::date_opt(value, &at)?,
      "location" => fields.location = json::string(value, &at)?,
      "notes" => fields.notes = json::string(value, &at)?,
      _ => version = Some(json::uint32(value, &at)?),
    }
  }

  let mut missing = Vec::new();
  if !has_title {
    missing.push("title");
  }
  if with_version && version.is_none() {
    missing.push("version");
  }
  if missing.is_empty() {
    Ok((fields, version))
  } else {
    Err(json::missing_required(path, type_name, &missing))
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

impl CreateEventRequest {
  /// The event fields of the request.
  pub fn fields(&self) -> EventFields {
    EventFields {
      title: self.title.clone(),
      all_day: self.all_day,
      start: self.start,
      end: self.end,
      time_zone: self.time_zone.clone(),
      start_date: self.start_date,
      end_date: self.end_date,
      location: self.location.clone(),
      notes: self.notes.clone(),
    }
  }
}

impl FromJson for CreateEventRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.CreateEventRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let (fields, _) = read_event(value, path, Self::TYPE_NAME, false)?;
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
  /// The event fields of the request.
  pub fn fields(&self) -> EventFields {
    EventFields {
      title: self.title.clone(),
      all_day: self.all_day,
      start: self.start,
      end: self.end,
      time_zone: self.time_zone.clone(),
      start_date: self.start_date,
      end_date: self.end_date,
      location: self.location.clone(),
      notes: self.notes.clone(),
    }
  }
}

impl FromJson for UpdateEventRequest {
  const TYPE_NAME: &'static str = "Calendar.Api.Contracts.UpdateEventRequest";

  fn from_json(value: &Value, path: &str) -> JsonResult<Self> {
    let (fields, version) = read_event(value, path, Self::TYPE_NAME, true)?;
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
      version: version.unwrap_or_default(),
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
