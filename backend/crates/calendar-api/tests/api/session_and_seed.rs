//! Ports `Endpoints/SessionAndSeedTests`. Sessions carry the user id (ADR-0041): a cookie issued before
//! per-user ownership is rejected, and the Development seed scheme acts as the first allow-listed email's user.

use std::io::Write;
use std::sync::{Arc, Mutex};

use crate::common::*;
use calendar_api::auth::dev_seed::{self, NO_ALLOWED_EMAIL_MESSAGE};
use calendar_domain::users::User;
use tokio_postgres::types::ToSql;

const SEED_KEY: &str = "12345678901234567890123456789012";
const FIRST_ALLOWED: &str = "Owner@Example.com";
const SEED_HEADER: &str = "X-Dev-Seed-Key";

/// A host where only the cookie and seed schemes count, as in the real app.
fn seed_host(environment: &str, key: &str, allowed_email: Option<&str>) -> TestAppBuilder {
  let builder = TestApp::builder()
    .real_authentication()
    .environment(environment)
    .setting("Auth__DevSeedKey", key);
  match allowed_email {
    Some(email) => builder.setting("Auth__AllowedEmails__0", email),
    None => builder,
  }
}

fn seed_client(app: &TestApp, key: Option<&str>) -> TestClient {
  match key {
    Some(key) => app.client().header(SEED_HEADER, key),
    None => app.client(),
  }
}

/// `id` and `google_subject` of the one user with `email`.
async fn user_with_email(app: &TestApp, email: &str) -> (Uuid, Option<String>) {
  let client = app.database().migrator_client().await;
  let row = client
    .query_one("SELECT id, google_subject FROM users WHERE email = $1", &[&email])
    .await
    .expect("exactly one user has the email");
  (row.get(0), row.get(1))
}

/// The owner of the one task matching `condition`, whoever it is.
async fn task_owner(app: &TestApp, condition: &str, value: &(dyn ToSql + Sync)) -> Uuid {
  let client = app.database().migrator_client().await;
  let row = client
    .query_one(&format!("SELECT owner_id FROM tasks WHERE {condition}"), &[value])
    .await
    .expect("exactly one task matches");
  row.get(0)
}

#[tokio::test]
async fn a_cookie_session_is_accepted_only_with_a_user_id() {
  for (with_user_id, expected) in [(false, StatusCode::UNAUTHORIZED), (true, StatusCode::OK)] {
    // The real cookie scheme, with a ticket sealed with this host's own key.
    let app = TestApp::builder().real_authentication().start().await;
    let ticket = SessionTicket {
      user_id: with_user_id.then_some(USER_A),
      name: Some("Someone".to_owned()),
      email: Some("someone@example.com".to_owned()),
      picture: None,
      expires_at: app.clock.now() + TimeDelta::hours(8),
    };
    let cookie = app.session_cookie(&ticket).await;

    let response = app.client().cookie(&cookie).get("/api/auth/me").await;

    assert_eq!(response.status, expected, "with_user_id={with_user_id}");
    if !with_user_id {
      // Rejected and signed out: the browser stops presenting the stale cookie.
      let cookies = response.set_cookies();
      assert_eq!(cookies.len(), 1, "{cookies:?}");
      let cleared = response.set_cookie(SESSION_COOKIE).expect("the session cookie is cleared");
      assert!(cleared.has("expires"), "{cleared:?}");
    }
  }
}

#[tokio::test]
async fn the_seed_key_only_authenticates_in_development() {
  for (environment, key, header, expected) in [
    ("Development", SEED_KEY, Some(SEED_KEY), StatusCode::OK),
    ("Development", SEED_KEY, Some("wrong"), StatusCode::UNAUTHORIZED),
    ("Development", SEED_KEY, None, StatusCode::UNAUTHORIZED),
    ("Development", "", Some(SEED_KEY), StatusCode::UNAUTHORIZED),
    ("Production", SEED_KEY, Some(SEED_KEY), StatusCode::UNAUTHORIZED),
  ] {
    let case = format!("{environment} key={key:?} header={header:?}");
    let app = seed_host(environment, key, Some(FIRST_ALLOWED)).start().await;

    let response = seed_client(&app, header).get("/api/auth/me").await;

    assert_eq!(response.status, expected, "{case}");
    // The scheme exists only in Development with a key (the .NET test asked the scheme provider).
    assert_eq!(
      app.state().settings().seed_enabled(),
      environment == "Development" && !key.is_empty(),
      "{case}"
    );
    if expected == StatusCode::OK {
      assert_eq!(response.json::<AuthUserResponse>().email, "owner@example.com", "{case}");
    }
  }
}

