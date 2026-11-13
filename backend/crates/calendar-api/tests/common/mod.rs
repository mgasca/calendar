//! The API test harness (ports `ApiTestBase`, `CalendarApiFactory`, `FakeAuthenticationHandler`,
//! `TestHostDefaults` and `PostgresFixture` of `Calendar.Api.Tests`).
//!
//! ```ignore
//! mod common;
//! use common::*;
//!
//! #[tokio::test]
//! async fn a_task_can_be_created() {
//!   let app = TestApp::start().await;                       // own database, clock at 2026-10-26T15:00Z
//!   let response = app.client().post_json("/api/tasks", &json!({"title": "x"})).await;
//!   assert_eq!(response.status, StatusCode::CREATED);
//!   let other = app.client_as(USER_B).get("/api/tasks?view=no-deadline").await;   // another signed-in user
//! }
//! ```
//!
//! - **One app per test.** [`TestApp::start`] builds the application in process on a database of the test's
//!   own (a clone of the migrated template on the test binary's PostgreSQL container, dropped afterwards), with
//!   the tables empty except for the two users [`USER_A`] and [`USER_B`]. Requests go straight into the
//!   router; nothing listens on a port. Needs Docker.
//! - **Signed-in users.** By default the app is built with [`FakeAuthenticator`], the test-only
//!   [`Authenticator`] hook: every request acts as [`USER_A`], or as the user in the `X-Test-User` header
//!   ([`TestApp::client_as`]). [`TestAppBuilder::real_authentication`] builds the app as production does, so
//!   only the session cookie (and, in Development with a key, the seed header) signs a request in;
//!   [`TestApp::session_cookie`] mints a cookie for such a test.
//! - **Clock.** [`TestApp::clock`] starts at [`START`]; `set` and `advance` move it.
//! - **Settings.** Nothing is read from the process environment, so a developer's `.env` never reaches a
//!   test. [`TestAppBuilder::setting`] takes the names the host reads (`Auth__DevSeedKey`, ...); the default
//!   environment is `Development`, as under `WebApplicationFactory`.
//! - **Database.** [`TestApp::database`] is the `calendar_testing::TestDatabase`: connect as
//!   `calendar_migrator` to arrange or inspect rows. [`TestApp::seed`] inserts domain entities directly.
//!
//! Each file in `tests/` is its own test binary with its own container; start with `mod common;`.
#![allow(dead_code, unused_imports, reason = "each test binary uses a different part of the harness")]

use std::path::Path;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::header::{CONTENT_TYPE, COOKIE, HOST, SET_COOKIE};
pub use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode};
use calendar_api::app;
use calendar_api::auth::google::GoogleEndpoints;
pub use calendar_api::auth::session::{SESSION_COOKIE, SessionTicket};
pub use calendar_api::auth::{AuthOutcome, Authenticator, Principal};
use calendar_api::clock::Clock;
use calendar_api::config::Settings;
pub use calendar_api::contracts::*;
use calendar_api::state::{AppOptions, AppState};
pub use calendar_domain::events::CalendarEvent;
pub use calendar_domain::tasks::TodoTask;
use calendar_infrastructure::{OwnerId, events, tasks};
pub use calendar_testing::TestDatabase;
use chrono::TimeZone;
pub use chrono::{DateTime, NaiveDate, TimeDelta, Utc};
use serde::Serialize;
use serde::de::DeserializeOwned;
pub use serde_json::{Value, json};
use tower::ServiceExt;
pub use uuid::Uuid;

/// The user every request acts as unless it says otherwise.
pub const USER_A: Uuid = Uuid::from_u128(0xaaaa_aaaa_aaaa_4aaa_8aaa_aaaa_aaaa_aaaa);
/// A second user, for cross-user tests.
pub const USER_B: Uuid = Uuid::from_u128(0xbbbb_bbbb_bbbb_4bbb_8bbb_bbbb_bbbb_bbbb);
/// The owner of rows the tests arrange: [`USER_A`].
pub const OWNER: Uuid = USER_A;
/// [`USER_A`]'s email.
pub const USER_A_EMAIL: &str = "a@example.com";
/// [`USER_B`]'s email.
pub const USER_B_EMAIL: &str = "b@example.com";

/// The header that tells [`FakeAuthenticator`] which user a request acts as.
pub const USER_HEADER: &str = "x-test-user";

/// The host name requests carry, as under the .NET test server.
pub const TEST_HOST: &str = "localhost";

