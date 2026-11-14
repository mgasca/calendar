//! The migrator on the three kinds of database it meets: fresh, created by EF Core, and its own.
//!
//! `fixtures/ef-schema.sql` is `pg_dump --schema-only` of a database that `dotnet ef database update` brought to
//! the last EF Core migration (PostgreSQL from `compose.yaml`, roles from `docker/postgres/init/01-roles.sh`),
//! captured before the .NET backend was removed. It is the oracle for the six translated migrations.

use calendar_infrastructure::migrations::{self, EF_MIGRATIONS, MIGRATIONS, MigrateError};
use calendar_testing::TestDatabase;
use diesel_async::async_connection_wrapper::AsyncConnectionWrapper;
use diesel_migrations::MigrationHarness;

use crate::support::{assert_same_schema, ef_migrated_database, normalize_dump, scalar, strings, without_meta_commands};

const EF_HISTORY: &str = include_str!("../fixtures/ef-migrations-history.sql");
const LAST_EF_VERSION: &str = "20261102232144";
const ALL_MIGRATIONS: [&str; 7] = [
  "2026-10-26-195516_initial_create",
  "2026-10-27-000112_task_details",
  "2026-10-28-173124_open_task_due_indexes",
  "2026-10-28-193145_all_day_date_span",
  "2026-10-29-140850_data_protection_keys",
  "2026-11-02-232144_per_user_ownership",
  "2026-11-11-000000_session_keys",
];
const DIESEL_VERSIONS: &str = "SELECT version::text FROM __diesel_schema_migrations ORDER BY version";

#[tokio::test]
async fn the_translated_migrations_produce_the_schema_ef_core_produced() {
  let database = TestDatabase::empty().await;

  let report = migrations::migrate_to(database.migrator_connection().await, LAST_EF_VERSION)
    .await
    .unwrap();

  assert_eq!(report.applied, ALL_MIGRATIONS[..EF_MIGRATIONS.len()]);
  let expected = normalize_dump(include_str!("../fixtures/ef-schema.sql"));
  assert!(expected.contains("CREATE TABLE public.events"), "the fixture is a schema dump");
  assert!(!expected.contains("__EFMigrationsHistory"));
  assert_same_schema(
    &normalize_dump(&database.dump_schema()),
    &expected,
    "six translated migrations against the EF Core fixture",
  );
}

#[tokio::test]
async fn a_fresh_database_runs_the_whole_chain() {
  let database = TestDatabase::empty().await;

  let report = database.migrate().await.unwrap();

  assert!(!report.adopted_ef_history);
  assert_eq!(report.applied, ALL_MIGRATIONS);
  let client = database.migrator_client().await;
  assert_eq!(strings(&client, DIESEL_VERSIONS).await.len(), ALL_MIGRATIONS.len());
  assert_eq!(
    scalar::<String>(&client, "SELECT to_regclass('public.session_keys')::text").await,
    "session_keys"
  );
  assert!(scalar::<bool>(&client, "SELECT to_regclass('public.data_protection_keys') IS NULL").await);
  assert_eq!(
    migrations::pending(database.migrator_connection().await).await.unwrap(),
    Vec::<String>::new()
  );
  // The template every other test clones was built the same way.
  assert_same_schema(
    &without_meta_commands(&database.dump_schema()),
    &without_meta_commands(&TestDatabase::migrated().await.dump_schema()),
    "a fresh database against the template",
  );
}

#[tokio::test]
async fn running_again_is_a_no_op() {
  let database = TestDatabase::empty().await;
  database.migrate().await.unwrap();
  let before = without_meta_commands(&database.dump_schema());

  let report = database.migrate().await.unwrap();

  assert_eq!(report, migrations::MigrationReport::default());
  assert_same_schema(&without_meta_commands(&database.dump_schema()), &before, "after a second run");
}