/// Collects what the application logs on this thread.
#[derive(Clone, Default)]
struct LogCapture(Arc<Mutex<Vec<u8>>>);

impl Write for LogCapture {
  fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
    self.0.lock().unwrap().extend_from_slice(buffer);
    Ok(buffer.len())
  }

  fn flush(&mut self) -> std::io::Result<()> {
    Ok(())
  }
}

impl LogCapture {
  fn text(&self) -> String {
    String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
  }
}

#[tokio::test]
async fn the_seed_scheme_requires_an_allow_list_and_says_so() {
  let app = seed_host("Development", SEED_KEY, None).start().await;
  let log = LogCapture::default();
  let writer = log.clone();
  let subscriber = tracing_subscriber::fmt()
    .with_ansi(false)
    .with_writer(move || writer.clone())
    .finish();
  let logging = tracing::subscriber::set_default(subscriber);

  let response = seed_client(&app, Some(SEED_KEY)).get("/api/auth/me").await;
  assert_eq!(response.status, StatusCode::UNAUTHORIZED);

  // The scheme itself refuses the valid key, and says why (the .NET handler failed with this message).
  let mut headers = HeaderMap::new();
  headers.insert(SEED_HEADER, HeaderValue::from_static(SEED_KEY));
  let result = dev_seed::authenticate(app.state(), &headers).await.expect("no error");
  assert_eq!(result, None);
  drop(logging);
  assert_eq!(
    NO_ALLOWED_EMAIL_MESSAGE,
    "Auth:AllowedEmails is empty. The seed scheme acts as its first entry, so set Auth__AllowedEmails__0."
  );
  assert_eq!(log.text().matches(NO_ALLOWED_EMAIL_MESSAGE).count(), 2, "{}", log.text());
}

#[tokio::test]
async fn the_seed_scheme_still_works_after_the_owner_has_signed_in_for_real() {
  let app = seed_host("Development", SEED_KEY, Some(FIRST_ALLOWED)).start().await;
  // The owner's row after a real Google sign-in: subject and email set.
  let owner = User::create(app.clock.now(), FIRST_ALLOWED, Some("sub-owner"), Some("The Owner"), None).unwrap();
  app
    .database()
    .migrator_client()
    .await
    .execute(
      "INSERT INTO users (id, google_subject, email, display_name, created_at, last_signed_in_at) \
       VALUES ($1, $2, $3, $4, $5, $6)",
      &[
        &owner.id(),
        &owner.google_subject(),
        &owner.email(),
        &owner.display_name(),
        &owner.created_at(),
        &owner.last_signed_in_at(),
      ],
    )
    .await
    .unwrap();

  let created = seed_client(&app, Some(SEED_KEY))
    .post_json("/api/tasks", &json!({"title": "seeded later"}))
    .await;
  assert_eq!(created.status, StatusCode::CREATED);

  let (id, subject) = user_with_email(&app, "owner@example.com").await;
  assert_eq!(id, owner.id());
  assert_eq!(subject.as_deref(), Some("sub-owner"));
  assert_eq!(task_owner(&app, "title = $1", &"seeded later").await, id);
}

#[tokio::test]
async fn seeded_rows_belong_to_the_first_allow_listed_email_who_also_claims_the_legacy_owner() {
  let app = seed_host("Development", SEED_KEY, Some(FIRST_ALLOWED)).start().await;
  app
    .database()
    .migrator_client()
    .await
    .execute("INSERT INTO users (id, created_at) VALUES ($1, now())", &[&User::LEGACY_OWNER_ID])
    .await
    .unwrap();
  app
    .seed(&[], &[task_of(User::LEGACY_OWNER_ID, "from before ownership", None, None)])
    .await;

  let client = seed_client(&app, Some(SEED_KEY));
  let created = client.post_json("/api/tasks", &json!({"title": "seeded"})).await;
  assert_eq!(created.status, StatusCode::CREATED);
  let seeded_id = created.json::<TaskResponse>().id;

  let (owner_id, subject) = user_with_email(&app, "owner@example.com").await;
  assert_eq!(owner_id, User::LEGACY_OWNER_ID);
  assert_eq!(subject, None);
  assert_eq!(task_owner(&app, "id = $1", &seeded_id).await, User::LEGACY_OWNER_ID);

  // The seed sees the pre-ownership rows as its own.
  let list = client.get("/api/tasks?view=no-deadline").await;
  let mut titles: Vec<String> = list.json::<TaskPage>().items.into_iter().map(|task| task.title).collect();
  titles.sort();
  assert_eq!(titles, ["from before ownership", "seeded"]);
}
