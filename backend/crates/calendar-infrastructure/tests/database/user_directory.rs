//! Ports `UserDirectoryTests`: ADR-0041's lookup order. By Google subject; then by email among rows without a
//! subject; then, for the first allow-listed email, the unclaimed legacy placeholder; otherwise a new row.

use std::time::Duration;

use calendar_domain::users::User;
use calendar_infrastructure::users::{self, SignIn};
use calendar_infrastructure::{Error, error};
use calendar_testing::TestDatabase;
use chrono::{DateTime, Utc};
use diesel_async::AsyncPgConnection;
use uuid::Uuid;

use crate::repositories::{Fixture, fixture, utc};
use crate::support::scalar;

const FIRST: &str = "First@Example.com";
const OTHER: &str = "other@example.com";

fn now() -> DateTime<Utc> {
  utc(2026, 10, 26, 15, 0)
}

/// Users A and B only, as the .NET tests start: the placeholder the migration inserts is removed, and the
/// tests that need it put it back.
async fn directory_fixture() -> Fixture {
  let f = fixture().await;
  f.database
    .migrator_client()
    .await
    .execute("DELETE FROM users WHERE id = $1::text::uuid", &[&User::LEGACY_OWNER_ID.to_string()])
    .await
    .unwrap();
  f
}

async fn insert_legacy_placeholder(database: &TestDatabase) {
  database
    .migrator_client()
    .await
    .execute(
      "INSERT INTO users (id, created_at) VALUES ($1::text::uuid, now())",
      &[&User::LEGACY_OWNER_ID.to_string()],
    )
    .await
    .unwrap();
}

/// Users in the table; the fixture seeds two.
async fn count_users(database: &TestDatabase) -> String {
  scalar(&database.migrator_client().await, "SELECT count(*)::text FROM users").await
}

async fn resolve(
  conn: &mut AsyncPgConnection,
  email: &str,
  google_subject: Option<&str>,
  display_name: Option<&str>,
  picture_url: Option<&str>,
) -> Result<User, Error> {
  let sign_in = SignIn {
    email,
    google_subject,
    display_name,
    picture_url,
  };
  users::resolve(conn, now(), &sign_in, Some(FIRST)).await
}

#[tokio::test]
async fn a_new_person_gets_a_row_and_signs_in_again_to_the_same_row() {
  let mut f = directory_fixture().await;

  let created = resolve(&mut f.conn, OTHER, Some("sub-1"), Some("Other Person"), Some("https://pic/1"))
    .await
    .unwrap();
  assert_eq!(created.email(), Some(OTHER));
  assert_eq!(created.google_subject(), Some("sub-1"));
  assert_eq!(created.display_name(), Some("Other Person"));
  assert_eq!(created.picture_url(), Some("https://pic/1"));
  assert_eq!(created.last_signed_in_at(), Some(now()));
  assert_eq!(users::find(&mut f.conn, created.id()).await.unwrap(), Some(created.clone()));

  // Same subject, new email and name, no picture this time: the row follows the subject and keeps the picture.
  let again = resolve(&mut f.conn, "Renamed@Example.com", Some("sub-1"), Some("Renamed"), None)
    .await
    .unwrap();
  assert_eq!(again.id(), created.id());
  assert_eq!(again.email(), Some("renamed@example.com"));
  assert_eq!(again.display_name(), Some("Renamed"));
  assert_eq!(again.picture_url(), Some("https://pic/1"));
  assert_eq!(users::find(&mut f.conn, created.id()).await.unwrap(), Some(again));
  assert_eq!(count_users(&f.database).await, "3");
}

#[tokio::test]
async fn a_seed_created_row_is_claimed_by_the_real_sign_in_which_fills_in_the_subject() {
  let mut f = directory_fixture().await;

  let seeded = resolve(&mut f.conn, OTHER, None, None, None).await.unwrap();
  assert_eq!(seeded.google_subject(), None);
  assert_eq!(seeded.email(), Some(OTHER));

  let signed_in = resolve(&mut f.conn, OTHER, Some("sub-2"), Some("Other"), None).await.unwrap();
  assert_eq!(signed_in.id(), seeded.id());
  assert_eq!(signed_in.google_subject(), Some("sub-2"));
  assert_eq!(count_users(&f.database).await, "3");
}

#[tokio::test]
async fn the_seed_scheme_after_the_real_sign_in_resolves_the_same_row_and_keeps_the_subject() {
  let mut f = directory_fixture().await;
  let signed_in = resolve(&mut f.conn, OTHER, Some("sub-6"), Some("Other"), Some("https://pic/6"))
    .await
    .unwrap();

  let seeded = resolve(&mut f.conn, OTHER, None, None, None).await.unwrap();

  assert_eq!(seeded.id(), signed_in.id());
  assert_eq!(seeded.google_subject(), Some("sub-6"));
  assert_eq!(seeded.display_name(), Some("Other"));
  assert_eq!(count_users(&f.database).await, "3");
}