/// Where the test clock starts: 2026-10-26T15:00:00Z.
pub fn start_time() -> DateTime<Utc> {
  utc(2026, 10, 26, 15, 0)
}

/// A UTC instant at a whole minute.
pub fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
  Utc
    .with_ymd_and_hms(year, month, day, hour, minute, 0)
    .single()
    .expect("a valid instant")
}

/// A date.
pub fn date(year: i32, month: u32, day: u32) -> NaiveDate {
  NaiveDate::from_ymd_opt(year, month, day).expect("a valid date")
}

/// A clock the test moves by hand (the `FakeTimeProvider` of the .NET tests).
#[derive(Debug)]
pub struct TestClock(Mutex<DateTime<Utc>>);

impl TestClock {
  /// A clock stopped at `now`.
  pub fn new(now: DateTime<Utc>) -> Self {
    Self(Mutex::new(now))
  }

  /// The current instant of the clock.
  pub fn now(&self) -> DateTime<Utc> {
    *self.0.lock().expect("the clock is not poisoned")
  }

  /// Moves the clock to `now`.
  pub fn set(&self, now: DateTime<Utc>) {
    *self.0.lock().expect("the clock is not poisoned") = now;
  }

  /// Moves the clock forward by `delta`.
  pub fn advance(&self, delta: TimeDelta) {
    let mut now = self.0.lock().expect("the clock is not poisoned");
    *now += delta;
  }
}

impl Clock for TestClock {
  fn now(&self) -> DateTime<Utc> {
    TestClock::now(self)
  }
}

/// Authenticates every request as a test user: [`USER_A`], unless the request carries [`USER_HEADER`] with
/// another id, so one app can act as several people. The name is "Test" and the email the user's.
#[derive(Debug, Clone, Copy, Default)]
pub struct FakeAuthenticator;

impl Authenticator for FakeAuthenticator {
  fn authenticate(&self, headers: &HeaderMap) -> AuthOutcome {
    let mut values = headers.get_all(USER_HEADER).iter();
    let user = match (values.next(), values.next()) {
      (Some(value), None) => value.to_str().ok().and_then(|text| Uuid::try_parse(text).ok()).unwrap_or(USER_A),
      _ => USER_A,
    };
    AuthOutcome::Authenticated(Principal {
      user_id: user,
      name: Some("Test".to_owned()),
      email: Some(if user == USER_B { USER_B_EMAIL } else { USER_A_EMAIL }.to_owned()),
      picture: None,
    })
  }
}

/// Configures a [`TestApp`].
pub struct TestAppBuilder {
  vars: Vec<(String, String)>,
  database: DatabaseChoice,
  clock: Arc<TestClock>,
  authenticator: Option<Arc<dyn Authenticator>>,
  google_endpoints: GoogleEndpoints,
  meter: opentelemetry::metrics::Meter,
}

enum DatabaseChoice {
  Fresh,
  Shared(Arc<TestDatabase>),
  None,
}

impl TestAppBuilder {
  fn new() -> Self {
    Self {
      vars: vec![("ASPNETCORE_ENVIRONMENT".to_owned(), "Development".to_owned())],
      database: DatabaseChoice::Fresh,
      clock: Arc::new(TestClock::new(start_time())),
      authenticator: Some(Arc::new(FakeAuthenticator)),
      google_endpoints: GoogleEndpoints::default(),
      meter: opentelemetry::global::meter("calendar-api-tests"),
    }
  }

  /// Records the HTTP server metrics with `meter` (the telemetry tests' in-memory one).
  #[must_use]
  pub fn meter(mut self, meter: opentelemetry::metrics::Meter) -> Self {
    self.meter = meter;
    self
  }

  /// Sets a setting by the name the host reads, e.g. `Auth__DevSeedKey` or `Auth__AllowedEmails__0`. A later
  /// value for the same name wins.
  #[must_use]
  pub fn setting(mut self, name: &str, value: &str) -> Self {
    self.vars.retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
    self.vars.push((name.to_owned(), value.to_owned()));
    self
  }

  /// Sets `ASPNETCORE_ENVIRONMENT` (`Development` by default).
  #[must_use]
  pub fn environment(self, name: &str) -> Self {
    self.setting("ASPNETCORE_ENVIRONMENT", name)
  }

  /// Builds the app without a connection string: it starts, and only requests that need the database fail.
  #[must_use]
  pub fn without_database(mut self) -> Self {
    self.database = DatabaseChoice::None;
    self
  }

