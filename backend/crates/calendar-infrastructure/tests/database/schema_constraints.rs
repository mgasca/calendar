//! Ports `SchemaTests`: the database enforces the invariants itself, not only the domain code.

use calendar_testing::TestDatabase;
use tokio_postgres::error::SqlState;

use crate::support::{failure, insert_user, scalar, strings};

async fn index_definition(client: &tokio_postgres::Client, table: &str, index: &str) -> String {
  scalar::<String>(
    client,
    &format!("SELECT indexdef FROM pg_indexes WHERE tablename = '{table}' AND indexname = '{index}'"),
  )
  .await
}

#[tokio::test]
async fn open_task_due_index_excludes_completed_and_undated_tasks() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;

  for (index, column) in [("ix_tasks_open_due_date", "due_date"), ("ix_tasks_open_due_at", "due_at")] {
    let definition = index_definition(&client, "tasks", index).await;

    // ADR-0041: the owner leads, since every task query is scoped to one owner first.
    assert!(definition.contains(&format!("(owner_id, {column})")), "{definition}");
    assert!(definition.contains(&format!("({column} IS NOT NULL)")), "{definition}");
    assert!(definition.contains("(completed_at IS NULL)"), "{definition}");
  }
}

#[tokio::test]
async fn users_index_is_unique_among_rows_that_have_the_value() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;

  for (index, column) in [("ix_users_google_subject", "google_subject"), ("ix_users_email", "email")] {
    let definition = index_definition(&client, "users", index).await;
    assert!(definition.starts_with("CREATE UNIQUE INDEX"), "{definition}");
    assert!(definition.contains(&format!("({column} IS NOT NULL)")), "{definition}");

    let insert = format!("INSERT INTO users (id, {column}, created_at) VALUES (gen_random_uuid(), 'dup', now())");
    client.batch_execute(&insert).await.unwrap();
    let (state, constraint) = failure(&client, &insert).await;
    assert_eq!(state, SqlState::UNIQUE_VIOLATION);
    assert_eq!(constraint.as_deref(), Some(index));
  }
}

#[tokio::test]
async fn users_email_must_be_lower_case() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;

  let (state, constraint) = failure(
    &client,
    "INSERT INTO users (id, email, created_at) VALUES (gen_random_uuid(), 'Mixed@Example.com', now())",
  )
  .await;

  assert_eq!(state, SqlState::CHECK_VIOLATION);
  assert_eq!(constraint.as_deref(), Some("ck_users_email_lower"));
}

#[tokio::test]
async fn events_owner_is_indexed() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;

  let definition = index_definition(&client, "events", "ix_events_owner_id").await;

  assert!(definition.ends_with("(owner_id)"), "{definition}");
}

#[tokio::test]
async fn owner_id_is_a_non_null_foreign_key_to_users() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;

  for (table, constraint) in [("events", "fk_events_owner"), ("tasks", "fk_tasks_owner")] {
    let nullable = scalar::<String>(
      &client,
      &format!("SELECT is_nullable::text FROM information_schema.columns WHERE table_name = '{table}' AND column_name = 'owner_id'"),
    )
    .await;
    assert_eq!(nullable, "NO");

    let definition = scalar::<String>(
      &client,
      &format!("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '{constraint}'"),
    )
    .await;
    assert_eq!(definition, "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT");

    let insert = if table == "events" {
      "INSERT INTO events (id, owner_id, title, is_all_day, start_date, end_date) \
       VALUES (gen_random_uuid(), gen_random_uuid(), 'orphan', true, '2026-10-26', '2026-10-27')"
    } else {
      "INSERT INTO tasks (id, owner_id, title) VALUES (gen_random_uuid(), gen_random_uuid(), 'orphan')"
    };
    let (state, violated) = failure(&client, insert).await;
    assert_eq!(state, SqlState::FOREIGN_KEY_VIOLATION);
    assert_eq!(violated.as_deref(), Some(constraint));
  }
}

#[tokio::test]
async fn task_with_both_due_values_is_rejected() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;
  let user = insert_user(&client).await;

  let (state, constraint) = failure(
    &client,
    &format!("INSERT INTO tasks (id, owner_id, title, due_date, due_at) VALUES (gen_random_uuid(), '{user}', 't', '2026-10-26', now())"),
  )
  .await;

  assert_eq!(state, SqlState::CHECK_VIOLATION);
  assert_eq!(constraint.as_deref(), Some("ck_tasks_due_date_xor_due_at"));
}

#[tokio::test]
async fn task_priority_is_one_of_three_and_defaults_to_medium() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;
  let user = insert_user(&client).await;

  client
    .batch_execute(&format!(
      "INSERT INTO tasks (id, owner_id, title) VALUES (gen_random_uuid(), '{user}', 't')"
    ))
    .await
    .unwrap();
  assert_eq!(strings(&client, "SELECT priority::text FROM tasks").await, ["medium"]);

  let (state, constraint) = failure(
    &client,
    &format!("INSERT INTO tasks (id, owner_id, title, priority) VALUES (gen_random_uuid(), '{user}', 't', 'urgent')"),
  )
  .await;
  assert_eq!(state, SqlState::CHECK_VIOLATION);
  assert_eq!(constraint.as_deref(), Some("ck_tasks_priority"));
}