/// Another request inserts the same person's row between this one's lookup and its insert. The .NET test
/// interposed with a `SaveChanges` interceptor; here the other request holds its insert uncommitted, so this
/// one's lookup misses the row and its insert waits on the unique index until the other commits.
#[tokio::test]
async fn concurrent_first_sign_ins_converge_on_one_row() {
  for subject_of_the_row_that_won in [Some("sub-race"), None] {
    let f = directory_fixture().await;
    let interposed = Uuid::new_v4();
    let mut other = f.database.app_client().await;
    let admin = f.database.admin_client().await;
    let racing = other.transaction().await.unwrap();
    racing
      .execute(
        "INSERT INTO users (id, google_subject, email, created_at) VALUES ($1::text::uuid, $2, 'race@example.com', now())",
        &[&interposed.to_string(), &subject_of_the_row_that_won],
      )
      .await
      .unwrap();

    let mut conn = f.conn;
    let resolving = tokio::spawn(async move { resolve(&mut conn, "race@example.com", Some("sub-race"), Some("Racer"), None).await });
    // The lookup found nothing and the insert is now waiting for the other request.
    loop {
      let waiting: i64 = admin
        .query_one(
          "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
          &[],
        )
        .await
        .unwrap()
        .get(0);
      if waiting > 0 {
        break;
      }
      assert!(!resolving.is_finished(), "the sign-in did not wait for the competing insert");
      tokio::time::sleep(Duration::from_millis(20)).await;
    }
    racing.commit().await.unwrap();
    let resolved = resolving.await.unwrap().unwrap();

    assert_eq!(resolved.id(), interposed);
    assert_eq!(resolved.google_subject(), Some("sub-race"));
    assert_eq!(resolved.display_name(), Some("Racer"));
    assert_eq!(resolved.last_signed_in_at(), Some(now()));
    assert_eq!(count_users(&f.database).await, "3");
  }
}

#[tokio::test]
async fn the_first_allow_listed_email_claims_the_legacy_placeholder_once_only() {
  let mut f = directory_fixture().await;
  insert_legacy_placeholder(&f.database).await;

  let claimed = resolve(&mut f.conn, FIRST, Some("sub-first"), Some("The Owner"), None)
    .await
    .unwrap();
  assert_eq!(claimed.id(), User::LEGACY_OWNER_ID);
  assert_eq!(claimed.email(), Some("first@example.com"));
  assert_eq!(claimed.google_subject(), Some("sub-first"));
  assert!(!claimed.is_unclaimed_placeholder());

  let again = resolve(&mut f.conn, FIRST, Some("sub-first"), None, None).await.unwrap();
  assert_eq!(again.id(), User::LEGACY_OWNER_ID);
  assert_eq!(count_users(&f.database).await, "3");
}

#[tokio::test]
async fn the_seed_scheme_claims_the_legacy_placeholder_for_the_first_allow_listed_email() {
  let mut f = directory_fixture().await;
  insert_legacy_placeholder(&f.database).await;

  let seeded = resolve(&mut f.conn, FIRST, None, None, None).await.unwrap();
  assert_eq!(seeded.id(), User::LEGACY_OWNER_ID);
  assert_eq!(seeded.google_subject(), None);

  let signed_in = resolve(&mut f.conn, FIRST, Some("sub-first"), Some("The Owner"), None)
    .await
    .unwrap();
  assert_eq!(signed_in.id(), User::LEGACY_OWNER_ID);
  assert_eq!(signed_in.google_subject(), Some("sub-first"));
}

#[tokio::test]
async fn other_emails_never_claim_the_legacy_placeholder() {
  let mut f = directory_fixture().await;
  insert_legacy_placeholder(&f.database).await;

  let other = resolve(&mut f.conn, OTHER, Some("sub-3"), None, None).await.unwrap();
  assert_ne!(other.id(), User::LEGACY_OWNER_ID);

  let placeholder = users::find(&mut f.conn, User::LEGACY_OWNER_ID).await.unwrap().unwrap();
  assert!(placeholder.is_unclaimed_placeholder());

  // Nor does anyone when no email is allow-listed.
  let sign_in = SignIn {
    email: FIRST,
    google_subject: Some("sub-first"),
    display_name: None,
    picture_url: None,
  };
  let first = users::resolve(&mut f.conn, now(), &sign_in, None).await.unwrap();
  assert_ne!(first.id(), User::LEGACY_OWNER_ID);
}

#[tokio::test]
async fn another_subject_with_a_claimed_email_does_not_take_over_the_row() {
  let mut f = directory_fixture().await;
  let owner = resolve(&mut f.conn, OTHER, Some("sub-4"), None, None).await.unwrap();

  // Google says the email now belongs to another account: no silent takeover, the sign-in fails instead.
  let result = resolve(&mut f.conn, OTHER, Some("sub-5"), None, None).await;

  assert!(
    matches!(&result, Err(Error::UniqueViolation { constraint: Some(name) }) if name == "ix_users_email"),
    "{result:?}"
  );
  assert_eq!(users::find(&mut f.conn, owner.id()).await.unwrap(), Some(owner));
  assert_eq!(count_users(&f.database).await, "3");
}

/// Beyond the .NET tests: the domain's refusal of a blank email surfaces as a domain error, before any query.
#[tokio::test]
async fn a_blank_email_is_a_domain_error() {
  let mut f = directory_fixture().await;

  let result = resolve(&mut f.conn, "  ", Some("sub-7"), None, None).await;

  assert!(matches!(result, Err(error::Error::Domain(_))), "{result:?}");
  assert_eq!(count_users(&f.database).await, "2");
  assert_eq!(users::find(&mut f.conn, Uuid::new_v4()).await.unwrap(), None);
}
