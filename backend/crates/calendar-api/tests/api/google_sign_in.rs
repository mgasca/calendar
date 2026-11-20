//! The Google sign-in round trip against a local fake of Google's token and userinfo endpoints. The .NET
//! suite could not automate this (it exercised only the `OnCreatingTicket` glue); here the endpoints are
//! injectable, so the whole flow runs: redirect with `state`, PKCE and `nonce`, callback, code exchange,
//! allow-list, user row and session cookie.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::common::*;
use crate::sign_in::UserRow;
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use calendar_api::auth::google::{CALLBACK_PATH, FAILURE_REDIRECT, GoogleEndpoints, SIGN_IN_COOKIE};
use sha2::{Digest, Sha256};

const CLIENT_ID: &str = "test-client";
const CLIENT_SECRET: &str = "test-secret";
const CODE: &str = "the-code";

/// What the fake Google answers, and what it saw.
#[derive(Default)]
struct FakeGoogle {
  /// The claims of the person signing in (userinfo and ID token).
  claims: Value,
  /// The `nonce` and `code_challenge` of the authorization request, as Google would remember them.
  nonce: String,
  code_challenge: String,
  /// The form the API posted to the token endpoint.
  token_request: Option<HashMap<String, String>>,
}

type Shared = Arc<Mutex<FakeGoogle>>;

async fn token(State(google): State<Shared>, Form(form): Form<HashMap<String, String>>) -> Result<Json<Value>, StatusCode> {
  let mut google = google.lock().unwrap();
  let verifier = form.get("code_verifier").cloned().unwrap_or_default();
  let pkce_holds = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) == google.code_challenge;
  let accepted = form.get("code").map(String::as_str) == Some(CODE)
    && form.get("client_secret").map(String::as_str) == Some(CLIENT_SECRET)
    && form.get("grant_type").map(String::as_str) == Some("authorization_code")
    && pkce_holds;
  google.token_request = Some(form);
  if !accepted {
    return Err(StatusCode::BAD_REQUEST);
  }
  let mut claims = google.claims.clone();
  claims["aud"] = json!(CLIENT_ID);
  claims["iss"] = json!("https://accounts.google.com");
  claims["exp"] = json!(start_time().timestamp() + 3600);
  claims["nonce"] = json!(google.nonce);
  let id_token = format!("e30.{}.unsigned", URL_SAFE_NO_PAD.encode(claims.to_string()));
  Ok(Json(
    json!({"access_token": "the-access-token", "id_token": id_token, "token_type": "Bearer"}),
  ))
}

async fn user_info(State(google): State<Shared>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
  if headers.get("authorization").and_then(|value| value.to_str().ok()) != Some("Bearer the-access-token") {
    return Err(StatusCode::UNAUTHORIZED);
  }
  Ok(Json(google.lock().unwrap().claims.clone()))
}

/// Starts the fake and a Development app that signs in through it, allow-listing `first@example.com` and
/// `second@example.com`.
async fn start(claims: Value) -> (TestApp, Shared) {
  start_in("Development", claims).await
}

/// [`start`] in environment `environment`.
async fn start_in(environment: &str, claims: Value) -> (TestApp, Shared) {
  let google: Shared = Arc::new(Mutex::new(FakeGoogle {
    claims,
    ..FakeGoogle::default()
  }));
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
  let base = format!("http://{}", listener.local_addr().unwrap());
  let fake = Router::new()
    .route("/token", post(token))
    .route("/userinfo", get(user_info))
    .with_state(google.clone());
  tokio::spawn(async move { axum::serve(listener, fake).await });

  let app = TestApp::builder()
    .environment(environment)
    .real_authentication()
    .setting("Auth__Google__ClientId", CLIENT_ID)
    .setting("Auth__Google__ClientSecret", CLIENT_SECRET)
    .setting("Auth__AllowedEmails__0", "first@example.com")
    .setting("Auth__AllowedEmails__1", "Second@Example.com")
    .google_endpoints(GoogleEndpoints {
      authorize: format!("{base}/authorize"),
      token: format!("{base}/token"),
      user_info: format!("{base}/userinfo"),
    })
    .start()
    .await;
  (app, google)
}

