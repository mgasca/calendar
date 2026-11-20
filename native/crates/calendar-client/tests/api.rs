//! The wrapper against a stub HTTP server: the day the client sends, the session cookie, the error mapping and the
//! 401 signal. Native only (the stub server needs sockets); the wasm32 build is checked by `just native lint-wasm`.
#![cfg(not(target_arch = "wasm32"))]

use calendar_client::generated::{TaskResponse, TaskResponseVersion, UpdateTaskRequest, UpdateTaskRequestVersion};
use calendar_client::{Api, ApiError, Day, problem_message};
use chrono::NaiveDate;
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn day() -> Day {
  Day {
    today: NaiveDate::from_ymd_opt(2026, 11, 20).unwrap(),
    time_zone: "Europe/Madrid".to_owned(),
  }
}

fn api(server: &MockServer) -> Api {
  Api::new(&server.uri(), reqwest::Client::builder().cookie_store(true).build().unwrap())
}

fn day_agenda() -> serde_json::Value {
  json!({
      "date": "2026-11-20", "timeZone": "Europe/Madrid",
      "window": { "start": "2026-11-19T23:00:00Z", "end": "2026-11-20T23:00:00Z" },
      "allDayEvents": [], "events": [],
      "tasks": { "dueToday": [], "overdue": [], "overdueTotal": 0, "overdueOpenTotal": 0 }
  })
}

#[tokio::test]
async fn the_day_agenda_sends_the_clients_time_zone() {
  let server = MockServer::start().await;
  Mock::given(method("GET"))
    .and(path("/api/agenda/day"))
    .and(query_param("date", "2026-11-21"))
    .and(query_param("timeZone", "Europe/Madrid"))
    .respond_with(ResponseTemplate::new(200).set_body_json(day_agenda()))
    .expect(1)
    .mount(&server)
    .await;
  let agenda = api(&server)
    .day_agenda(NaiveDate::from_ymd_opt(2026, 11, 21).unwrap(), &day())
    .await;
  assert!(agenda.is_ok(), "{agenda:?}");
}

#[tokio::test]
async fn the_week_agenda_and_task_list_send_the_clients_today_and_time_zone() {
  let server = MockServer::start().await;
  Mock::given(method("GET"))
    .and(path("/api/agenda/week"))
    .and(query_param("date", "2026-11-16"))
    .and(query_param("timeZone", "Europe/Madrid"))
    .and(query_param("today", "2026-11-20"))
    .respond_with(ResponseTemplate::new(500))
    .expect(1)
    .mount(&server)
    .await;
  Mock::given(method("GET"))
    .and(path("/api/tasks"))
    .and(query_param("view", "open"))
    .and(query_param("today", "2026-11-20"))
    .and(query_param("timeZone", "Europe/Madrid"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [], "nextCursor": null })))
    .expect(1)
    .mount(&server)
    .await;
  let api = api(&server);
  // The status proves the request matched the parameters: an unmatched request gets wiremock's 404.
  let week = api
    .week_agenda(NaiveDate::from_ymd_opt(2026, 11, 16).unwrap(), &day())
    .await
    .unwrap_err();
  assert_eq!(week.status, Some(500));
  assert!(api.tasks("open", &day(), None, None).await.is_ok());
}

#[tokio::test]
async fn the_session_cookie_the_server_sets_goes_back_on_the_next_call() {
  let server = MockServer::start().await;
  Mock::given(method("GET"))
    .and(path("/api/auth/me"))
    .respond_with(
      ResponseTemplate::new(200)
        .insert_header("set-cookie", "calendar_session=ticket; Path=/; HttpOnly")
        .set_body_json(json!({ "email": "a@example.com", "name": "A", "pictureUrl": null })),
    )
    .mount(&server)
    .await;
  Mock::given(method("GET"))
    .and(path("/api/agenda/day"))
    .and(header("cookie", "calendar_session=ticket"))
    .respond_with(ResponseTemplate::new(200).set_body_json(day_agenda()))
    .expect(1)
    .mount(&server)
    .await;
  let api = api(&server);
  api.me().await.unwrap();
  assert!(api.day_agenda(day().today, &day()).await.is_ok());
}

