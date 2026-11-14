//! Ports `Endpoints/EventEndpointsTests.cs` of `Calendar.Api.Tests`: one test per fact, and one per theory
//! that runs every row of the theory on an app (and database) of its own.

use crate::common::*;

const EVENTS: &str = "/api/events";

fn event_uri(id: Uuid) -> String {
  format!("{EVENTS}/{id}")
}

async fn create(app: &TestApp, request: &Value) -> EventResponse {
  let created = app.client().post_json(EVENTS, request).await;
  assert_eq!(created.status, StatusCode::CREATED, "{}", created.text());
  created.json()
}

async fn get_event(app: &TestApp, id: Uuid) -> EventResponse {
  app.client().get(&event_uri(id)).await.success().json()
}

/// The number of event rows of every user, read as the schema owner.
async fn event_count(app: &TestApp) -> i64 {
  let client = app.database().migrator_client().await;
  client
    .query_one("SELECT count(*) FROM events", &[])
    .await
    .expect("the events are counted")
    .get(0)
}

#[tokio::test]
async fn create_timed_event_round_trips_and_normalizes_to_utc() {
  let app = TestApp::start().await;

  let created = app
    .client()
    .post_json(
      EVENTS,
      &json!({
        "title": "  Standup  ",
        "start": "2026-10-26T10:00:00-04:00",
        "end": "2026-10-26T10:30:00-04:00",
        "timeZone": "America/New_York",
        "location": "Room 1",
        "notes": "Bring notes",
      }),
    )
    .await;

  assert_eq!(created.status, StatusCode::CREATED);
  let body: EventResponse = created.json();
  let location = created.header("location").expect("a Location header");
  assert!(location.ends_with(&format!("/api/events/{}", body.id)), "{location}");
  assert_eq!(body.title, "Standup");
  assert!(!body.all_day);
  assert_eq!(body.start, Some(utc(2026, 10, 26, 14, 0)));
  assert_eq!(body.end, Some(utc(2026, 10, 26, 14, 30)));
  assert_eq!(body.time_zone.as_deref(), Some("America/New_York"));
  assert_eq!(body.location.as_deref(), Some("Room 1"));
  assert_eq!(body.notes.as_deref(), Some("Bring notes"));
  assert_eq!(body.start_date, None);
  assert_eq!(body.end_date, None);

  assert_eq!(get_event(&app, body.id).await, body);
}

