//! Users.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::{ArgumentError, DomainError, InvalidOperationError};
use crate::validation::trim_to_option;

/// The stored fields of a [`User`], for persistence to read and rebuild one without validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserRecord {
  /// Unique id.
  pub id: Uuid,
  /// Google's `sub` claim; `None` until a real sign-in.
  pub google_subject: Option<String>,
  /// Lower-cased email; `None` only on an unclaimed legacy placeholder.
  pub email: Option<String>,
  /// Display name, when known.
  pub display_name: Option<String>,
  /// Picture URL, when known.
  pub picture_url: Option<String>,
  /// When the row was created.
  pub created_at: DateTime<Utc>,
  /// When the person last signed in; `None` for an unclaimed placeholder.
  pub last_signed_in_at: Option<DateTime<Utc>>,
}

/// A person who may own events and tasks (ADR-0041).
///
/// Identified by Google's stable `sub` claim; the email is what the allow-list checks and is refreshed at every
/// sign-in. Two kinds of row have no subject yet: the legacy placeholder the ownership migration created for
/// pre-existing rows (no subject, no email), and a row the Development seed scheme created for an allow-listed
/// email (email only). A real sign-in fills the subject in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
  id: Uuid,
  google_subject: Option<String>,
  email: Option<String>,
  display_name: Option<String>,
  picture_url: Option<String>,
  created_at: DateTime<Utc>,
  last_signed_in_at: Option<DateTime<Utc>>,
}

impl User {
  /// The fixed id of the placeholder that owns every row created before ownership existed. The migration inserts
  /// it; the first sign-in (or seed run) by the first allow-listed email claims it.
  pub const LEGACY_OWNER_ID: Uuid = Uuid::from_u128(0x1111_1111_1111_1111_1111_1111_1111_1111);

  /// Creates a user for `email` with a new random id, and the subject and profile when they are known. Fails
  /// (parameter `email`) when the email is blank.
  pub fn create(
    now: DateTime<Utc>,
    email: &str,
    google_subject: Option<&str>,
    display_name: Option<&str>,
    picture_url: Option<&str>,
  ) -> Result<Self, ArgumentError> {
    Ok(Self {
      id: Uuid::new_v4(),
      google_subject: trim_to_option(google_subject),
      email: Some(Self::normalize_email(email)?),
      display_name: trim_to_option(display_name),
      picture_url: trim_to_option(picture_url),
      created_at: now,
      last_signed_in_at: Some(now),
    })
  }

  /// Rebuilds a stored user without validation.
  pub fn restore(record: UserRecord) -> Self {
    let UserRecord {
      id,
      google_subject,
      email,
      display_name,
      picture_url,
      created_at,
      last_signed_in_at,
    } = record;
    Self {
      id,
      google_subject,
      email,
      display_name,
      picture_url,
      created_at,
      last_signed_in_at,
    }
  }

  /// The stored fields, for persistence.
  pub fn into_record(self) -> UserRecord {
    UserRecord {
      id: self.id,
      google_subject: self.google_subject,
      email: self.email,
      display_name: self.display_name,
      picture_url: self.picture_url,
      created_at: self.created_at,
      last_signed_in_at: self.last_signed_in_at,
    }
  }

  /// Unique id; the value `owner_id` columns reference.
  pub fn id(&self) -> Uuid {
    self.id
  }

  /// Google's `sub` claim; `None` until a real sign-in.
  pub fn google_subject(&self) -> Option<&str> {
    self.google_subject.as_deref()
  }

  /// Lower-cased email; `None` only on an unclaimed legacy placeholder.
  pub fn email(&self) -> Option<&str> {
    self.email.as_deref()
  }

  /// Display name from the identity provider, when known.
  pub fn display_name(&self) -> Option<&str> {
    self.display_name.as_deref()
  }

  /// Picture URL from the identity provider, when known.
  pub fn picture_url(&self) -> Option<&str> {
    self.picture_url.as_deref()
  }

  /// When the row was created.
  pub fn created_at(&self) -> DateTime<Utc> {
    self.created_at
  }

  /// When the person last signed in or was last resolved by the seed scheme; `None` for an unclaimed placeholder.
  pub fn last_signed_in_at(&self) -> Option<DateTime<Utc>> {
    self.last_signed_in_at
  }

  /// True while the row is the unclaimed legacy placeholder.
  pub fn is_unclaimed_placeholder(&self) -> bool {
    self.google_subject.is_none() && self.email.is_none()
  }

  /// Records a sign-in (or a seed resolution): refreshes the email, replaces the profile values that are given
  /// (a `None` or blank keeps the current one), fills in the subject when it is known and missing, and stamps
  /// the last sign-in. A row that already has a subject keeps it.
  ///
  /// Fails with an argument error (parameter `email`) for a blank email, and with an invalid-operation error
  /// when the row has a subject and `google_subject` is a different one. Nothing changes on failure.
  pub fn sign_in(
    &mut self,
    now: DateTime<Utc>,
    email: &str,
    google_subject: Option<&str>,
    display_name: Option<&str>,
    picture_url: Option<&str>,
  ) -> Result<(), DomainError> {
    let normalized_email = Self::normalize_email(email)?;
    if let (Some(current), Some(given)) = (self.google_subject.as_deref(), google_subject)
      && current != given
    {
      return Err(InvalidOperationError::new("A user's Google subject never changes.").into());
    }

    if self.google_subject.is_none() {
      self.google_subject = trim_to_option(google_subject);
    }

    self.email = Some(normalized_email);
    if let Some(display_name) = trim_to_option(display_name) {
      self.display_name = Some(display_name);
    }

    if let Some(picture_url) = trim_to_option(picture_url) {
      self.picture_url = Some(picture_url);
    }

    self.last_signed_in_at = Some(now);
    Ok(())
  }

  /// Trims and lower-cases an email so that lookups and the unique index agree. Fails (parameter `email`) when
  /// the email is blank.
  ///
  /// Lower-casing is the culture-invariant simple mapping: each character maps to at most one character, so
  /// `U+0130` (capital I with dot above) stays as it is and a final capital sigma becomes `σ`, not `ς`.
  pub fn normalize_email(email: &str) -> Result<String, ArgumentError> {
    let trimmed = email.trim();
    if trimmed.is_empty() {
      return Err(ArgumentError::new(
        "email",
        "The value cannot be an empty string or composed entirely of whitespace.",
      ));
    }

    Ok(trimmed.chars().map(to_lower_invariant).collect())
  }
}

fn to_lower_invariant(character: char) -> char {
  let mut lower = character.to_lowercase();
  match (lower.next(), lower.next()) {
    (Some(single), None) => single,
    _ => character,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn normalize_email_uses_the_simple_invariant_lowercase_mapping() {
    assert_eq!(
      User::normalize_email(" A\u{130}\u{3a3}@X.ORG\u{2003}").unwrap(),
      "a\u{130}\u{3c3}@x.org"
    );
  }
}