#[test]
fn the_message_is_the_first_field_error_then_detail_then_title() {
  let validation = r#"{"title":"One or more validation errors occurred.","status":400,
        "errors":{"title":["Title is required."],"end":["End must be after start."]}}"#;
  assert_eq!(problem_message(validation).as_deref(), Some("Title is required."));
  let both = r#"{"title":"Conflict","detail":"The task changed since you loaded it.","status":409}"#;
  assert_eq!(problem_message(both).as_deref(), Some("The task changed since you loaded it."));
  assert_eq!(
    problem_message(r#"{"title":"Not Found","detail":"","status":404}"#).as_deref(),
    Some("Not Found")
  );
  assert_eq!(problem_message(r#"{"errors":{},"title":"Bad"}"#).as_deref(), Some("Bad"));
  assert_eq!(problem_message("<html>Bad gateway</html>"), None);
  assert_eq!(problem_message("[]"), None);
}

#[tokio::test]
async fn a_failed_call_carries_its_status_and_message() {
  let server = MockServer::start().await;
  Mock::given(method("GET"))
    .and(path("/api/tasks"))
    .respond_with(ResponseTemplate::new(400).set_body_raw(
      r#"{"title":"One or more validation errors occurred.","status":400,"errors":{"limit":["Limit must be 1 to 100."]}}"#,
      "application/problem+json",
    ))
    .mount(&server)
    .await;
  let error = api(&server).tasks("open", &day(), Some(0), None).await.unwrap_err();
  assert_eq!(
    error,
    ApiError {
      status: Some(400),
      message: Some("Limit must be 1 to 100.".to_owned())
    }
  );
  assert_eq!(error.message_or("Could not load tasks"), "Limit must be 1 to 100.");
  let bare = ApiError {
    status: Some(502),
    message: None,
  };
  assert_eq!(bare.message_or("Could not load tasks"), "Could not load tasks");
}

#[tokio::test]
async fn an_unreachable_api_is_an_error_without_a_status() {
  let error = Api::new("http://127.0.0.1:9", reqwest::Client::new()).me().await.unwrap_err();
  assert_eq!(error.status, None);
}

#[tokio::test]
async fn a_401_signals_sign_out_except_from_the_session_check() {
  let server = MockServer::start().await;
  Mock::given(method("GET"))
    .respond_with(ResponseTemplate::new(401))
    .mount(&server)
    .await;
  let signals = Arc::new(AtomicUsize::new(0));
  let counter = Arc::clone(&signals);
  let api = api(&server).on_unauthorized(move || {
    counter.fetch_add(1, Ordering::SeqCst);
  });
  assert!(api.me().await.unwrap_err().is_unauthorized());
  assert_eq!(
    signals.load(Ordering::SeqCst),
    0,
    "/api/auth/me answers 401 when signed out; that is no sign-out"
  );
  assert!(api.day_agenda(day().today, &day()).await.unwrap_err().is_unauthorized());
  assert_eq!(signals.load(Ordering::SeqCst), 1);
}

/// Contract-shaped samples, not captured from a running API (no Docker in the session that wrote this).
#[test]
fn a_task_reads_and_its_version_goes_back_unchanged() {
  for (wire, expected) in [
    (json!(7), TaskResponseVersion::UnsignedInteger(7)),
    (json!("7"), TaskResponseVersion::String("7".into())),
  ] {
    let task: TaskResponse = serde_json::from_value(json!({
        "id": "0b9f5d4e-3c1a-4f7e-9a2b-1c2d3e4f5a6b", "title": "Buy milk", "priority": "high",
        "notes": null, "dueDate": "2026-11-20", "dueAt": null, "completedAt": null,
        "isCompleted": false, "version": wire.clone()
    }))
    .unwrap();
    assert!(matches!((&task.version, &expected), (a, b) if format!("{a:?}") == format!("{b:?}")));
    assert_eq!(task.notes, Some(None), "an explicit null is kept apart from a missing field");
    assert_eq!(task.due_date, Some(Some(NaiveDate::from_ymd_opt(2026, 11, 20).unwrap())));
    let update = UpdateTaskRequest::new(task.title.clone(), UpdateTaskRequestVersion::from(task.version));
    assert_eq!(
      serde_json::to_value(&update).unwrap()["version"],
      wire,
      "the version goes back as it came"
    );
  }
}

#[tokio::test]
async fn a_success_that_does_not_match_the_contract_says_so() {
  let server = MockServer::start().await;
  Mock::given(method("GET"))
    .and(path("/api/auth/me"))
    .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "name": "A" })))
    .mount(&server)
    .await;
  let error = api(&server).me().await.unwrap_err();
  assert_eq!(error.status, Some(200));
  assert!(
    error.message_or("").starts_with("The response does not match the contract"),
    "{error:?}"
  );
}
