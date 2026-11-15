//! Waiting for a freshly started PostgreSQL container to accept connections (#867).
//!
//! Testcontainers reports the `postgres` image ready on its "ready to accept connections" log line, but the
//! image's entrypoint first runs a temporary server for the init scripts, listening on the Unix socket only, and
//! then restarts it. A TCP client can therefore arrive during the restart, and on a loaded machine the restart
//! takes seconds. A connection over TCP succeeds only against the final server, so connect until one does, within
//! a time bound rather than a number of attempts.

use std::fmt;
use std::io::ErrorKind;
use std::time::Duration;

use calendar_infrastructure::connection::{self, ConnectSource, ConnectionConfig, ConnectionError};
use tokio::time::Instant;
use tokio_postgres::error::SqlState;

/// How long a test waits for a container it started; generous, because it only ever costs time on a broken run.
pub const CONTAINER_READY_WITHIN: Duration = Duration::from_secs(120);

const RETRY_EVERY: Duration = Duration::from_millis(250);

/// The most one attempt (connect, then `SELECT 1`) may take. `Timeout` in the connection string bounds only the
/// TCP connect, not the PostgreSQL handshake after it, and a handshake can wait for ever: on a TCP
/// self-connection, which Linux makes when a refused port in its ephemeral range is retried often enough that the
/// port comes up as the attempt's own source port (#949).
const ATTEMPT_WITHIN: Duration = Duration::from_secs(5);

/// How the last attempt of a wait ended.
#[derive(Debug)]
pub enum LastAttempt {
  /// It failed with this error.
  Failed(ConnectionError),
  /// It had no answer within its time ([`ATTEMPT_WITHIN`] or what was left of the wait).
  Unanswered(Duration),
}

impl fmt::Display for LastAttempt {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      Self::Failed(error) => f.write_str(&connection::error_chain(error)),
      Self::Unanswered(within) => write!(f, "no answer within {:.1} s", within.as_secs_f64()),
    }
  }
}

/// The server did not accept a connection: either it gave an error that waiting cannot cure, or the time ran out.
#[derive(Debug)]
pub struct NotAccepting {
  /// How long the wait lasted.
  pub waited: Duration,
  /// Whether the wait ended because its time was up, rather than on an error that does not pass.
  pub timed_out: bool,
  /// How the last attempt ended.
  pub last: LastAttempt,
}

impl fmt::Display for NotAccepting {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let reason = if self.timed_out { "still not ready" } else { "refused for good" };
    write!(
      f,
      "the test PostgreSQL does not accept connections ({reason} after {:.1} s): {}",
      self.waited.as_secs_f64(),
      self.last
    )
  }
}

/// Connects with `config` and runs `SELECT 1` until that succeeds, retrying while the server is still starting
/// ([`is_not_ready_yet`]) or does not answer, and for at most `within`. Each attempt has at most
/// [`ATTEMPT_WITHIN`], so the wait ends on time whatever the server does. Any other error ends the wait at once.
///
/// # Errors
/// [`NotAccepting`] when the time is up or an error is not one a starting server gives.
pub async fn wait_until_accepting(config: &ConnectionConfig, within: Duration) -> Result<(), NotAccepting> {
  let started = Instant::now();
  let deadline = started + within;
  loop {
    let attempt_within = deadline.saturating_duration_since(Instant::now()).min(ATTEMPT_WITHIN);
    let last = match tokio::time::timeout(attempt_within, attempt(config)).await {
      Ok(Ok(())) => return Ok(()),
      Ok(Err(error)) => LastAttempt::Failed(error),
      Err(_) => LastAttempt::Unanswered(attempt_within),
    };
    let now = Instant::now();
    let timed_out = now + RETRY_EVERY > deadline;
    let retryable = match &last {
      LastAttempt::Failed(error) => is_not_ready_yet(error),
      LastAttempt::Unanswered(_) => true,
    };
    if timed_out || !retryable {
      return Err(NotAccepting {
        waited: now - started,
        timed_out,
        last,
      });
    }
    tokio::time::sleep(RETRY_EVERY).await;
  }
}

async fn attempt(config: &ConnectionConfig) -> Result<(), ConnectionError> {
  let client = connection::connect_client(config).await?;
  client
    .simple_query("SELECT 1")
    .await
    // The session was opened but the server went away under it: the temporary server stopping, say.
    .map_err(|error| connect_error(config, error))?;
  Ok(())
}