#[tokio::test]
async fn event_violating_the_shape_rules_is_rejected() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;
  let user = insert_user(&client).await;

  for values in [
    // timed with a time zone missing and dates set
    "(gen_random_uuid(), 'e', false, now(), now() + interval '1 hour', NULL, '2026-10-26', '2026-10-27')",
    // ends before it starts
    "(gen_random_uuid(), 'e', false, now(), now() - interval '1 hour', 'UTC', NULL, NULL)",
    // empty all-day span
    "(gen_random_uuid(), 'e', true, NULL, NULL, NULL, '2026-10-26', '2026-10-26')",
    // both kinds
    "(gen_random_uuid(), 'e', true, now(), now() + interval '1 hour', 'UTC', '2026-10-26', '2026-10-27')",
    // blank title
    "(gen_random_uuid(), '  ', true, NULL, NULL, NULL, '2026-10-26', '2026-10-27')",
  ] {
    let (state, _) = failure(
      &client,
      &format!(
        "INSERT INTO events (id, owner_id, title, is_all_day, starts_at, ends_at, time_zone_id, start_date, end_date) VALUES {}",
        values.replace("(gen_random_uuid(), ", &format!("(gen_random_uuid(), '{user}', "))
      ),
    )
    .await;

    // An inverted span is refused by the generated range column (data_exception) before the check constraint runs.
    assert!(
      state == SqlState::CHECK_VIOLATION || state == SqlState::DATA_EXCEPTION,
      "{values}: {state:?}"
    );
  }
}

async fn insert_timed_and_all_day_event(client: &tokio_postgres::Client, end_date: &str) {
  let user = insert_user(client).await;
  client
    .batch_execute(&format!(
      "INSERT INTO events (id, owner_id, title, is_all_day, starts_at, ends_at, time_zone_id) \
       VALUES (gen_random_uuid(), '{user}', 'timed', false, '2026-10-26T10:00Z', '2026-10-26T11:00Z', 'UTC'); \
       INSERT INTO events (id, owner_id, title, is_all_day, start_date, end_date) \
       VALUES (gen_random_uuid(), '{user}', 'day', true, '2026-10-26', '{end_date}')"
    ))
    .await
    .unwrap();
}

#[tokio::test]
async fn event_span_is_a_gist_indexed_generated_range_only_for_timed_events() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;
  client.batch_execute("SET TIME ZONE 'UTC'").await.unwrap();

  let gist = index_definition(&client, "events", "ix_events_span").await;
  assert!(gist.contains("USING gist (span)"), "{gist}");

  insert_timed_and_all_day_event(&client, "2026-10-27").await;

  let spans = strings(&client, "SELECT COALESCE(span::text, 'NULL') FROM events ORDER BY is_all_day").await;
  assert_eq!(spans, ["[\"2026-10-26 10:00:00+00\",\"2026-10-26 11:00:00+00\")", "NULL"]);
}

#[tokio::test]
async fn event_date_span_is_a_partial_gist_indexed_generated_range_only_for_all_day_events() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;

  let gist = index_definition(&client, "events", "ix_events_date_span").await;
  assert!(gist.contains("USING gist (date_span) WHERE is_all_day"), "{gist}");

  insert_timed_and_all_day_event(&client, "2026-10-28").await;

  let spans = strings(&client, "SELECT COALESCE(date_span::text, 'NULL') FROM events ORDER BY is_all_day").await;
  assert_eq!(spans, ["NULL", "[2026-10-26,2026-10-28)"]);
}

/// The generated ranges and the row version are the database's to write.
#[tokio::test]
async fn generated_ranges_and_xmin_cannot_be_written() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;
  insert_timed_and_all_day_event(&client, "2026-10-27").await;

  let (state, _) = failure(&client, "UPDATE events SET span = NULL").await;
  assert_eq!(state, SqlState::GENERATED_ALWAYS);
  let (state, _) = failure(&client, "UPDATE events SET date_span = NULL").await;
  assert_eq!(state, SqlState::GENERATED_ALWAYS);
  let (state, _) = failure(&client, "UPDATE events SET xmin = '1'").await;
  assert_eq!(state, SqlState::FEATURE_NOT_SUPPORTED);
}

#[tokio::test]
async fn app_role_cannot_change_the_schema() {
  let database = TestDatabase::migrated().await;
  let app = database.app_client().await;

  let (state, _) = failure(&app, "DROP TABLE tasks").await;

  assert_eq!(state, SqlState::INSUFFICIENT_PRIVILEGE);
}