fn person(sub: &str, email: &str) -> Value {
  json!({"sub": sub, "email": email, "email_verified": true, "name": "A Person", "picture": "https://pic/person"})
}

fn query_of(location: &str) -> HashMap<String, String> {
  let query = location.split_once('?').map_or("", |(_, query)| query);
  form_urlencoded::parse(query.as_bytes()).into_owned().collect()
}

/// The `Set-Cookie` for `name`, panicking with every cookie the response set when there is none.
fn set_cookie<'a>(response: &'a TestResponse, name: &str) -> SetCookie<'a> {
  response
    .set_cookie(name)
    .unwrap_or_else(|| panic!("no Set-Cookie for {name}: {:?}", response.set_cookies()))
}

/// Asserts that the `Set-Cookie` for `name` is `Secure`, `HttpOnly` and `SameSite=Lax`.
fn assert_secure_http_only_lax(response: &TestResponse, name: &str) {
  let cookie = set_cookie(response, name);
  for expected in ["secure", "httponly", "samesite=lax"] {
    assert!(cookie.has(expected), "{name} lacks {expected}: {cookie:?}");
  }
}

/// What `GET /api/auth/login` hands the browser.
struct SignInStart {
  /// The query parameters of the redirect to Google's authorization endpoint.
  parameters: HashMap<String, String>,
  /// The sign-in cookie (name and value).
  cookie: String,
  /// The login response itself.
  login: TestResponse,
}

/// `GET /api/auth/login`, as a browser would; tells the fake what Google would remember.
async fn begin(app: &TestApp, google: &Shared, return_url: &str) -> SignInStart {
  begin_with(app, &app.client(), google, return_url).await
}

/// [`begin`] through `client`.
async fn begin_with(app: &TestApp, client: &TestClient, google: &Shared, return_url: &str) -> SignInStart {
  let login = client.get(&format!("/api/auth/login?returnUrl={}", escape(return_url))).await;
  assert_eq!(login.status, StatusCode::FOUND);
  let location = login.header("location").unwrap().to_owned();
  assert!(location.starts_with(&app.state().google_endpoints().authorize), "{location}");
  let parameters = query_of(&location);
  let cookie = set_cookie(&login, SIGN_IN_COOKIE).pair().to_owned();
  let mut google = google.lock().unwrap();
  google.nonce.clone_from(&parameters["nonce"]);
  google.code_challenge.clone_from(&parameters["code_challenge"]);
  SignInStart { parameters, cookie, login }
}

async fn finish(app: &TestApp, cookie: &str, query: &str) -> TestResponse {
  app.client().cookie(cookie).get(&format!("{CALLBACK_PATH}?{query}")).await
}

