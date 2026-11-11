//! Ports `DatabaseRolesTests`: the two roles of ADR-0014/ADR-0015 on a migrated database.

use calendar_infrastructure::migrations;
use calendar_testing::TestDatabase;
use tokio_postgres::error::SqlState;

use crate::support::{failure, scalar};

#[tokio::test]
async fn app_role_can_connect() {
  let database = TestDatabase::migrated().await;

  let client = database.app_client().await;

  assert_eq!(scalar(&client, "SELECT current_user::text").await, "calendar_app");
}

#[tokio::test]
async fn migrations_are_applied_by_the_migrator() {
  let database = TestDatabase::migrated().await;

  let pending = migrations::pending(database.migrator_connection().await).await.unwrap();

  assert_eq!(pending, Vec::<String>::new());
}

#[tokio::test]
async fn app_role_cannot_run_ddl() {
  let database = TestDatabase::migrated().await;
  let app = database.app_client().await;

  let (state, _) = failure(&app, "CREATE TABLE app_ddl_attempt (id int)").await;

  assert_eq!(state, SqlState::INSUFFICIENT_PRIVILEGE);
}

#[tokio::test]
async fn app_role_gets_dml_on_tables_the_migrator_creates() {
  let database = TestDatabase::migrated().await;
  let migrator = database.migrator_client().await;
  migrator
    .batch_execute("CREATE TABLE privilege_probe (id int PRIMARY KEY)")
    .await
    .unwrap();

  let app = database.app_client().await;
  app.batch_execute("INSERT INTO privilege_probe VALUES (1)").await.unwrap();
  app.batch_execute("UPDATE privilege_probe SET id = 2").await.unwrap();
  app.batch_execute("DELETE FROM privilege_probe").await.unwrap();

  let (state, _) = failure(&app, "DROP TABLE privilege_probe").await;
  assert_eq!(state, SqlState::INSUFFICIENT_PRIVILEGE, "only the owner may drop");

  migrator.batch_execute("DROP TABLE privilege_probe").await.unwrap();
}

/// Only the migrator records migrations; the app may see which are applied.
#[tokio::test]
async fn app_role_can_read_but_not_write_the_migration_history() {
  let database = TestDatabase::migrated().await;
  let app = database.app_client().await;

  assert_eq!(
    scalar(&app, "SELECT max(version)::text FROM __diesel_schema_migrations").await,
    "20261111000000"
  );
  for sql in [
    "INSERT INTO __diesel_schema_migrations (version) VALUES ('29990101000000')",
    "UPDATE __diesel_schema_migrations SET version = '0'",
    "DELETE FROM __diesel_schema_migrations",
  ] {
    let (state, _) = failure(&app, sql).await;
    assert_eq!(state, SqlState::INSUFFICIENT_PRIVILEGE, "{sql}");
  }
}

/// The session key is read and inserted once by the app; replacing it is an operator action.
#[tokio::test]
async fn app_role_can_read_and_insert_the_session_key_but_not_change_it() {
  let database = TestDatabase::migrated().await;
  let app = database.app_client().await;
  let insert = "INSERT INTO session_keys (key_material) VALUES (decode(repeat('ab', 32), 'hex')) ON CONFLICT (id) DO NOTHING";

  assert_eq!(app.execute(insert, &[]).await.unwrap(), 1);
  assert_eq!(app.execute(insert, &[]).await.unwrap(), 0, "a second replica's insert is a no-op");
  assert_eq!(
    scalar(&app, "SELECT encode(key_material, 'hex') FROM session_keys").await,
    "ab".repeat(32)
  );

  let (state, _) = failure(&app, "UPDATE session_keys SET key_material = decode(repeat('cd', 32), 'hex')").await;
  assert_eq!(state, SqlState::INSUFFICIENT_PRIVILEGE);
  let (state, _) = failure(&app, "DELETE FROM session_keys").await;
  assert_eq!(state, SqlState::INSUFFICIENT_PRIVILEGE);
}

#[tokio::test]
async fn session_keys_holds_one_32_byte_key() {
  let database = TestDatabase::migrated().await;
  let migrator = database.migrator_client().await;

  let (state, constraint) = failure(&migrator, "INSERT INTO session_keys (key_material) VALUES (decode('abcd', 'hex'))").await;
  assert_eq!(state, SqlState::CHECK_VIOLATION);
  assert_eq!(constraint.as_deref(), Some("ck_session_keys_key_material_length"));

  let (state, constraint) = failure(
    &migrator,
    "INSERT INTO session_keys (id, key_material) VALUES (2, decode(repeat('ab', 32), 'hex'))",
  )
  .await;
  assert_eq!(state, SqlState::CHECK_VIOLATION);
  assert_eq!(constraint.as_deref(), Some("ck_session_keys_single_row"));
}

/// Concurrent first starts: every replica inserts, exactly one wins, and all read the same key.
#[tokio::test]
async fn concurrent_first_inserts_of_the_session_key_agree_on_one_row() {
  let database = TestDatabase::migrated().await;
  let mut replicas = Vec::new();
  for replica in 0..6u8 {
    let client = database.app_client().await;
    replicas.push(tokio::spawn(async move {
      let inserted = client
        .execute(
          "INSERT INTO session_keys (key_material) VALUES (decode(repeat($1, 32), 'hex')) ON CONFLICT (id) DO NOTHING",
          &[&format!("{replica:02x}")],
        )
        .await
        .unwrap();
      (
        inserted,
        scalar(&client, "SELECT encode(key_material, 'hex') FROM session_keys").await,
      )
    }));
  }

  let mut winners = 0;
  let mut keys = Vec::new();
  for replica in replicas {
    let (inserted, key) = replica.await.unwrap();
    winners += inserted;
    keys.push(key);
  }

  assert_eq!(winners, 1);
  keys.dedup();
  assert_eq!(keys.len(), 1, "every replica reads the same key");
}