  /// Builds the app as production does, without the test authenticator: only a session cookie (or, in
  /// Development with `Auth__DevSeedKey`, the seed header) signs a request in.
  #[must_use]
  pub fn real_authentication(mut self) -> Self {
    self.authenticator = None;
    self
  }

  /// Replaces [`FakeAuthenticator`] with another test authenticator.
  #[must_use]
  pub fn authenticator(mut self, authenticator: impl Authenticator) -> Self {
    self.authenticator = Some(Arc::new(authenticator));
    self
  }

  /// Points the Google sign-in at other endpoints (a local fake).
  #[must_use]
  pub fn google_endpoints(mut self, endpoints: GoogleEndpoints) -> Self {
    self.google_endpoints = endpoints;
    self
  }

  /// Serves the web app's static files from `root`.
  #[must_use]
  pub fn web_root(self, root: &Path) -> Self {
    self.setting("ASPNETCORE_WEBROOT", &root.to_string_lossy())
  }

  /// Starts the app. With a fresh database, the tables are emptied and [`USER_A`] and [`USER_B`] inserted.
  pub async fn start(mut self) -> TestApp {
    let database = match self.database {
      DatabaseChoice::Fresh => {
        let database = Arc::new(TestDatabase::migrated().await);
        seed_users(&database).await;
        Some(database)
      }
      DatabaseChoice::Shared(database) => Some(database),
      DatabaseChoice::None => None,
    };
    if let Some(database) = &database
      && !self
        .vars
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("ConnectionStrings__Calendar"))
    {
      self
        .vars
        .push(("ConnectionStrings__Calendar".to_owned(), database.app_connection_string()));
    }

    let state = AppState::new(AppOptions {
      settings: Settings::from_vars(self.vars.clone()),
      clock: self.clock.clone(),
      google_endpoints: self.google_endpoints.clone(),
      authenticator: self.authenticator.clone(),
      meter: self.meter.clone(),
    })
    .expect("the test settings are valid");
    TestApp {
      clock: self.clock,
      router: app::router(state.clone()),
      state,
      database,
      vars: self.vars,
      authenticator: self.authenticator,
      google_endpoints: self.google_endpoints,
    }
  }

  /// The startup failure of these settings, for tests of refused configurations.
  pub fn start_error(self) -> String {
    match AppState::new(AppOptions {
      settings: Settings::from_vars(self.vars),
      clock: self.clock,
      google_endpoints: self.google_endpoints,
      authenticator: self.authenticator,
      meter: self.meter,
    }) {
      Ok(_) => panic!("the app started"),
      Err(error) => error.to_string(),
    }
  }
}

/// Empties the users table (the migrations insert the legacy owner; the .NET tests started from empty
/// tables) and inserts [`USER_A`] and [`USER_B`].
async fn seed_users(database: &TestDatabase) {
  let client = database.migrator_client().await;
  client
    .batch_execute(&format!(
      "DELETE FROM users; \
       INSERT INTO users (id, email, created_at) VALUES ('{USER_A}', '{USER_A_EMAIL}', now()), ('{USER_B}', '{USER_B_EMAIL}', now())"
    ))
    .await
    .expect("the test users are inserted");
}

/// The application under test, in process, with its own database and clock.
pub struct TestApp {
  /// The clock the app reads; starts at [`start_time`].
  pub clock: Arc<TestClock>,
  router: Router,
  state: AppState,
  database: Option<Arc<TestDatabase>>,
  vars: Vec<(String, String)>,
  authenticator: Option<Arc<dyn Authenticator>>,
  google_endpoints: GoogleEndpoints,
}

impl TestApp {
  /// The default app: Development, a fresh database with the two users, requests acting as [`USER_A`].
  pub async fn start() -> Self {
    Self::builder().start().await
  }

  /// A builder with the defaults of [`TestApp::start`].
  pub fn builder() -> TestAppBuilder {
    TestAppBuilder::new()
  }

  /// A builder for another app on this app's database, clock and settings (`Factory.WithWebHostBuilder`).
  pub fn reconfigure(&self) -> TestAppBuilder {
    TestAppBuilder {
      vars: self.vars.clone(),
      database: self.database.clone().map_or(DatabaseChoice::None, DatabaseChoice::Shared),
      clock: self.clock.clone(),
      authenticator: self.authenticator.clone(),
      google_endpoints: self.google_endpoints.clone(),
      meter: opentelemetry::global::meter("calendar-api-tests"),
    }
  }

