//! Ports `Endpoints/SignInTests`: the Google callback glue (ADR-0041). After the allow-list check,
//! `attach_user` resolves the person's users row and returns the principal that carries its id. The whole
//! round trip against a fake Google is in `google_sign_in.rs`.

use crate::common::*;
use calendar_api::auth::google::{SignInError, attach_user};
use calendar_domain::users::User;

const FIRST: &str = "first@example.com";

async fn host() -> TestApp {
  TestApp::builder().setting("Auth__AllowedEmails__0", FIRST).start().await
}

/// The person columns of a users row, read by name.
#[derive(Debug, PartialEq)]
pub struct UserRow {
  pub google_subject: Option<String>,
  pub email: Option<String>,
  pub display_name: Option<String>,
  pub picture_url: Option<String>,
}

impl UserRow {
  pub fn new(google_subject: Option<&str>, email: Option<&str>, display_name: Option<&str>, picture_url: Option<&str>) -> Self {
    Self {
      google_subject: google_subject.map(str::to_owned),
      email: email.map(str::to_owned),
      display_name: display_name.map(str::to_owned),
      picture_url: picture_url.map(str::to_owned),
    }
  }
}

impl From<&tokio_postgres::Row> for UserRow {
  fn from(row: &tokio_postgres::Row) -> Self {
    Self {
      google_subject: row.get("google_subject"),
      email: row.get("email"),
      display_name: row.get("display_name"),
      picture_url: row.get("picture_url"),
    }
  }
}

/// The person columns of the users row `id`.
async fn user_row(app: &TestApp, id: Uuid) -> UserRow {
  let client = app.database().migrator_client().await;
  let row = client
    .query_one(
      "SELECT google_subject, email, display_name, picture_url FROM users WHERE id = $1",
      &[&id],
    )
    .await
    .expect("exactly one users row has the id");
  UserRow::from(&row)
}

#[tokio::test]
async fn attach_user_adds_the_user_id_for_a_new_person() {
  let app = host().await;

  let principal = attach_user(
    app.state(),
    Some("sub-new"),
    "new@example.com",
    Some("New Person"),
    Some("https://pic/new"),
  )
  .await
  .expect("the sign-in succeeds");

  assert_eq!(
    user_row(&app, principal.owner.0).await,
    UserRow::new(
      Some("sub-new"),
      Some("new@example.com"),
      Some("New Person"),
      Some("https://pic/new")
    )
  );
}

#[tokio::test]
async fn attach_user_lets_the_first_allow_listed_email_claim_the_legacy_owner() {
  let app = host().await;
  app
    .database()
    .migrator_client()
    .await
    .execute("INSERT INTO users (id, created_at) VALUES ($1, now())", &[&User::LEGACY_OWNER_ID])
    .await
    .unwrap();

  let principal = attach_user(app.state(), Some("sub-first"), "First@Example.com", Some("The Owner"), None)
    .await
    .expect("the sign-in succeeds");

  assert_eq!(principal.owner.0, User::LEGACY_OWNER_ID);
  let row = user_row(&app, User::LEGACY_OWNER_ID).await;
  assert_eq!(row.google_subject.as_deref(), Some("sub-first"));
  assert_eq!(row.email.as_deref(), Some(FIRST));
}

#[tokio::test]
async fn attach_user_fails_the_sign_in_when_google_sent_no_subject() {
  let app = host().await;

  let result = attach_user(app.state(), None, "nosub@example.com", Some("No Subject"), None).await;

  assert!(matches!(result, Err(SignInError::NoSubject)), "{result:?}");
  let client = app.database().migrator_client().await;
  let rows: i64 = client
    .query_one("SELECT count(*) FROM users WHERE email = 'nosub@example.com'", &[])
    .await
    .unwrap()
    .get(0);
  assert_eq!(rows, 0);
}
