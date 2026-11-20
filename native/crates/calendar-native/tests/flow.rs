//! The real loading path against a stub API: the session check, each page's request with the client's day, the
//! loading and error states, "Try again", "Load more", the five-minute refresh, midnight, and a 401 signing out.
//!
//! The tests are synchronous: the stub server is set up on its own runtime, and the app's manual effects run each
//! request to completion, as the background thread would.

use calendar_native::clock::Clock;
use calendar_native::fetch::Effects;
use calendar_native::route::{Route, TaskView};
use calendar_native::session::Session;
use calendar_native::{App, fixtures, load};
use serde_json::{Value, json};
use std::future::Future;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn block<T>(future: impl Future<Output = T>) -> T {
  tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
    .unwrap()
    .block_on(future)
}

fn to_json<T: serde::Serialize>(value: &T) -> Value {
  serde_json::to_value(value).unwrap()
}

/// Runs every queued request and applies the results, until nothing is left.
fn settle(app: &mut App) {
  while app.effects.pending() > 0 {
    app.effects.run_pending();
    let effects = app.effects.clone();
    effects.drain(app);
  }
}

fn mount(server: &MockServer, mock: Mock) {
  block(mock.mount(server));
}

/// A stub API with a signed-in user.
fn api() -> MockServer {
  let server = block(MockServer::start());
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/auth/me"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::user()))),
  );
  server
}

/// A signed-in app on `server`, its first page loaded.
fn started(server: &MockServer) -> App {
  let mut app = App::new(&server.uri(), Clock::fixed(fixtures::ZONE, fixtures::now()), Effects::manual());
  load::ensure(&mut app);
  settle(&mut app);
  app
}

fn requests(server: &MockServer, p: &str) -> Vec<wiremock::Request> {
  block(server.received_requests())
    .unwrap_or_default()
    .into_iter()
    .filter(|r| r.url.path() == p)
    .collect()
}

#[test]
fn today_loads_with_the_clients_date_and_zone() {
  let server = api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .and(query_param("date", "2026-11-20"))
      .and(query_param("timeZone", "Europe/Madrid"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::day())))
      .expect(1),
  );
  let app = started(&server);
  assert!(matches!(app.session, Session::SignedIn(_)));
  assert_eq!(app.day.data.as_ref().map(|d| d.events.len()), Some(4));
  assert!(!app.day.loading && app.day.error.is_none());
}

#[test]
fn the_week_and_tasks_send_today_too() {
  let server = api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::day()))),
  );
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/week"))
      .and(query_param("date", "2026-11-16"))
      .and(query_param("today", "2026-11-20"))
      .and(query_param("timeZone", "Europe/Madrid"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::week()))),
  );
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/tasks"))
      .and(query_param("view", "overdue"))
      .and(query_param("today", "2026-11-20"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [], "nextCursor": null }))),
  );
  let mut app = started(&server);
  let week = Route::week_of(app.clock.today());
  load::go(&mut app, week);
  settle(&mut app);
  assert_eq!(app.week.data.as_ref().map(|w| w.days.len()), Some(7));
  load::go(&mut app, Route::Tasks(TaskView::Overdue));
  settle(&mut app);
  assert_eq!(app.tasks.data.as_ref().map(|l| l.items.len()), Some(0));
}

#[test]
fn a_failed_load_shows_its_message_and_try_again_fetches_again() {
  let server = api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .respond_with(ResponseTemplate::new(500).set_body_raw(r#"{"title":"Server error","status":500}"#, "application/problem+json"))
      .up_to_n_times(1),
  );
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::day()))),
  );
  let mut app = started(&server);
  assert!(app.day.data.is_none());
  assert_eq!(app.day.error.as_ref().map(|e| e.message_or("")), Some("Server error"));
  load::reload(&mut app);
  assert!(app.day.loading, "Try again starts a load");
  settle(&mut app);
  assert!(app.day.data.is_some() && app.day.error.is_none());
}

#[test]
fn load_more_appends_the_next_page() {
  let server = api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::day()))),
  );
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/tasks"))
      .and(query_param("cursor", "page-2"))
      .respond_with(
        ResponseTemplate::new(200).set_body_json(json!({ "items": [to_json(&fixtures::tasks().items[0])], "nextCursor": null })),
      ),
  );
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/tasks"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::tasks()))),
  );
  let mut app = started(&server);
  load::go(&mut app, Route::Tasks(TaskView::Upcoming));
  settle(&mut app);
  assert_eq!(
    app.tasks.data.as_ref().map(|l| (l.items.len(), l.next_cursor.clone())),
    Some((3, Some("page-2".to_owned())))
  );
  load::more_tasks(&mut app);
  settle(&mut app);
  assert_eq!(
    app.tasks.data.as_ref().map(|l| (l.items.len(), l.next_cursor.clone())),
    Some((4, None))
  );
}

