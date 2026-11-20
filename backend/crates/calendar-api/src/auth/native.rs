//! Native sign-in: the desktop app's session handover through a loopback redirect (RFC 8252), with the API
//! as the authorization server and the cookie session unchanged (ADR-0068, amending ADR-0027; #1008).
//!
//! 1. The app binds `127.0.0.1:0` (or `[::1]:0`) and opens the system browser at `GET /api/auth/native/start`
//!    with a [`NativeRequest`]. The API checks it, seals it into the [`NATIVE_COOKIE`] flow cookie, and sends
//!    the browser to the confirm page.
//! 2. `GET /api/auth/native/confirm` sends a browser without a session through the ordinary Google sign-in
//!    (`/api/auth/login?returnUrl=/api/auth/native/confirm`), so a browser already signed in skips Google. A
//!    signed-in browser sees "Sign in to the Calendar desktop app?" and the signed-in email.
//! 3. The page's button posts the same-origin form `POST /api/auth/native/confirm`. Without that click no code
//!    is minted, so a local process that sends the browser to `start` with its own listener gets nothing. The
//!    POST is refused unless the browser says it is same-origin, and the page refuses to be framed.
//! 4. The POST redirects (303) to the loopback with a sealed [`Handover`] code that lasts [`HANDOVER_LIFETIME`]
//!    and the app's `state`. The app redeems the code with its PKCE verifier at `POST /api/auth/native/token`
//!    (`crate::endpoints::auth::native_token`), whose answer sets the ordinary session cookie.
//!
//! The session cookie never travels in a URL, and the code in the URL is worthless without the verifier, which
//! never leaves the app. The code is stateless, like the session cookie: it can be redeemed more than once
//! within its lifetime by whoever holds the verifier (the maintainer's answer on #1008, question 2).

use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, LOCATION, ORIGIN, SET_COOKIE, X_FRAME_OPTIONS};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use calendar_infrastructure::OwnerId;
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use super::session::{self, Sealer};
use super::{CurrentUser, MaybeUser, Principal};
use crate::endpoints::request::QueryParams;
use crate::error::ApiError;
use crate::hosting::RequestOrigin;
use crate::problem::Problem;
use crate::state::AppState;

/// The path that starts a native sign-in.
pub const START_PATH: &str = "/api/auth/native/start";

/// The path of the confirm page and of the form it posts.
pub const CONFIRM_PATH: &str = "/api/auth/native/confirm";

/// Where the confirm page sends a browser that is not signed in.
pub const SIGN_IN_FOR_CONFIRM: &str = "/api/auth/login?returnUrl=%2Fapi%2Fauth%2Fnative%2Fconfirm";

/// The cookie that carries the app's [`NativeRequest`] from `start` to the confirm POST.
pub const NATIVE_COOKIE: &str = "calendar_native";

/// The only path a loopback redirect may name.
pub const LOOPBACK_PATH: &str = "/callback";

/// How long a handover code can be redeemed, from the confirm click.
pub const HANDOVER_LIFETIME: TimeDelta = TimeDelta::seconds(60);

const FLOW_PURPOSE: &str = "calendar.native-flow.v1";
const FLOW_LIFETIME: TimeDelta = TimeDelta::minutes(15);
const HANDOVER_PURPOSE: &str = "calendar.native-handover.v1";
const LOWEST_PORT: u16 = 1024;
const MAX_STATE_LENGTH: usize = 128;

/// The redirect URI if it is an allowed loopback redirect: `http`, the host `127.0.0.1` or `[::1]` (never
/// `localhost`, which the hosts file can point elsewhere; RFC 8252 §8.3), a port from 1024 to 65535 written
/// without leading zeros (any such port, because the app lets the OS pick one; RFC 8252 §7.3), and exactly the
/// path [`LOOPBACK_PATH`], with no user info, query or fragment.
pub fn loopback_redirect(uri: &str) -> Option<&str> {
  let rest = uri.strip_prefix("http://")?;
  let rest = rest.strip_prefix("127.0.0.1:").or_else(|| rest.strip_prefix("[::1]:"))?;
  let port = rest.strip_suffix(LOOPBACK_PATH)?;
  let canonical = !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()) && !port.starts_with('0');
  let allowed = canonical && port.parse::<u16>().is_ok_and(|port| port >= LOWEST_PORT);
  allowed.then_some(uri)
}

