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

fn cookie_named<'a>(response: &'a TestResponse, name: &str) -> Option<&'a str> {
  response
    .set_cookies()
    .into_iter()
    .find_map(|cookie| cookie.split(';').next().filter(|pair| pair.starts_with(&format!("{name}="))))
}

/// The attributes of the `Set-Cookie` for `name`, lower-cased and trimmed, without the `name=value` pair.
fn cookie_attributes(response: &TestResponse, name: &str) -> Vec<String> {
  let cookie = response
    .set_cookies()
    .into_iter()
    .find(|cookie| cookie.starts_with(&format!("{name}=")))
    .unwrap_or_else(|| panic!("no Set-Cookie for {name}: {:?}", response.set_cookies()));
  cookie.split(';').skip(1).map(|attribute| attribute.trim().to_lowercase()).collect()
}

/// Asserts that the `Set-Cookie` for `name` is `Secure`, `HttpOnly` and `SameSite=Lax`.
fn assert_secure_http_only_lax(response: &TestResponse, name: &str) {
  let attributes = cookie_attributes(response, name);
  for expected in ["secure", "httponly", "samesite=lax"] {
    assert!(
      attributes.iter().any(|attribute| attribute == expected),
      "{name} lacks {expected}: {attributes:?}"
    );
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
  let cookie = cookie_named(&login, SIGN_IN_COOKIE).expect("the sign-in cookie is set").to_owned();
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
  let session = cookie_named(&callback, SESSION_COOKIE)
    .expect("the session cookie is set")
    .to_owned();
  let attributes = callback
    .set_cookies()
    .into_iter()
    .find(|cookie| cookie.starts_with(SESSION_COOKIE))
    .unwrap()
    .to_lowercase();
  assert!(
    attributes.contains("httponly") && attributes.contains("samesite=lax") && attributes.contains("path=/"),
    "{attributes}"
  );
  assert!(
    !attributes.contains("max-age") && !attributes.contains("expires"),
    "a browser-session cookie: {attributes}"
  );
  assert_eq!(
    cookie_named(&callback, SIGN_IN_COOKIE),
    Some(format!("{SIGN_IN_COOKIE}=").as_str()),
    "the flow cookie is cleared"
  );

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
  assert!(cookie_named(&callback, SESSION_COOKIE).is_some());
}

async fn assert_denied(app: &TestApp, callback: &TestResponse) {
  assert_eq!(callback.status, StatusCode::FOUND);
  assert_eq!(callback.header("location"), Some(FAILURE_REDIRECT));
  assert_eq!(cookie_named(callback, SESSION_COOKIE), None);
  assert_eq!(
    cookie_named(callback, SIGN_IN_COOKIE),
    Some(format!("{SIGN_IN_COOKIE}=").as_str()),
    "the flow cookie is cleared"
  );
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
  assert!(login.set_cookies().join("").contains("secure"));
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

  let session = cookie_named(&callback, SESSION_COOKIE).unwrap();
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
