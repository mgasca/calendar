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

/// `google_subject`, `email`, `display_name` and `picture_url` of the users row `id`.
async fn user_row(app: &TestApp, id: Uuid) -> [Option<String>; 4] {
  let client = app.database().migrator_client().await;
  let row = client
    .query_one(
      "SELECT google_subject, email, display_name, picture_url FROM users WHERE id = $1::text::uuid",
      &[&id.to_string()],
    )
    .await
    .expect("exactly one users row has the id");
  [row.get(0), row.get(1), row.get(2), row.get(3)]
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
    [
      Some("sub-new".to_owned()),
      Some("new@example.com".to_owned()),
      Some("New Person".to_owned()),
      Some("https://pic/new".to_owned())
    ]
  );
}

#[tokio::test]
async fn attach_user_lets_the_first_allow_listed_email_claim_the_legacy_owner() {
  let app = host().await;
  app
    .database()
    .migrator_client()
    .await
    .execute(
      "INSERT INTO users (id, created_at) VALUES ($1::text::uuid, now())",
      &[&User::LEGACY_OWNER_ID.to_string()],
    )
    .await
    .unwrap();

  let principal = attach_user(app.state(), Some("sub-first"), "First@Example.com", Some("The Owner"), None)
    .await
    .expect("the sign-in succeeds");

  assert_eq!(principal.owner.0, User::LEGACY_OWNER_ID);
  let [subject, email, ..] = user_row(&app, User::LEGACY_OWNER_ID).await;
  assert_eq!(subject.as_deref(), Some("sub-first"));
  assert_eq!(email.as_deref(), Some(FIRST));
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