#[test]
fn data_is_fetched_again_after_five_minutes_and_at_midnight() {
  let server = api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::day()))),
  );
  let mut app = started(&server);
  assert_eq!(requests(&server, "/api/agenda/day").len(), 1);
  app.clock.set_now(fixtures::now() + chrono::Duration::minutes(4));
  load::ensure(&mut app);
  settle(&mut app);
  assert_eq!(requests(&server, "/api/agenda/day").len(), 1, "fresh for five minutes");
  app.clock.set_now(fixtures::now() + chrono::Duration::minutes(5));
  load::ensure(&mut app);
  settle(&mut app);
  assert_eq!(requests(&server, "/api/agenda/day").len(), 2, "stale after five minutes");
  // 23:00 UTC is midnight in Madrid: today becomes the 21st, so the page asks for the new day.
  app.clock.set_now("2026-11-20T23:00:00Z".parse().unwrap());
  load::ensure(&mut app);
  settle(&mut app);
  let last = requests(&server, "/api/agenda/day").pop().unwrap();
  assert!(last.url.query().unwrap_or_default().contains("date=2026-11-21"), "{}", last.url);
}

#[test]
fn a_401_signs_out() {
  let server = api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .respond_with(ResponseTemplate::new(401)),
  );
  let app = started(&server);
  assert!(matches!(app.session, Session::SignedOut { .. }), "{:?}", app.session);
}

#[test]
fn a_signed_out_user_sees_no_calendar_and_no_requests() {
  let server = block(MockServer::start());
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/auth/me"))
      .respond_with(ResponseTemplate::new(401)),
  );
  let app = started(&server);
  assert!(matches!(app.session, Session::SignedOut { error: None }));
  assert!(requests(&server, "/api/agenda/day").is_empty());
}

// Task actions (#1005).

const CALL_THE_BANK: &str = "00000000-0000-4000-8000-000000000002";

fn bank(app: &App) -> bool {
  app
    .day
    .data
    .as_ref()
    .unwrap()
    .tasks
    .due_today
    .iter()
    .find(|t| t.id.to_string() == CALL_THE_BANK)
    .unwrap()
    .is_completed
}

fn day_api() -> MockServer {
  let server = api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/agenda/day"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::day()))),
  );
  server
}

fn task_response(done: bool) -> Value {
  json!({ "id": CALL_THE_BANK, "title": "Call the bank", "priority": "high", "notes": null, "dueDate": null,
    "dueAt": "2026-11-20T08:00:00Z", "completedAt": if done { json!("2026-11-20T09:00:00Z") } else { json!(null) },
    "isCompleted": done, "version": 2 })
}

#[test]
fn completing_a_task_shows_at_once_then_refetches_the_page() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("POST"))
      .and(path(format!("/api/tasks/{CALL_THE_BANK}/complete")))
      .respond_with(ResponseTemplate::new(200).set_body_json(task_response(true)))
      .expect(1),
  );
  let mut app = started(&server);
  calendar_native::actions::toggle(&mut app, CALL_THE_BANK.parse().unwrap(), true);
  assert!(bank(&app), "optimistic: done before the server answers");
  assert!(app.actions.pending.contains(&CALL_THE_BANK.parse().unwrap()));
  settle(&mut app);
  assert!(app.actions.pending.is_empty() && app.actions.toggle_error.is_none());
  assert_eq!(
    requests(&server, "/api/agenda/day").len(),
    2,
    "the page is fetched again once the toggle settles"
  );
}

#[test]
fn a_failed_toggle_undoes_that_task_alone_and_says_why() {
  for (status, message) in [
    (
      409,
      "That task was changed elsewhere. The list has been refreshed; please try again.",
    ),
    (500, "Couldn\u{2019}t update the task. Your change was undone."),
  ] {
    let server = api();
    // The refetch after the failure answers with nothing loaded, so the rollback itself is what the test sees.
    mount(
      &server,
      Mock::given(method("GET"))
        .and(path("/api/agenda/day"))
        .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::day())))
        .up_to_n_times(1),
    );
    mount(
      &server,
      Mock::given(method("GET"))
        .and(path("/api/agenda/day"))
        .respond_with(ResponseTemplate::new(503)),
    );
    mount(
      &server,
      Mock::given(method("POST"))
        .and(path(format!("/api/tasks/{CALL_THE_BANK}/complete")))
        .respond_with(ResponseTemplate::new(status)),
    );
    let mut app = started(&server);
    calendar_native::actions::toggle(&mut app, CALL_THE_BANK.parse().unwrap(), true);
    assert!(bank(&app));
    settle(&mut app);
    assert!(!bank(&app), "{status}: rolled back");
    assert_eq!(app.actions.toggle_error.as_deref(), Some(message));
    assert_eq!(
      requests(&server, "/api/agenda/day").len(),
      2,
      "{status}: refetched straight after the failure"
    );
  }
}

