//! Native sign-in (ADR-0068, #1008): the desktop app's loopback handover. `start` checks the app's request and
//! keeps it in a flow cookie, the confirm page sends an anonymous browser through the Google sign-in of
//! `google_sign_in` and asks a signed-in one to confirm, the same-origin confirm POST redirects to the
//! loopback with a 60-second code, and `token` redeems the code with the PKCE verifier for the session cookie.

use std::collections::HashMap;

use crate::common::*;
use crate::google_sign_in::{CODE, SignInStart, assert_secure_http_only_lax, begin, finish, person, query_of, set_cookie, start, start_in};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use calendar_api::auth::native::{CONFIRM_PATH, NATIVE_COOKIE, SIGN_IN_FOR_CONFIRM, START_PATH};
use sha2::{Digest, Sha256};

const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const LOOPBACK: &str = "http://127.0.0.1:49152/callback";
const APP_STATE: &str = "the-app-state";
const TOKEN_PATH: &str = "/api/auth/native/token";
const OWN_ORIGIN: &str = "http://localhost";

fn challenge() -> String {
  URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()))
}

/// The start URL for `redirect_uri`.
fn start_url(redirect_uri: &str) -> String {
  format!(
    "{START_PATH}?redirect_uri={}&state={APP_STATE}&code_challenge={}&code_challenge_method=S256",
    escape(redirect_uri),
    challenge()
  )
}

/// `GET /api/auth/native/start` for [`LOOPBACK`]: the flow cookie (name and value).
async fn begin_native(app: &TestApp) -> String {
  let start = app.client().get(&start_url(LOOPBACK)).await;
  assert_eq!(start.status, StatusCode::FOUND, "{}", start.text());
  assert_eq!(start.header("location"), Some(CONFIRM_PATH));
  let flow = set_cookie(&start, NATIVE_COOKIE);
  assert!(
    flow.has("httponly") && flow.has("samesite=lax") && flow.has("max-age=900"),
    "{flow:?}"
  );
  flow.pair().to_owned()
}

/// The `Cookie` header of a browser holding all of `cookies`.
fn jar(cookies: &[&str]) -> String {
  cookies.join("; ")
}

/// The confirm POST, as the page's own form sends it.
async fn click_confirm(app: &TestApp, cookies: &str) -> TestResponse {
  app.client().cookie(cookies).header("origin", OWN_ORIGIN).post(CONFIRM_PATH).await
}

/// The loopback's query after the confirm POST, checking that the browser got no new session and that the flow
/// cookie is cleared.
fn loopback_query(confirmed: &TestResponse) -> HashMap<String, String> {
  assert_eq!(confirmed.status, StatusCode::SEE_OTHER, "{}", confirmed.text());
  let location = confirmed.header("location").unwrap();
  assert!(location.starts_with(&format!("{LOOPBACK}?")), "{location}");
  assert!(confirmed.set_cookie(SESSION_COOKIE).is_none(), "{:?}", confirmed.set_cookies());
  assert_eq!(set_cookie(confirmed, NATIVE_COOKIE).value(), "", "the flow cookie is cleared");
  let query = query_of(location);
  assert_eq!(query["state"], APP_STATE);
  query
}

/// A browser already signed in as [`USER_A`] starts and confirms a native sign-in: the handover code.
async fn confirmed_code(app: &TestApp) -> String {
  let flow = begin_native(app).await;
  let session = app.session_cookie(&app.ticket_for(Some(USER_A))).await;
  loopback_query(&click_confirm(app, &jar(&[&flow, &session])).await)["code"].clone()
}

async fn redeem(app: &TestApp, code: &str, verifier: &str, redirect_uri: &str) -> TestResponse {
  app
    .client()
    .post_json(
      TOKEN_PATH,
      &json!({"code": code, "codeVerifier": verifier, "redirectUri": redirect_uri}),
    )
    .await
}

