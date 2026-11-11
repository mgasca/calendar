//! The session cookie: stateless, sealed with XChaCha20-Poly1305 under the key held in the `session_keys`
//! table. It carries the user's id, name, email and picture and an absolute expiry of eight hours with no
//! sliding renewal, is `HttpOnly` and `SameSite=Lax`, and `Secure` outside Development (in Development, when
//! the request came over HTTPS).

use axum::http::header::COOKIE;
use axum::http::{HeaderMap, HeaderValue};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::Principal;

/// The name of the session cookie.
pub const SESSION_COOKIE: &str = "calendar_session";

/// How long a session lasts, from sign-in. It is not extended by use.
pub const SESSION_LIFETIME: TimeDelta = TimeDelta::hours(8);

const SESSION_PURPOSE: &str = "calendar.session.v1";
const NONCE_LENGTH: usize = 24;
const FORMAT_VERSION: u8 = 1;

/// Seals small payloads into cookie-safe tokens and opens them again. A token only opens under the key and
/// the purpose it was sealed with, so one kind of cookie cannot be presented as another.
#[derive(Clone)]
pub struct Sealer {
  cipher: XChaCha20Poly1305,
}

impl Sealer {
  /// A sealer for `key`.
  pub fn new(key: &[u8; 32]) -> Self {
    Self {
      cipher: XChaCha20Poly1305::new(&Key::from(*key)),
    }
  }

  /// Seals `plaintext` for `purpose` into a base64url token: a version byte, a fresh random nonce, and the
  /// ciphertext with its tag.
  pub fn seal(&self, purpose: &str, plaintext: &[u8]) -> String {
    let mut nonce = [0_u8; NONCE_LENGTH];
    rand::fill(&mut nonce);
    let sealed = self
      .cipher
      .encrypt(
        &XNonce::from(nonce),
        Payload {
          msg: plaintext,
          aad: purpose.as_bytes(),
        },
      )
      .expect("XChaCha20-Poly1305 encryption of an in-memory buffer cannot fail");
    let mut token = Vec::with_capacity(1 + NONCE_LENGTH + sealed.len());
    token.push(FORMAT_VERSION);
    token.extend_from_slice(&nonce);
    token.extend_from_slice(&sealed);
    URL_SAFE_NO_PAD.encode(token)
  }

  /// Opens a token sealed for `purpose`; `None` when it is malformed, forged, or sealed with another key or
  /// for another purpose.
  pub fn open(&self, purpose: &str, token: &str) -> Option<Vec<u8>> {
    let bytes = URL_SAFE_NO_PAD.decode(token).ok()?;
    let (&version, rest) = bytes.split_first()?;
    if version != FORMAT_VERSION || rest.len() < NONCE_LENGTH {
      return None;
    }
    let (nonce, sealed) = rest.split_at(NONCE_LENGTH);
    let nonce: [u8; NONCE_LENGTH] = nonce.try_into().ok()?;
    self
      .cipher
      .decrypt(
        &XNonce::from(nonce),
        Payload {
          msg: sealed,
          aad: purpose.as_bytes(),
        },
      )
      .ok()
  }
}

/// What a session cookie holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionTicket {
  /// The signed-in user's id. A ticket without one is rejected and the cookie cleared (ADR-0041).
  pub user_id: Option<Uuid>,
  /// Display name.
  pub name: Option<String>,
  /// Email.
  pub email: Option<String>,
  /// Picture URL.
  pub picture: Option<String>,
  /// When the session ends.
  pub expires_at: DateTime<Utc>,
}

impl SessionTicket {
  /// A ticket for `principal`, signed in at `now`.
  pub fn issue(principal: &Principal, now: DateTime<Utc>) -> Self {
    Self {
      user_id: Some(principal.user_id),
      name: principal.name.clone(),
      email: principal.email.clone(),
      picture: principal.picture.clone(),
      expires_at: now + SESSION_LIFETIME,
    }
  }

  /// The cookie value of this ticket.
  pub fn seal(&self, sealer: &Sealer) -> String {
    let json = serde_json::to_vec(self).expect("a session ticket serializes to JSON");
    sealer.seal(SESSION_PURPOSE, &json)
  }

  /// Opens a cookie value; `None` when it does not open or has expired at `now`.
  pub fn open(sealer: &Sealer, cookie: &str, now: DateTime<Utc>) -> Option<Self> {
    let json = sealer.open(SESSION_PURPOSE, cookie)?;
    let ticket: Self = serde_json::from_slice(&json).ok()?;
    (now < ticket.expires_at).then_some(ticket)
  }