/// What the app asks of `GET /api/auth/native/start`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeRequest {
  /// The app's loopback redirect, already checked by [`loopback_redirect`].
  pub redirect_uri: String,
  /// The app's PKCE challenge: `BASE64URL(SHA-256(verifier))`.
  pub code_challenge: String,
  /// The app's `state`, echoed to the loopback for the app to check.
  pub state: String,
}

/// Why a start request is refused. The message is the problem's detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum NativeRequestError {
  /// A parameter is missing.
  #[error("A native sign-in needs redirect_uri, state, code_challenge and code_challenge_method.")]
  Incomplete,
  /// The redirect URI is not an allowed loopback redirect.
  #[error("redirect_uri must be http://127.0.0.1:<port>/callback or http://[::1]:<port>/callback with a port from 1024 to 65535.")]
  RedirectUri,
  /// The challenge method is not `S256`, or the challenge is not a base64url SHA-256 digest.
  #[error("code_challenge_method must be S256 and code_challenge a base64url SHA-256 digest.")]
  Challenge,
  /// `state` is empty, too long, or not URL-safe.
  #[error("state must be 1 to 128 characters from A-Z, a-z, 0-9, '-', '.', '_' and '~'.")]
  State,
}

impl NativeRequest {
  /// Reads and checks a start request.
  pub fn from_query(query: &QueryParams) -> Result<Self, NativeRequestError> {
    let (Some(redirect_uri), Some(state), Some(code_challenge), Some(method)) = (
      query.get("redirect_uri"),
      query.get("state"),
      query.get("code_challenge"),
      query.get("code_challenge_method"),
    ) else {
      return Err(NativeRequestError::Incomplete);
    };
    if loopback_redirect(&redirect_uri).is_none() {
      return Err(NativeRequestError::RedirectUri);
    }
    if method != "S256" || !is_sha256_challenge(&code_challenge) {
      return Err(NativeRequestError::Challenge);
    }
    if state.is_empty() || state.len() > MAX_STATE_LENGTH || !state.bytes().all(is_unreserved) {
      return Err(NativeRequestError::State);
    }
    Ok(Self {
      redirect_uri,
      code_challenge,
      state,
    })
  }

  /// Where the browser goes after the confirm click: the loopback with the handover code and `state`.
  pub fn success_location(&self, code: &str) -> String {
    let query = form_urlencoded::Serializer::new(String::new())
      .append_pair("code", code)
      .append_pair("state", &self.state)
      .finish();
    format!("{}?{query}", self.redirect_uri)
  }
}

