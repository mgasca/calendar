//! The desktop sign-in (ADR-0068): open the system browser at `GET /api/auth/native/start`, wait on the loopback
//! for the code the confirm click sends, and redeem it with the PKCE verifier at `POST /api/auth/native/token`,
//! whose answer sets the ordinary `calendar_session` cookie. The client that made the call keeps the cookie in its
//! jar, and the caller stores the value so a restart stays signed in.

use std::sync::Arc;
use std::time::Duration;

use calendar_client::reqwest;
use reqwest::cookie::Jar;
use reqwest::{StatusCode, Url};

use super::loopback::{Loopback, LoopbackError};
use super::pkce::Attempt;

/// The session cookie's name (`calendar-api`, `auth::session::SESSION_COOKIE`).
pub const SESSION_COOKIE: &str = "calendar_session";

/// Why a desktop sign-in did not sign anyone in.
#[derive(Debug, thiserror::Error)]
pub enum SignInError {
  /// The API origin is not a URL.
  #[error("the API address is not a URL")]
  Origin,
  /// The loopback could not listen, or the browser did not come back in time (refused, abandoned or cancelled).
  #[error(transparent)]
  Loopback(#[from] LoopbackError),
  /// The system browser could not be opened.
  #[error("the browser could not be opened: {0}")]
  Browser(std::io::Error),
  /// The token request failed on the network.
  #[error("the API could not be reached")]
  Network,
  /// The API refused the code (`400 invalid_grant`) or answered something else.
  #[error("the API refused the sign-in ({0})")]
  Refused(StatusCode),
  /// The API accepted the code but set no session cookie.
  #[error("the API sent no session")]
  NoSession,
}

impl SignInError {
  /// What the sign-in screen says, as plain words.
  #[must_use]
  pub fn message(&self) -> &'static str {
    match self {
      SignInError::Loopback(LoopbackError::TimedOut) => {
        "Sign-in did not finish in the browser. If your account is not allowed, the browser says so. Try again."
      }
      SignInError::Browser(_) => "The browser could not be opened. Open it and try again.",
      SignInError::Network => "Calendar could not be reached. Check your connection and try again.",
      SignInError::Refused(_) | SignInError::NoSession => "Sign-in was not accepted. Try again.",
      SignInError::Origin | SignInError::Loopback(_) => "Sign-in could not start. Try again.",
    }
  }
}

/// A client for `origin` whose cookie jar holds `cookie` (the stored `calendar_session` value), if any, and keeps
/// whatever the API sets. After sign-out the app builds a new client without one.
///
/// # Errors
///
/// [`SignInError::Origin`] when `origin` is not a URL.
pub fn http_client(origin: &str, cookie: Option<&str>) -> Result<reqwest::Client, SignInError> {
  let url = Url::parse(origin).map_err(|_| SignInError::Origin)?;
  let jar = Arc::new(Jar::default());
  if let Some(cookie) = cookie {
    jar.add_cookie_str(&format!("{SESSION_COOKIE}={cookie}; Path=/; HttpOnly"), &url);
  }
  reqwest::Client::builder()
    .cookie_provider(jar)
    .build()
    .map_err(|_| SignInError::Origin)
}

/// [`http_client`] with no session, whose every request carries `parent` as its `traceparent`: the sign-in's own
/// requests, so the API's spans for the redemption join the sign-in's trace (#1010).
///
/// # Errors
///
/// [`SignInError::Origin`] when `origin` is not a URL.
pub fn traced_client(origin: &str, parent: &calendar_client::TraceParent) -> Result<reqwest::Client, SignInError> {
  Url::parse(origin).map_err(|_| SignInError::Origin)?;
  let mut headers = reqwest::header::HeaderMap::new();
  let value = reqwest::header::HeaderValue::from_str(&parent.header()).map_err(|_| SignInError::Origin)?;
  headers.insert("traceparent", value);
  reqwest::Client::builder()
    .cookie_provider(Arc::new(Jar::default()))
    .default_headers(headers)
    .build()
    .map_err(|_| SignInError::Origin)
}

/// The URL that starts a native sign-in for `attempt`, redirecting to `redirect_uri`.
///
/// # Errors
///
/// [`SignInError::Origin`] when `origin` is not a URL.
pub fn start_url(origin: &str, attempt: &Attempt, redirect_uri: &str) -> Result<Url, SignInError> {
  let mut url = Url::parse(origin)
    .and_then(|origin| origin.join("/api/auth/native/start"))
    .map_err(|_| SignInError::Origin)?;
  url
    .query_pairs_mut()
    .append_pair("redirect_uri", redirect_uri)
    .append_pair("state", &attempt.state)
    .append_pair("code_challenge", &attempt.challenge)
    .append_pair("code_challenge_method", "S256");
  Ok(url)
}

