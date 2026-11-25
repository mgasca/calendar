//! Contract-shaped data for the named scenes (`--scene today`) and the headless tests. Not captured from a
//! running API: each value follows `contracts/openapi.json`'s schemas, and a test fails if one stops decoding.

use calendar_client::generated::{AuthUserResponse, DayAgendaResponse, TaskPage, WeekAgendaResponse};
use chrono::{DateTime, Utc};
use serde_json::json;

/// The instant scenes and tests are frozen at: Friday 20 November 2026, 10:00 in Madrid.
#[must_use]
pub fn now() -> DateTime<Utc> {
  "2026-11-20T09:00:00Z".parse().expect("a fixed instant")
}

/// The time zone scenes and tests use.
pub const ZONE: chrono_tz::Tz = chrono_tz::Europe::Madrid;

/// The locale scenes and tests format in: `en-GB`, as the web app's tests pin it (`test/render.tsx`).
#[must_use]
pub fn locale() -> crate::locale::Locale {
  crate::locale::Locale::parse("en-GB").expect("en-GB parses")
}

fn decode<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
  serde_json::from_value(value).expect("fixtures follow the contract")
}

#[must_use]
pub fn user() -> AuthUserResponse {
  decode(json!({ "name": "Alex Doe", "email": "alex@example.com", "pictureUrl": null }))
}

fn task(id: u8, title: &str, extra: &serde_json::Value) -> serde_json::Value {
  let mut task = json!({
    "id": format!("00000000-0000-4000-8000-0000000000{id:02}"), "title": title, "priority": null,
    "dueDate": null, "dueAt": null, "completedAt": null, "isCompleted": false, "hasNotes": false
  });
  task
    .as_object_mut()
    .expect("an object")
    .extend(extra.as_object().expect("an object").clone());
  task
}

/// Today's agenda: an all-day event over three days, a past, a current and two next events, tasks due today
/// (one done, one past due) and two overdue.
#[must_use]
pub fn day() -> DayAgendaResponse {
  decode(json!({
    "date": "2026-11-20", "timeZone": "Europe/Madrid",
    "window": { "start": "2026-11-19T23:00:00Z", "end": "2026-11-20T23:00:00Z" },
    "allDayEvents": [
      { "id": "10000000-0000-4000-8000-000000000001", "title": "Conference", "startDate": "2026-11-19",
        "endDate": "2026-11-22", "location": "Lisbon", "hasNotes": false }
    ],
    "events": [
      { "id": "20000000-0000-4000-8000-000000000001", "title": "Stand-up", "start": "2026-11-20T07:30:00Z",
        "end": "2026-11-20T07:45:00Z", "timeZone": "Europe/Madrid", "location": null, "hasNotes": false,
        "startsBeforeDay": false, "endsAfterDay": false },
      { "id": "20000000-0000-4000-8000-000000000002", "title": "Design review", "start": "2026-11-20T08:30:00Z",
        "end": "2026-11-20T10:00:00Z", "timeZone": "Europe/Madrid", "location": "Room 2", "hasNotes": true,
        "startsBeforeDay": false, "endsAfterDay": false },
      { "id": "20000000-0000-4000-8000-000000000003", "title": "Lunch with Sam", "start": "2026-11-20T12:00:00Z",
        "end": "2026-11-20T13:00:00Z", "timeZone": "Europe/Madrid", "location": null, "hasNotes": false,
        "startsBeforeDay": false, "endsAfterDay": false },
      { "id": "20000000-0000-4000-8000-000000000004", "title": "Train to Porto", "start": "2026-11-20T21:30:00Z",
        "end": "2026-11-21T01:00:00Z", "timeZone": "Europe/Madrid", "location": null, "hasNotes": false,
        "startsBeforeDay": false, "endsAfterDay": true }
    ],
    "tasks": {
      "dueToday": [
        task(1, "Send the slides", &json!({ "dueDate": "2026-11-20", "isCompleted": true, "completedAt": "2026-11-20T08:00:00Z" })),
        task(2, "Call the bank", &json!({ "dueAt": "2026-11-20T08:00:00Z", "priority": "high" })),
        task(3, "Book flights", &json!({ "dueDate": "2026-11-20" }))
      ],
      "overdue": [
        task(4, "Renew passport", &json!({ "dueDate": "2026-11-19", "priority": "medium" })),
        task(5, "File expenses", &json!({ "dueDate": "2026-11-12" }))
      ],
      "overdueTotal": 2, "overdueOpenTotal": 2
    }
  }))
}

/// A day with nothing on it.
#[must_use]
pub fn empty_day() -> DayAgendaResponse {
  decode(json!({
    "date": "2026-11-20", "timeZone": "Europe/Madrid",
    "window": { "start": "2026-11-19T23:00:00Z", "end": "2026-11-20T23:00:00Z" },
    "allDayEvents": [], "events": [],
    "tasks": { "dueToday": [], "overdue": [], "overdueTotal": 0, "overdueOpenTotal": 0 }
  }))
}

