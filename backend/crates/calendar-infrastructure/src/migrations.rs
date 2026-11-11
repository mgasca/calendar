//! The schema's migrations, embedded in the binary, and the one way they are applied (ADR-0015: only by the
//! migrator, as `calendar_migrator`, never by the application).
//!
//! The first six migrations are a one-to-one translation of the EF Core migrations the .NET backend shipped. A
//! database those created is adopted rather than rebuilt: see [`migrate`].

use diesel::connection::SimpleConnection;
use diesel::migration::{Migration, MigrationConnection, MigrationSource};
use diesel::pg::Pg;
use diesel::sql_types::{Bool, Text};
use diesel::{Connection, QueryableByName, RunQueryDsl};
use diesel_async::AsyncPgConnection;
use diesel_async::async_connection_wrapper::AsyncConnectionWrapper;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

/// Every migration under `migrations/`, in order.
pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// The complete EF Core migration history of the .NET backend, oldest first. The first
/// `EF_MIGRATIONS.len()` embedded migrations translate these, in the same order and with the same timestamps.
pub const EF_MIGRATIONS: [&str; 6] = [
  "20261026195516_InitialCreate",
  "20261027000112_TaskDetails",
  "20261028173124_OpenTaskDueIndexes",
  "20261028193145_AllDayDateSpan",
  "20261029140850_DataProtectionKeys",
  "20261102232144_PerUserOwnership",
];

/// Serializes concurrent migrators; held until the migration transaction ends. The value is arbitrary.
const ADVISORY_LOCK_KEY: i64 = 0x0043_414c_4d49_4752; // "CALMIGR"

type Wrapper = AsyncConnectionWrapper<AsyncPgConnection>;

/// What [`migrate`] did.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MigrationReport {
  /// The database was created by EF Core and its history was taken over on this run.
  pub adopted_ef_history: bool,
  /// The names of the migrations this run applied, in order (for example `2026-11-11-000000_session_keys`).
  pub applied: Vec<String>,
}

/// Why migrating failed. The transaction was rolled back, so the database is as it was.
#[derive(Debug, thiserror::Error)]
pub enum MigrateError {
  #[error(
    "this database was migrated by EF Core but its history does not match the last EF Core migration: \
     found [{found}], expected exactly [{expected}]. Bring it to '{last}' with the .NET migrator before \
     handing it to this one; nothing was changed."
  )]
  UnexpectedEfHistory {
    found: String,
    expected: String,
    last: &'static str,
  },
  #[error("migration '{name}' failed: {reason}")]
  Migration { name: String, reason: String },
  #[error("no migration has the version '{0}'")]
  UnknownVersion(String),
  #[error("database error while migrating: {0}")]
  Database(#[from] diesel::result::Error),
  #[error("the migration task did not finish: {0}")]
  Task(String),
}

/// Brings the database to the latest migration, in one transaction.
///
/// - A fresh database runs the whole chain.
/// - A database migrated by EF Core (`__EFMigrationsHistory` exists, Diesel's `__diesel_schema_migrations` does
///   not) must be exactly at the last EF Core migration, or this fails without changing anything. The six
///   translated migrations are then recorded as applied without being run, and the newer ones run.
/// - A database this migrator already manages runs whatever is pending.
///
/// Concurrent callers queue on an advisory lock, so the second one finds nothing left to do.
pub async fn migrate(connection: AsyncPgConnection) -> Result<MigrationReport, MigrateError> {
  blocking(connection, |wrapper| run(wrapper, None)).await
}

/// As [`migrate`], but stops after the migration with this version (`"20261029140850"`), leaving later ones
/// pending. For tests that need a database from before a migration.
pub async fn migrate_to(connection: AsyncPgConnection, version: &str) -> Result<MigrationReport, MigrateError> {
  let version = version.to_owned();
  blocking(connection, move |wrapper| run(wrapper, Some(&version))).await
}

/// The names of the migrations not yet applied, in order, without applying them. On a database Diesel does not
/// manage yet (fresh, or still owned by EF Core) every migration is reported.
pub async fn pending(connection: AsyncPgConnection) -> Result<Vec<String>, MigrateError> {
  blocking(connection, |wrapper| {
    if !relation_exists(wrapper, "public.__diesel_schema_migrations")? {
      return Ok(embedded()?.iter().map(|m| m.name().to_string()).collect());
    }
    let pending = wrapper
      .pending_migrations(MIGRATIONS)
      .map_err(|e| migration_error("(listing)", e.as_ref()))?;
    Ok(pending.iter().map(|m| m.name().to_string()).collect())
  })
  .await
}

/// Diesel's migration harness is synchronous; run it on the blocking pool over the async connection.
async fn blocking<T, F>(connection: AsyncPgConnection, work: F) -> Result<T, MigrateError>
where
  T: Send + 'static,
  F: FnOnce(&mut Wrapper) -> Result<T, MigrateError> + Send + 'static,
{
  tokio::task::spawn_blocking(move || work(&mut Wrapper::from(connection)))
    .await
    .map_err(|e| MigrateError::Task(e.to_string()))?
}

