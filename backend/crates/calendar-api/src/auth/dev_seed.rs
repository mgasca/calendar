//! Development-only authentication for `just db seed` (ADR-0027): a shared key in `X-Dev-Seed-Key`.
//!
//! The seed has no Google identity, so it acts as the user of the first allow-listed email, resolving (or
//! creating, or claiming the legacy placeholder for) that row on every request (ADR-0041). It exists only in
//! Development with `Auth__DevSeedKey` set, and the API refuses to start with a key shorter than 32 characters.

use axum::http::HeaderMap;
use calendar_infrastructure::OwnerId;
use calendar_infrastructure::users::{self, SignIn};
use subtle::ConstantTimeEq;

use super::Principal;
use crate::error::ApiError;
use crate::state::AppState;

/// The header that carries the key.
pub const HEADER: &str = "x-dev-seed-key";

/// Why the seed scheme refuses a request with a valid key when nobody is allow-listed.
pub const NO_ALLOWED_EMAIL_MESSAGE: &str =
  "Auth:AllowedEmails is empty. The seed scheme acts as its first entry, so set Auth__AllowedEmails__0.";

/// Whether the request presents exactly one `X-Dev-Seed-Key` equal to `key`, compared in constant time.
pub fn presents_key(headers: &HeaderMap, key: &str) -> bool {
  let mut provided = headers.get_all(HEADER).iter();
  match (provided.next(), provided.next()) {
    (Some(value), None) => bool::from(value.as_bytes().ct_eq(key.as_bytes())),
    _ => false,
  }
}

/// The seed's principal when the request presents the key, `None` when it does not (or presents a wrong
/// one, or nobody is allow-listed, or the first allow-listed email's user cannot be resolved).
pub async fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<Option<Principal>, ApiError> {
  let settings = state.settings();
  let Some(key) = settings.dev_seed_key.as_deref().filter(|_| settings.seed_enabled()) else {
    return Ok(None);
  };
  if !presents_key(headers, key) {
    return Ok(None);
  }
  let Some(email) = settings.first_allowed_email() else {
    tracing::warn!("{NO_ALLOWED_EMAIL_MESSAGE}");
    return Ok(None);
  };

  let mut connection = state.db().await?;
  let sign_in = SignIn {
    email,
    google_subject: None,
    display_name: None,
    picture_url: None,
  };
  match users::resolve(&mut connection, state.now(), &sign_in, Some(email)).await {
    Ok(user) => Ok(Some(Principal {
      owner: OwnerId(user.id()),
      name: Some("dev-seed".to_owned()),
      email: user.email().map(str::to_owned),
      picture: None,
    })),
    Err(error @ calendar_infrastructure::Error::UniqueViolation { .. }) => {
      tracing::warn!("The seed scheme could not resolve the first allow-listed email's user: {error}");
      Ok(None)
    }
    Err(error) => Err(error.into()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn exactly_one_matching_key_is_needed() {
    let key = "12345678901234567890123456789012";
    let mut headers = HeaderMap::new();
    assert!(!presents_key(&headers, key));
    headers.append(HEADER, key.parse().unwrap());
    assert!(presents_key(&headers, key));
    assert!(!presents_key(&headers, "another-key-of-the-same-length-!"));
    assert!(!presents_key(&headers, "short"));
    headers.append(HEADER, key.parse().unwrap());
    assert!(!presents_key(&headers, key));
  }
}