/// RFC 3986 unreserved characters, which RFC 7636 allows in a code verifier.
fn is_unreserved(byte: u8) -> bool {
  byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

/// Whether `challenge` is the unpadded base64url of 32 bytes, as an S256 challenge is.
fn is_sha256_challenge(challenge: &str) -> bool {
  challenge.len() == 43 && URL_SAFE_NO_PAD.decode(challenge).is_ok_and(|bytes| bytes.len() == 32)
}

/// Whether `verifier` is a valid RFC 7636 code verifier: 43 to 128 unreserved characters.
fn is_verifier(verifier: &str) -> bool {
  (43..=128).contains(&verifier.len()) && verifier.bytes().all(is_unreserved)
}

/// What the flow cookie holds between `start` and the confirm POST.
#[derive(Debug, Serialize, Deserialize)]
struct NativeFlow {
  request: NativeRequest,
  expires_at: DateTime<Utc>,
}

/// The app's request from the flow cookie, while it lasts.
async fn open_flow(state: &AppState, headers: &HeaderMap) -> Result<Option<NativeRequest>, ApiError> {
  let Some(cookie) = session::cookie_value(headers, NATIVE_COOKIE) else {
    return Ok(None);
  };
  let flow: Option<NativeFlow> = state
    .sealer()
    .await?
    .open(FLOW_PURPOSE, cookie)
    .and_then(|json| serde_json::from_slice(&json).ok());
  Ok(flow.filter(|flow| state.now() < flow.expires_at).map(|flow| flow.request))
}

fn no_flow() -> ApiError {
  Problem::titled(StatusCode::BAD_REQUEST, "The desktop sign-in has expired or was not started.")
    .with_detail("Start signing in again from the desktop app.")
    .into()
}

/// `GET /api/auth/native/start`: checks the app's request, keeps it in the flow cookie, and sends the browser
/// to the confirm page. A request that is not safe is answered `400`, never redirected.
pub async fn start(State(state): State<AppState>, origin: RequestOrigin, query: QueryParams) -> Result<Response, ApiError> {
  let request = NativeRequest::from_query(&query)
    .map_err(|error| Problem::titled(StatusCode::BAD_REQUEST, "The native sign-in request is invalid.").with_detail(error.to_string()))?;
  let flow = NativeFlow {
    request,
    expires_at: state.now() + FLOW_LIFETIME,
  };
  let sealed = state
    .sealer()
    .await?
    .seal(FLOW_PURPOSE, &serde_json::to_vec(&flow).map_err(ApiError::internal)?);
  let cookie = session::set_cookie(
    NATIVE_COOKIE,
    &sealed,
    origin.secure_cookies(state.settings()),
    Some(FLOW_LIFETIME.num_seconds()),
  );
  Ok(redirect(StatusCode::FOUND, CONFIRM_PATH, &[cookie]))
}

/// `GET /api/auth/native/confirm`: asks the signed-in person to confirm the desktop sign-in, or sends a browser
/// that is not signed in through Google first.
pub async fn confirm_page(State(state): State<AppState>, MaybeUser(user): MaybeUser, headers: HeaderMap) -> Result<Response, ApiError> {
  let request = open_flow(&state, &headers).await?.ok_or_else(no_flow)?;
  let Some(user) = user else {
    return Ok(redirect(StatusCode::FOUND, SIGN_IN_FOR_CONFIRM, &[]));
  };
  let email = escape_html(user.email.as_deref().unwrap_or_default());
  let page = format!(
    "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">\
     <title>Sign in to the Calendar desktop app</title></head><body>\
     <h1>Sign in to the Calendar desktop app?</h1>\
     <p>You are signed in as <strong>{email}</strong>. Continue only if you started signing in from the Calendar \
     desktop app on this computer.</p>\
     <form method=\"post\" action=\"{CONFIRM_PATH}\"><button type=\"submit\">Sign in to the desktop app</button></form>\
     <p><a href=\"/\">Cancel</a></p></body></html>\n"
  );
  let mut response = (StatusCode::OK, page).into_response();
  let headers = response.headers_mut();
  headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
  // Browsers apply `form-action` to the redirects that follow a form, so the policy names the one loopback
  // the POST will send the browser to. `loopback_redirect` admitted only header-safe characters.
  let policy = format!(
    "default-src 'none'; form-action 'self' {}; frame-ancestors 'none'; base-uri 'none'",
    request.redirect_uri
  );
  headers.insert(
    HeaderName::from_static("content-security-policy"),
    HeaderValue::from_str(&policy).map_err(ApiError::internal)?,
  );
  refuse_framing(headers);
  Ok(response)
}

/// The click is the guard, so neither the confirm page nor the answer to its POST may be framed
/// (clickjacking) or kept.
fn refuse_framing(headers: &mut HeaderMap) {
  headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
  headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
  headers
    .entry(HeaderName::from_static("content-security-policy"))
    .or_insert(HeaderValue::from_static("frame-ancestors 'none'"));
}

/// `POST /api/auth/native/confirm`: the confirm click. Mints the handover code and sends the browser to the app's
/// loopback. Refused unless the browser says the form came from this origin.
pub async fn confirm(
  State(state): State<AppState>,
  origin: RequestOrigin,
  CurrentUser(user): CurrentUser,
  headers: HeaderMap,
) -> Result<Response, ApiError> {
  if !is_same_origin(&headers, &origin) {
    return Err(Problem::titled(StatusCode::FORBIDDEN, "The desktop sign-in must be confirmed on its own page.").into());
  }
  let request = open_flow(&state, &headers).await?.ok_or_else(no_flow)?;
  let code = Handover::issue(&user, &request, state.now()).seal(&state.sealer().await?);
  let clear_flow = session::clear_cookie(NATIVE_COOKIE, origin.secure_cookies(state.settings()));
  Ok(redirect(StatusCode::SEE_OTHER, &request.success_location(&code), &[clear_flow]))
}

/// Whether the browser says the request came from this origin: `Origin` names it, or, without `Origin`,
/// `Sec-Fetch-Site` is `same-origin`. A request with neither (not a browser form) is refused.
fn is_same_origin(headers: &HeaderMap, origin: &RequestOrigin) -> bool {
  let header = |name| headers.get(name).and_then(|value: &HeaderValue| value.to_str().ok());
  match header(ORIGIN) {
    Some(sent) => sent.eq_ignore_ascii_case(&format!("{}://{}", origin.scheme, origin.host)),
    None => header(HeaderName::from_static("sec-fetch-site")) == Some("same-origin"),
  }
}

fn redirect(status: StatusCode, location: &str, cookies: &[HeaderValue]) -> Response {
  let mut response = status.into_response();
  let headers = response.headers_mut();
  headers.insert(
    LOCATION,
    HeaderValue::from_str(location).unwrap_or_else(|_| HeaderValue::from_static("/")),
  );
  refuse_framing(headers);
  for cookie in cookies {
    headers.append(SET_COOKIE, cookie.clone());
  }
  response
}

fn escape_html(text: &str) -> String {
  let mut escaped = String::with_capacity(text.len());
  for character in text.chars() {
    match character {
      '&' => escaped.push_str("&amp;"),
      '<' => escaped.push_str("&lt;"),
      '>' => escaped.push_str("&gt;"),
      '"' => escaped.push_str("&quot;"),
      '\'' => escaped.push_str("&#39;"),
      other => escaped.push(other),
    }
  }
  escaped
}

/// The handover code of a native sign-in: who confirmed, bound to the app's challenge and redirect URI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Handover {
  user_id: Uuid,
  name: Option<String>,
  email: Option<String>,
  picture: Option<String>,
  code_challenge: String,
  redirect_uri: String,
  expires_at: DateTime<Utc>,
}

