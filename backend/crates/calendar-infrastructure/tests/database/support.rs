use std::time::Duration;

use calendar_testing::TestDatabase;
use tokio::task::JoinHandle;
use tokio_postgres::Client;
use tokio_postgres::error::SqlState;
use tokio_postgres::types::FromSql;
use uuid::Uuid;

/// Inserts a user to own rows, as the schema owner, and returns its id (`UserA` in the .NET tests).
pub async fn insert_user(client: &Client) -> Uuid {
  let id = Uuid::new_v4();
  client
    .execute("INSERT INTO users (id, created_at) VALUES ($1, now())", &[&id])
    .await
    .unwrap();
  id
}

/// Runs SQL text that must fail and returns the SQLSTATE and the violated constraint's name.
pub async fn failure(client: &Client, sql: &str) -> (SqlState, Option<String>) {
  let error = client.batch_execute(sql).await.expect_err("the statement is refused");
  let db = error.as_db_error().expect("a server error");
  (db.code().clone(), db.constraint().map(str::to_owned))
}

/// The first column of the one row `sql` returns, decoded as `T`.
pub async fn scalar<T: for<'a> FromSql<'a>>(client: &Client, sql: &str) -> T {
  client.query_one(sql, &[]).await.unwrap().get(0)
}

/// Waits until a session of this database is blocked on a lock, which the race tests take to mean that `task` is
/// waiting for the competing transaction. Fails instead of waiting forever when `task` finishes first or nothing
/// blocks within the bound.
pub async fn wait_until_blocked<T>(admin: &Client, task: &JoinHandle<T>) {
  const BOUND: Duration = Duration::from_secs(30);
  let blocked = async {
    loop {
      let waiting: i64 = scalar(
        admin,
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      )
      .await;
      if waiting > 0 {
        return;
      }
      assert!(
        !task.is_finished(),
        "the task finished without waiting for the competing transaction"
      );
      tokio::time::sleep(Duration::from_millis(20)).await;
    }
  };
  tokio::time::timeout(BOUND, blocked)
    .await
    .unwrap_or_else(|_| panic!("nothing blocked on a lock within {BOUND:?}"));
}

pub async fn strings(client: &Client, sql: &str) -> Vec<String> {
  client.query(sql, &[]).await.unwrap().iter().map(|row| row.get(0)).collect()
}

/// A database restored from the schema EF Core produced (`fixtures/ef-schema.sql`), with the given EF history
/// rows and the legacy owner the ownership migration inserted.
pub async fn ef_migrated_database(history_sql: &str) -> TestDatabase {
  let database = TestDatabase::empty().await;
  let admin = database.admin_client().await;
  // psql meta-commands (\restrict) are not SQL; the rest of a plain pg_dump is.
  let schema = without_meta_commands(include_str!("../fixtures/ef-schema.sql"));
  admin.batch_execute(&schema).await.expect("the EF Core schema restores");
  admin.batch_execute(history_sql).await.expect("the EF Core history restores");
  admin
    .batch_execute("INSERT INTO public.users (id, created_at) VALUES ('11111111-1111-1111-1111-111111111111', now())")
    .await
    .unwrap();
  database
}

/// A `pg_dump --schema-only` reduced to what the migrations decide: without psql meta-commands (their token is
/// random) and without the objects of either migration-history table.
pub fn normalize_dump(dump: &str) -> String {
  const SEPARATOR: &str = "\n--\n-- Name: ";
  let text = without_meta_commands(dump);
  let mut sections = text.split(SEPARATOR);
  let mut kept = sections.next().unwrap_or_default().to_owned();
  for section in sections {
    let header = section.lines().next().unwrap_or_default();
    if header.contains("__EFMigrationsHistory") || header.contains("__diesel_schema_migrations") {
      continue;
    }
    kept.push_str(SEPARATOR);
    kept.push_str(section);
  }
  kept.trim_end().to_owned()
}

/// A dump without psql meta-commands, whose token differs on every run. Keeps the history tables.
pub fn without_meta_commands(dump: &str) -> String {
  dump
    .lines()
    .filter(|line| !line.starts_with('\\'))
    .flat_map(|line| [line, "\n"])
    .collect()
}

/// Fails with the lines only one schema has, which reads better than two whole dumps.
pub fn assert_same_schema(actual: &str, expected: &str, context: &str) {
  if actual == expected {
    return;
  }
  let only_in = |a: &str, b: &str| -> Vec<String> {
    let other: std::collections::HashSet<&str> = b.lines().collect();
    a.lines().filter(|line| !other.contains(line)).map(str::to_owned).collect()
  };
  panic!(
    "{context}: the schemas differ.\nonly in the actual schema:\n{}\nonly in the expected schema:\n{}\n(or the same lines in another order)",
    only_in(actual, expected).join("\n"),
    only_in(expected, actual).join("\n")
  );
}

#[tokio::test]
#[should_panic(expected = "the task finished without waiting for the competing transaction")]
async fn waiting_for_a_lock_fails_when_the_task_finishes_without_blocking() {
  let database = TestDatabase::migrated().await;
  let admin = database.admin_client().await;
  let task = tokio::spawn(async {});
  while !task.is_finished() {
    tokio::task::yield_now().await;
  }

  wait_until_blocked(&admin, &task).await;
}
