//! Native sign-in: the desktop app's session handover through a loopback redirect (RFC 8252), with the
//! API as the authorization server and the cookie session unchanged (ADR-0027, #1008).
//!
//! The app binds `127.0.0.1:0` (or `[::1]:0`), opens the system browser at `GET /api/auth/login` with a
//! [`NativeRequest`] (`redirectUri`, `codeChallenge`, `codeChallengeMethod=S256`, `appState`), and the
//! Google flow runs as for the web app. Instead of setting the session cookie in the browser, the callback
//! redirects to the loopback with a sealed [`Handover`] token that lasts [`HANDOVER_LIFETIME`] and the
//! app's `state`. The app redeems the token with its PKCE verifier at `POST /api/auth/native/session`, whose
//! answer sets the ordinary session cookie. The session cookie therefore never travels in a URL, and the
//! token in the URL is worthless without the verifier, which never leaves the app.
//!
//! The token is stateless, like the session cookie: it can be redeemed more than once within its lifetime
//! by whoever holds the verifier (the maintainer's answer on #1008, question 2).

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use calendar_infrastructure::OwnerId;
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use super::Principal;
use super::session::Sealer;
use crate::endpoints::request::QueryParams;

/// The only path a loopback redirect may name.
pub const LOOPBACK_PATH: &str = "/callback";

/// How long a handover token can be redeemed, from the callback.
pub const HANDOVER_LIFETIME: TimeDelta = TimeDelta::seconds(60);

const HANDOVER_PURPOSE: &str = "calendar.native-handover.v1";
const LOWEST_PORT: u16 = 1024;
const MAX_APP_STATE_LENGTH: usize = 128;

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

/// What a native sign-in asks of `GET /api/auth/login`, carried in the sign-in cookie to the callback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeRequest {
  /// The app's loopback redirect, already checked by [`loopback_redirect`].
  pub redirect_uri: String,
  /// The app's PKCE challenge: `BASE64URL(SHA-256(verifier))`.
  pub code_challenge: String,
  /// The app's own `state`, echoed to the loopback for the app to check.
  pub app_state: String,
}

/// Why a login request is not a valid native sign-in. The message is the problem's detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum NativeRequestError {
  /// Some native parameters are present but not all.
  #[error("A native sign-in needs redirectUri, codeChallenge, codeChallengeMethod and appState.")]
  Incomplete,
  /// `returnUrl` was sent with native parameters.
  #[error("returnUrl cannot be combined with a native sign-in.")]
  WithReturnUrl,
  /// The redirect URI is not an allowed loopback redirect.
  #[error("redirectUri must be http://127.0.0.1:<port>/callback or http://[::1]:<port>/callback with a port from 1024 to 65535.")]
  RedirectUri,
  /// The challenge method is not `S256`, or the challenge is not a base64url SHA-256 digest.
  #[error("codeChallengeMethod must be S256 and codeChallenge a base64url SHA-256 digest.")]
  Challenge,
  /// `appState` is empty, too long, or not URL-safe.
  #[error("appState must be 1 to 128 characters from A-Z, a-z, 0-9, '-', '.', '_' and '~'.")]
  AppState,
}

impl NativeRequest {
  /// The native sign-in a login request asks for: `Ok(None)` for the web app's flow, which sends none of the
  /// native parameters.
  pub fn from_query(query: &QueryParams) -> Result<Option<Self>, NativeRequestError> {
    let redirect_uri = query.get("redirectUri");
    let code_challenge = query.get("codeChallenge");
    let method = query.get("codeChallengeMethod");
    let app_state = query.get("appState");
    if redirect_uri.is_none() && code_challenge.is_none() && method.is_none() && app_state.is_none() {
      return Ok(None);
    }
    if query.get("returnUrl").is_some() {
      return Err(NativeRequestError::WithReturnUrl);
    }
    let (Some(redirect_uri), Some(code_challenge), Some(method), Some(app_state)) = (redirect_uri, code_challenge, method, app_state)
    else {
      return Err(NativeRequestError::Incomplete);
    };
    if loopback_redirect(&redirect_uri).is_none() {
      return Err(NativeRequestError::RedirectUri);
    }
    if method != "S256" || !is_sha256_challenge(&code_challenge) {
      return Err(NativeRequestError::Challenge);
    }
    if app_state.is_empty() || app_state.len() > MAX_APP_STATE_LENGTH || !app_state.bytes().all(is_unreserved) {
      return Err(NativeRequestError::AppState);
    }
    Ok(Some(Self {
      redirect_uri,
      code_challenge,
      app_state,
    }))
  }

  /// Where the browser goes when the sign-in succeeded: the loopback with the handover token and `state`.
  pub fn success_location(&self, code: &str) -> String {
    let query = form_urlencoded::Serializer::new(String::new())
      .append_pair("code", code)
      .append_pair("state", &self.app_state)
      .finish();
    format!("{}?{query}", self.redirect_uri)
  }

  /// Where the browser goes when the sign-in failed: the loopback with `error=access_denied` and `state`.
  pub fn failure_location(&self) -> String {
    let query = form_urlencoded::Serializer::new(String::new())
      .append_pair("error", "access_denied")
      .append_pair("state", &self.app_state)
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

/// The one-time code of a native sign-in: who signed in, bound to the app's challenge and redirect URI.
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

/// Why a handover token is not redeemed. The precise reason is only logged; the app sees one problem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HandoverError {
  /// The token is malformed, forged, or sealed for another purpose or under another key.
  #[error("the handover token cannot be opened")]
  Unreadable,
  /// The token is older than [`HANDOVER_LIFETIME`].
  #[error("the handover token has expired")]
  Expired,
  /// The verifier is not a code verifier, or does not hash to the token's challenge.
  #[error("the code verifier does not match the challenge")]
  VerifierMismatch,
  /// The redirect URI is not the one the token was issued for.
  #[error("the redirect URI does not match the handover token")]
  RedirectMismatch,
}

impl Handover {
  /// The handover for `principal` at the end of `request`'s callback at `now`.
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