/// Why a handover code is not redeemed. The precise reason is only logged; the app sees `invalid_grant`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HandoverError {
  /// The code is malformed, forged, or sealed for another purpose or under another key.
  #[error("the handover code cannot be opened")]
  Unreadable,
  /// The code is older than [`HANDOVER_LIFETIME`].
  #[error("the handover code has expired")]
  Expired,
  /// The verifier is not a code verifier, or does not hash to the code's challenge.
  #[error("the code verifier does not match the challenge")]
  VerifierMismatch,
  /// The redirect URI is not the one the code was issued for.
  #[error("the redirect URI does not match the handover code")]
  RedirectMismatch,
}

impl Handover {
  /// The handover for `principal`, confirmed for `request` at `now`.
  pub fn issue(principal: &Principal, request: &NativeRequest, now: DateTime<Utc>) -> Self {
    Self {
      user_id: principal.owner.0,
      name: principal.name.clone(),
      email: principal.email.clone(),
      picture: principal.picture.clone(),
      code_challenge: request.code_challenge.clone(),
      redirect_uri: request.redirect_uri.clone(),
      expires_at: now + HANDOVER_LIFETIME,
    }
  }

  /// The code that goes to the loopback.
  pub fn seal(&self, sealer: &Sealer) -> String {
    let json = serde_json::to_vec(self).expect("a handover serializes to JSON");
    sealer.seal(HANDOVER_PURPOSE, &json)
  }

