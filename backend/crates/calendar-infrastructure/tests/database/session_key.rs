//! The session key: created once, then the same for every caller, and beyond the application role's reach to
//! change.

use calendar_infrastructure::session_keys::{self, KEY_LENGTH, SessionKey};
use tokio_postgres::error::SqlState;

use crate::repositories::fixture;
use crate::support::{failure, scalar};

#[tokio::test]
async fn the_key_is_created_once_and_then_read_back() {
  let mut f = fixture().await;

  let created = session_keys::get_or_create(&mut f.conn, || [7; KEY_LENGTH]).await.unwrap();
  let again = session_keys::get_or_create(&mut f.conn, || panic!("a key exists, so none is generated"))
    .await
    .unwrap();

  assert_eq!(created, SessionKey([7; KEY_LENGTH]));
  assert_eq!(again, created);
  let client = f.database.migrator_client().await;
  assert_eq!(scalar::<i64>(&client, "SELECT count(*) FROM session_keys").await, 1);
  assert_eq!(format!("{created:?}"), "SessionKey(<redacted>)");
}

/// Two instances that start together each offer a key; one row wins and both use it.
#[tokio::test]
async fn instances_that_start_together_agree_on_one_key() {
  let f = fixture().await;
  let mut tasks = Vec::new();
  for candidate in 1..=6u8 {
    let mut conn = f.database.app_connection().await;
    tasks.push(tokio::spawn(async move {
      session_keys::get_or_create(&mut conn, || [candidate; KEY_LENGTH]).await.unwrap()
    }));
  }
  let mut keys = Vec::new();
  for task in tasks {
    keys.push(task.await.unwrap());
  }

  assert!(keys.iter().all(|key| *key == keys[0]), "{keys:?}");
  let client = f.database.migrator_client().await;
  assert_eq!(scalar::<i64>(&client, "SELECT count(*) FROM session_keys").await, 1);
}

#[tokio::test]
async fn the_application_role_cannot_replace_or_remove_the_key() {
  let mut f = fixture().await;
  session_keys::get_or_create(&mut f.conn, || [7; KEY_LENGTH]).await.unwrap();
  let app = f.database.app_client().await;

  let (update, _) = failure(&app, "UPDATE session_keys SET key_material = decode(repeat('00', 32), 'hex')").await;
  let (delete, _) = failure(&app, "DELETE FROM session_keys").await;

  assert_eq!(update, SqlState::INSUFFICIENT_PRIVILEGE);
  assert_eq!(delete, SqlState::INSUFFICIENT_PRIVILEGE);
}