#[tokio::test]
async fn an_allow_listed_person_is_signed_in_and_gets_their_user_row() {
  let (app, google) = start(person("sub-1", "Second@Example.com")).await;

  let SignInStart { parameters, cookie, .. } = begin(&app, &google, "/day/2026-10-29?x=1").await;
  assert_eq!(parameters["client_id"], CLIENT_ID);
  assert_eq!(parameters["response_type"], "code");
  assert_eq!(parameters["scope"], "openid profile email");
  assert_eq!(parameters["code_challenge_method"], "S256");
  assert_eq!(parameters["redirect_uri"], format!("http://{TEST_HOST}{CALLBACK_PATH}"));
  assert!(parameters["state"].len() >= 43 && parameters["nonce"].len() >= 43);

  let callback = finish(&app, &cookie, &format!("code={CODE}&state={}", parameters["state"])).await;
  assert_eq!(callback.status, StatusCode::FOUND);
  assert_eq!(callback.header("location"), Some("/day/2026-10-29?x=1"));
  let session_cookie = set_cookie(&callback, SESSION_COOKIE);
  let session = session_cookie.pair().to_owned();
  assert!(
    session_cookie.has("httponly") && session_cookie.has("samesite=lax") && session_cookie.has("path=/"),
    "{session_cookie:?}"
  );
  assert!(
    !session_cookie.has("max-age") && !session_cookie.has("expires"),
    "a browser-session cookie: {session_cookie:?}"
  );
  assert_eq!(set_cookie(&callback, SIGN_IN_COOKIE).value(), "", "the flow cookie is cleared");

  let sent = google.lock().unwrap().token_request.clone().unwrap();
  assert_eq!(sent["redirect_uri"], format!("http://{TEST_HOST}{CALLBACK_PATH}"));
  assert_eq!(sent["client_id"], CLIENT_ID);

  let signed_in = app.client().cookie(&session);
  let me: AuthUserResponse = signed_in.get("/api/auth/me").await.success().json();
  assert_eq!(me.name, "A Person");
  assert_eq!(me.email, "Second@Example.com");
  assert_eq!(me.picture_url.as_deref(), Some("https://pic/person"));

  // The person owns what they create, under a users row that records the Google subject (ADR-0041).
  let task: TaskResponse = signed_in.post_json("/api/tasks", &json!({"title": "mine"})).await.success().json();
  let client = app.database().migrator_client().await;
  let row = client
    .query_one(
      "SELECT u.google_subject, u.email, u.display_name, u.picture_url FROM users u JOIN tasks t ON t.owner_id = u.id WHERE t.id = $1",
      &[&task.id],
    )
    .await
    .unwrap();
  assert_eq!(
    UserRow::from(&row),
    UserRow::new(
      Some("sub-1"),
      Some("second@example.com"),
      Some("A Person"),
      Some("https://pic/person")
    )
  );

  // The session lasts eight hours from sign-in.
  app.clock.advance(TimeDelta::hours(8));
  assert_eq!(signed_in.get("/api/auth/me").await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_return_url_that_is_not_local_becomes_the_root() {
  let (app, google) = start(person("sub-1", "first@example.com")).await;
  let SignInStart { parameters, cookie, .. } = begin(&app, &google, "https://evil.test/").await;
  let callback = finish(&app, &cookie, &format!("code={CODE}&state={}", parameters["state"])).await;
  assert_eq!(callback.header("location"), Some("/"));
  assert!(callback.set_cookie(SESSION_COOKIE).is_some());
}

async fn assert_denied(app: &TestApp, callback: &TestResponse) {
  assert_eq!(callback.status, StatusCode::FOUND);
  assert_eq!(callback.header("location"), Some(FAILURE_REDIRECT));
  assert!(callback.set_cookie(SESSION_COOKIE).is_none(), "{:?}", callback.set_cookies());
  assert_eq!(set_cookie(callback, SIGN_IN_COOKIE).value(), "", "the flow cookie is cleared");
  // Whatever the denial set, it is not a session.
  let set: Vec<&str> = callback
    .set_cookies()
    .iter()
    .filter_map(|cookie| cookie.split(';').next())
    .collect();
  let me = app.client().cookie(&set.join("; ")).get("/api/auth/me").await;
  assert_eq!(me.status, StatusCode::UNAUTHORIZED);
  let client = app.database().migrator_client().await;
  let users: i64 = client
    .query_one("SELECT count(*) FROM users WHERE google_subject IS NOT NULL", &[])
    .await
    .unwrap()
    .get(0);
  assert_eq!(users, 0, "nobody was given a user row");
}

#[tokio::test]
async fn people_who_are_not_allow_listed_or_not_verified_are_denied() {
  for claims in [
    person("sub-1", "stranger@example.com"),
    json!({"sub": "sub-1", "email": "first@example.com", "email_verified": false}),
    json!({"sub": "sub-1", "email": "first@example.com", "email_verified": "true"}),
    json!({"sub": "sub-1", "email_verified": true}),
  ] {
    let (app, google) = start(claims).await;
    let SignInStart { parameters, cookie, .. } = begin(&app, &google, "/").await;
    let callback = finish(&app, &cookie, &format!("code={CODE}&state={}", parameters["state"])).await;
    assert_denied(&app, &callback).await;
  }
}

#[tokio::test]
async fn a_callback_that_does_not_belong_to_the_flow_is_denied() {
  let (app, google) = start(person("sub-1", "first@example.com")).await;
  let SignInStart { parameters, cookie, .. } = begin(&app, &google, "/").await;
  let state = &parameters["state"];

  // Another state, no state, no cookie, Google's own error, a code Google refuses, an expired flow.
  assert_denied(&app, &finish(&app, &cookie, &format!("code={CODE}&state=forged")).await).await;
  assert_denied(&app, &finish(&app, &cookie, &format!("code={CODE}")).await).await;
  assert_denied(&app, &app.client().get(&format!("{CALLBACK_PATH}?code={CODE}&state={state}")).await).await;
  assert_denied(&app, &finish(&app, &cookie, &format!("error=access_denied&state={state}")).await).await;
  assert_denied(&app, &finish(&app, &cookie, &format!("code=another-code&state={state}")).await).await;
  app.clock.advance(TimeDelta::minutes(15));
  assert_denied(&app, &finish(&app, &cookie, &format!("code={CODE}&state={state}")).await).await;

  // A nonce other than the one of this flow: the ID token is refused.
  app.clock.set(start_time());
  google.lock().unwrap().nonce = "replayed".to_owned();
  assert_denied(&app, &finish(&app, &cookie, &format!("code={CODE}&state={state}")).await).await;
}

#[tokio::test]
async fn behind_the_proxy_the_redirect_uri_is_https_and_cookies_are_secure() {
  let (app, _google) = start(person("sub-1", "first@example.com")).await;
  let client = app
    .client()
    .header("host", "internal")
    .header("x-forwarded-proto", "https")
    .header("x-forwarded-host", "calendar.example");

  let login = client.get("/api/auth/login").await;
  assert_eq!(login.status, StatusCode::FOUND);
  let location = login.header("location").unwrap();
  assert!(
    location.contains("redirect_uri=https%3A%2F%2Fcalendar.example%2Fapi%2Fauth%2Fcallback%2Fgoogle"),
    "{location}"
  );
  assert!(set_cookie(&login, SIGN_IN_COOKIE).has("secure"), "{:?}", login.set_cookies());
}

#[tokio::test]
async fn outside_development_behind_the_proxy_the_whole_sign_in_is_https_and_every_cookie_is_secure() {
  let (app, google) = start_in("Production", person("sub-1", "first@example.com")).await;
  // The ingress appends its entry to whatever the client sent; only the last one is trusted.
  let proxied = app
    .client()
    .header("host", "internal")
    .header("x-forwarded-proto", "http, https")
    .header("x-forwarded-host", "spoofed.example, calendar.example");
  let public_redirect_uri = format!("https://calendar.example{CALLBACK_PATH}");

  let SignInStart { parameters, cookie, login } = begin_with(&app, &proxied, &google, "/day/2026-10-29").await;
  assert_eq!(parameters["redirect_uri"], public_redirect_uri);
  assert_secure_http_only_lax(&login, SIGN_IN_COOKIE);

  let callback = proxied
    .clone()
    .cookie(&cookie)
    .get(&format!("{CALLBACK_PATH}?code={CODE}&state={}", parameters["state"]))
    .await;
  assert_eq!(callback.status, StatusCode::FOUND);
  assert_eq!(callback.header("location"), Some("/day/2026-10-29"));
  assert_eq!(
    google.lock().unwrap().token_request.as_ref().unwrap()["redirect_uri"],
    public_redirect_uri,
    "the code is redeemed for the redirect URI it was issued to"
  );
  assert_secure_http_only_lax(&callback, SIGN_IN_COOKIE);
  assert_secure_http_only_lax(&callback, SESSION_COOKIE);

  let session = set_cookie(&callback, SESSION_COOKIE).pair();
  let me: AuthUserResponse = proxied.clone().cookie(session).get("/api/auth/me").await.success().json();
  assert_eq!(me.email, "first@example.com");
}

#[tokio::test]
async fn outside_development_cookies_are_secure_even_over_plain_http() {
  let (app, google) = start_in("Production", person("sub-1", "first@example.com")).await;

  let SignInStart { parameters, login, .. } = begin_with(&app, &app.client(), &google, "/").await;

  assert_eq!(parameters["redirect_uri"], format!("http://{TEST_HOST}{CALLBACK_PATH}"));
  assert_secure_http_only_lax(&login, SIGN_IN_COOKIE);
}

// Native sign-in (#1008): the desktop app's loopback handover. The Google leg is the one above; what
// changes is where the callback sends the browser and how the app gets its session.

const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const LOOPBACK: &str = "http://127.0.0.1:49152/callback";
const APP_STATE: &str = "the-app-state";
const NATIVE_SESSION_PATH: &str = "/api/auth/native/session";

fn native_challenge() -> String {
  URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()))
}