  /// Redeems `code` with the app's `verifier` and `redirect_uri` at `now`: the person it signs in.
  pub fn redeem(sealer: &Sealer, code: &str, verifier: &str, redirect_uri: &str, now: DateTime<Utc>) -> Result<Principal, HandoverError> {
    let handover: Self = sealer
      .open(HANDOVER_PURPOSE, code)
      .and_then(|json| serde_json::from_slice(&json).ok())
      .ok_or(HandoverError::Unreadable)?;
    if now >= handover.expires_at {
      return Err(HandoverError::Expired);
    }
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    if !is_verifier(verifier) || !bool::from(challenge.as_bytes().ct_eq(handover.code_challenge.as_bytes())) {
      return Err(HandoverError::VerifierMismatch);
    }
    if !bool::from(redirect_uri.as_bytes().ct_eq(handover.redirect_uri.as_bytes())) {
      return Err(HandoverError::RedirectMismatch);
    }
    Ok(Principal {
      owner: OwnerId(handover.user_id),
      name: handover.name,
      email: handover.email,
      picture: handover.picture,
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::TimeZone;

  #[test]
  fn only_loopback_ip_literals_on_the_callback_path_with_an_unprivileged_port_are_allowed() {
    for allowed in [
      "http://127.0.0.1:1024/callback",
      "http://127.0.0.1:49152/callback",
      "http://127.0.0.1:65535/callback",
      "http://[::1]:5000/callback",
    ] {
      assert_eq!(loopback_redirect(allowed), Some(allowed), "{allowed}");
    }
    for refused in [
      "http://localhost:5000/callback",
      "https://127.0.0.1:5000/callback",
      "http://127.0.0.1/callback",
      "http://127.0.0.1:/callback",
      "http://127.0.0.1:1023/callback",
      "http://127.0.0.1:80/callback",
      "http://127.0.0.1:65536/callback",
      "http://127.0.0.1:05000/callback",
      "http://127.0.0.1:+5000/callback",
      "http://127.0.0.1:5000/callback/",
      "http://127.0.0.1:5000/other",
      "http://127.0.0.1:5000/callback?x=1",
      "http://127.0.0.1:5000/callback#x",
      "http://user@127.0.0.1:5000/callback",
      "http://127.0.0.1:5000@evil.test/callback",
      "http://127.0.0.2:5000/callback",
      "http://[::2]:5000/callback",
      "http://evil.test/http://127.0.0.1:5000/callback",
      "HTTP://127.0.0.1:5000/callback",
      "",
    ] {
      assert_eq!(loopback_redirect(refused), None, "{refused}");
    }
  }

  const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  fn challenge() -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()))
  }

  /// A parameter to replace, or to remove when the value is `None`.
  type Override<'a> = (&'a str, Option<&'a str>);

  /// A start query: the valid request, with each `overrides` pair replacing its parameter (or, when the value
  /// is `None`, removing it).
  fn start_query(overrides: &[Override]) -> QueryParams {
    let challenge = challenge();
    let mut pairs = vec![
      ("redirect_uri", "http://127.0.0.1:5000/callback"),
      ("state", "app-state_1.~"),
      ("code_challenge", challenge.as_str()),
      ("code_challenge_method", "S256"),
    ];
    for (name, value) in overrides {
      pairs.retain(|(key, _)| key != name);
      if let Some(value) = value {
        pairs.push((name, value));
      }
    }
    QueryParams::parse(&form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish())
  }

  #[test]
  fn a_complete_start_request_is_read() {
    let request = NativeRequest::from_query(&start_query(&[])).unwrap();
    assert_eq!(request.redirect_uri, "http://127.0.0.1:5000/callback");
    assert_eq!(request.code_challenge, challenge());
    assert_eq!(request.state, "app-state_1.~");
  }

  #[test]
  fn an_incomplete_or_invalid_start_request_is_refused() {
    use NativeRequestError::{Challenge, Incomplete, RedirectUri, State};
    let long_state = "a".repeat(129);
    let cases: &[(&[Override], NativeRequestError)] = &[
      (&[("redirect_uri", None)], Incomplete),
      (&[("state", None)], Incomplete),
      (&[("code_challenge", None)], Incomplete),
      (&[("code_challenge_method", None)], Incomplete),
      (&[("redirect_uri", Some("http://localhost:5000/callback"))], RedirectUri),
      (&[("code_challenge_method", Some("plain"))], Challenge),
      (&[("code_challenge", Some("short"))], Challenge),
      (
        &[("code_challenge", Some("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjX!"))],
        Challenge,
      ),
      (&[("state", Some(""))], State),
      (&[("state", Some("has space"))], State),
      (&[("state", Some(&long_state))], State),
    ];
    for (overrides, expected) in cases {
      assert_eq!(NativeRequest::from_query(&start_query(overrides)), Err(*expected), "{overrides:?}");
    }
  }

  #[test]
  fn the_loopback_location_carries_the_code_and_the_state() {
    let request = NativeRequest::from_query(&start_query(&[])).unwrap();
    assert_eq!(
      request.success_location("a.b-c_"),
      "http://127.0.0.1:5000/callback?code=a.b-c_&state=app-state_1.%7E"
    );
  }