  /// This app's database: connect as `calendar_migrator` to arrange or inspect rows.
  pub fn database(&self) -> &TestDatabase {
    self.database.as_deref().expect("the app was started without a database")
  }

  /// The app's state: its settings, session sealer and sign-in functions.
  pub fn state(&self) -> &AppState {
    &self.state
  }

  /// The router, for a request the client helpers cannot express.
  pub fn router(&self) -> Router {
    self.router.clone()
  }

  /// A client whose requests carry nothing but the host: they act as [`USER_A`] under [`FakeAuthenticator`],
  /// and as nobody under real authentication.
  pub fn client(&self) -> TestClient {
    let mut headers = HeaderMap::new();
    headers.insert(HOST, HeaderValue::from_static(TEST_HOST));
    TestClient {
      router: self.router.clone(),
      headers,
    }
  }

  /// A client whose requests act as `user` (under [`FakeAuthenticator`]).
  pub fn client_as(&self, user: Uuid) -> TestClient {
    self.client().header(USER_HEADER, &user.to_string())
  }

  /// A `Cookie` header value holding a session cookie for `ticket`, sealed with this app's key.
  pub async fn session_cookie(&self, ticket: &SessionTicket) -> String {
    let sealer = self.state.sealer().await.expect("the session key is available");
    format!("{SESSION_COOKIE}={}", ticket.seal(&sealer))
  }

  /// Inserts rows directly (as the schema owner), bypassing the API, to arrange exact states. Each row
  /// belongs to the owner the entity names.
  pub async fn seed(&self, events_to_add: &[CalendarEvent], tasks_to_add: &[TodoTask]) {
    let mut connection = self.database().migrator_connection().await;
    for event in events_to_add {
      events::insert(&mut connection, OwnerId(event.owner_id()), event)
        .await
        .expect("the event is inserted");
    }
    for task in tasks_to_add {
      tasks::insert(&mut connection, OwnerId(task.owner_id()), task)
        .await
        .expect("the task is inserted");
    }
  }

  /// `GET /api/agenda/day` as [`USER_A`]; panics unless it answers 200.
  pub async fn get_agenda(&self, date: &str, zone: &str) -> DayAgendaResponse {
    self
      .client()
      .get(&format!("/api/agenda/day?date={date}&timeZone={}", escape(zone)))
      .await
      .success()
      .json()
  }

  /// `GET /api/agenda/week` as [`USER_A`]; panics unless it answers 200.
  pub async fn get_week_agenda(&self, date: &str, zone: &str, today: &str) -> WeekAgendaResponse {
    self
      .client()
      .get(&format!("/api/agenda/week?date={date}&timeZone={}&today={today}", escape(zone)))
      .await
      .success()
      .json()
  }
}

/// Percent-encodes a query value (`Uri.EscapeDataString`).
pub fn escape(value: &str) -> String {
  value
    .bytes()
    .map(|byte| match byte {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => char::from(byte).to_string(),
      other => format!("%{other:02X}"),
    })
    .collect()
}

/// An open task of [`OWNER`] with medium priority and no notes.
pub fn task(title: &str, due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>) -> TodoTask {
  task_of(OWNER, title, due_date, due_at)
}

/// An open task of `owner` with medium priority and no notes.
pub fn task_of(owner: Uuid, title: &str, due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>) -> TodoTask {
  TodoTask::create(owner, title, due_date, due_at, "medium", None).expect("a valid task")
}

/// A task of [`OWNER`] completed at `completed_at`.
pub fn completed_task(title: &str, due_date: Option<NaiveDate>, completed_at: DateTime<Utc>, due_at: Option<DateTime<Utc>>) -> TodoTask {
  let mut task = task(title, due_date, due_at);
  task.complete(completed_at);
  task
}

/// Sends requests into the app. Cheap to clone; [`TestClient::header`] adds a header to every request.
#[derive(Clone)]
pub struct TestClient {
  router: Router,
  headers: HeaderMap,
}

impl TestClient {
  /// The client with `name: value` on every request (replacing an earlier value of `name`).
  #[must_use]
  pub fn header(mut self, name: &str, value: &str) -> Self {
    self.headers.insert(
      HeaderName::try_from(name).expect("a valid header name"),
      HeaderValue::try_from(value).expect("a valid header value"),
    );
    self
  }

  /// The client presenting `cookie` (`name=value`) on every request.
  #[must_use]
  pub fn cookie(self, cookie: &str) -> Self {
    self.header(COOKIE.as_str(), cookie)
  }