/// Runs a desktop sign-in against `origin`: binds the loopback, calls `open` with the start URL (the system browser,
/// or a test's driver), waits up to `timeout`, and redeems the code through `client`. Returns the session cookie's
/// value for the caller to store.
///
/// # Errors
///
/// A [`SignInError`] for each way the sign-in can fail; nothing is signed in then.
pub async fn sign_in(
  origin: &str,
  client: &reqwest::Client,
  open: impl FnOnce(&Url) -> std::io::Result<()>,
  timeout: Duration,
) -> Result<String, SignInError> {
  let attempt = Attempt::new();
  let loopback = Loopback::bind().await?;
  let redirect_uri = loopback.redirect_uri();
  open(&start_url(origin, &attempt, &redirect_uri)?).map_err(SignInError::Browser)?;
  let code = loopback.wait(&attempt.state, timeout).await?;
  redeem(origin, client, &code, &attempt.verifier, &redirect_uri).await
}

/// `POST /api/auth/native/token`: the session cookie's value on `204`.
///
/// # Errors
///
/// [`SignInError::Network`], [`SignInError::Refused`] or [`SignInError::NoSession`].
pub async fn redeem(origin: &str, client: &reqwest::Client, code: &str, verifier: &str, redirect_uri: &str) -> Result<String, SignInError> {
  let url = Url::parse(origin)
    .and_then(|origin| origin.join("/api/auth/native/token"))
    .map_err(|_| SignInError::Origin)?;
  let body = serde_json::json!({ "code": code, "codeVerifier": verifier, "redirectUri": redirect_uri });
  let response = client
    .post(url)
    .header(reqwest::header::CONTENT_TYPE, "application/json")
    .body(body.to_string())
    .send()
    .await
    .map_err(|_| SignInError::Network)?;
  if response.status() != StatusCode::NO_CONTENT {
    return Err(SignInError::Refused(response.status()));
  }
  session_cookie(response.headers()).ok_or(SignInError::NoSession)
}

/// The value of the `calendar_session` cookie a response sets.
fn session_cookie(headers: &reqwest::header::HeaderMap) -> Option<String> {
  headers
    .get_all(reqwest::header::SET_COOKIE)
    .iter()
    .filter_map(|value| value.to_str().ok())
    .filter_map(|cookie| cookie.split(';').next()?.trim().split_once('='))
    .find(|(name, value)| *name == SESSION_COOKIE && !value.is_empty())
    .map(|(_, value)| value.to_owned())
}

