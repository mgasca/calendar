//! Applies the database migrations as `calendar_migrator` (ADR-0015). Reads the Npgsql keyword connection
//! string from `CALENDAR_MIGRATOR_CONNECTION`, prints what it applied and exits non-zero on any failure.

use std::process::ExitCode;

use calendar_infrastructure::connection::{self, ConnectionConfig};
use calendar_infrastructure::migrations::{self, MigrationReport};

const CONNECTION_VARIABLE: &str = "CALENDAR_MIGRATOR_CONNECTION";

#[tokio::main]
async fn main() -> ExitCode {
  match run(std::env::var(CONNECTION_VARIABLE).ok().as_deref()).await {
    Ok(report) => {
      print!("{}", describe(&report));
      ExitCode::SUCCESS
    }
    Err(message) => {
      eprintln!("calendar-migrate: {message}");
      ExitCode::FAILURE
    }
  }
}

async fn run(connection_string: Option<&str>) -> Result<MigrationReport, String> {
  let connection_string = connection_string
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| format!("{CONNECTION_VARIABLE} is not set. Set it to the calendar_migrator connection string."))?;
  let config = ConnectionConfig::parse(connection_string).map_err(|e| format!("{CONNECTION_VARIABLE}: {e}"))?;
  let connection = connection::connect(&config).await.map_err(|e| e.to_string())?;
  migrations::migrate(connection).await.map_err(|e| e.to_string())
}

fn describe(report: &MigrationReport) -> String {
  let mut text = String::new();
  if report.adopted_ef_history {
    text.push_str("Adopted the EF Core migration history: its migrations are recorded as applied.\n");
  }
  for name in &report.applied {
    text.push_str("Applied migration '");
    text.push_str(name);
    text.push_str("'.\n");
  }
  text.push_str(if report.applied.is_empty() {
    "No migrations were pending. The database is up to date.\n"
  } else {
    "Done.\n"
  });
  text
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn describes_a_run_that_adopted_and_applied() {
    let report = MigrationReport {
      adopted_ef_history: true,
      applied: vec!["2026-11-11-000000_session_keys".to_owned()],
    };

    assert_eq!(
      describe(&report),
      "Adopted the EF Core migration history: its migrations are recorded as applied.\n\
       Applied migration '2026-11-11-000000_session_keys'.\n\
       Done.\n"
    );
  }

  #[test]
  fn describes_a_run_with_nothing_pending() {
    assert_eq!(
      describe(&MigrationReport::default()),
      "No migrations were pending. The database is up to date.\n"
    );
  }

  #[tokio::test]
  async fn fails_clearly_without_the_variable() {
    let message = run(None).await.unwrap_err();

    assert!(message.contains("CALENDAR_MIGRATOR_CONNECTION is not set"), "{message}");
  }

  #[tokio::test]
  async fn fails_clearly_on_a_bad_connection_string_without_echoing_it() {
    let message = run(Some("Host=h;Username=u;Password=hunter2;Port=nope")).await.unwrap_err();

    assert!(message.starts_with("CALENDAR_MIGRATOR_CONNECTION: "), "{message}");
    assert!(!message.contains("hunter2"), "{message}");
  }
}
