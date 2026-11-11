//! Ports `DataProtectionTests`. The ASP.NET key ring in PostgreSQL became one session key in the
//! `session_keys` table (migration 7), which seals the stateless session cookie: every instance of the API
//! on one database reads the same key, so what one instance seals another opens.

mod common;

use calendar_api::auth::session::Sealer;
use common::*;

async fn host() -> TestApp {
  TestApp::builder().real_authentication().start().await
}

/// The keys in the table, read as the application role.
async fn stored_keys(app: &TestApp) -> Vec<Vec<u8>> {
  let client = app.database().app_client().await;
  let rows = client.query("SELECT key_material FROM session_keys", &[]).await.unwrap();
  rows.iter().map(|row| row.get(0)).collect()
}

fn ticket(app: &TestApp) -> SessionTicket {
  SessionTicket {
    user_id: Some(USER_A),
    name: Some("Someone".to_owned()),
    email: Some("someone@example.com".to_owned()),
    picture: None,
    expires_at: app.clock.now() + TimeDelta::hours(8),
  }
}

#[tokio::test]
async fn the_key_is_stored_in_postgres_and_visible_to_another_instance() {
  let first = host().await;
  assert_eq!(
    stored_keys(&first).await.len(),
    0,
    "nothing needs the key until something is sealed"
  );
  let sealed = first.state().sealer().await.unwrap().seal("key-ring-test", b"create a key");
  let keys_a = stored_keys(&first).await;
  assert_eq!(keys_a.len(), 1);

  let second = first.reconfigure().start().await;
  let second_sealer = second.state().sealer().await.unwrap();
  let keys_b = stored_keys(&second).await;
  assert_eq!(keys_b, keys_a, "the second instance created no key of its own");

  // Both instances use exactly the stored key.
  let key: [u8; 32] = keys_a[0].clone().try_into().expect("the key is 32 bytes");
  assert_eq!(
    Sealer::new(&key).open("key-ring-test", &sealed).as_deref(),
    Some(&b"create a key"[..])
  );
  let from_second = second_sealer.seal("key-ring-test", b"second");
  assert_eq!(
    Sealer::new(&key).open("key-ring-test", &from_second).as_deref(),
    Some(&b"second"[..])
  );
}

#[tokio::test]
async fn a_protected_payload_survives_another_instance() {
  let first = host().await;
  let protected = first
    .state()
    .sealer()
    .await
    .unwrap()
    .seal("cross-instance-test", b"calendar session");
  assert_eq!(stored_keys(&first).await.len(), 1);

  let second = first.reconfigure().start().await;
  let value = second.state().sealer().await.unwrap().open("cross-instance-test", &protected);

  assert_eq!(value.as_deref(), Some(&b"calendar session"[..]));
}

#[tokio::test]
async fn a_session_cookie_sealed_by_one_instance_signs_in_at_another() {
  let first = host().await;
  let cookie = first.session_cookie(&ticket(&first)).await;
  let second = first.reconfigure().start().await;

  let me: AuthUserResponse = second.client().cookie(&cookie).get("/api/auth/me").await.success().json();

  assert_eq!((me.name.as_str(), me.email.as_str()), ("Someone", "someone@example.com"));
}

#[tokio::test]
async fn a_tampered_cookie_is_rejected() {
  let app = host().await;
  let cookie = app.session_cookie(&ticket(&app)).await;
  assert_eq!(app.client().cookie(&cookie).get("/api/auth/me").await.status, StatusCode::OK);

  // Change one character in the middle of the sealed value, and separately cut the value short.
  let (name, value) = cookie.split_once('=').unwrap();
  let middle = value.len() / 2;
  let replacement = if &value[middle..=middle] == "A" { "B" } else { "A" };
  let altered = format!("{name}={}{replacement}{}", &value[..middle], &value[middle + 1..]);
  let truncated = format!("{name}={}", &value[..value.len() - 4]);

  for forged in [altered, truncated, format!("{name}="), format!("{name}=not-a-sealed-value")] {
    let response = app.client().cookie(&forged).get("/api/auth/me").await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED, "{forged}");
  }
}

#[tokio::test]
async fn an_expired_cookie_is_rejected() {
  let app = host().await;
  let cookie = app.session_cookie(&ticket(&app)).await;
  let client = app.client().cookie(&cookie);

  app.clock.advance(TimeDelta::hours(8) - TimeDelta::seconds(1));
  assert_eq!(client.get("/api/auth/me").await.status, StatusCode::OK);
  app.clock.advance(TimeDelta::seconds(1));
  assert_eq!(client.get("/api/auth/me").await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_cookie_sealed_with_another_databases_key_is_rejected() {
  let first = host().await;
  let other = host().await;
  let cookie = other.session_cookie(&ticket(&other)).await;

  assert_eq!(other.client().cookie(&cookie).get("/api/auth/me").await.status, StatusCode::OK);
  assert_eq!(
    first.client().cookie(&cookie).get("/api/auth/me").await.status,
    StatusCode::UNAUTHORIZED
  );
}