/// The login query of a native sign-in for `redirect_uri`.
fn native_login(redirect_uri: &str) -> String {
  format!(
    "/api/auth/login?redirectUri={}&codeChallenge={}&codeChallengeMethod=S256&appState={APP_STATE}",
    escape(redirect_uri),
    native_challenge()
  )
}

/// `GET /api/auth/login` for a native sign-in through `client`; tells the fake what Google would remember.
async fn begin_native(client: &TestClient, google: &Shared) -> SignInStart {
  let login = client.get(&native_login(LOOPBACK)).await;
  assert_eq!(login.status, StatusCode::FOUND, "{}", login.text());
  let parameters = query_of(login.header("location").unwrap());
  let cookie = set_cookie(&login, SIGN_IN_COOKIE).pair().to_owned();
  let mut google = google.lock().unwrap();
  google.nonce.clone_from(&parameters["nonce"]);
  google.code_challenge.clone_from(&parameters["code_challenge"]);
  SignInStart { parameters, cookie, login }
}

/// The loopback's query after a native callback that redirected to it, checking that the browser got no
/// session and that the flow cookie is cleared.
fn loopback_query(callback: &TestResponse) -> HashMap<String, String> {
  assert_eq!(callback.status, StatusCode::FOUND);
  let location = callback.header("location").unwrap();
  assert!(location.starts_with(&format!("{LOOPBACK}?")), "{location}");
  assert!(
    callback.set_cookie(SESSION_COOKIE).is_none(),
    "a native callback sets no session in the browser: {:?}",
    callback.set_cookies()
  );
  assert_eq!(set_cookie(callback, SIGN_IN_COOKIE).value(), "", "the flow cookie is cleared");
  query_of(location)
}