/// `POST /api/auth/logout`, whatever it answers: the caller forgets the stored cookie either way (ADR-0068,
/// "Sign-out").
pub async fn sign_out(origin: &str, client: &reqwest::Client) {
  if let Ok(url) = Url::parse(origin).and_then(|origin| origin.join("/api/auth/logout")) {
    let _ = client.post(url).send().await;
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::session::pkce::challenge_of;
  use wiremock::matchers::{body_json, header, method, path};
  use wiremock::{Mock, MockServer, ResponseTemplate};

  #[test]
  fn the_start_url_carries_the_redirect_state_and_s256_challenge() {
    let attempt = Attempt::new();
    let url = start_url("https://calendar.example", &attempt, "http://127.0.0.1:49152/callback").unwrap();
    assert_eq!(url.path(), "/api/auth/native/start");
    let query: Vec<(String, String)> = url.query_pairs().into_owned().collect();
    assert_eq!(
      query,
      vec![
        ("redirect_uri".to_owned(), "http://127.0.0.1:49152/callback".to_owned()),
        ("state".to_owned(), attempt.state.clone()),
        ("code_challenge".to_owned(), attempt.challenge.clone()),
        ("code_challenge_method".to_owned(), "S256".to_owned()),
      ]
    );
    assert!(!url.as_str().contains(&attempt.verifier), "the verifier never travels in a URL");
  }

  #[test]
  fn only_a_non_empty_calendar_session_cookie_is_taken() {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.append(
      "set-cookie",
      "calendar_native=; expires=Thu, 01 Jan 1970 00:00:00 GMT".parse().unwrap(),
    );
    assert_eq!(session_cookie(&headers), None);
    headers.append(
      "set-cookie",
      "calendar_session=sealed; path=/; samesite=lax; httponly".parse().unwrap(),
    );
    assert_eq!(session_cookie(&headers).as_deref(), Some("sealed"));
  }

  /// Plays the browser: follows the start URL as the API would after the confirm click, by calling the loopback
  /// with a code and the attempt's `state`.
  fn browser(code: &'static str) -> impl FnOnce(&Url) -> std::io::Result<()> {
    move |start: &Url| {
      let query: std::collections::HashMap<String, String> = start.query_pairs().into_owned().collect();
      let callback = format!("{}?code={code}&state={}", query["redirect_uri"], query["state"]);
      tokio::spawn(async move {
        let _ = reqwest::get(callback).await;
      });
      Ok(())
    }
  }

  #[tokio::test]
  async fn a_sign_in_redeems_the_loopback_code_with_the_verifier_and_keeps_the_session() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/api/auth/native/token"))
      .and(header("content-type", "application/json"))
      .respond_with(ResponseTemplate::new(204).insert_header("set-cookie", "calendar_session=sealed; path=/; samesite=lax; httponly"))
      .expect(1)
      .mount(&server)
      .await;
    let client = http_client(&server.uri(), None).unwrap();

    let cookie = sign_in(&server.uri(), &client, browser("the-code"), Duration::from_secs(10))
      .await
      .unwrap();
    assert_eq!(cookie, "sealed");

    let request = &server.received_requests().await.unwrap()[0];
    let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["code"], "the-code");
    assert!(body["redirectUri"].as_str().unwrap().starts_with("http://127.0.0.1:"));
    let verifier = body["codeVerifier"].as_str().unwrap();
    assert_eq!(verifier.len(), 43);
    assert_ne!(challenge_of(verifier), verifier);

    // The jar sends the session from now on.
    Mock::given(method("GET"))
      .and(path("/api/auth/me"))
      .and(header("cookie", "calendar_session=sealed"))
      .respond_with(ResponseTemplate::new(200))
      .expect(1)
      .mount(&server)
      .await;
    let me = client.get(format!("{}/api/auth/me", server.uri())).send().await.unwrap();
    assert_eq!(me.status(), StatusCode::OK);
  }

  #[tokio::test]
  async fn a_refused_code_signs_nobody_in() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/api/auth/native/token"))
      .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({"title": "invalid_grant"})))
      .mount(&server)
      .await;
    let client = http_client(&server.uri(), None).unwrap();
    let refused = sign_in(&server.uri(), &client, browser("c"), Duration::from_secs(10)).await;
    assert!(matches!(refused, Err(SignInError::Refused(StatusCode::BAD_REQUEST))), "{refused:?}");

    // A 204 without the cookie, from a server of its own (the 400 above would answer first).
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/api/auth/native/token"))
      .and(body_json(serde_json::json!({"code": "x", "codeVerifier": "v", "redirectUri": "r"})))
      .respond_with(ResponseTemplate::new(204))
      .mount(&server)
      .await;
    let no_cookie = redeem(&server.uri(), &client, "x", "v", "r").await;
    assert!(matches!(no_cookie, Err(SignInError::NoSession)), "{no_cookie:?}");
  }

  #[tokio::test]
  async fn a_browser_that_never_comes_back_times_out_and_a_browser_that_cannot_open_says_so() {
    let client = http_client("http://127.0.0.1:9", None).unwrap();
    let abandoned = sign_in("http://127.0.0.1:9", &client, |_: &Url| Ok(()), Duration::from_millis(50)).await;
    assert!(
      matches!(abandoned, Err(SignInError::Loopback(LoopbackError::TimedOut))),
      "{abandoned:?}"
    );
    assert!(abandoned.unwrap_err().message().contains("did not finish"));

    let no_browser = sign_in(
      "http://127.0.0.1:9",
      &client,
      |_: &Url| Err(std::io::Error::other("no browser")),
      Duration::from_secs(1),
    )
    .await;
    assert!(matches!(no_browser, Err(SignInError::Browser(_))), "{no_browser:?}");
  }

  #[tokio::test]
  async fn a_stored_cookie_is_sent_and_sign_out_calls_logout() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/api/auth/logout"))
      .and(header("cookie", "calendar_session=stored"))
      .respond_with(ResponseTemplate::new(204))
      .expect(1)
      .mount(&server)
      .await;
    let client = http_client(&server.uri(), Some("stored")).unwrap();
    sign_out(&server.uri(), &client).await;
  }
}