fn run(connection: &mut Wrapper, up_to: Option<&str>) -> Result<MigrationReport, MigrateError> {
  if let Some(version) = up_to
    && !embedded()?.iter().any(|m| m.name().version().to_string() == version)
  {
    return Err(MigrateError::UnknownVersion(version.to_owned()));
  }

  // PostgreSQL DDL is transactional, so adoption and every migration commit together or not at all. The harness
  // runs each migration in a transaction of its own, which nests here as a savepoint.
  connection.transaction(|connection| {
    connection.batch_execute(&format!("SELECT pg_advisory_xact_lock({ADVISORY_LOCK_KEY})"))?;

    let mut report = MigrationReport::default();
    let managed_by_diesel = relation_exists(connection, "public.__diesel_schema_migrations")?;
    if !managed_by_diesel && relation_exists(connection, "public.\"__EFMigrationsHistory\"")? {
      adopt_ef_history(connection)?;
      report.adopted_ef_history = true;
    }

    let pending = connection
      .pending_migrations(MIGRATIONS)
      .map_err(|e| migration_error("(listing)", e.as_ref()))?;
    for migration in pending {
      let name = migration.name().to_string();
      if up_to.is_some_and(|last| migration.name().version().to_string().as_str() > last) {
        break;
      }
      connection
        .run_migration(&migration)
        .map_err(|e| migration_error(&name, e.as_ref()))?;
      report.applied.push(name);
    }
    Ok(report)
  })
}

/// Checks that EF Core left the database at its last migration and records the translated migrations as applied.
fn adopt_ef_history(connection: &mut Wrapper) -> Result<(), MigrateError> {
  #[derive(QueryableByName)]
  struct Row {
    #[diesel(sql_type = Text)]
    migration_id: String,
  }

  let found: Vec<String> = diesel::sql_query("SELECT migration_id FROM public.\"__EFMigrationsHistory\" ORDER BY migration_id")
    .load::<Row>(connection)?
    .into_iter()
    .map(|row| row.migration_id)
    .collect();
  if found != EF_MIGRATIONS {
    return Err(MigrateError::UnexpectedEfHistory {
      found: found.join(", "),
      expected: EF_MIGRATIONS.join(", "),
      last: EF_MIGRATIONS[EF_MIGRATIONS.len() - 1],
    });
  }

  MigrationConnection::setup(connection)?;
  for migration in embedded()?.iter().take(EF_MIGRATIONS.len()) {
    diesel::sql_query("INSERT INTO public.__diesel_schema_migrations (version) VALUES ($1)")
      .bind::<Text, _>(migration.name().version().to_string())
      .execute(connection)?;
  }
  Ok(())
}

fn relation_exists(connection: &mut Wrapper, qualified_name: &str) -> Result<bool, diesel::result::Error> {
  #[derive(QueryableByName)]
  struct Row {
    #[diesel(sql_type = Bool)]
    present: bool,
  }

  let row = diesel::sql_query("SELECT to_regclass($1) IS NOT NULL AS present")
    .bind::<Text, _>(qualified_name)
    .get_result::<Row>(connection)?;
  Ok(row.present)
}

/// The embedded migrations, oldest first.
fn embedded() -> Result<Vec<Box<dyn Migration<Pg>>>, MigrateError> {
  let mut migrations = MigrationSource::<Pg>::migrations(&MIGRATIONS).map_err(|e| migration_error("(embedded)", e.as_ref()))?;
  migrations.sort_by_key(|m| m.name().version().to_string());
  Ok(migrations)
}

fn migration_error(name: &str, error: &(dyn std::error::Error + Send + Sync)) -> MigrateError {
  MigrateError::Migration {
    name: name.to_owned(),
    reason: error.to_string(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_first_embedded_migrations_are_the_ef_migrations_in_order() {
    let versions: Vec<String> = embedded().unwrap().iter().map(|m| m.name().version().to_string()).collect();
    let ef_versions: Vec<&str> = EF_MIGRATIONS.iter().map(|id| id.split_once('_').unwrap().0).collect();

    assert!(
      versions.len() > EF_MIGRATIONS.len(),
      "the session-keys migration follows the EF Core chain"
    );
    assert_eq!(versions[..EF_MIGRATIONS.len()], ef_versions);
    assert!(versions.is_sorted());
  }

  #[test]
  fn the_translated_migrations_keep_the_ef_names() {
    let names: Vec<String> = embedded().unwrap().iter().map(|m| m.name().to_string()).collect();

    for (name, ef) in names.iter().zip(EF_MIGRATIONS) {
      let snake = name.split_once('_').unwrap().1.replace('_', "");
      assert_eq!(snake, ef.split_once('_').unwrap().1.to_lowercase(), "{name} translates {ef}");
    }
  }
}
