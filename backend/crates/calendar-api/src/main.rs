//! The Calendar API host.
//!
//! `calendar-api` serves the API. `calendar-api --openapi [FILE]` writes the OpenAPI document to `FILE` (or to
//! standard output) without starting the server: that is how `contracts/openapi.json` is generated.

#![allow(clippy::doc_markdown, reason = "names such as OpenAPI are prose here, not code")]

use std::process::ExitCode;

use calendar_api::config::Settings;
use calendar_api::state::AppOptions;
use calendar_api::telemetry::{self, TelemetryConfig};
use calendar_api::{app, openapi};

#[tokio::main]
async fn main() -> ExitCode {
  let arguments: Vec<String> = std::env::args().skip(1).collect();
  if arguments.first().map(String::as_str) == Some("--openapi") {
    return write_openapi(arguments.get(1).map(String::as_str));
  }

  // Standard output as before; OpenTelemetry over OTLP as well when an `OTEL_*` endpoint is set (ADR-0062).
  let telemetry = match TelemetryConfig::from_env().and_then(telemetry::init) {
    Ok(telemetry) => telemetry,
    Err(error) => {
      eprintln!("calendar-api: {error}");
      return ExitCode::FAILURE;
    }
  };
  let result = run(&arguments).await;
  if !telemetry.is_disabled() {
    let _ = tokio::task::spawn_blocking(move || telemetry.shutdown()).await;
  }
  match result {
    Ok(()) => ExitCode::SUCCESS,
    Err(message) => {
      eprintln!("calendar-api: {message}");
      ExitCode::FAILURE
    }
  }
}

fn write_openapi(file: Option<&str>) -> ExitCode {
  let document = openapi::to_json(&openapi::document());
  let written = if let Some(file) = file {
    std::fs::write(file, document).map_err(|error| format!("cannot write {file}: {error}"))
  } else {
    print!("{document}");
    Ok(())
  };
  match written {
    Ok(()) => ExitCode::SUCCESS,
    Err(message) => {
      eprintln!("calendar-api: {message}");
      ExitCode::FAILURE
    }
  }
}

async fn run(arguments: &[String]) -> Result<(), String> {
  let mut settings = Settings::from_env();
  // `--urls` overrides ASPNETCORE_URLS, as it did for the .NET host.
  if let Some(position) = arguments.iter().position(|argument| argument == "--urls") {
    settings.urls = arguments.get(position + 1).cloned().ok_or("--urls needs a value")?;
  }
  let addresses = settings.listen_addresses().map_err(|error| error.to_string())?;
  tracing::info!("Hosting environment: {}", settings.environment);

  let app = app::build(AppOptions::new(settings)).map_err(|error| error.to_string())?;
  app::serve(app, &addresses, shutdown_signal())
    .await
    .map_err(|error| error.to_string())
}

/// Completes on Ctrl+C or, on Unix, `SIGTERM` (what the container runtime sends).
async fn shutdown_signal() {
  let interrupt = async {
    let _ = tokio::signal::ctrl_c().await;
  };
  #[cfg(unix)]
  let terminate = async {
    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
      Ok(mut signal) => {
        signal.recv().await;
      }
      Err(_) => std::future::pending::<()>().await,
    }
  };
  #[cfg(not(unix))]
  let terminate = std::future::pending::<()>();

  tokio::select! {
    () = interrupt => {}
    () = terminate => {}
  }
  tracing::info!("Application is shutting down...");
}