/// The week of 16–22 November 2026.
#[must_use]
pub fn week() -> WeekAgendaResponse {
  let day = |date: &str, start: &str, end: &str, events: serde_json::Value, tasks: serde_json::Value| json!({ "date": date, "window": { "start": start, "end": end }, "events": events, "tasks": tasks });
  let event = |id: u8, title: &str, start: &str, end: &str| {
    json!({ "id": format!("30000000-0000-4000-8000-0000000000{id:02}"), "title": title, "start": start, "end": end,
      "timeZone": "Europe/Madrid", "location": null, "hasNotes": false, "startsBeforeDay": false, "endsAfterDay": false })
  };
  decode(json!({
    "weekStart": "2026-11-16", "timeZone": "Europe/Madrid",
    "window": { "start": "2026-11-15T23:00:00Z", "end": "2026-11-22T23:00:00Z" },
    "allDayEvents": [
      { "id": "10000000-0000-4000-8000-000000000001", "title": "Conference", "startDate": "2026-11-19",
        "endDate": "2026-11-22", "location": "Lisbon", "hasNotes": false }
    ],
    "days": [
      day("2026-11-16", "2026-11-15T23:00:00Z", "2026-11-16T23:00:00Z",
        json!([event(1, "Planning", "2026-11-16T08:00:00Z", "2026-11-16T09:00:00Z")]),
        json!([task(6, "Write the brief", &json!({ "dueDate": "2026-11-16" }))])),
      day("2026-11-17", "2026-11-16T23:00:00Z", "2026-11-17T23:00:00Z", json!([]), json!([])),
      day("2026-11-18", "2026-11-17T23:00:00Z", "2026-11-18T23:00:00Z",
        json!([event(2, "Dentist", "2026-11-18T15:00:00Z", "2026-11-18T15:45:00Z")]), json!([])),
      day("2026-11-19", "2026-11-18T23:00:00Z", "2026-11-19T23:00:00Z", json!([]), json!([])),
      day("2026-11-20", "2026-11-19T23:00:00Z", "2026-11-20T23:00:00Z",
        json!([event(3, "Design review", "2026-11-20T08:30:00Z", "2026-11-20T10:00:00Z")]),
        json!([task(2, "Call the bank", &json!({ "dueAt": "2026-11-20T08:00:00Z" }))])),
      day("2026-11-21", "2026-11-20T23:00:00Z", "2026-11-21T23:00:00Z", json!([]), json!([])),
      day("2026-11-22", "2026-11-21T23:00:00Z", "2026-11-22T23:00:00Z", json!([]), json!([]))
    ],
    "overdue": [ task(5, "File expenses", &json!({ "dueDate": "2026-11-12" })) ],
    "overdueTotal": 1, "overdueOpenTotal": 1
  }))
}

/// A page of upcoming tasks with more to load.
#[must_use]
pub fn tasks() -> TaskPage {
  let item = |id: u8, title: &str, extra: serde_json::Value| {
    let mut t = json!({ "id": format!("00000000-0000-4000-8000-0000000001{id:02}"), "title": title,
      "priority": null, "notes": null, "dueDate": null, "dueAt": null, "completedAt": null,
      "isCompleted": false, "version": 1 });
    t.as_object_mut()
      .expect("an object")
      .extend(extra.as_object().expect("an object").clone());
    t
  };
  decode(json!({
    "items": [
      item(1, "Book flights", json!({ "dueDate": "2026-11-20", "priority": "high" })),
      item(2, "Call the bank", json!({ "dueAt": "2026-11-20T08:00:00Z" })),
      item(3, "Plan the offsite", json!({ "dueDate": "2026-12-01", "notes": "Ask for budget first" }))
    ],
    "nextCursor": "page-2"
  }))
}

/// The first page of overdue tasks for triage: due before 2026-11-20, more to load.
#[must_use]
pub fn overdue_tasks() -> TaskPage {
  let item = |id: u8, title: &str, extra: serde_json::Value| {
    let mut t = json!({ "id": format!("00000000-0000-4000-8000-0000000002{id:02}"), "title": title,
      "priority": null, "notes": null, "dueDate": null, "dueAt": null, "completedAt": null,
      "isCompleted": false, "version": 1 });
    t.as_object_mut()
      .expect("an object")
      .extend(extra.as_object().expect("an object").clone());
    t
  };
  decode(json!({
    "items": [
      item(1, "File expenses", json!({ "dueDate": "2026-11-12", "priority": "high" })),
      item(2, "Renew passport", json!({ "dueDate": "2026-11-19" })),
      item(3, "Call the plumber", json!({ "dueAt": "2026-11-18T16:00:00Z", "notes": "Kitchen tap" }))
    ],
    "nextCursor": "page-2",
    "total": 42
  }))
}

/// The week with five overlapping events on Wednesday 18 November, 16:00 to 17:00 in Madrid: three side by side and
/// "+2 more" (#1034).
#[must_use]
pub fn busy_week() -> WeekAgendaResponse {
  let mut week = week();
  let wednesday = &mut week.days[2];
  let first = wednesday.events[0].clone();
  for n in 1..=4u8 {
    let mut event = first.clone();
    event.id = format!("30000000-0000-4000-8000-0000000000{:02}", 10 + n).parse().expect("a uuid");
    event.title = format!("Interview {n}");
    event.start = first.start + chrono::Duration::minutes(i64::from(n) * 5);
    wednesday.events.push(event);
  }
  week
}

#[cfg(test)]
mod tests {
  #[test]
  fn every_fixture_decodes() {
    let _ = (
      super::user(),
      super::day(),
      super::empty_day(),
      super::week(),
      super::tasks(),
      super::overdue_tasks(),
    );
  }
}