#[tokio::test]
async fn an_ef_migrated_database_is_adopted_and_keeps_its_rows() {
  let database = ef_migrated_database(EF_HISTORY).await;
  let client = database.migrator_client().await;
  client
    .batch_execute(
      "INSERT INTO users (id, google_subject, email, display_name, created_at) \
         VALUES ('22222222-2222-2222-2222-222222222222', 'sub-1', 'ana@example.com', 'Ana', '2026-11-01T08:00Z'); \
       INSERT INTO events (id, owner_id, title, is_all_day, starts_at, ends_at, time_zone_id) \
         VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Standup', false, \
                 '2026-11-03T09:00Z', '2026-11-03T09:15Z', 'Europe/Lisbon'); \
       INSERT INTO events (id, title, is_all_day, start_date, end_date) \
         VALUES ('44444444-4444-4444-4444-444444444444', 'Legacy day', true, '2026-11-04', '2026-11-06'); \
       INSERT INTO tasks (id, owner_id, title, due_date, priority, notes) \
         VALUES ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'Pay rent', '2026-11-05', 'high', 'n'); \
       INSERT INTO data_protection_keys (friendly_name, xml) VALUES ('key-1', '<key/>')",
    )
    .await
    .unwrap();
  let rows = "SELECT id::text || '|' || title || '|' || owner_id::text FROM events UNION ALL \
              SELECT id::text || '|' || title || '|' || owner_id::text || '|' || priority || '|' || due_date::text FROM tasks UNION ALL \
              SELECT id::text || '|' || COALESCE(email, '-') FROM users ORDER BY 1";
  let rows_before = strings(&client, rows).await;
  assert_eq!(rows_before.len(), 5);
  assert_eq!(
    migrations::pending(database.migrator_connection().await).await.unwrap(),
    ALL_MIGRATIONS,
    "not adopted yet"
  );

  let report = database.migrate().await.unwrap();

  assert!(report.adopted_ef_history);
  assert_eq!(report.applied, ["2026-11-11-000000_session_keys"]);
  assert_eq!(strings(&client, rows).await, rows_before);
  assert_eq!(
    strings(&client, DIESEL_VERSIONS).await,
    [
      "20261026195516",
      "20261027000112",
      "20261028173124",
      "20261028193145",
      "20261029140850",
      "20261102232144",
      "20261111000000"
    ]
  );
  assert!(scalar::<bool>(&client, "SELECT to_regclass('public.data_protection_keys') IS NULL").await);
  assert_eq!(scalar::<i64>(&client, "SELECT count(*) FROM session_keys").await, 0);
  // The EF Core history is kept as it was, as a record.
  assert_eq!(
    strings(&client, "SELECT migration_id::text FROM \"__EFMigrationsHistory\" ORDER BY 1").await,
    EF_MIGRATIONS
  );
  // Apart from the history tables, an adopted database and a fresh one are the same.
  // One spelling differs only because this database was restored from a dump: PostgreSQL stores the parsed
  // check expression, and parsing pg_dump's rendering of `priority IN (...)` casts each element instead of the
  // array. The two are the same predicate; a database EF Core migrated directly has the fresh spelling.
  let adopted = normalize_dump(&database.dump_schema()).replace(
    "ANY (ARRAY[('low'::character varying)::text, ('medium'::character varying)::text, ('high'::character varying)::text])",
    "ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying])::text[])",
  );
  assert_same_schema(
    &adopted,
    &normalize_dump(&TestDatabase::migrated().await.dump_schema()),
    "an adopted database against a fresh one",
  );

  // The app role works on the adopted database, and a second run finds nothing to do.
  let app = database.app_client().await;
  assert_eq!(scalar::<i64>(&app, "SELECT count(*) FROM tasks").await, 1);
  assert_eq!(database.migrate().await.unwrap(), migrations::MigrationReport::default());
}