/// Runs a native sign-in up to the loopback and returns the handover code.
async fn native_code(app: &TestApp, google: &Shared) -> String {
  let SignInStart { parameters, cookie, .. } = begin_native(&app.client(), google).await;
  let callback = finish(app, &cookie, &format!("code={CODE}&state={}", parameters["state"])).await;
  let loopback = loopback_query(&callback);
  assert_eq!(loopback["state"], APP_STATE);
  assert!(!loopback.contains_key("error"), "{loopback:?}");
  loopback["code"].clone()
}

async fn redeem(client: &TestClient, code: &str, verifier: &str, redirect_uri: &str) -> TestResponse {
  client
    .post_json(
      NATIVE_SESSION_PATH,
      &json!({"code": code, "codeVerifier": verifier, "redirectUri": redirect_uri}),
    )
    .await
}

fn assert_handover_refused(response: &TestResponse) {
  assert_eq!(response.status, StatusCode::BAD_REQUEST, "{}", response.text());
  assert_eq!(response.problem_title(), "The sign-in handover is invalid or has expired.");
  assert!(response.set_cookie(SESSION_COOKIE).is_none(), "{:?}", response.set_cookies());
}

#[tokio::test]
async fn a_native_sign_in_hands_the_session_to_the_app_through_the_loopback_and_never_to_the_browser() {
  let (app, google) = start(person("sub-1", "Second@Example.com")).await;

  let SignInStart { parameters, .. } = begin_native(&app.client(), &google).await;
  assert_eq!(
    parameters["redirect_uri"],
    format!("http://{TEST_HOST}{CALLBACK_PATH}"),
    "Google still redirects to the API's registered callback"
  );
  let code = native_code(&app, &google).await;
  assert!(
    !code.contains(VERIFIER) && !code.contains(&native_challenge()),
    "the code is sealed"
  );

  let exchange = redeem(&app.client(), &code, VERIFIER, LOOPBACK).await;
  assert_eq!(exchange.status, StatusCode::NO_CONTENT, "{}", exchange.text());
  assert_eq!(exchange.header("cache-control"), Some("no-cache,no-store"));
  let session_cookie = set_cookie(&exchange, SESSION_COOKIE);
  assert!(
    session_cookie.has("httponly") && session_cookie.has("samesite=lax") && session_cookie.has("path=/"),
    "{session_cookie:?}"
  );
  assert!(
    !session_cookie.has("max-age") && !session_cookie.has("expires"),
    "{session_cookie:?}"
  );

  let signed_in = app.client().cookie(session_cookie.pair());
  let me: AuthUserResponse = signed_in.get("/api/auth/me").await.success().json();
  assert_eq!(me.email, "Second@Example.com");
  assert_eq!(me.name, "A Person");

  // The session is the ordinary one: eight hours from the exchange, and sign-out clears it.
  let logout = signed_in.post("/api/auth/logout").await;
  assert_eq!(logout.status, StatusCode::NO_CONTENT);
  assert_eq!(set_cookie(&logout, SESSION_COOKIE).value(), "");
  app.clock.advance(TimeDelta::hours(8));
  assert_eq!(signed_in.get("/api/auth/me").await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_native_login_with_an_unsafe_or_incomplete_request_is_refused_before_google() {
  let (app, _google) = start(person("sub-1", "first@example.com")).await;
  let challenge = native_challenge();
  let cases = [
    native_login("http://localhost:49152/callback"),
    native_login("http://evil.test:49152/callback"),
    native_login("https://127.0.0.1:49152/callback"),
    native_login("http://127.0.0.1:80/callback"),
    native_login("http://127.0.0.1:49152/elsewhere"),
    native_login("http://127.0.0.1:49152/callback?x=1"),
    format!("{}&returnUrl=%2F", native_login(LOOPBACK)),
    format!("/api/auth/login?redirectUri={}&appState={APP_STATE}", escape(LOOPBACK)),
    format!("/api/auth/login?codeChallenge={challenge}&codeChallengeMethod=S256&appState={APP_STATE}"),
    format!(
      "/api/auth/login?redirectUri={}&codeChallenge={challenge}&codeChallengeMethod=plain&appState={APP_STATE}",
      escape(LOOPBACK)
    ),
    format!(
      "/api/auth/login?redirectUri={}&codeChallenge={challenge}&codeChallengeMethod=S256&appState=a%20b",
      escape(LOOPBACK)
    ),
  ];
  for login in cases {
    let response = app.client().get(&login).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{login}: {}", response.text());
    assert_eq!(response.problem_title(), "The native sign-in request is invalid.", "{login}");
    assert!(response.header("location").is_none(), "{login}");
    assert!(response.set_cookie(SIGN_IN_COOKIE).is_none(), "{login}");
  }
}

#[tokio::test]
async fn a_failed_native_sign_in_tells_the_loopback_and_signs_nobody_in() {
  let (app, google) = start(person("sub-1", "stranger@example.com")).await;
  let SignInStart { parameters, cookie, .. } = begin_native(&app.client(), &google).await;
  let state = &parameters["state"];

  for query in [
    format!("code={CODE}&state={state}"),
    format!("code={CODE}&state=forged"),
    format!("error=access_denied&state={state}"),
  ] {
    let loopback = loopback_query(&finish(&app, &cookie, &query).await);
    assert_eq!(loopback.get("error").map(String::as_str), Some("access_denied"), "{query}");
    assert_eq!(loopback["state"], APP_STATE);
    assert!(!loopback.contains_key("code"), "{query}: {loopback:?}");
  }

  // Without the flow cookie there is no trusted loopback: the browser ends at the web failure page.
  let without_cookie = app.client().get(&format!("{CALLBACK_PATH}?code={CODE}&state={state}")).await;
  assert_eq!(without_cookie.header("location"), Some(FAILURE_REDIRECT));
}

#[tokio::test]
async fn a_handover_is_redeemed_only_with_its_verifier_and_redirect_within_a_minute() {
  let (app, google) = start(person("sub-1", "first@example.com")).await;
  let code = native_code(&app, &google).await;
  let client = app.client();

  assert_handover_refused(&redeem(&client, &code, &"x".repeat(43), LOOPBACK).await);
  assert_handover_refused(&redeem(&client, &code, &native_challenge(), LOOPBACK).await);
  assert_handover_refused(&redeem(&client, &code, "", LOOPBACK).await);
  assert_handover_refused(&redeem(&client, &code, VERIFIER, "http://127.0.0.1:49153/callback").await);
  assert_handover_refused(&redeem(&client, "forged", VERIFIER, LOOPBACK).await);
  // A session cookie is not a handover code, nor the sign-in cookie.
  let session = app.session_cookie(&app.ticket_for(Some(USER_A))).await;
  let session_value = session.split_once('=').unwrap().1;
  assert_handover_refused(&redeem(&client, session_value, VERIFIER, LOOPBACK).await);

  app.clock.advance(TimeDelta::seconds(59));
  assert_eq!(redeem(&client, &code, VERIFIER, LOOPBACK).await.status, StatusCode::NO_CONTENT);
  app.clock.advance(TimeDelta::seconds(1));
  assert_handover_refused(&redeem(&client, &code, VERIFIER, LOOPBACK).await);
}

#[tokio::test]
async fn a_handover_for_a_user_removed_since_the_callback_is_refused() {
  let (app, google) = start(person("sub-1", "first@example.com")).await;
  let code = native_code(&app, &google).await;
  let client = app.database().migrator_client().await;
  client
    .execute("DELETE FROM users WHERE google_subject = 'sub-1'", &[])
    .await
    .unwrap();

  assert_handover_refused(&redeem(&app.client(), &code, VERIFIER, LOOPBACK).await);
}

#[tokio::test]
async fn the_native_session_exchange_reads_a_json_body_with_every_property() {
  let (app, _google) = start(person("sub-1", "first@example.com")).await;
  let missing = app.client().post_json(NATIVE_SESSION_PATH, &json!({"code": "c"})).await;
  assert_eq!(missing.status, StatusCode::BAD_REQUEST);
  assert!(missing.set_cookie(SESSION_COOKIE).is_none());

  let form = app
    .client()
    .send(
      Method::POST,
      NATIVE_SESSION_PATH,
      Some(("application/x-www-form-urlencoded", b"code=c&codeVerifier=v&redirectUri=r".to_vec())),
    )
    .await;
  assert_ne!(form.status, StatusCode::NO_CONTENT);
  assert!(
    form.set_cookie(SESSION_COOKIE).is_none(),
    "a form post, which a page can send cross-site, signs nobody in"
  );
}

#[tokio::test]
async fn outside_development_the_native_session_cookie_is_secure() {
  let (app, google) = start_in("Production", person("sub-1", "first@example.com")).await;
  let code = native_code(&app, &google).await;
  let exchange = redeem(&app.client(), &code, VERIFIER, LOOPBACK).await;
  assert_eq!(exchange.status, StatusCode::NO_CONTENT, "{}", exchange.text());
  assert_secure_http_only_lax(&exchange, SESSION_COOKIE);
}
