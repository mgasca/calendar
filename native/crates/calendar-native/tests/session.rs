//! The desktop sign-in through the app (ADR-0068, #1008), against a stub API: a stored session signs a restart
//! straight back in, **Sign in with Google** redeems the loopback code for the session, a refused code and an
//! abandoned browser leave the app signed out and say why, **Cancel** stops the wait, and sign-out and a 401 forget
//! the stored session.
//!
//! The browser is played by a thread that calls the app's loopback, as the API's confirm redirect would. The session
//! module keeps one origin and cookie jar per process, so these tests run one at a time, in a binary of their own,
//! and keep the session in memory: they never touch the person's keyring.
#![cfg(not(target_arch = "wasm32"))]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

use calendar_native::clock::Clock;
use calendar_native::fetch::Effects;
use calendar_native::session::{self, Session, store::Store};
use calendar_native::{App, fixtures, load};
use serde_json::{Value, json};
use std::future::Future;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn block<T>(future: impl Future<Output = T>) -> T {
  tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
    .unwrap()
    .block_on(future)
}

fn user() -> Value {
  serde_json::to_value(fixtures::user()).unwrap()
}

/// Runs every queued request and applies the results, until nothing is left.
fn settle(app: &mut App) {
  while app.effects.pending() > 0 {
    app.effects.run_pending();
    let effects = app.effects.clone();
    effects.drain(app);
  }
}

/// A stub API: `/api/auth/me` answers 200 only with `calendar_session=sealed`, the token endpoint answers `token`,
/// and logout answers 204.
fn api(token: ResponseTemplate) -> MockServer {
  let server = block(MockServer::start());
  // wiremock reuses servers from a pool, so an earlier test may have left a session for this origin.
  Store::for_origin(&server.uri()).clear();
  block(
    Mock::given(method("GET"))
      .and(path("/api/auth/me"))
      .and(header("cookie", "calendar_session=sealed"))
      .respond_with(ResponseTemplate::new(200).set_body_json(user()))
      .with_priority(1)
      .mount(&server),
  );
  block(
    Mock::given(method("GET"))
      .and(path("/api/auth/me"))
      .respond_with(ResponseTemplate::new(401))
      .with_priority(2)
      .mount(&server),
  );
  block(
    Mock::given(method("POST"))
      .and(path("/api/auth/native/token"))
      .respond_with(token)
      .mount(&server),
  );
  block(
    Mock::given(method("POST"))
      .and(path("/api/auth/logout"))
      .respond_with(ResponseTemplate::new(204))
      .mount(&server),
  );
  server
}

fn issues_the_session() -> ResponseTemplate {
  ResponseTemplate::new(204).insert_header("set-cookie", "calendar_session=sealed; path=/; samesite=lax; httponly")
}

/// An app on `server`, its session checked.
fn started(server: &MockServer) -> App {
  let mut app = App::new(&server.uri(), Clock::fixed(fixtures::ZONE, fixtures::now()), Effects::manual());
  load::ensure(&mut app);
  settle(&mut app);
  app
}

/// Plays the browser: after the confirm click the API redirects to the loopback with a code and the app's `state`.
fn browser_confirms() {
  session::open_with(|start| {
    let query: std::collections::HashMap<String, String> = start.query_pairs().into_owned().collect();
    let redirect = query["redirect_uri"].clone();
    let state = query["state"].clone();
    std::thread::spawn(move || {
      let address = redirect.trim_start_matches("http://").trim_end_matches("/callback").to_owned();
      let mut stream = TcpStream::connect(address).unwrap();
      write!(
        stream,
        "GET /callback?code=the-code&state={state} HTTP/1.1\r\nHost: loopback\r\n\r\n"
      )
      .unwrap();
      let mut answer = String::new();
      let _ = stream.read_to_string(&mut answer);
    });
    Ok(())
  });
}

fn signed_in_email(app: &App) -> Option<String> {
  match &app.session {
    Session::SignedIn(user) => Some(user.email.clone()),
    _ => None,
  }
}

fn setup() -> std::sync::MutexGuard<'static, ()> {
  let guard = ONE_AT_A_TIME.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
  session::store::use_memory_store();
  guard
}