/// Whether `error` is one a PostgreSQL container gives while it is still starting: nothing listening yet (a
/// refused connection), Docker's port proxy accepting the connection and then closing it (reset, abort, EOF, a
/// closed session), an attempt that timed out, or SQLSTATE 57P03 `the database system is starting up`.
pub fn is_not_ready_yet(error: &ConnectionError) -> bool {
  let ConnectionError::Connect {
    source: ConnectSource::Postgres(error),
    ..
  } = error
  else {
    return false;
  };
  let io_kind = std::error::Error::source(error)
    .and_then(|cause| cause.downcast_ref::<std::io::Error>())
    .map(std::io::Error::kind);
  let transient_io = io_kind.is_some_and(|kind| {
    matches!(
      kind,
      ErrorKind::ConnectionRefused
        | ErrorKind::ConnectionReset
        | ErrorKind::ConnectionAborted
        | ErrorKind::UnexpectedEof
        | ErrorKind::BrokenPipe
        | ErrorKind::TimedOut
    )
  });
  transient_io || error.is_closed() || error.code() == Some(&SqlState::CANNOT_CONNECT_NOW)
}

/// The error a failed `SELECT 1` gives, shaped like a failed connect so that one rule classifies both.
fn connect_error(config: &ConnectionConfig, error: tokio_postgres::Error) -> ConnectionError {
  ConnectionError::Connect {
    host: config.host.clone(),
    port: config.port,
    username: config.username.clone(),
    source: ConnectSource::Postgres(error),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn config_for(port: u16) -> ConnectionConfig {
    ConnectionConfig::parse(&format!(
      "Host=127.0.0.1;Port={port};Database=postgres;Username=postgres;Password=unused;SSL Mode=Disable;Timeout=2"
    ))
    .unwrap()
  }

  /// A port nothing listens on: bind one, note it, and close it.
  fn closed_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
  }

  #[tokio::test]
  async fn a_refused_connection_is_retried_until_the_time_is_up() {
    let within = Duration::from_secs(1);

    let error = wait_until_accepting(&config_for(closed_port()), within).await.unwrap_err();

    assert!(error.timed_out, "{error}");
    assert!(error.waited + RETRY_EVERY >= within, "{error}");
    assert!(
      matches!(&error.last, LastAttempt::Failed(last) if is_not_ready_yet(last)),
      "{error}"
    );
    let message = error.to_string();
    assert!(message.contains("still not ready after"), "{message}");
  }

  /// What Docker's port proxy does while nothing in the container listens yet: accept, then close at once.
  #[tokio::test]
  async fn a_connection_closed_on_arrival_is_retried_until_the_time_is_up() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let proxy = tokio::spawn(async move {
      loop {
        let (socket, _) = listener.accept().await.unwrap();
        drop(socket);
      }
    });

    let error = wait_until_accepting(&config_for(port), Duration::from_secs(1)).await.unwrap_err();
    proxy.abort();

    assert!(error.timed_out, "{error}");
    assert!(
      matches!(&error.last, LastAttempt::Failed(last) if is_not_ready_yet(last)),
      "{error}"
    );
  }

  /// A server that accepts and then never answers, as a TCP self-connection does (#949): each attempt gives up on
  /// time, so the wait ends at its bound instead of hanging.
  #[tokio::test]
  async fn a_server_that_never_answers_is_retried_until_the_time_is_up() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let silent = tokio::spawn(async move {
      let mut held = Vec::new();
      loop {
        let (socket, _) = listener.accept().await.unwrap();
        held.push(socket);
      }
    });
    let within = Duration::from_secs(2);

    let waited = tokio::time::timeout(Duration::from_secs(30), wait_until_accepting(&config_for(port), within)).await;
    silent.abort();

    let error = waited.expect("the wait ends at its bound").unwrap_err();
    assert!(error.timed_out, "{error}");
    assert!(error.waited < within + RETRY_EVERY, "{error}");
    assert!(matches!(error.last, LastAttempt::Unanswered(_)), "{error}");
    assert!(error.to_string().contains("no answer within"), "{error}");
  }

  /// Not every failure is a server still starting: a wrong configuration ends the wait at once.
  #[tokio::test]
  async fn an_error_a_starting_server_does_not_give_ends_the_wait_at_once() {
    let missing = std::env::temp_dir().join("calendar-testing-no-such-root.pem");
    let config = ConnectionConfig::parse(&format!(
      "Host=127.0.0.1;Port={};Database=postgres;Username=postgres;SSL Mode=VerifyFull;Root Certificate={}",
      closed_port(),
      missing.display()
    ))
    .unwrap();

    let error = wait_until_accepting(&config, Duration::from_secs(30)).await.unwrap_err();

    assert!(!error.timed_out, "{error}");
    assert!(error.waited < Duration::from_secs(5), "{error}");
    assert!(error.to_string().contains("refused for good"), "{error}");
  }
}