#[test]
fn a_burst_of_toggles_refetches_once() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("POST"))
      .and(path(format!("/api/tasks/{CALL_THE_BANK}/complete")))
      .respond_with(ResponseTemplate::new(200).set_body_json(task_response(true))),
  );
  let renew = "00000000-0000-4000-8000-000000000004";
  mount(
    &server,
    Mock::given(method("POST"))
      .and(path(format!("/api/tasks/{renew}/complete")))
      .respond_with(ResponseTemplate::new(200).set_body_json(task_response(true))),
  );
  let mut app = started(&server);
  calendar_native::actions::toggle(&mut app, CALL_THE_BANK.parse().unwrap(), true);
  calendar_native::actions::toggle(&mut app, renew.parse().unwrap(), true);
  // A second press while the first request runs does nothing (the checkbox is disabled).
  calendar_native::actions::toggle(&mut app, CALL_THE_BANK.parse().unwrap(), false);
  assert!(bank(&app));
  settle(&mut app);
  assert_eq!(requests(&server, "/api/agenda/day").len(), 2, "one refetch for the burst");
  assert_eq!(requests(&server, &format!("/api/tasks/{CALL_THE_BANK}/complete")).len(), 1);
}

#[test]
fn deleting_asks_first_then_waits_for_the_server() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("DELETE"))
      .and(path(format!("/api/tasks/{CALL_THE_BANK}")))
      .respond_with(ResponseTemplate::new(500))
      .up_to_n_times(1),
  );
  mount(
    &server,
    Mock::given(method("DELETE"))
      .and(path(format!("/api/tasks/{CALL_THE_BANK}")))
      .respond_with(ResponseTemplate::new(204)),
  );
  let mut app = started(&server);
  let id = CALL_THE_BANK.parse().unwrap();
  calendar_native::actions::ask_delete(&mut app, id, Some("Call the bank"));
  calendar_native::actions::cancel_delete(&mut app);
  assert!(app.actions.delete.is_none(), "Cancel closes it");
  assert!(requests(&server, &format!("/api/tasks/{CALL_THE_BANK}")).is_empty());
  calendar_native::actions::ask_delete(&mut app, id, Some("Call the bank"));
  calendar_native::actions::confirm_delete(&mut app);
  assert!(app.actions.delete.as_ref().unwrap().pending);
  calendar_native::actions::cancel_delete(&mut app);
  assert!(app.actions.delete.is_some(), "no cancelling while the delete runs");
  settle(&mut app);
  let dialog = app.actions.delete.clone().unwrap();
  assert_eq!(
    dialog.error.as_deref(),
    Some("Couldn\u{2019}t delete the task. Try again, or cancel.")
  );
  assert!(!dialog.pending);
  calendar_native::actions::confirm_delete(&mut app);
  settle(&mut app);
  assert!(app.actions.delete.is_none(), "closed once deleted");
  assert_eq!(requests(&server, "/api/agenda/day").len(), 2, "and the page is fetched again");
}

#[test]
fn a_toggle_on_my_tasks_uses_its_own_words() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/tasks"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::tasks()))),
  );
  let book = "00000000-0000-4000-8000-000000000101";
  mount(
    &server,
    Mock::given(method("POST"))
      .and(path(format!("/api/tasks/{book}/complete")))
      .respond_with(ResponseTemplate::new(409)),
  );
  let mut app = started(&server);
  load::go(&mut app, Route::Tasks(TaskView::Upcoming));
  settle(&mut app);
  calendar_native::actions::toggle(&mut app, book.parse().unwrap(), true);
  settle(&mut app);
  assert_eq!(
    app.actions.toggle_error.as_deref(),
    Some("That task changed elsewhere. The list has been refreshed; try again.")
  );
}

#[test]
fn deleting_from_my_tasks_counts_the_task_and_keeps_quiet_on_failure() {
  // The web app's task list opens `ConfirmDialog` with `count={1}` and no title, and shows no error text.
  let server = day_api();
  let book = "00000000-0000-4000-8000-000000000101";
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path("/api/tasks"))
      .respond_with(ResponseTemplate::new(200).set_body_json(to_json(&fixtures::tasks()))),
  );
  mount(
    &server,
    Mock::given(method("DELETE"))
      .and(path(format!("/api/tasks/{book}")))
      .respond_with(ResponseTemplate::new(500)),
  );
  let mut app = started(&server);
  load::go(&mut app, Route::Tasks(TaskView::Upcoming));
  settle(&mut app);
  calendar_native::actions::ask_delete(&mut app, book.parse().unwrap(), None);
  calendar_native::actions::confirm_delete(&mut app);
  settle(&mut app);
  let dialog = app.actions.delete.clone().expect("still open after the failure");
  assert_eq!((dialog.title, dialog.error, dialog.pending), (None, None, false));
}