#[test]
fn sign_in_redeems_the_loopback_code_and_a_restart_stays_signed_in() {
  let _one = setup();
  let server = api(issues_the_session());
  browser_confirms();

  let mut app = started(&server);
  assert!(matches!(app.session, Session::SignedOut { error: None }), "{:?}", app.session);

  session::start(&mut app);
  assert!(matches!(app.session, Session::SigningIn));
  settle(&mut app);
  assert_eq!(signed_in_email(&app), Some(fixtures::user().email), "{:?}", app.session);

  let token = block(server.received_requests())
    .unwrap()
    .into_iter()
    .find(|request| request.url.path() == "/api/auth/native/token")
    .expect("the code was redeemed");
  let body: Value = serde_json::from_slice(&token.body).unwrap();
  assert_eq!(body["code"], "the-code");
  assert_eq!(body["codeVerifier"].as_str().map(str::len), Some(43));

  // A restart loads the stored session: `/api/auth/me` signs it straight back in.
  assert_eq!(Store::for_origin(&server.uri()).load().as_deref(), Some("sealed"));
  let restarted = started(&server);
  assert_eq!(signed_in_email(&restarted), Some(fixtures::user().email), "{:?}", restarted.session);
}

#[test]
fn sign_out_calls_logout_with_the_session_and_forgets_it() {
  let _one = setup();
  let server = api(issues_the_session());
  Store::for_origin(&server.uri()).save("sealed");
  let mut app = started(&server);
  assert!(signed_in_email(&app).is_some(), "{:?}", app.session);

  session::sign_out(&mut app);
  assert!(matches!(app.session, Session::SignedOut { error: None }));
  settle(&mut app);

  let logout = block(server.received_requests())
    .unwrap()
    .into_iter()
    .find(|request| request.url.path() == "/api/auth/logout")
    .expect("logout was called");
  assert_eq!(
    logout.headers.get("cookie").and_then(|v| v.to_str().ok()),
    Some("calendar_session=sealed")
  );
  assert_eq!(Store::for_origin(&server.uri()).load(), None, "the stored session is gone");
  let restarted = started(&server);
  assert!(matches!(restarted.session, Session::SignedOut { .. }), "{:?}", restarted.session);
}

#[test]
fn a_refused_code_leaves_the_app_signed_out_and_says_why() {
  let _one = setup();
  let server = api(ResponseTemplate::new(400).set_body_json(json!({"title": "invalid_grant"})));
  browser_confirms();
  let mut app = started(&server);

  session::start(&mut app);
  settle(&mut app);
  match &app.session {
    Session::SignedOut { error: Some(error) } => assert_eq!(error, "Sign-in was not accepted. Try again."),
    other => panic!("{other:?}"),
  }
  assert_eq!(Store::for_origin(&server.uri()).load(), None, "no session is stored");
}

#[test]
fn cancel_stops_waiting_for_the_browser_and_signs_nobody_in() {
  let _one = setup();
  let server = api(issues_the_session());
  // A browser that never comes back.
  session::open_with(|_| Ok(()));
  let mut app = started(&server);

  session::start(&mut app);
  session::cancel(&mut app);
  assert!(matches!(app.session, Session::SignedOut { error: None }));
  let started_at = std::time::Instant::now();
  settle(&mut app);
  assert!(started_at.elapsed() < Duration::from_secs(5), "the wait ended at once");
  assert!(matches!(app.session, Session::SignedOut { error: None }), "{:?}", app.session);
  assert_eq!(Store::for_origin(&server.uri()).load(), None);
}

#[test]
fn a_401_forgets_the_stored_session() {
  let _one = setup();
  let server = api(issues_the_session());
  Store::for_origin(&server.uri()).save("sealed");
  let mut app = started(&server);
  assert!(signed_in_email(&app).is_some());

  session::on_unauthorized(&mut app);
  assert!(matches!(app.session, Session::SignedOut { error: None }));
  assert_eq!(Store::for_origin(&server.uri()).load(), None);
}

#[test]
fn only_the_first_401_of_an_expired_session_touches_the_store() {
  let _one = setup();
  let server = api(issues_the_session());
  Store::for_origin(&server.uri()).save("sealed");
  let mut app = started(&server);
  session::on_unauthorized(&mut app);
  assert_eq!(Store::for_origin(&server.uri()).load(), None);

  // The other page loads that were in flight answer 401 too. The app is already signed out, so they must not make
  // another blocking keyring call on the UI thread: an entry put back here stands in for the keyring, and stays.
  Store::for_origin(&server.uri()).save("untouched");
  session::on_unauthorized(&mut app);
  session::on_unauthorized(&mut app);
  assert_eq!(Store::for_origin(&server.uri()).load().as_deref(), Some("untouched"));
  Store::for_origin(&server.uri()).clear();
}
