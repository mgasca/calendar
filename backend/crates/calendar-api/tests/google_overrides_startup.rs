//! The `calendar-api` binary refuses to start when a Google endpoint or issuer override (ADR-0064) is set
//! outside Development, or names a host other than loopback. It runs the real binary with a cleared
//! environment, so nothing from the developer's shell or `.env` leaks in, and it needs no database: the
//! settings are refused before anything connects.

use std::process::{Command, Output};

const OVERRIDES: [&str; 4] = [
  "Auth__Google__AuthorizationEndpoint",
  "Auth__Google__TokenEndpoint",
  "Auth__Google__UserInfoEndpoint",
  "Auth__Google__Issuer",
];

fn run(environment: &str, name: &str, value: &str) -> Output {
  Command::new(env!("CARGO_BIN_EXE_calendar-api"))
    .env_clear()
    .env("ASPNETCORE_ENVIRONMENT", environment)
    // Port 1 cannot be bound by an unprivileged user, so a binary that wrongly starts fails here rather
    // than hanging the test; a refusal happens before the bind.
    .env("ASPNETCORE_URLS", "http://127.0.0.1:1")
    .env(name, value)
    .output()
    .expect("the calendar-api binary runs")
}

fn stderr(output: &Output) -> String {
  String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn an_override_outside_development_stops_the_api() {
  for name in OVERRIDES {
    for environment in ["Production", "Staging"] {
      let output = run(environment, name, "http://127.0.0.1:55280/google");
      assert!(!output.status.success(), "{name} in {environment} started");
      assert!(
        stderr(&output).contains(&format!(
          "{name} points sign-in away from Google and is honoured only when ASPNETCORE_ENVIRONMENT is Development."
        )),
        "{name} in {environment}: {}",
        stderr(&output)
      );
    }
  }
}

#[test]
fn a_non_loopback_override_stops_the_api_even_in_development() {
  for name in OVERRIDES {
    let output = run("Development", name, "http://stub.example.com:8080/google");
    assert!(!output.status.success(), "{name} started");
    assert!(
      stderr(&output).contains(&format!("{name} must be an http(s) URL on localhost, 127.0.0.1 or [::1].")),
      "{name}: {}",
      stderr(&output)
    );
  }
}
