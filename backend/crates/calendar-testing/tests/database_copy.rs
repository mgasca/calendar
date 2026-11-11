//! The database each test takes is a copy of the migrated one with the same roles and rights
//! (`docker/postgres/init/01-roles.sh`, ADR-0014), so tests still run as the least-privilege app role.
//! Ports `DatabaseCopyTests` and the reuse rules of `PostgresTestDatabase`.

use calendar_testing::{MIGRATED_DATABASE, TestDatabase};
use tokio_postgres::error::SqlState;

/// The owner and the sorted access list (role=privileges/grantor), which name roles, not the database.
async fn describe(client: &tokio_postgres::Client, name: &str) -> (String, String) {
  let row = client
    .query_one(
      "SELECT datdba::regrole::text, array_to_string(ARRAY(SELECT a::text FROM unnest(datacl) a ORDER BY 1), ',') \
       FROM pg_database WHERE datname = $1",
      &[&name],
    )
    .await
    .unwrap();
  (row.get(0), row.get(1))
}

#[tokio::test]
async fn copy_has_the_owner_and_access_list_of_the_migrated_database() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;
  let name: String = client.query_one("SELECT current_database()::text", &[]).await.unwrap().get(0);

  let copy = describe(&client, &name).await;
  let migrated = describe(&client, MIGRATED_DATABASE).await;

  assert_ne!(name, MIGRATED_DATABASE);
  assert_eq!(name, database.name());
  assert_eq!(copy.0, "calendar_migrator");
  assert_eq!(copy.0, migrated.0);
  assert_eq!(copy.1, migrated.1);
  assert_ne!(copy.1, "");
}

#[tokio::test]
async fn copy_gives_the_app_role_no_ddl_rights() {
  let database = TestDatabase::migrated().await;
  let client = database.app_client().await;

  let user: String = client.query_one("SELECT current_user::text", &[]).await.unwrap().get(0);
  assert_eq!(user, "calendar_app");
  let denied = client.batch_execute("CREATE TABLE app_may_not_create (id int)").await.unwrap_err();
  assert_eq!(denied.code(), Some(&SqlState::INSUFFICIENT_PRIVILEGE));
}

#[tokio::test]
async fn empty_copy_has_the_same_access_list_and_no_tables() {
  let database = TestDatabase::empty().await;
  let client = database.migrator_client().await;

  assert_eq!(describe(&client, database.name()).await, describe(&client, MIGRATED_DATABASE).await);
  let tables: i64 = client
    .query_one("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'", &[])
    .await
    .unwrap()
    .get(0);
  assert_eq!(tables, 0);
}

#[tokio::test]
async fn each_test_database_is_its_own_and_starts_clean() {
  let first = TestDatabase::migrated().await;
  let second = TestDatabase::migrated().await;
  assert_ne!(first.name(), second.name());

  first
    .migrator_client()
    .await
    .batch_execute("INSERT INTO users (id, created_at) VALUES (gen_random_uuid(), now())")
    .await
    .unwrap();

  let count =
    |client: tokio_postgres::Client| async move { client.query_one("SELECT count(*) FROM users", &[]).await.unwrap().get::<_, i64>(0) };
  assert_eq!(count(first.migrator_client().await).await, 2, "the legacy owner and the new row");
  assert_eq!(
    count(second.migrator_client().await).await,
    1,
    "only the legacy owner the migration inserts"
  );
}

#[tokio::test]
async fn a_dropped_test_database_is_removed_and_frees_its_slot() {
  let database = TestDatabase::migrated().await;
  let name = database.name().to_owned();
  let observer = TestDatabase::migrated().await;
  let client = observer.admin_client().await;
  drop(database);

  let mut exists = true;
  for _ in 0..100 {
    exists = client
      .query_one("SELECT EXISTS (SELECT FROM pg_database WHERE datname = $1)", &[&name])
      .await
      .unwrap()
      .get(0);
    if !exists {
      break;
    }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
  }
  assert!(!exists, "{name} is dropped in the background");
}

#[tokio::test]
async fn connection_strings_name_the_three_roles() {
  let database = TestDatabase::migrated().await;

  for (config, role) in [
    (database.app_config(), "calendar_app"),
    (database.migrator_config(), "calendar_migrator"),
    (database.admin_config(), "postgres"),
  ] {
    assert_eq!(config.username, role);
    assert_eq!(config.database, database.name());
  }
  let pool = database.app_pool();
  assert!(pool.get().await.is_ok(), "the app pool opens a connection");
}