fn assert_invalid_grant(response: &TestResponse) {
  assert_eq!(response.status, StatusCode::BAD_REQUEST, "{}", response.text());
  assert_eq!(response.problem_title(), "invalid_grant");
  assert!(response.set_cookie(SESSION_COOKIE).is_none(), "{:?}", response.set_cookies());
}

/// A test app with real authentication and no Google: for flows whose browser is already signed in.
async fn signed_in_browser_app() -> TestApp {
  TestApp::builder().real_authentication().start().await
}

#[tokio::test]
async fn a_browser_without_a_session_signs_in_with_google_confirms_and_hands_the_session_to_the_app() {
  let (app, google) = start(person("sub-1", "Second@Example.com")).await;
  let flow = begin_native(&app).await;

  // No session yet: the confirm page sends the browser through the ordinary Google sign-in.
  let anonymous = app.client().cookie(&flow).get(CONFIRM_PATH).await;
  assert_eq!(anonymous.status, StatusCode::FOUND);
  assert_eq!(anonymous.header("location"), Some(SIGN_IN_FOR_CONFIRM));
  let SignInStart { parameters, cookie, .. } = begin(&app, &google, CONFIRM_PATH).await;
  let callback = finish(&app, &cookie, &format!("code={CODE}&state={}", parameters["state"])).await;
  assert_eq!(
    callback.header("location"),
    Some(CONFIRM_PATH),
    "Google sends the browser back to confirm"
  );
  let browser_session = set_cookie(&callback, SESSION_COOKIE).pair().to_owned();

  // Signed in: the page asks, names the account, and refuses to be framed or kept.
  let page = app.client().cookie(&jar(&[&flow, &browser_session])).get(CONFIRM_PATH).await;
  assert_eq!(page.status, StatusCode::OK);
  assert_eq!(page.media_type(), Some("text/html"));
  assert!(page.text().contains("Sign in to the Calendar desktop app?"), "{}", page.text());
  assert!(page.text().contains("Second@Example.com"));
  assert!(page.text().contains(&format!("action=\"{CONFIRM_PATH}\"")));
  assert!(
    page.header("content-security-policy").unwrap().contains("frame-ancestors 'none'"),
    "{:?}",
    page.header("content-security-policy")
  );
  assert_eq!(page.header("x-frame-options"), Some("DENY"));
  assert_eq!(page.header("cache-control"), Some("no-store"));

  // The click: a 60-second code for the loopback, and nothing new for the browser.
  let code = loopback_query(&click_confirm(&app, &jar(&[&flow, &browser_session])).await)["code"].clone();
  assert!(!code.contains(VERIFIER) && !code.contains(&challenge()), "the code is sealed");

  // The app redeems it for its own, ordinary session.
  let token = redeem(&app, &code, VERIFIER, LOOPBACK).await;
  assert_eq!(token.status, StatusCode::NO_CONTENT, "{}", token.text());
  assert_eq!(token.header("cache-control"), Some("no-cache,no-store"));
  let app_session = set_cookie(&token, SESSION_COOKIE);
  assert!(
    app_session.has("httponly") && app_session.has("samesite=lax") && app_session.has("path=/"),
    "{app_session:?}"
  );
  assert!(!app_session.has("max-age") && !app_session.has("expires"), "{app_session:?}");
  assert_ne!(app_session.pair(), browser_session, "the app gets a session of its own");

  let desktop = app.client().cookie(app_session.pair());
  let me: AuthUserResponse = desktop.get("/api/auth/me").await.success().json();
  assert_eq!(me.email, "Second@Example.com");
  assert_eq!(me.name, "A Person");

  // It is the ordinary session: sign-out clears it, and it ends eight hours after the exchange.
  let logout = desktop.post("/api/auth/logout").await;
  assert_eq!(logout.status, StatusCode::NO_CONTENT);
  assert_eq!(set_cookie(&logout, SESSION_COOKIE).value(), "");
  app.clock.advance(TimeDelta::hours(8));
  assert_eq!(desktop.get("/api/auth/me").await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_browser_already_signed_in_skips_google() {
  let app = signed_in_browser_app().await;
  let flow = begin_native(&app).await;
  let session = app.session_cookie(&app.ticket_for(Some(USER_A))).await;

  let page = app.client().cookie(&jar(&[&flow, &session])).get(CONFIRM_PATH).await;
  assert_eq!(page.status, StatusCode::OK, "{}", page.text());

  let code = loopback_query(&click_confirm(&app, &jar(&[&flow, &session])).await)["code"].clone();
  assert_eq!(redeem(&app, &code, VERIFIER, LOOPBACK).await.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn an_unsafe_or_incomplete_start_is_refused_without_a_redirect() {
  let app = signed_in_browser_app().await;
  let challenge = challenge();
  let cases = [
    start_url("http://localhost:49152/callback"),
    start_url("http://evil.test:49152/callback"),
    start_url("https://127.0.0.1:49152/callback"),
    start_url("http://127.0.0.1:80/callback"),
    start_url("http://127.0.0.1:49152/elsewhere"),
    start_url("http://127.0.0.1:49152/callback?x=1"),
    format!("{START_PATH}?redirect_uri={}&state={APP_STATE}", escape(LOOPBACK)),
    format!("{START_PATH}?state={APP_STATE}&code_challenge={challenge}&code_challenge_method=S256"),
    format!(
      "{START_PATH}?redirect_uri={}&state={APP_STATE}&code_challenge={challenge}&code_challenge_method=plain",
      escape(LOOPBACK)
    ),
    format!(
      "{START_PATH}?redirect_uri={}&state=a%20b&code_challenge={challenge}&code_challenge_method=S256",
      escape(LOOPBACK)
    ),
  ];
  for url in cases {
    let response = app.client().get(&url).await;
    assert_eq!(response.status, StatusCode::BAD_REQUEST, "{url}: {}", response.text());
    assert_eq!(response.problem_title(), "The native sign-in request is invalid.", "{url}");
    assert!(response.header("location").is_none(), "{url}");
    assert!(response.set_cookie(NATIVE_COOKIE).is_none(), "{url}");
  }
}

#[tokio::test]
async fn without_a_live_flow_cookie_there_is_nothing_to_confirm() {
  let app = signed_in_browser_app().await;
  let session = app.session_cookie(&app.ticket_for(Some(USER_A))).await;

  let page = app.client().cookie(&session).get(CONFIRM_PATH).await;
  assert_eq!(page.status, StatusCode::BAD_REQUEST);
  let forged = jar(&[&format!("{NATIVE_COOKIE}=forged"), &session]);
  assert_eq!(click_confirm(&app, &forged).await.status, StatusCode::BAD_REQUEST);

  // A flow cookie lasts fifteen minutes.
  let flow = begin_native(&app).await;
  app.clock.advance(TimeDelta::minutes(15));
  let expired = click_confirm(&app, &jar(&[&flow, &session])).await;
  assert_eq!(expired.status, StatusCode::BAD_REQUEST);
  assert!(expired.header("location").is_none());
}

#[tokio::test]
async fn the_confirm_click_must_come_from_a_signed_in_browser_on_this_origin() {
  let app = signed_in_browser_app().await;
  let flow = begin_native(&app).await;
  let session = app.session_cookie(&app.ticket_for(Some(USER_A))).await;
  let cookies = jar(&[&flow, &session]);
  let post = |origin: Option<&'static str>, fetch_site: Option<&'static str>, cookies: String| {
    let mut client = app.client().cookie(&cookies);
    if let Some(origin) = origin {
      client = client.header("origin", origin);
    }
    if let Some(site) = fetch_site {
      client = client.header("sec-fetch-site", site);
    }
    async move { client.post(CONFIRM_PATH).await }
  };

  for (origin, site) in [
    (Some("https://evil.test"), None),
    (Some("http://127.0.0.1:49152"), None),
    (Some("null"), None),
    (None, Some("cross-site")),
    (None, Some("same-site")),
    (None, None),
  ] {
    let refused = post(origin, site, cookies.clone()).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{origin:?} {site:?}");
    assert!(refused.header("location").is_none(), "{origin:?} {site:?}");
  }
  // Without the browser's session there is nobody to sign in.
  assert_eq!(post(Some(OWN_ORIGIN), None, flow.clone()).await.status, StatusCode::UNAUTHORIZED);
  // The browser's own form, by Origin or by Sec-Fetch-Site.
  loopback_query(&post(None, Some("same-origin"), cookies.clone()).await);
  loopback_query(&post(Some(OWN_ORIGIN), None, cookies).await);
}

#[tokio::test]
async fn a_code_is_redeemed_only_with_its_verifier_and_redirect_within_a_minute() {
  let app = signed_in_browser_app().await;
  let code = confirmed_code(&app).await;

  assert_invalid_grant(&redeem(&app, &code, &"x".repeat(43), LOOPBACK).await);
  assert_invalid_grant(&redeem(&app, &code, &challenge(), LOOPBACK).await);
  assert_invalid_grant(&redeem(&app, &code, "", LOOPBACK).await);
  assert_invalid_grant(&redeem(&app, &code, VERIFIER, "http://127.0.0.1:49153/callback").await);
  assert_invalid_grant(&redeem(&app, "forged", VERIFIER, LOOPBACK).await);
  // A session cookie is not a code.
  let session = app.session_cookie(&app.ticket_for(Some(USER_A))).await;
  assert_invalid_grant(&redeem(&app, session.split_once('=').unwrap().1, VERIFIER, LOOPBACK).await);

  app.clock.advance(TimeDelta::seconds(59));
  assert_eq!(redeem(&app, &code, VERIFIER, LOOPBACK).await.status, StatusCode::NO_CONTENT);
  app.clock.advance(TimeDelta::seconds(1));
  assert_invalid_grant(&redeem(&app, &code, VERIFIER, LOOPBACK).await);
}

#[tokio::test]
async fn a_code_for_a_user_removed_since_the_click_is_refused() {
  let app = signed_in_browser_app().await;
  let code = confirmed_code(&app).await;
  let client = app.database().migrator_client().await;
  client.execute("DELETE FROM users WHERE id = $1", &[&USER_A]).await.unwrap();

  assert_invalid_grant(&redeem(&app, &code, VERIFIER, LOOPBACK).await);
}

#[tokio::test]
async fn the_token_endpoint_reads_only_a_json_body_with_every_property() {
  let app = signed_in_browser_app().await;
  let missing = app.client().post_json(TOKEN_PATH, &json!({"code": "c"})).await;
  assert_eq!(missing.status, StatusCode::BAD_REQUEST, "{}", missing.text());
  assert!(missing.set_cookie(SESSION_COOKIE).is_none());

  let form = app
    .client()
    .send(
      Method::POST,
      TOKEN_PATH,
      Some(("application/x-www-form-urlencoded", b"code=c&codeVerifier=v&redirectUri=r".to_vec())),
    )
    .await;
  assert_ne!(form.status, StatusCode::NO_CONTENT);
  assert!(
    form.set_cookie(SESSION_COOKIE).is_none(),
    "a form, which any page can post, signs nobody in"
  );
}

#[tokio::test]
async fn outside_development_the_flow_and_the_app_session_cookies_are_secure() {
  let (app, _google) = start_in("Production", person("sub-1", "first@example.com")).await;
  let start = app.client().get(&start_url(LOOPBACK)).await;
  assert_secure_http_only_lax(&start, NATIVE_COOKIE);

  let flow = set_cookie(&start, NATIVE_COOKIE).pair().to_owned();
  let session = app.session_cookie(&app.ticket_for(Some(USER_A))).await;
  let code = loopback_query(&click_confirm(&app, &jar(&[&flow, &session])).await)["code"].clone();
  let token = redeem(&app, &code, VERIFIER, LOOPBACK).await;
  assert_eq!(token.status, StatusCode::NO_CONTENT, "{}", token.text());
  assert_secure_http_only_lax(&token, SESSION_COOKIE);
}