#[tokio::test]
async fn an_ef_database_at_an_older_migration_is_refused_and_left_alone() {
  let older = EF_HISTORY.replace(",\n  ('20261102232144_PerUserOwnership', '10.0.15')", "");
  assert_ne!(older, EF_HISTORY);
  let database = ef_migrated_database(&older).await;
  let before = without_meta_commands(&database.dump_schema());

  let error = database.migrate().await.unwrap_err();

  assert!(matches!(error, MigrateError::UnexpectedEfHistory { .. }), "{error:?}");
  let message = error.to_string();
  assert!(
    message.contains("20261029140850_DataProtectionKeys]"),
    "names where the history ends: {message}"
  );
  assert!(message.contains("Bring it to '20261102232144_PerUserOwnership'"), "{message}");
  // Nothing was changed, not even Diesel's history table.
  assert_same_schema(&without_meta_commands(&database.dump_schema()), &before, "after a refused adoption");
}

#[tokio::test]
async fn an_ef_database_with_an_unknown_migration_is_refused() {
  let newer = format!("{EF_HISTORY}\nINSERT INTO public.\"__EFMigrationsHistory\" VALUES ('20261201000000_Later', '10.0.15');");
  let database = ef_migrated_database(&newer).await;

  let error = database.migrate().await.unwrap_err();

  assert!(matches!(error, MigrateError::UnexpectedEfHistory { .. }), "{error:?}");
  let client = database.migrator_client().await;
  assert!(scalar::<bool>(&client, "SELECT to_regclass('public.__diesel_schema_migrations') IS NULL").await);
}

#[tokio::test]
async fn concurrent_migrators_apply_each_migration_once() {
  let database = TestDatabase::empty().await;

  let (first, second) = tokio::join!(database.migrate(), database.migrate());

  let mut applied = first.unwrap().applied;
  applied.extend(second.unwrap().applied);
  assert_eq!(applied, ALL_MIGRATIONS);
}

#[tokio::test]
async fn a_failing_migration_rolls_everything_back() {
  let database = TestDatabase::empty().await;
  // The session-keys migration drops data_protection_keys; a table that depends on it makes that step fail.
  migrations::migrate_to(database.migrator_connection().await, LAST_EF_VERSION)
    .await
    .unwrap();
  let client = database.migrator_client().await;
  client
    .batch_execute("CREATE VIEW blocks_the_drop AS SELECT id FROM data_protection_keys")
    .await
    .unwrap();

  let error = database.migrate().await.unwrap_err();

  assert!(
    matches!(&error, MigrateError::Migration { name, .. } if name == "2026-11-11-000000_session_keys"),
    "{error:?}"
  );
  assert!(scalar::<bool>(&client, "SELECT to_regclass('public.session_keys') IS NULL").await);
  assert_eq!(strings(&client, DIESEL_VERSIONS).await.len(), EF_MIGRATIONS.len());
}

#[tokio::test]
async fn an_unknown_target_version_is_refused() {
  let database = TestDatabase::empty().await;

  let error = migrations::migrate_to(database.migrator_connection().await, "19990101000000")
    .await
    .unwrap_err();

  assert!(matches!(error, MigrateError::UnknownVersion(_)), "{error:?}");
}

/// Every `down.sql` undoes its `up.sql`: reverting the chain leaves no object, and it applies again.
#[tokio::test]
async fn the_down_migrations_revert_the_whole_chain() {
  let database = TestDatabase::empty().await;
  database.migrate().await.unwrap();
  let migrated = without_meta_commands(&database.dump_schema());

  let connection = database.migrator_connection().await;
  let reverted = tokio::task::spawn_blocking(move || {
    AsyncConnectionWrapper::<diesel_async::AsyncPgConnection>::from(connection)
      .revert_all_migrations(MIGRATIONS)
      .map(|versions| versions.len())
      .map_err(|e| e.to_string())
  })
  .await
  .unwrap();

  assert_eq!(reverted, Ok(ALL_MIGRATIONS.len()));
  let client = database.migrator_client().await;
  assert_eq!(
    strings(&client, "SELECT tablename::text FROM pg_tables WHERE schemaname = 'public'").await,
    ["__diesel_schema_migrations"]
  );
  assert_eq!(database.migrate().await.unwrap().applied, ALL_MIGRATIONS);
  assert_same_schema(
    &without_meta_commands(&database.dump_schema()),
    &migrated,
    "after reverting and migrating again",
  );
}
