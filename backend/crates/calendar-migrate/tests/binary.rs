//! The `calendar-migrate` binary end to end, against a real PostgreSQL (Testcontainers). Needs Docker.

use std::process::{Command, Output};

use calendar_testing::TestDatabase;

fn run(connection_string: Option<&str>) -> Output {
  let mut command = Command::new(env!("CARGO_BIN_EXE_calendar-migrate"));
  command.env_remove("CALENDAR_MIGRATOR_CONNECTION");
  if let Some(connection_string) = connection_string {
    command.env("CALENDAR_MIGRATOR_CONNECTION", connection_string);
  }
  command.output().expect("the binary runs")
}

fn text(bytes: &[u8]) -> String {
  String::from_utf8_lossy(bytes).into_owned()
}

#[tokio::test]
async fn applies_the_chain_prints_it_and_then_finds_nothing_pending() {
  let database = TestDatabase::empty().await;

  let first = run(Some(&database.migrator_connection_string()));

  assert!(first.status.success(), "{}", text(&first.stderr));
  let printed = text(&first.stdout);
  let lines: Vec<&str> = printed.lines().collect();
  assert_eq!(lines.len(), 8, "{printed}");
  assert_eq!(lines[0], "Applied migration '2026-10-26-195516_initial_create'.");
  assert_eq!(lines[6], "Applied migration '2026-11-11-000000_session_keys'.");
  assert_eq!(lines[7], "Done.");

  let second = run(Some(&database.migrator_connection_string()));

  assert!(second.status.success(), "{}", text(&second.stderr));
  assert_eq!(text(&second.stdout), "No migrations were pending. The database is up to date.\n");
}

#[tokio::test]
async fn the_app_role_cannot_migrate_and_the_failure_is_reported() {
  let database = TestDatabase::empty().await;

  let output = run(Some(&database.app_connection_string()));

  assert_eq!(output.status.code(), Some(1));
  assert_eq!(text(&output.stdout), "");
  let message = text(&output.stderr);
  assert!(message.starts_with("calendar-migrate: "), "{message}");
  assert!(message.contains("permission denied"), "{message}");
  assert!(!message.contains("test-app-password"), "{message}");
}

#[test]
fn fails_without_the_connection_variable() {
  let output = run(None);

  assert_eq!(output.status.code(), Some(1));
  assert!(text(&output.stderr).contains("CALENDAR_MIGRATOR_CONNECTION is not set"));
}

#[test]
fn fails_when_the_server_is_unreachable() {
  let output = run(Some(
    "Host=127.0.0.1;Port=1;Database=calendar;Username=calendar_migrator;Password=secret-value;Timeout=2",
  ));

  assert_eq!(output.status.code(), Some(1));
  let message = text(&output.stderr);
  assert!(
    message.contains("could not connect to PostgreSQL at 127.0.0.1:1 as calendar_migrator"),
    "{message}"
  );
  assert!(!message.contains("secret-value"), "{message}");
}