  /// `GET path`.
  pub async fn get(&self, path: &str) -> TestResponse {
    self.send(Method::GET, path, None).await
  }

  /// `DELETE path`.
  pub async fn delete(&self, path: &str) -> TestResponse {
    self.send(Method::DELETE, path, None).await
  }

  /// `POST path` without a body.
  pub async fn post(&self, path: &str) -> TestResponse {
    self.send(Method::POST, path, None).await
  }

  /// `POST path` with a JSON body.
  pub async fn post_json<T: Serialize + ?Sized>(&self, path: &str, body: &T) -> TestResponse {
    self.send_json(Method::POST, path, body).await
  }

  /// `PUT path` with a JSON body.
  pub async fn put_json<T: Serialize + ?Sized>(&self, path: &str, body: &T) -> TestResponse {
    self.send_json(Method::PUT, path, body).await
  }

  /// `method path` with a JSON body.
  pub async fn send_json<T: Serialize + ?Sized>(&self, method: Method, path: &str, body: &T) -> TestResponse {
    let json = serde_json::to_vec(body).expect("the body serializes");
    self.send(method, path, Some(("application/json", json))).await
  }

  /// `method path` with an optional body given as `(content type, bytes)`: for bodies that are not valid
  /// JSON, or not JSON at all.
  pub async fn send(&self, method: Method, path: &str, body: Option<(&str, Vec<u8>)>) -> TestResponse {
    let mut request = Request::builder().method(method).uri(path);
    let body = match body {
      Some((content_type, bytes)) => {
        request = request.header(CONTENT_TYPE, content_type);
        Body::from(bytes)
      }
      None => Body::empty(),
    };
    self.request(request.body(body).expect("a valid request")).await
  }

  /// Sends `request` as it is, plus the client's headers where the request has none of that name.
  pub async fn request(&self, mut request: Request<Body>) -> TestResponse {
    for (name, value) in &self.headers {
      if !request.headers().contains_key(name) {
        request.headers_mut().insert(name.clone(), value.clone());
      }
    }
    let response = self.router.clone().oneshot(request).await.expect("the router is infallible");
    let (parts, body) = response.into_parts();
    let body = axum::body::to_bytes(body, usize::MAX).await.expect("the response body is readable");
    TestResponse {
      status: parts.status,
      headers: parts.headers,
      body: body.to_vec(),
    }
  }
}

/// A response, read to the end.
#[derive(Debug, Clone)]
pub struct TestResponse {
  /// The status code.
  pub status: StatusCode,
  /// The headers.
  pub headers: HeaderMap,
  /// The body.
  pub body: Vec<u8>,
}

impl TestResponse {
  /// The response, after asserting its status is 2xx (`EnsureSuccessStatusCode`).
  #[must_use]
  pub fn success(self) -> Self {
    assert!(self.status.is_success(), "expected success, got {}: {}", self.status, self.text());
    self
  }

  /// The body as text.
  pub fn text(&self) -> String {
    String::from_utf8_lossy(&self.body).into_owned()
  }

  /// The body as `T`.
  pub fn json<T: DeserializeOwned>(&self) -> T {
    serde_json::from_slice(&self.body).unwrap_or_else(|error| panic!("the body is not the expected JSON ({error}): {}", self.text()))
  }

  /// The body as a JSON value.
  pub fn value(&self) -> Value {
    self.json()
  }

  /// The first value of header `name`.
  pub fn header(&self, name: &str) -> Option<&str> {
    self.headers.get(name).and_then(|value| value.to_str().ok())
  }

  /// The media type of the body, without parameters.
  pub fn media_type(&self) -> Option<&str> {
    self
      .header(CONTENT_TYPE.as_str())
      .and_then(|value| value.split(';').next())
      .map(str::trim)
  }

  /// Every `Set-Cookie` value.
  pub fn set_cookies(&self) -> Vec<&str> {
    self
      .headers
      .get_all(SET_COOKIE)
      .iter()
      .filter_map(|value| value.to_str().ok())
      .collect()
  }

  /// The messages of field `field` in a validation problem's `errors`; empty when it has none.
  pub fn errors(&self, field: &str) -> Vec<String> {
    self.value()["errors"][field]
      .as_array()
      .map(|messages| messages.iter().filter_map(|message| message.as_str().map(str::to_owned)).collect())
      .unwrap_or_default()
  }

  /// The `title` of a problem response.
  pub fn problem_title(&self) -> String {
    self.value()["title"].as_str().unwrap_or_default().to_owned()
  }
}
