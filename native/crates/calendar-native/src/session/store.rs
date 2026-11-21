//! Where the desktop app keeps its session cookie: the OS credential store (Secret Service on Linux, Keychain on
//! macOS, Credential Manager on Windows) through `keyring`, keyed by the API origin, and, when there is no store, in
//! memory only, so the person signs in again at the next launch. It is never written to a plain file (ADR-0068, "On
//! desktop").
//!
//! `CALENDAR_SESSION_STORE=memory` keeps the session in memory even when a credential store exists: headless runs
//! and the end-to-end tests (#1010) never touch the person's keyring.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// The `keyring` service name every entry is filed under.
const SERVICE: &str = "calendar-native";

/// The environment variable that forces the memory store.
pub const STORE_VARIABLE: &str = "CALENDAR_SESSION_STORE";

/// Set by [`use_memory_store`]: the memory store for every origin, for the rest of the process.
static FORCE_MEMORY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Keeps every session in memory for the rest of the process, whatever the platform offers: headless tests and the
/// end-to-end driver (#1010), which must never touch the person's keyring.
pub fn use_memory_store() {
  FORCE_MEMORY.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// The memory store, per origin, for this run of the app.
static MEMORY: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);

/// The session cookie of one API origin.
pub struct Store {
  origin: String,
  keyring: Option<keyring::Entry>,
}

impl std::fmt::Debug for Store {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    // Never the cookie itself.
    f.debug_struct("Store")
      .field("origin", &self.origin)
      .field("persistent", &self.is_persistent())
      .finish_non_exhaustive()
  }
}

impl Store {
  /// The OS credential store's entry for `origin`, or memory when the platform has no store (headless CI, a WSL
  /// without a Secret Service) or [`STORE_VARIABLE`] is `memory`.
  #[must_use]
  pub fn for_origin(origin: &str) -> Self {
    let forced_memory =
      FORCE_MEMORY.load(std::sync::atomic::Ordering::SeqCst) || std::env::var(STORE_VARIABLE).is_ok_and(|value| value == "memory");
    let keyring = if forced_memory {
      None
    } else {
      keyring::Entry::new(SERVICE, origin).ok()
    };
    Self {
      origin: origin.to_owned(),
      keyring,
    }
  }

  /// The memory store for `origin`, whatever the platform offers.
  #[must_use]
  pub fn memory(origin: &str) -> Self {
    Self {
      origin: origin.to_owned(),
      keyring: None,
    }
  }

  /// Whether the cookie survives a restart.
  #[must_use]
  pub fn is_persistent(&self) -> bool {
    self.keyring.is_some()
  }

  /// The stored cookie value, if any. A credential store that cannot be read counts as empty.
  #[must_use]
  pub fn load(&self) -> Option<String> {
    let stored = match &self.keyring {
      Some(entry) => entry.get_password().ok(),
      None => None,
    };
    stored
      .or_else(|| MEMORY.lock().ok()?.get(&self.origin).cloned())
      .filter(|value| !value.is_empty())
  }

  /// Keeps `value`. When the credential store refuses it, the value is kept in memory, so the person stays signed in
  /// until they quit.
  pub fn save(&self, value: &str) {
    if let Some(entry) = &self.keyring
      && entry.set_password(value).is_ok()
    {
      return;
    }
    if let Ok(mut memory) = MEMORY.lock() {
      memory.insert(self.origin.clone(), value.to_owned());
    }
  }

  /// Forgets the cookie (sign-out, or a session the API no longer accepts), in both places.
  pub fn clear(&self) {
    if let Some(entry) = &self.keyring {
      // Nothing stored is as good as deleted.
      let _ = entry.delete_credential();
    }
    if let Ok(mut memory) = MEMORY.lock() {
      memory.remove(&self.origin);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_memory_store_keeps_a_value_per_origin_until_cleared_and_never_prints_it() {
    let store = Store::memory("http://store-test.invalid");
    assert!(!store.is_persistent());
    assert_eq!(store.load(), None);
    store.save("sealed-cookie");
    assert_eq!(store.load().as_deref(), Some("sealed-cookie"));
    assert_eq!(
      Store::memory("http://store-test.invalid").load().as_deref(),
      Some("sealed-cookie"),
      "kept for the rest of the run"
    );
    assert_eq!(Store::memory("http://other.invalid").load(), None, "one value per origin");
    assert!(!format!("{store:?}").contains("sealed-cookie"));
    store.clear();
    assert_eq!(store.load(), None);
  }
}
