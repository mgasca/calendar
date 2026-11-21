//! The secrets of one sign-in attempt: a PKCE verifier and its S256 challenge (RFC 7636), and the `state` the
//! loopback checks (ADR-0068, step 1).

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

/// A fresh verifier, its challenge and a `state`, each from 32 random bytes.
#[derive(Clone, PartialEq, Eq)]
pub struct Attempt {
  /// Sent only to `POST /api/auth/native/token`; it never leaves the app otherwise.
  pub verifier: String,
  /// `BASE64URL(SHA-256(verifier))`, sent to `GET /api/auth/native/start`.
  pub challenge: String,
  /// Echoed to the loopback; the listener accepts only a callback that carries it.
  pub state: String,
}

impl std::fmt::Debug for Attempt {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    // The verifier is a secret: keep it out of logs and panics.
    f.debug_struct("Attempt")
      .field("challenge", &self.challenge)
      .finish_non_exhaustive()
  }
}

impl Attempt {
  /// A new attempt.
  #[must_use]
  pub fn new() -> Self {
    let verifier = random_token();
    let challenge = challenge_of(&verifier);
    Self {
      verifier,
      challenge,
      state: random_token(),
    }
  }
}

impl Default for Attempt {
  fn default() -> Self {
    Self::new()
  }
}

/// The S256 challenge of `verifier`.
#[must_use]
pub fn challenge_of(verifier: &str) -> String {
  URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn random_token() -> String {
  let mut bytes = [0_u8; 32];
  rand::fill(&mut bytes);
  URL_SAFE_NO_PAD.encode(bytes)
}

/// Whether `a` and `b` are equal, in time that does not depend on where they differ.
#[must_use]
pub fn constant_time_eq(a: &str, b: &str) -> bool {
  a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0_u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_attempt_has_a_verifier_its_s256_challenge_and_a_state() {
    let attempt = Attempt::new();
    // RFC 7636 appendix B.
    assert_eq!(
      challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    assert_eq!(attempt.challenge, challenge_of(&attempt.verifier));
    assert_eq!(attempt.verifier.len(), 43, "32 bytes, base64url without padding");
    assert_eq!(attempt.state.len(), 43);
    assert_ne!(attempt.verifier, attempt.state);
    assert_ne!(Attempt::new().verifier, attempt.verifier, "every attempt is fresh");
    assert!(
      !format!("{attempt:?}").contains(&attempt.verifier),
      "the verifier stays out of Debug"
    );
  }

  #[test]
  fn equal_strings_compare_equal_and_others_do_not() {
    assert!(constant_time_eq("abc", "abc"));
    assert!(!constant_time_eq("abc", "abd"));
    assert!(!constant_time_eq("abc", "ab"));
    assert!(constant_time_eq("", ""));
  }
}
