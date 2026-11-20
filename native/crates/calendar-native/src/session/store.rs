//! Where the desktop app keeps its session cookie: the OS credential store (Secret Service on Linux, Keychain on
//! macOS, Credential Manager on Windows) through `keyring`, keyed by the API origin, and, when there is no store, in
//! memory only, so the person signs in again at the next launch. It is never written to a plain file (ADR-0068, "On
//! desktop").

use std::sync::Mutex;

/// The `keyring` service name every entry is filed under.
const SERVICE: &str = "calendar-native";

/// A session cookie value, kept for one API origin.
pub struct Store {
  backend: Backend,
}

enum Backend {
  Keyring(keyring::Entry),
  Memory(Mutex<Option<String>>),
}

impl std::fmt::Debug for Store {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    // Never the cookie itself.
    f.write_str(if self.is_persistent() { "Store(keyring)" } else { "Store(memory)" })
  }
}

impl Store {
  /// The OS credential store's entry for `origin`, or memory when the platform has no store (headless CI, a WSL
  /// without a Secret Service).
  #[must_use]
  pub fn for_origin(origin: &str) -> Self {
    match keyring::Entry::new(SERVICE, origin) {
      Ok(entry) => Self {
        backend: Backend::Keyring(entry),
      },
      Err(_) => Self::memory(),
    }
  }

  /// A store that forgets everything when the app quits: headless runs and the end-to-end tests (#1010).
  #[must_use]
  pub fn memory() -> Self {
    Self {
      backend: Backend::Memory(Mutex::new(None)),
    }
  }

  /// Whether the cookie survives a restart.
  #[must_use]
  pub fn is_persistent(&self) -> bool {
    matches!(self.backend, Backend::Keyring(_))
  }

  /// The stored cookie value, if any. A credential store that cannot be read counts as empty.
  #[must_use]
  pub fn load(&self) -> Option<String> {
    match &self.backend {
      Backend::Keyring(entry) => entry.get_password().ok().filter(|value| !value.is_empty()),
      Backend::Memory(value) => value.lock().ok()?.clone(),
    }
  }

  /// Keeps `value`. When the credential store refuses it, the store falls back to memory for the rest of the run, so
  /// the person stays signed in until they quit.
  pub fn save(&mut self, value: &str) {
    if let Backend::Keyring(entry) = &self.backend
      && entry.set_password(value).is_ok()
    {
      return;
    }
    self.backend = Backend::Memory(Mutex::new(Some(value.to_owned())));
  }

  /// Forgets the cookie (sign-out, or a session the API no longer accepts).
  pub fn clear(&mut self) {
    match &self.backend {
      Backend::Keyring(entry) => {
        // Nothing stored is as good as deleted.
        let _ = entry.delete_credential();
      }
      Backend::Memory(_) => self.backend = Backend::Memory(Mutex::new(None)),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_memory_store_keeps_a_value_until_cleared_and_never_prints_it() {
    let mut store = Store::memory();
    assert!(!store.is_persistent());
    assert_eq!(store.load(), None);
    store.save("sealed-cookie");
    assert_eq!(store.load().as_deref(), Some("sealed-cookie"));
    assert!(!format!("{store:?}").contains("sealed-cookie"));
    store.clear();
    assert_eq!(store.load(), None);
  }
}