  /// The person the ticket signs in, or `None` when it carries no user id.
  pub fn principal(&self) -> Option<Principal> {
    Some(Principal {
      user_id: self.user_id?,
      name: self.name.clone(),
      email: self.email.clone(),
      picture: self.picture.clone(),
    })
  }
}

/// The value of cookie `name` in the request, if it sent one.
pub fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
  headers
    .get_all(COOKIE)
    .iter()
    .filter_map(|value| value.to_str().ok())
    .flat_map(|value| value.split(';'))
    .filter_map(|pair| pair.trim().split_once('='))
    .find_map(|(key, value)| (key == name).then_some(value))
}

/// A `Set-Cookie` value for a session-lifetime cookie (or one that lasts `max_age_seconds`), with the
/// attributes every cookie of the API has: `path=/`, `samesite=lax`, `httponly`, and `secure` when asked.
pub fn set_cookie(name: &str, value: &str, secure: bool, max_age_seconds: Option<i64>) -> HeaderValue {
  let max_age = max_age_seconds.map(|seconds| format!("; max-age={seconds}")).unwrap_or_default();
  let secure = if secure { "; secure" } else { "" };
  HeaderValue::from_str(&format!("{name}={value}{max_age}; path=/{secure}; samesite=lax; httponly"))
    .expect("cookie names and sealed values are visible ASCII")
}

/// A `Set-Cookie` value that makes the browser drop cookie `name`.
pub fn clear_cookie(name: &str, secure: bool) -> HeaderValue {
  let secure = if secure { "; secure" } else { "" };
  HeaderValue::from_str(&format!(
    "{name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/{secure}; samesite=lax; httponly"
  ))
  .expect("cookie names are visible ASCII")
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::TimeZone;

  fn principal() -> Principal {
    Principal {
      user_id: Uuid::from_u128(7),
      name: Some("Someone".to_owned()),
      email: Some("someone@example.com".to_owned()),
      picture: None,
    }
  }

  #[test]
  fn a_ticket_opens_under_its_key_until_it_expires() {
    let sealer = Sealer::new(&[1; 32]);
    let now = Utc.with_ymd_and_hms(2026, 10, 26, 15, 0, 0).unwrap();
    let ticket = SessionTicket::issue(&principal(), now);
    assert_eq!(ticket.expires_at, now + TimeDelta::hours(8));
    let cookie = ticket.seal(&sealer);

    let opened = SessionTicket::open(&sealer, &cookie, now + TimeDelta::hours(8) - TimeDelta::seconds(1)).unwrap();
    assert_eq!(opened.principal(), Some(principal()));
    assert_eq!(SessionTicket::open(&sealer, &cookie, now + TimeDelta::hours(8)), None);
    assert_eq!(SessionTicket::open(&Sealer::new(&[2; 32]), &cookie, now), None);
  }

  #[test]
  fn tokens_are_bound_to_their_purpose_and_tamper_evident() {
    let sealer = Sealer::new(&[1; 32]);
    let token = sealer.seal("a", b"payload");
    assert_eq!(sealer.open("a", &token).as_deref(), Some(&b"payload"[..]));
    assert_eq!(sealer.open("b", &token), None);
    assert_ne!(sealer.seal("a", b"payload"), token, "each token has its own nonce");

    let mut bytes = URL_SAFE_NO_PAD.decode(&token).unwrap();
    *bytes.last_mut().unwrap() ^= 1;
    assert_eq!(sealer.open("a", &URL_SAFE_NO_PAD.encode(bytes)), None);
    assert_eq!(sealer.open("a", "not base64 !"), None);
    assert_eq!(sealer.open("a", ""), None);
  }

  #[test]
  fn a_ticket_without_a_user_id_signs_nobody_in() {
    let ticket = SessionTicket {
      user_id: None,
      ..SessionTicket::issue(&principal(), DateTime::UNIX_EPOCH)
    };
    assert_eq!(ticket.principal(), None);
  }

  #[test]
  fn cookies_are_read_and_written() {
    let mut headers = HeaderMap::new();
    headers.append(COOKIE, "a=1; calendar_session=abc".parse().unwrap());
    headers.append(COOKIE, "b=2".parse().unwrap());
    assert_eq!(cookie_value(&headers, SESSION_COOKIE), Some("abc"));
    assert_eq!(cookie_value(&headers, "b"), Some("2"));
    assert_eq!(cookie_value(&headers, "c"), None);

    assert_eq!(set_cookie("n", "v", false, None), "n=v; path=/; samesite=lax; httponly");
    assert_eq!(
      set_cookie("n", "v", true, Some(900)),
      "n=v; max-age=900; path=/; secure; samesite=lax; httponly"
    );
    assert_eq!(
      clear_cookie("n", true),
      "n=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=lax; httponly"
    );
  }
}
