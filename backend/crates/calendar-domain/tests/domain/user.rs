//! Port of `Calendar.Domain.Tests/Users/UserTests.cs`.

use calendar_domain::error::{ArgumentError, DomainError, InvalidOperationError};
use calendar_domain::users::{User, UserRecord};
use chrono::{DateTime, FixedOffset, TimeDelta, TimeZone, Utc};
use uuid::Uuid;

/// 2026-11-02T12:00:00+01:00, as the C# suite has it; the domain takes it as UTC.
fn now() -> DateTime<Utc> {
  FixedOffset::east_opt(3600)
    .unwrap()
    .with_ymd_and_hms(2026, 11, 2, 12, 0, 0)
    .unwrap()
    .with_timezone(&Utc)
}

#[test]
fn create_normalizes_the_email_and_stamps_the_sign_in() {
  let user = User::create(now(), "  Someone@Example.COM ", Some("sub"), Some(" Some One "), None).unwrap();

  assert!(!user.id().is_nil());
  assert_eq!(user.email(), Some("someone@example.com"));
  assert_eq!(user.google_subject(), Some("sub"));
  assert_eq!(user.display_name(), Some("Some One"));
  assert_eq!(user.picture_url(), None);
  assert_eq!(user.created_at(), Utc.with_ymd_and_hms(2026, 11, 2, 11, 0, 0).unwrap());
  assert_eq!(user.last_signed_in_at(), Some(Utc.with_ymd_and_hms(2026, 11, 2, 11, 0, 0).unwrap()));
  assert!(!user.is_unclaimed_placeholder());
}

#[test]
fn sign_in_fills_in_a_missing_subject_and_keeps_profile_values_that_are_not_given() {
  let mut user = User::create(now(), "a@example.com", None, Some("A"), Some("https://pic/a")).unwrap();
  assert_eq!(user.google_subject(), None);

  user
    .sign_in(now() + TimeDelta::days(1), "A@example.com", Some("sub-a"), None, None)
    .unwrap();

  assert_eq!(user.google_subject(), Some("sub-a"));
  assert_eq!(user.display_name(), Some("A"));
  assert_eq!(user.picture_url(), Some("https://pic/a"));
  assert_eq!(user.last_signed_in_at(), Some(now() + TimeDelta::days(1)));
}

#[test]
fn sign_in_with_another_subject_fails() {
  let mut user = User::create(now(), "a@example.com", Some("sub-a"), None, None).unwrap();
  let before = user.clone();

  let error = user
    .sign_in(now() + TimeDelta::days(1), "b@example.com", Some("sub-b"), Some("B"), None)
    .unwrap_err();

  assert_eq!(
    error,
    DomainError::InvalidOperation(InvalidOperationError::new("A user's Google subject never changes."))
  );
  assert_eq!(user, before);
}

#[test]
fn normalize_email_rejects_blank() {
  for email in ["", "   "] {
    assert_eq!(
      User::normalize_email(email).unwrap_err(),
      ArgumentError::new("email", "The value cannot be an empty string or composed entirely of whitespace.")
    );
  }
}

#[test]
fn legacy_owner_id_is_fixed() {
  assert_eq!(
    User::LEGACY_OWNER_ID,
    Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap()
  );
}

// ---- beyond the C# suite ----

#[test]
fn create_and_sign_in_with_a_blank_email_fail_and_change_nothing() {
  assert_eq!(User::create(now(), " ", Some("sub"), None, None).unwrap_err().param, "email");

  let mut user = User::create(now(), "a@example.com", None, None, None).unwrap();
  let before = user.clone();
  let error = user.sign_in(now(), "", Some("sub"), Some("A"), None).unwrap_err();

  assert!(matches!(error, DomainError::Argument(ArgumentError { param: "email", .. })));
  assert_eq!(user, before);
}

#[test]
fn sign_in_keeps_an_existing_subject_and_blank_profile_values_keep_the_current_ones() {
  let mut user = User::create(now(), "a@example.com", Some("sub-a"), Some("A"), Some("https://pic/a")).unwrap();

  user
    .sign_in(now(), "new@example.com", None, Some("   "), Some(" https://pic/b "))
    .unwrap();

  assert_eq!(user.google_subject(), Some("sub-a"));
  assert_eq!(user.email(), Some("new@example.com"));
  assert_eq!(user.display_name(), Some("A"));
  assert_eq!(user.picture_url(), Some("https://pic/b"));
}

#[test]
fn restore_rebuilds_the_legacy_placeholder_and_a_sign_in_claims_it() {
  let record = UserRecord {
    id: User::LEGACY_OWNER_ID,
    google_subject: None,
    email: None,
    display_name: None,
    picture_url: None,
    created_at: now(),
    last_signed_in_at: None,
  };
  let mut user = User::restore(record.clone());
  assert!(user.is_unclaimed_placeholder());
  assert_eq!(user.clone().into_record(), record);

  user.sign_in(now(), "First@example.com", Some("sub"), None, None).unwrap();

  assert!(!user.is_unclaimed_placeholder());
  assert_eq!(user.id(), User::LEGACY_OWNER_ID);
  assert_eq!(user.email(), Some("first@example.com"));
  assert_eq!(user.created_at(), now());
}
