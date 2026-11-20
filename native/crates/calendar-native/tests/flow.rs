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

// Add and edit dialogs (#1006).

use calendar_native::dialogs::{self, Dialog, Load};
use calendar_native::forms::{EventField, TaskField};
use wiremock::matchers::body_partial_json;

const DESIGN_REVIEW: &str = "20000000-0000-4000-8000-000000000002";

fn stored_event(version: u32, title: &str) -> Value {
  json!({ "id": DESIGN_REVIEW, "title": title, "allDay": false, "start": "2026-11-20T08:30:00Z",
    "end": "2026-11-20T10:00:00Z", "timeZone": "Europe/Madrid", "startDate": null, "endDate": null,
    "location": "Room 2", "notes": null, "version": version })
}

fn event_dialog(app: &App) -> &dialogs::EventDialog {
  match &app.dialog {
    Some(Dialog::Event(d)) => d,
    other => panic!("no event dialog: {other:?}"),
  }
}

fn task_dialog(app: &App) -> &dialogs::TaskDialog {
  match &app.dialog {
    Some(Dialog::Task(d)) => d,
    other => panic!("no task dialog: {other:?}"),
  }
}

#[test]
fn adding_a_task_sends_the_day_and_says_where_it_went() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("POST"))
      .and(path("/api/tasks"))
      .and(body_partial_json(
        json!({ "title": "Buy stamps", "priority": "medium", "dueDate": "2026-11-23" }),
      ))
      .respond_with(ResponseTemplate::new(201).set_body_json(task_response(false)))
      .expect(1),
  );
  let mut app = started(&server);
  dialogs::add_task(&mut app, Some(fixtures::now().date_naive()));
  if let Some(Dialog::Task(d)) = &mut app.dialog {
    d.title.replace_text("Buy stamps");
    d.due_date.replace_text("2026-11-23");
  }
  dialogs::save_task(&mut app);
  assert!(task_dialog(&app).saving, "Saving…");
  settle(&mut app);
  assert!(app.dialog.is_none());
  let notice = app.notice.clone().unwrap();
  assert_eq!(notice.text, "\u{201c}Buy stamps\u{201d} added for Mon 23 Nov.");
  assert_eq!(notice.show_day, Some("2026-11-23".parse().unwrap()), "another day: Show day");
  assert_eq!(requests(&server, "/api/agenda/day").len(), 2, "the agenda is fetched again");
}

#[test]
fn a_task_form_that_is_not_valid_never_reaches_the_server() {
  let server = day_api();
  let mut app = started(&server);
  dialogs::add_task(&mut app, None);
  dialogs::save_task(&mut app);
  assert_eq!(
    task_dialog(&app).errors.get(&TaskField::Title).map(String::as_str),
    Some("Enter a title.")
  );
  assert!(task_dialog(&app).title.focused, "focus goes to the first invalid field");
  assert_eq!(app.effects.pending(), 0);
}

#[test]
fn editing_an_event_loads_it_then_saves_with_its_version() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(200).set_body_json(stored_event(4, "Design review"))),
  );
  mount(
    &server,
    Mock::given(method("PUT"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .and(body_partial_json(
        json!({ "title": "Design review (moved)", "version": 4, "timeZone": "Europe/Madrid", "start": "2026-11-20T08:30:00Z" }),
      ))
      .respond_with(ResponseTemplate::new(200).set_body_json(stored_event(5, "Design review (moved)")))
      .expect(1),
  );
  let mut app = started(&server);
  dialogs::edit_event(&mut app, DESIGN_REVIEW.parse().unwrap());
  assert_eq!(event_dialog(&app).load, Load::Loading);
  settle(&mut app);
  let dialog = event_dialog(&app);
  assert_eq!(
    (
      dialog.title.text.as_str(),
      dialog.start_time.text.as_str(),
      dialog.end_time.text.as_str()
    ),
    ("Design review", "09:30", "11:00")
  );
  assert_eq!(dialog.location.text, "Room 2");
  if let Some(Dialog::Event(d)) = &mut app.dialog {
    d.title.replace_text("Design review (moved)");
  }
  dialogs::save_event(&mut app);
  settle(&mut app);
  assert!(app.dialog.is_none());
  assert_eq!(app.notice.as_ref().map(|n| n.text.as_str()), Some("Design review (moved) saved."));
}

#[test]
fn a_400_lands_on_its_field_and_a_409_reloads_the_latest_copy() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(200).set_body_json(stored_event(4, "Design review")))
      .up_to_n_times(1),
  );
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(200).set_body_json(stored_event(6, "Design review (theirs)"))),
  );
  mount(
    &server,
    Mock::given(method("PUT"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(400).set_body_raw(
        r#"{"title":"Invalid","errors":{"Location":["Location is too long."]}}"#,
        "application/problem+json",
      ))
      .up_to_n_times(1),
  );
  mount(
    &server,
    Mock::given(method("PUT"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(409)),
  );
  let mut app = started(&server);
  dialogs::edit_event(&mut app, DESIGN_REVIEW.parse().unwrap());
  settle(&mut app);
  dialogs::save_event(&mut app);
  settle(&mut app);
  let dialog = event_dialog(&app);
  assert_eq!(
    dialog.errors.get(&EventField::Location).map(String::as_str),
    Some("Location is too long.")
  );
  assert!(!dialog.saving && dialog.location.focused);
  dialogs::save_event(&mut app);
  settle(&mut app);
  let dialog = event_dialog(&app);
  assert_eq!(dialog.title.text, "Design review (theirs)", "the latest copy is shown");
  assert_eq!(
    dialog.errors.get(&EventField::Form).map(String::as_str),
    Some("This event was changed elsewhere. The latest version is shown; check it and save again.")
  );
  assert!(matches!(
    dialog.version,
    Some(calendar_client::generated::UpdateEventRequestVersion::UnsignedInteger(6))
  ));
}

#[test]
fn an_event_that_no_longer_exists_disables_save() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(404)),
  );
  let mut app = started(&server);
  dialogs::edit_event(&mut app, DESIGN_REVIEW.parse().unwrap());
  settle(&mut app);
  let dialog = event_dialog(&app);
  assert!(dialog.gone);
  assert_eq!(
    dialog.errors.get(&EventField::Form).map(String::as_str),
    Some("This event no longer exists.")
  );
  dialogs::save_event(&mut app);
  assert_eq!(app.effects.pending(), 0, "Save does nothing");
}