#[tokio::test]
async fn create_all_day_event_round_trips() {
  let app = TestApp::start().await;

  let created = app
    .client()
    .post_json(
      EVENTS,
      &json!({"title": "Offsite", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-28"}),
    )
    .await;

  assert_eq!(created.status, StatusCode::CREATED);
  let body: EventResponse = created.json();
  assert!(body.all_day);
  assert_eq!(body.start_date, Some(date(2026, 10, 26)));
  assert_eq!(body.end_date, Some(date(2026, 10, 28)));
  assert_eq!(body.start, None);
  assert_eq!(body.time_zone, None);

  assert_eq!(get_event(&app, body.id).await, body);
}

#[tokio::test]
async fn create_event_canonicalizes_the_zone_id() {
  let app = TestApp::start().await;

  let created = app
    .client()
    .post_json(
      EVENTS,
      &json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z", "timeZone": "utc"}),
    )
    .await;

  assert_eq!(created.status, StatusCode::CREATED);
  assert_eq!(created.json::<EventResponse>().time_zone.as_deref(), Some("UTC"));
}

#[tokio::test]
async fn create_event_with_a_legacy_zone_alias_stores_the_canonical_id() {
  let app = TestApp::start().await;

  let created = app
    .client()
    .post_json(
      EVENTS,
      &json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z", "timeZone": "Asia/Calcutta"}),
    )
    .await;

  assert_eq!(created.status, StatusCode::CREATED);
  assert_eq!(created.json::<EventResponse>().time_zone.as_deref(), Some("Asia/Kolkata"));
}

#[tokio::test]
async fn get_event_unknown_returns_404_problem() {
  let app = TestApp::start().await;

  let response = app.client().get(&event_uri(Uuid::new_v4())).await;

  assert_eq!(response.status, StatusCode::NOT_FOUND);
  assert_eq!(response.media_type(), Some("application/problem+json"));
}

#[tokio::test]
async fn get_event_with_non_guid_id_returns_404() {
  let app = TestApp::start().await;

  let response = app.client().get("/api/events/not-a-guid").await;

  assert_eq!(response.status, StatusCode::NOT_FOUND);
}

/// The rows of the `InvalidRequests` theory: scenario, the field the problem must name, the payload.
#[allow(clippy::too_many_lines, reason = "a table of seventeen request bodies")]
fn invalid_requests() -> Vec<(&'static str, &'static str, Value)> {
  vec![
    (
      "blank title",
      "title",
      json!({"title": "   ", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z", "timeZone": "UTC"}),
    ),
    (
      "title too long",
      "title",
      json!({"title": "a".repeat(201), "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z", "timeZone": "UTC"}),
    ),
    (
      "end equals start",
      "end",
      json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T10:00:00Z", "timeZone": "UTC"}),
    ),
    (
      "end before start",
      "end",
      json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T09:00:00Z", "timeZone": "UTC"}),
    ),
    (
      "bad zone",
      "timeZone",
      json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z", "timeZone": "Nowhere/Land"}),
    ),
    (
      "directory-like zone",
      "timeZone",
      json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z", "timeZone": "America"}),
    ),
    (
      "windows zone",
      "timeZone",
      json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z", "timeZone": "Eastern Standard Time"}),
    ),
    (
      "timed without zone",
      "timeZone",
      json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T11:00:00Z"}),
    ),
    (
      "timed without start",
      "start",
      json!({"title": "E", "end": "2026-10-26T11:00:00Z", "timeZone": "UTC"}),
    ),
    (
      "timed with dates",
      "startDate",
      json!({
        "title": "E",
        "start": "2026-10-26T10:00:00Z",
        "end": "2026-10-26T11:00:00Z",
        "timeZone": "UTC",
        "startDate": "2026-10-26",
      }),
    ),
    (
      "location too long",
      "location",
      json!({
        "title": "E",
        "start": "2026-10-26T10:00:00Z",
        "end": "2026-10-26T11:00:00Z",
        "timeZone": "UTC",
        "location": "l".repeat(201),
      }),
    ),
    (
      "notes too long",
      "notes",
      json!({
        "title": "E",
        "start": "2026-10-26T10:00:00Z",
        "end": "2026-10-26T11:00:00Z",
        "timeZone": "UTC",
        "notes": "n".repeat(4001),
      }),
    ),
    ("all-day without dates", "startDate", json!({"title": "E", "allDay": true})),
    (
      "all-day end equals start",
      "endDate",
      json!({"title": "E", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-26"}),
    ),
    (
      "all-day end before start",
      "endDate",
      json!({"title": "E", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-25"}),
    ),
    (
      "all-day with timed fields",
      "start",
      json!({"title": "E", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27", "start": "2026-10-26T10:00:00Z"}),
    ),
    (
      "all-day date out of range",
      "endDate",
      json!({"title": "E", "allDay": true, "startDate": "2026-10-26", "endDate": "9999-12-31"}),
    ),
  ]
}

#[tokio::test]
async fn create_event_invalid_returns_400_validation_problem() {
  let cases = invalid_requests();
  assert_eq!(cases.len(), 17);
  for (scenario, field, payload) in cases {
    let app = TestApp::start().await;

    let response = app.client().post_json(EVENTS, &payload).await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{scenario}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{scenario}");
    assert!(
      response.has_error(field),
      "{scenario}: expected an error for '{field}' but got {}",
      response.value()["errors"]
    );
    assert_eq!(event_count(&app).await, 0, "{scenario}");
  }
}

#[tokio::test]
async fn create_event_instant_without_explicit_offset_returns_400_naming_the_field() {
  // "2026-10-26T10:00:00" has no offset: it would be read in the server's local offset.
  for (value, field) in [
    ("2026-10-26T10:00:00", "start"),
    ("2026-10-26", "start"),
    ("2026-10-26T10:00:00+0400", "start"),
    ("not a time", "start"),
  ] {
    let app = TestApp::start().await;

    let response = app
      .client()
      .post_json(
        EVENTS,
        &json!({"title": "E", "start": value, "end": "2026-10-26T12:00:00Z", "timeZone": "UTC"}),
      )
      .await;

    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{value}");
    assert_eq!(response.media_type(), Some("application/problem+json"), "{value}");
    assert!(response.has_error(field), "{value}: {}", response.text());
    assert_eq!(event_count(&app).await, 0, "{value}");
  }
}

#[tokio::test]
async fn create_event_end_without_offset_names_the_end_field() {
  let app = TestApp::start().await;

  let response = app
    .client()
    .post_json(
      EVENTS,
      &json!({"title": "E", "start": "2026-10-26T10:00:00Z", "end": "2026-10-26T12:00:00", "timeZone": "UTC"}),
    )
    .await;

  assert_eq!(response.status, StatusCode::BAD_REQUEST);
  assert!(response.has_error("end"), "{}", response.text());
}

#[tokio::test]
async fn create_event_instant_with_explicit_offset_is_accepted() {
  for value in [
    "2026-10-26T10:00:00Z",
    "2026-10-26T10:00:00.5+05:30",
    "2026-10-26T10:00-04:00",
    "2026-10-26T10:00:00z",
  ] {
    let app = TestApp::start().await;

    let response = app
      .client()
      .post_json(
        EVENTS,
        &json!({"title": "E", "start": value, "end": "2026-10-27T10:00:00Z", "timeZone": "UTC"}),
      )
      .await;

    assert_eq!(response.status, StatusCode::CREATED, "{value}: {}", response.text());
  }
}

#[tokio::test]
async fn create_event_with_malformed_body_returns_400() {
  let app = TestApp::start().await;
  let content = br#"{"title":"E","allDay":true,"startDate":"nope"}"#.to_vec();

  let response = app
    .client()
    .send(Method::POST, EVENTS, Some(("application/json; charset=utf-8", content)))
    .await;

  assert_eq!(response.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_timed_event_replaces_every_field_and_returns_a_new_version() {
  let app = TestApp::start().await;
  let created = create(
    &app,
    &json!({
      "title": "Dentist",
      "start": "2026-10-26T15:00:00Z",
      "end": "2026-10-26T16:00:00Z",
      "timeZone": "UTC",
      "location": "Clinic",
      "notes": "Bring card",
    }),
  )
  .await;

  let response = app
    .client()
    .put_json(
      &event_uri(created.id),
      &json!({
        "title": " Dentist (moved) ",
        "start": "2026-10-26T12:00:00-04:00",
        "end": "2026-10-26T13:00:00-04:00",
        "timeZone": "America/New_York",
        "version": created.version,
      }),
    )
    .await;

  assert_eq!(response.status, StatusCode::OK);
  let updated: EventResponse = response.json();
  assert_eq!(updated.id, created.id);
  assert_eq!(updated.title, "Dentist (moved)");
  assert_eq!(updated.start, Some(utc(2026, 10, 26, 16, 0)));
  assert_eq!(updated.end, Some(utc(2026, 10, 26, 17, 0)));
  assert_eq!(updated.time_zone.as_deref(), Some("America/New_York"));
  assert_eq!(updated.location, None);
  assert_eq!(updated.notes, None);
  assert_ne!(updated.version, created.version);

  assert_eq!(get_event(&app, created.id).await, updated);
  let day = app.get_agenda("2026-10-26", "UTC").await;
  assert_eq!(day.events.len(), 1);
  assert_eq!(day.events[0].start, utc(2026, 10, 26, 16, 0));
}

#[tokio::test]
async fn update_event_can_switch_a_timed_event_to_all_day() {
  let app = TestApp::start().await;
  let created = create(
    &app,
    &json!({"title": "Offsite", "start": "2026-10-26T15:00:00Z", "end": "2026-10-26T16:00:00Z", "timeZone": "UTC"}),
  )
  .await;

  let response = app
    .client()
    .put_json(
      &event_uri(created.id),
      &json!({"title": "Offsite", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-28", "version": created.version}),
    )
    .await;

  assert_eq!(response.status, StatusCode::OK);
  let updated: EventResponse = response.json();
  assert!(updated.all_day);
  assert_eq!(updated.start_date, Some(date(2026, 10, 26)));
  assert_eq!(updated.end_date, Some(date(2026, 10, 28)));
  assert_eq!(updated.start, None);
  assert_eq!(updated.time_zone, None);
  let day = app.get_agenda("2026-10-27", "UTC").await;
  assert_eq!(day.events, Vec::<TimedEventItem>::new());
  assert_eq!(day.all_day_events.len(), 1);
  assert_eq!(day.all_day_events[0].id, created.id);
}

#[tokio::test]
async fn update_event_with_a_stale_version_returns_409_and_leaves_the_event_unchanged() {
  let app = TestApp::start().await;
  let created = create(
    &app,
    &json!({"title": "Dentist", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27"}),
  )
  .await;
  let first = app
    .client()
    .put_json(
      &event_uri(created.id),
      &json!({
        "title": "Changed elsewhere",
        "allDay": true,
        "startDate": "2026-10-26",
        "endDate": "2026-10-27",
        "version": created.version,
      }),
    )
    .await;
  assert_eq!(first.status, StatusCode::OK);
  let latest: EventResponse = first.json();

  let stale = app
    .client()
    .put_json(
      &event_uri(created.id),
      &json!({"title": "Stale write", "allDay": true, "startDate": "2026-10-27", "endDate": "2026-10-28", "version": created.version}),
    )
    .await;

  assert_eq!(stale.status, StatusCode::CONFLICT);
  assert_eq!(stale.media_type(), Some("application/problem+json"));
  assert_eq!(get_event(&app, created.id).await, latest);
}

#[tokio::test]
async fn update_event_invalid_returns_400_with_the_field_and_leaves_the_event_unchanged() {
  let app = TestApp::start().await;
  let created = create(
    &app,
    &json!({"title": "Dentist", "start": "2026-10-26T15:00:00Z", "end": "2026-10-26T16:00:00Z", "timeZone": "UTC"}),
  )
  .await;

  let end_before_start = app
    .client()
    .put_json(
      &event_uri(created.id),
      &json!({
        "title": "Dentist",
        "start": "2026-10-26T15:00:00Z",
        "end": "2026-10-26T14:00:00Z",
        "timeZone": "UTC",
        "version": created.version,
      }),
    )
    .await;
  let mixed_kinds = app
    .client()
    .put_json(
      &event_uri(created.id),
      &json!({
        "title": "Dentist",
        "allDay": true,
        "startDate": "2026-10-26",
        "start": "2026-10-26T15:00:00Z",
        "version": created.version,
      }),
    )
    .await;

  assert_eq!(end_before_start.status, StatusCode::BAD_REQUEST);
  assert!(end_before_start.has_error("end"), "{}", end_before_start.text());
  assert_eq!(mixed_kinds.status, StatusCode::BAD_REQUEST);
  let mixed = mixed_kinds.value();
  let mut fields: Vec<&str> = mixed["errors"]
    .as_object()
    .expect("the problem has errors")
    .keys()
    .map(String::as_str)
    .collect();
  fields.sort_unstable();
  assert_eq!(fields, ["endDate", "start"]);
  assert_eq!(get_event(&app, created.id).await, created);
}

#[tokio::test]
async fn update_event_without_a_version_returns_400() {
  let app = TestApp::start().await;
  let created = create(
    &app,
    &json!({"title": "Dentist", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27"}),
  )
  .await;

  let response = app
    .client()
    .put_json(
      &event_uri(created.id),
      &json!({"title": "Dentist", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27"}),
    )
    .await;

  assert_eq!(response.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_event_unknown_returns_404_problem() {
  let app = TestApp::start().await;

  let response = app
    .client()
    .put_json(
      &event_uri(Uuid::new_v4()),
      &json!({"title": "Dentist", "allDay": true, "startDate": "2026-10-26", "endDate": "2026-10-27", "version": 1}),
    )
    .await;

  assert_eq!(response.status, StatusCode::NOT_FOUND);
  assert_eq!(response.media_type(), Some("application/problem+json"));
}

#[tokio::test]
async fn delete_event_removes_it_from_the_resource_and_the_agenda() {
  let app = TestApp::start().await;
  let created = create(
    &app,
    &json!({"title": "Dentist", "start": "2026-10-26T15:00:00Z", "end": "2026-10-26T16:00:00Z", "timeZone": "UTC"}),
  )
  .await;

  let deleted = app.client().delete(&event_uri(created.id)).await;
  let again = app.client().delete(&event_uri(created.id)).await;
  let fetched = app.client().get(&event_uri(created.id)).await;

  assert_eq!(deleted.status, StatusCode::NO_CONTENT);
  assert_eq!(again.status, StatusCode::NOT_FOUND);
  assert_eq!(fetched.status, StatusCode::NOT_FOUND);
  assert_eq!(app.get_agenda("2026-10-26", "UTC").await.events, Vec::<TimedEventItem>::new());
}
