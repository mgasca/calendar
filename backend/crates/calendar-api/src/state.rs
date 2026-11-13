//! What every request handler shares.

use std::sync::Arc;

use calendar_infrastructure::connection::{self, ConnectionConfig, ConnectionStringError, PgPool};
use calendar_infrastructure::session_keys;
use chrono::{DateTime, Utc};
use diesel_async::pooled_connection::deadpool::Object;
use diesel_async::{AsyncConnection, AsyncPgConnection};
use opentelemetry::metrics::Meter;
use tokio::sync::OnceCell;

use crate::auth::Authenticator;
use crate::auth::google::GoogleEndpoints;
use crate::auth::session::Sealer;
use crate::clock::{Clock, SystemClock};
use crate::config::{ConfigError, Settings};
use crate::error::ApiError;
use crate::telemetry::db::DatabaseSpans;
use crate::telemetry::http::HttpMetrics;

/// A pooled database connection, connected as the least-privilege `calendar_app` role (ADR-0052).
pub type DbConnection = Object<AsyncPgConnection>;

/// What [`AppState::new`] is built from. Everything but the settings has a production default.
pub struct AppOptions {
  /// The configuration.
  pub settings: Settings,
  /// The clock; the system clock in production.
  pub clock: Arc<dyn Clock>,
  /// Where Google's OAuth endpoints are; tests point them at a local fake.
  pub google_endpoints: GoogleEndpoints,
  /// A test-only replacement for cookie authentication (see [`Authenticator`]); `None` in production.
  pub authenticator: Option<Arc<dyn Authenticator>>,
  /// Where the HTTP server metrics go: the global meter provider's meter in production (a no-op one when no
  /// OTLP endpoint is configured), an in-memory one in the telemetry tests.
  pub meter: Meter,
}

impl AppOptions {
  /// The production collaborators for `settings`.
  pub fn new(settings: Settings) -> Self {
    Self {
      settings,
      clock: Arc::new(SystemClock),
      google_endpoints: GoogleEndpoints::default(),
      authenticator: None,
      meter: opentelemetry::global::meter(crate::telemetry::SCOPE),
    }
  }
}

/// Why the API cannot start.
#[derive(Debug, thiserror::Error)]
pub enum StartupError {
  /// The configuration is refused.
  #[error(transparent)]
  Config(#[from] ConfigError),
  /// `ConnectionStrings__Calendar` cannot be parsed. The message names keywords, never values.
  #[error("ConnectionStrings__Calendar is not valid: {0}")]
  ConnectionString(#[from] ConnectionStringError),
  /// The connection pool cannot be built.
  #[error("the database connection pool could not be created: {0}")]
  Pool(String),
  /// The HTTP client for Google cannot be built.
  #[error("the HTTP client could not be created: {0}")]
  HttpClient(String),
}

struct Inner {
  settings: Settings,
  clock: Arc<dyn Clock>,
  pool: Option<PgPool>,
  session_key: OnceCell<[u8; session_keys::KEY_LENGTH]>,
  google_endpoints: GoogleEndpoints,
  authenticator: Option<Arc<dyn Authenticator>>,
  http: Option<reqwest::Client>,
  http_metrics: HttpMetrics,
}

/// The shared state of the application: cheap to clone.
#[derive(Clone)]
pub struct AppState(Arc<Inner>);

impl AppState {
  /// Validates the settings and builds the state. The pool is lazy: nothing connects until a request needs
  /// the database, so a host whose database is down, or that has no connection string, still serves health.
  pub fn new(options: AppOptions) -> Result<Self, StartupError> {
    options.settings.validate()?;
    let pool = match options.settings.connection_string.as_deref() {
      Some(connection_string) => {
        let config = ConnectionConfig::parse(connection_string)?;
        Some(connection::create_pool(&config).map_err(|error| StartupError::Pool(error.to_string()))?)
      }
      None => None,
    };
    // Only a host that signs people in with Google calls out, so only it needs (and can fail to build) a client.
    let http = match options.settings.google {
      Some(_) => Some(
        reqwest::Client::builder()
          .timeout(std::time::Duration::from_secs(60))
          .redirect(reqwest::redirect::Policy::none())
          .build()
          .map_err(|error| StartupError::HttpClient(error.to_string()))?,
      ),
      None => None,
    };
    Ok(Self(Arc::new(Inner {
      settings: options.settings,
      clock: options.clock,
      pool,
      session_key: OnceCell::new(),
      google_endpoints: options.google_endpoints,
      authenticator: options.authenticator,
      http,
      http_metrics: HttpMetrics::new(&options.meter),
    })))
  }

  /// The configuration.
  pub fn settings(&self) -> &Settings {
    &self.0.settings
  }

  /// The current instant, from the injected clock.
  pub fn now(&self) -> DateTime<Utc> {
    self.0.clock.now()
  }

  /// The connection pool, or `None` on a host without a connection string.
  pub fn pool(&self) -> Option<&PgPool> {
    self.0.pool.as_ref()
  }

  /// A database connection for this request.
  pub async fn db(&self) -> Result<DbConnection, ApiError> {
    let pool = self
      .0
      .pool
      .as_ref()
      .ok_or_else(|| ApiError::internal("ConnectionStrings__Calendar is not set, so this host has no database"))?;
    let mut connection = pool
      .get()
      .await
      .map_err(|error| ApiError::internal(format!("no database connection: {error}")))?;
    // A span per query, children of this request's span; they cost nothing when no telemetry is exported.
    connection.set_instrumentation(DatabaseSpans::default());
    Ok(connection)
  }

  /// Seals and opens the session and sign-in cookies.
  ///
  /// The key lives in the `session_keys` table, so every instance of the API reads the same one and a
  /// restart keeps sessions; the first instance to need it creates it. A host without a database uses a key
  /// of its own that lasts until it stops.
  pub async fn sealer(&self) -> Result<Sealer, ApiError> {
    let key = self
      .0
      .session_key
      .get_or_try_init(|| async {
        match &self.0.pool {
          Some(_) => {
            let mut connection = self.db().await?;
            let stored = session_keys::get_or_create(&mut connection, random_key).await?;
            Ok::<_, ApiError>(stored.0)
          }
          None => Ok(random_key()),
        }
      })
      .await?;
    Ok(Sealer::new(key))
  }

  /// Where Google's endpoints are.
  pub fn google_endpoints(&self) -> &GoogleEndpoints {
    &self.0.google_endpoints
  }

  /// The test-only authenticator, if one was injected.
  pub fn authenticator(&self) -> Option<&dyn Authenticator> {
    self.0.authenticator.as_deref()
  }

  /// The HTTP client for calls to Google; `None` when Google sign-in is not configured.
  pub fn http(&self) -> Option<&reqwest::Client> {
    self.0.http.as_ref()
  }

  /// The HTTP server metrics.
  pub fn http_metrics(&self) -> &HttpMetrics {
    &self.0.http_metrics
  }
}

fn random_key() -> [u8; session_keys::KEY_LENGTH] {
  let mut key = [0_u8; session_keys::KEY_LENGTH];
  rand::fill(&mut key);
  key
}