  /// The token that goes to the loopback.
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

  fn query(pairs: &[(&str, &str)]) -> QueryParams {
    let query = form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish();
    QueryParams::parse(&query)
  }

  fn native_query(overrides: &[(&str, &str)]) -> QueryParams {
    let challenge = challenge();
    let mut pairs = vec![
      ("redirectUri", "http://127.0.0.1:5000/callback"),
      ("codeChallenge", challenge.as_str()),
      ("codeChallengeMethod", "S256"),
      ("appState", "app-state_1.~"),
    ];
    for (name, value) in overrides {
      pairs.retain(|(key, _)| key != name);
      if !value.is_empty() {
        pairs.push((name, value));
      }
    }
    query(&pairs)
  }

  #[test]
  fn a_login_without_native_parameters_is_the_web_flow() {
    assert_eq!(NativeRequest::from_query(&query(&[("returnUrl", "/day")])), Ok(None));
    assert_eq!(NativeRequest::from_query(&query(&[])), Ok(None));
  }

  #[test]
  fn a_complete_native_login_is_read() {
    let request = NativeRequest::from_query(&native_query(&[])).unwrap().unwrap();
    assert_eq!(request.redirect_uri, "http://127.0.0.1:5000/callback");
    assert_eq!(request.code_challenge, challenge());
    assert_eq!(request.app_state, "app-state_1.~");
  }

  #[test]
  fn an_incomplete_or_invalid_native_login_is_refused() {
    use NativeRequestError::*;
    let cases: &[(&[(&str, &str)], NativeRequestError)] = &[
      (&[("redirectUri", "")], Incomplete),
      (&[("codeChallenge", "")], Incomplete),
      (&[("codeChallengeMethod", "")], Incomplete),
      (&[("appState", "")], Incomplete),
      (&[("returnUrl", "/day")], WithReturnUrl),
      (&[("redirectUri", "http://localhost:5000/callback")], RedirectUri),
      (&[("codeChallengeMethod", "plain")], Challenge),
      (&[("codeChallenge", "short")], Challenge),
      (&[("codeChallenge", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjX!")], Challenge),
      (&[("appState", "has space")], AppState),
      (&[("appState", &"a".repeat(129))], AppState),
    ];
    for (overrides, expected) in cases {
      assert_eq!(NativeRequest::from_query(&native_query(overrides)), Err(*expected), "{overrides:?}");
    }
    // An empty `appState` is sent but empty.
    let empty_state = query(&[
      ("redirectUri", "http://127.0.0.1:5000/callback"),
      ("codeChallenge", &challenge()),
      ("codeChallengeMethod", "S256"),
      ("appState", ""),
    ]);
    assert_eq!(NativeRequest::from_query(&empty_state), Err(AppState));
  }

  #[test]
  fn the_loopback_locations_carry_the_code_or_the_error_and_the_app_state() {
    let request = NativeRequest::from_query(&native_query(&[])).unwrap().unwrap();
    assert_eq!(
      request.success_location("a.b-c_"),
      "http://127.0.0.1:5000/callback?code=a.b-c_&state=app-state_1.%7E"
    );
    assert_eq!(
      request.failure_location(),
      "http://127.0.0.1:5000/callback?error=access_denied&state=app-state_1.%7E"
    );
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
    let request = NativeRequest::from_query(&native_query(&[])).unwrap().unwrap();
    let code = Handover::issue(&principal(), &request, now).seal(&sealer);
    let redirect = "http://127.0.0.1:5000/callback";

    let last_moment = now + HANDOVER_LIFETIME - TimeDelta::seconds(1);
    assert_eq!(Handover::redeem(&sealer, &code, VERIFIER, redirect, last_moment), Ok(principal()));
    assert_eq!(
      Handover::redeem(&sealer, &code, VERIFIER, redirect, now + HANDOVER_LIFETIME),
      Err(HandoverError::Expired)
    );
    let other_verifier = "x".repeat(43);
    assert_eq!(
      Handover::redeem(&sealer, &code, &other_verifier, redirect, now),
      Err(HandoverError::VerifierMismatch)
    );
    // The challenge itself is not a verifier for it.
    assert_eq!(
      Handover::redeem(&sealer, &code, &challenge(), redirect, now),
      Err(HandoverError::VerifierMismatch)
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
      Handover::redeem(&sealer, "not-a-token", VERIFIER, redirect, now),
      Err(HandoverError::Unreadable)
    );
  }

  #[test]
  fn a_handover_does_not_open_as_another_kind_of_token() {
    let sealer = Sealer::new(&[1; 32]);
    let now = Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap();
    let session = crate::auth::session::SessionTicket::issue(principal(), now).seal(&sealer);
    assert_eq!(
      Handover::redeem(&sealer, &session, VERIFIER, "http://127.0.0.1:5000/callback", now),
      Err(HandoverError::Unreadable)
    );
    let request = NativeRequest::from_query(&native_query(&[])).unwrap().unwrap();
    let code = Handover::issue(&principal(), &request, now).seal(&sealer);
    assert_eq!(crate::auth::session::SessionTicket::open(&sealer, &code, now), None);
  }
}