#[test]
fn a_failed_load_offers_try_again() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(500))
      .up_to_n_times(1),
  );
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(200).set_body_json(stored_event(4, "Design review"))),
  );
  let mut app = started(&server);
  dialogs::edit_event(&mut app, DESIGN_REVIEW.parse().unwrap());
  settle(&mut app);
  assert_eq!(event_dialog(&app).load, Load::Failed);
  dialogs::retry_load(&mut app);
  settle(&mut app);
  assert_eq!(event_dialog(&app).load, Load::Ready);
}

#[test]
fn an_event_is_deleted_from_its_dialog_after_asking() {
  let server = day_api();
  mount(
    &server,
    Mock::given(method("GET"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(200).set_body_json(stored_event(4, "Design review"))),
  );
  mount(
    &server,
    Mock::given(method("DELETE"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(500))
      .up_to_n_times(1),
  );
  mount(
    &server,
    Mock::given(method("DELETE"))
      .and(path(format!("/api/events/{DESIGN_REVIEW}")))
      .respond_with(ResponseTemplate::new(204)),
  );
  let mut app = started(&server);
  dialogs::edit_event(&mut app, DESIGN_REVIEW.parse().unwrap());
  settle(&mut app);
  dialogs::delete_event(&mut app);
  assert_eq!(app.effects.pending(), 0, "nothing is deleted before asking");
  dialogs::ask_delete_event(&mut app);
  dialogs::keep_event(&mut app);
  assert!(!event_dialog(&app).confirm_delete, "Keep event");
  dialogs::ask_delete_event(&mut app);
  dialogs::delete_event(&mut app);
  settle(&mut app);
  assert_eq!(
    event_dialog(&app).errors.get(&EventField::Form).map(String::as_str),
    Some("Couldn\u{2019}t delete the event. Try again.")
  );
  dialogs::ask_delete_event(&mut app);
  dialogs::delete_event(&mut app);
  settle(&mut app);
  assert!(app.dialog.is_none());
  assert_eq!(app.notice.as_ref().map(|n| n.text.as_str()), Some("Design review deleted."));
}

#[test]
fn editing_the_start_keeps_the_length() {
  let server = day_api();
  let mut app = started(&server);
  dialogs::add_event(&mut app, "2026-11-23".parse().unwrap());
  if let Some(Dialog::Event(d)) = &mut app.dialog {
    d.end_time.replace_text("11:30");
    d.start_time.replace_text("14:00");
  }
  dialogs::follow_start(&mut app);
  assert_eq!(event_dialog(&app).end_time.text, "16:30", "09:00–11:30 moved to 14:00 keeps 2 h 30");
}

#[test]
fn a_fields_error_clears_when_that_field_is_edited() {
  let server = day_api();
  let mut app = started(&server);
  dialogs::add_task(&mut app, None);
  dialogs::save_task(&mut app);
  dialogs::clear_edited_errors(&mut app);
  assert!(
    task_dialog(&app).errors.contains_key(&TaskField::Title),
    "it stays until the field changes"
  );
  if let Some(Dialog::Task(d)) = &mut app.dialog {
    d.title.replace_text("B");
  }
  dialogs::clear_edited_errors(&mut app);
  assert!(!task_dialog(&app).errors.contains_key(&TaskField::Title));
}