  #[test]
  fn the_confirm_post_must_come_from_this_origin() {
    let origin = RequestOrigin {
      scheme: "https".to_owned(),
      host: "calendar.example".to_owned(),
    };
    let headers = |pairs: &[(&'static str, &'static str)]| {
      let mut headers = HeaderMap::new();
      for (name, value) in pairs {
        headers.insert(*name, HeaderValue::from_static(value));
      }
      headers
    };
    assert!(is_same_origin(&headers(&[("origin", "https://calendar.example")]), &origin));
    assert!(is_same_origin(&headers(&[("sec-fetch-site", "same-origin")]), &origin));
    assert!(!is_same_origin(&headers(&[("origin", "https://evil.test")]), &origin));
    assert!(!is_same_origin(&headers(&[("origin", "http://calendar.example")]), &origin));
    assert!(!is_same_origin(&headers(&[("origin", "null")]), &origin));
    assert!(
      !is_same_origin(
        &headers(&[("origin", "https://evil.test"), ("sec-fetch-site", "same-origin")]),
        &origin
      ),
      "Origin wins over Sec-Fetch-Site"
    );
    assert!(!is_same_origin(&headers(&[("sec-fetch-site", "same-site")]), &origin));
    assert!(!is_same_origin(&headers(&[]), &origin));
  }

  #[test]
  fn emails_are_escaped_on_the_confirm_page() {
    assert_eq!(escape_html("a<b>&\"'c@example.com"), "a&lt;b&gt;&amp;&quot;&#39;c@example.com");
  }

  fn principal() -> Principal {
    Principal {
      owner: OwnerId(Uuid::from_u128(7)),
      name: Some("Someone".to_owned()),
      email: Some("someone@example.com".to_owned()),
      picture: None,
    }
  }

  #[test]
  fn a_handover_redeems_with_its_verifier_and_redirect_until_it_expires() {
    let sealer = Sealer::new(&[1; 32]);
    let now = Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap();
    let request = NativeRequest::from_query(&start_query(&[])).unwrap();
    let code = Handover::issue(&principal(), &request, now).seal(&sealer);
    let redirect = "http://127.0.0.1:5000/callback";

    let last_moment = now + HANDOVER_LIFETIME - TimeDelta::seconds(1);
    assert_eq!(Handover::redeem(&sealer, &code, VERIFIER, redirect, last_moment), Ok(principal()));
    assert_eq!(
      Handover::redeem(&sealer, &code, VERIFIER, redirect, now + HANDOVER_LIFETIME),
      Err(HandoverError::Expired)
    );
    assert_eq!(
      Handover::redeem(&sealer, &code, &"x".repeat(43), redirect, now),
      Err(HandoverError::VerifierMismatch)
    );
    assert_eq!(
      Handover::redeem(&sealer, &code, &challenge(), redirect, now),
      Err(HandoverError::VerifierMismatch),
      "the challenge itself is not a verifier for it"
    );
    assert_eq!(
      Handover::redeem(&sealer, &code, VERIFIER, "http://127.0.0.1:5001/callback", now),
      Err(HandoverError::RedirectMismatch)
    );
    assert_eq!(
      Handover::redeem(&Sealer::new(&[2; 32]), &code, VERIFIER, redirect, now),
      Err(HandoverError::Unreadable)
    );
    assert_eq!(
      Handover::redeem(&sealer, "not-a-code", VERIFIER, redirect, now),
      Err(HandoverError::Unreadable)
    );
  }

  #[test]
  fn a_handover_does_not_open_as_another_kind_of_token() {
    let sealer = Sealer::new(&[1; 32]);
    let now = Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap();
    let redirect = "http://127.0.0.1:5000/callback";
    let session = session::SessionTicket::issue(principal(), now).seal(&sealer);
    assert_eq!(
      Handover::redeem(&sealer, &session, VERIFIER, redirect, now),
      Err(HandoverError::Unreadable)
    );
    let request = NativeRequest::from_query(&start_query(&[])).unwrap();
    let flow = sealer.seal(
      FLOW_PURPOSE,
      &serde_json::to_vec(&NativeFlow {
        request: request.clone(),
        expires_at: now + FLOW_LIFETIME,
      })
      .unwrap(),
    );
    assert_eq!(
      Handover::redeem(&sealer, &flow, VERIFIER, redirect, now),
      Err(HandoverError::Unreadable)
    );
    let code = Handover::issue(&principal(), &request, now).seal(&sealer);
    assert_eq!(session::SessionTicket::open(&sealer, &code, now), None);
  }
}
