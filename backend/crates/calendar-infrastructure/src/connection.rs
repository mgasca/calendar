//! PostgreSQL connections from the Npgsql keyword connection strings the deployment already stores
//! (`ConnectionStrings__Calendar`, `CALENDAR_MIGRATOR_CONNECTION`): parsing, TLS through rustls, a single
//! connection for the migrator and a deadpool pool for the application.
//!
//! The password never leaves [`ConnectionConfig`]: no URL is built from it, `Debug` redacts it and no error
//! message quotes a connection-string value.

use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use diesel_async::AsyncPgConnection;
use diesel_async::pooled_connection::deadpool::{BuildError, Pool};
use diesel_async::pooled_connection::{AsyncDieselConnectionManager, ManagerConfig, RecyclingMethod};
use futures_util::FutureExt;
use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use tokio_postgres_rustls::MakeRustlsConnect;

/// The application's connection pool.
pub type PgPool = Pool<AsyncPgConnection>;

/// The pool size used when the connection string has no `Maximum Pool Size`.
pub const DEFAULT_MAX_POOL_SIZE: usize = 20;

const DEFAULT_PORT: u16 = 5432;

/// Npgsql's default `Timeout`: how long to wait for a connection to open.
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// How the connection is encrypted and what is verified, named as in Npgsql's `SSL Mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SslMode {
  /// Never use TLS.
  Disable,
  /// Treated as [`SslMode::Prefer`]: TLS when the server offers it.
  Allow,
  /// TLS when the server offers it, without verifying the certificate; plain text otherwise. Npgsql's default.
  #[default]
  Prefer,
  /// TLS, without verifying the certificate.
  Require,
  /// TLS, verifying the certificate chain but not the host name.
  VerifyCa,
  /// TLS, verifying the certificate chain and the host name. What the Azure connection strings use.
  VerifyFull,
}

/// A parsed Npgsql keyword connection string.
#[derive(Clone, PartialEq, Eq)]
pub struct ConnectionConfig {
  pub host: String,
  pub port: u16,
  pub database: String,
  pub username: String,
  pub password: Option<String>,
  pub ssl_mode: SslMode,
  /// `Root Certificate`: a PEM file whose certificates replace the system roots for verification.
  pub root_certificate: Option<PathBuf>,
  /// `Timeout`: how long to wait for a connection to open.
  pub connect_timeout: Duration,
  /// `Maximum Pool Size`, or [`DEFAULT_MAX_POOL_SIZE`].
  pub max_pool_size: usize,
  pub application_name: Option<String>,
}

impl fmt::Debug for ConnectionConfig {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.debug_struct("ConnectionConfig")
      .field("host", &self.host)
      .field("port", &self.port)
      .field("database", &self.database)
      .field("username", &self.username)
      .field("password", &self.password.as_ref().map(|_| "<redacted>"))
      .field("ssl_mode", &self.ssl_mode)
      .field("root_certificate", &self.root_certificate)
      .field("connect_timeout", &self.connect_timeout)
      .field("max_pool_size", &self.max_pool_size)
      .field("application_name", &self.application_name)
      .finish()
  }
}

/// Why a connection string was refused. Names keywords, never values, so a password cannot leak into a log.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConnectionStringError {
  #[error("the connection string is empty")]
  Empty,
  #[error("the connection string has a segment without '=' (expected 'Keyword=value;...')")]
  MissingEquals,
  #[error("the connection string has a value with an unterminated quote")]
  UnterminatedQuote,
  #[error("the connection string keyword '{0}' is not supported")]
  UnsupportedKeyword(String),
  #[error("the connection string value of '{0}' is not valid")]
  InvalidValue(String),
  #[error("the connection string has no '{0}'")]
  Missing(&'static str),
}

impl ConnectionConfig {
  /// Parses an Npgsql keyword connection string such as
  /// `Host=db;Port=5432;Database=calendar;Username=calendar_app;Password=...;SSL Mode=VerifyFull`.
  ///
  /// Keywords are case-insensitive and may be written with or without spaces. Values may be quoted with `'` or
  /// `"` (a doubled quote stands for itself). A later keyword overrides an earlier one. Keywords that only tune
  /// Npgsql are accepted and ignored; any other unknown keyword is an error.
  pub fn parse(connection_string: &str) -> Result<Self, ConnectionStringError> {
    let pairs = split_pairs(connection_string)?;
    if pairs.is_empty() {
      return Err(ConnectionStringError::Empty);
    }

    let mut host = None;
    let mut port = DEFAULT_PORT;
    let mut database = None;
    let mut username = None;
    let mut password = None;
    let mut ssl_mode = SslMode::default();
    let mut root_certificate = None;
    let mut connect_timeout = DEFAULT_CONNECT_TIMEOUT;
    let mut max_pool_size = DEFAULT_MAX_POOL_SIZE;
    let mut application_name = None;

    for (keyword, value) in pairs {
      let invalid = || ConnectionStringError::InvalidValue(keyword.clone());
      match normalize_keyword(&keyword).as_str() {
        "host" | "server" => host = Some(value),
        "port" => port = value.parse().map_err(|_| invalid())?,
        "database" | "db" => database = Some(value),
        "username" | "userid" | "user" | "uid" => username = Some(value),
        "password" | "psw" | "pwd" => password = Some(value),
        "sslmode" => ssl_mode = parse_ssl_mode(&value).ok_or_else(invalid)?,
        "rootcertificate" => root_certificate = Some(PathBuf::from(value)),
        "timeout" => connect_timeout = Duration::from_secs(value.parse().map_err(|_| invalid())?),
        "maximumpoolsize" | "maxpoolsize" => {
          max_pool_size = value.parse().ok().filter(|size| *size > 0).ok_or_else(invalid)?;
        }
        "applicationname" => application_name = Some(value),
        // Npgsql tuning with no counterpart here, or with the same effect by default.
        "pooling"
        | "minimumpoolsize"
        | "minpoolsize"
        | "commandtimeout"
        | "includeerrordetail"
        | "keepalive"
        | "tcpkeepalive"
        | "connectionidlelifetime"
        | "connectionpruninginterval"
        | "connectionlifetime"
        | "trustservercertificate"
        | "enlist"
        | "multiplexing"
        | "maxautoprepare"
        | "noresetonclose"
        | "persistsecurityinfo" => {}
        _ => return Err(ConnectionStringError::UnsupportedKeyword(keyword)),
      }
    }

    let host = host.filter(|h| !h.is_empty()).ok_or(ConnectionStringError::Missing("Host"))?;
    let username = username
      .filter(|u| !u.is_empty())
      .ok_or(ConnectionStringError::Missing("Username"))?;
    // Npgsql connects to the database named after the user when none is given.
    let database = database.filter(|d| !d.is_empty()).unwrap_or_else(|| username.clone());

    Ok(Self {
      host,
      port,
      database,
      username,
      password,
      ssl_mode,
      root_certificate,
      connect_timeout,
      max_pool_size,
      application_name,
    })
  }

  /// The same server and credentials, another database.
  #[must_use]
  pub fn with_database(mut self, database: impl Into<String>) -> Self {
    self.database = database.into();
    self
  }

  fn to_postgres_config(&self) -> tokio_postgres::Config {
    let mut config = tokio_postgres::Config::new();
    config
      .host(&self.host)
      .port(self.port)
      .dbname(&self.database)
      .user(&self.username)
      .connect_timeout(self.connect_timeout)
      .ssl_mode(match self.ssl_mode {
        SslMode::Disable => tokio_postgres::config::SslMode::Disable,
        SslMode::Allow | SslMode::Prefer => tokio_postgres::config::SslMode::Prefer,
        SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => tokio_postgres::config::SslMode::Require,
      });
    if let Some(password) = &self.password {
      config.password(password);
    }
    if let Some(application_name) = &self.application_name {
      config.application_name(application_name);
    }
    config
  }
}

impl FromStr for ConnectionConfig {
  type Err = ConnectionStringError;

  fn from_str(s: &str) -> Result<Self, Self::Err> {
    Self::parse(s)
  }
}

/// Why a connection could not be opened.
#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
  #[error(transparent)]
  ConnectionString(#[from] ConnectionStringError),
  #[error("TLS setup failed: {0}")]
  Tls(String),
  #[error("could not connect to PostgreSQL at {host}:{port} as {username}: {reason}")]
  Connect {
    host: String,
    port: u16,
    username: String,
    reason: String,
  },
}

/// Opens one connection for Diesel, outside any pool. The migrator uses this.
pub async fn connect(config: &ConnectionConfig) -> Result<AsyncPgConnection, ConnectionError> {
  let postgres = config.to_postgres_config();
  let connection = match tls_connector(config)? {
    None => {
      let (client, connection) = postgres
        .connect(tokio_postgres::NoTls)
        .await
        .map_err(|e| connect_error(config, &e))?;
      AsyncPgConnection::try_from_client_and_connection(client, connection).await
    }
    Some(tls) => {
      let (client, connection) = postgres.connect(tls).await.map_err(|e| connect_error(config, &e))?;
      AsyncPgConnection::try_from_client_and_connection(client, connection).await
    }
  };
  connection.map_err(|e| ConnectionError::Connect {
    host: config.host.clone(),
    port: config.port,
    username: config.username.clone(),
    reason: e.to_string(),
  })
}

/// Opens one plain `tokio_postgres` client, driving its connection on the current runtime. For tools and tests
/// that run SQL text directly; application code uses [`connect`] or [`create_pool`].
pub async fn connect_client(config: &ConnectionConfig) -> Result<tokio_postgres::Client, ConnectionError> {
  let postgres = config.to_postgres_config();
  match tls_connector(config)? {
    None => {
      let (client, connection) = postgres
        .connect(tokio_postgres::NoTls)
        .await
        .map_err(|e| connect_error(config, &e))?;
      tokio::spawn(connection.map(drop));
      Ok(client)
    }
    Some(tls) => {
      let (client, connection) = postgres.connect(tls).await.map_err(|e| connect_error(config, &e))?;
      tokio::spawn(connection.map(drop));
      Ok(client)
    }
  }
}

/// The deadpool manager behind [`create_pool`], for callers that configure the pool themselves.
pub fn pool_manager(config: &ConnectionConfig) -> AsyncDieselConnectionManager<AsyncPgConnection> {
  let config = Arc::new(config.clone());
  let mut manager_config = ManagerConfig::<AsyncPgConnection>::default();
  // A connection the server or a firewall closed while idle is replaced at checkout, instead of failing a request.
  manager_config.recycling_method = RecyclingMethod::Verified;
  manager_config.custom_setup = Box::new(move |_| {
    let config = Arc::clone(&config);
    async move {
      connect(&config)
        .await
        .map_err(|e| diesel::ConnectionError::BadConnection(e.to_string()))
    }
    .boxed()
  });
  // The manager only passes this string to `custom_setup`, which ignores it: credentials stay in `config`.
  AsyncDieselConnectionManager::new_with_config(String::new(), manager_config)
}

/// Builds the application's pool. Connections are opened lazily, so this succeeds while the database is down.
pub fn create_pool(config: &ConnectionConfig) -> Result<PgPool, BuildError> {
  Pool::builder(pool_manager(config)).max_size(config.max_pool_size).build()
}

fn connect_error(config: &ConnectionConfig, error: &tokio_postgres::Error) -> ConnectionError {
  ConnectionError::Connect {
    host: config.host.clone(),
    port: config.port,
    username: config.username.clone(),
    reason: error_chain(error),
  }
}

/// `tokio_postgres::Error` prints only its kind ("db error"); the cause holds the server's message.
fn error_chain(error: &dyn std::error::Error) -> String {
  let mut text = error.to_string();
  let mut source = error.source();
  while let Some(cause) = source {
    text.push_str(": ");
    text.push_str(&cause.to_string());
    source = cause.source();
  }
  text
}

fn tls_connector(config: &ConnectionConfig) -> Result<Option<MakeRustlsConnect>, ConnectionError> {
  Ok(client_config(config)?.map(MakeRustlsConnect::new))
}

/// The rustls configuration of an SSL mode, or `None` when TLS is disabled.
fn client_config(config: &ConnectionConfig) -> Result<Option<ClientConfig>, ConnectionError> {
  // Named explicitly: other crates in the workspace enable a second rustls provider, and then there is no default.
  let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
  let builder = ClientConfig::builder_with_provider(Arc::clone(&provider))
    .with_safe_default_protocol_versions()
    .map_err(|e| ConnectionError::Tls(e.to_string()))?;

  let client_config = match config.ssl_mode {
    SslMode::Disable => return Ok(None),
    SslMode::Allow | SslMode::Prefer | SslMode::Require => builder
      .dangerous()
      .with_custom_certificate_verifier(Arc::new(NoVerification { provider }))
      .with_no_client_auth(),
    SslMode::VerifyFull => builder
      .with_root_certificates(root_store(config.root_certificate.as_deref())?)
      .with_no_client_auth(),
    SslMode::VerifyCa => {
      let roots = Arc::new(root_store(config.root_certificate.as_deref())?);
      let inner = WebPkiServerVerifier::builder_with_provider(roots, provider)
        .build()
        .map_err(|e| ConnectionError::Tls(e.to_string()))?;
      builder
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(ChainOnlyVerification { inner }))
        .with_no_client_auth()
    }
  };
  Ok(Some(client_config))
}

/// The certificates of `Root Certificate` when given, otherwise the operating system's trusted roots.
fn root_store(root_certificate: Option<&Path>) -> Result<RootCertStore, ConnectionError> {
  let mut roots = RootCertStore::empty();
  if let Some(path) = root_certificate {
    let certificates = CertificateDer::pem_file_iter(path)
      .and_then(Iterator::collect::<Result<Vec<_>, _>>)
      .map_err(|e| ConnectionError::Tls(format!("cannot read the root certificate '{}': {e}", path.display())))?;
    let (added, _) = roots.add_parsable_certificates(certificates);
    if added == 0 {
      return Err(ConnectionError::Tls(format!(
        "the root certificate '{}' holds no certificate",
        path.display()
      )));
    }
  } else {
    let native = rustls_native_certs::load_native_certs();
    let (added, _) = roots.add_parsable_certificates(native.certs);
    if added == 0 {
      let reasons: Vec<String> = native.errors.iter().map(ToString::to_string).collect();
      return Err(ConnectionError::Tls(format!(
        "no trusted root certificate was found on this system ({})",
        if reasons.is_empty() {
          "the store is empty".to_owned()
        } else {
          reasons.join("; ")
        }
      )));
    }
  }
  Ok(roots)
}

/// `Require` and `Prefer`: encrypt, but accept any certificate (as libpq and Npgsql do for these modes).
#[derive(Debug)]
struct NoVerification {
  provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for NoVerification {
  fn verify_server_cert(
    &self,
    _end_entity: &CertificateDer<'_>,
    _intermediates: &[CertificateDer<'_>],
    _server_name: &ServerName<'_>,
    _ocsp_response: &[u8],
    _now: UnixTime,
  ) -> Result<ServerCertVerified, rustls::Error> {
    Ok(ServerCertVerified::assertion())
  }

  fn verify_tls12_signature(
    &self,
    message: &[u8],
    cert: &CertificateDer<'_>,
    dss: &DigitallySignedStruct,
  ) -> Result<HandshakeSignatureValid, rustls::Error> {
    rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
  }

  fn verify_tls13_signature(
    &self,
    message: &[u8],
    cert: &CertificateDer<'_>,
    dss: &DigitallySignedStruct,
  ) -> Result<HandshakeSignatureValid, rustls::Error> {
    rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
  }

  fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
    self.provider.signature_verification_algorithms.supported_schemes()
  }
}

/// `VerifyCA`: the chain must lead to a trusted root, but the certificate need not name the host.
#[derive(Debug)]
struct ChainOnlyVerification {
  inner: Arc<WebPkiServerVerifier>,
}

impl ServerCertVerifier for ChainOnlyVerification {
  fn verify_server_cert(
    &self,
    end_entity: &CertificateDer<'_>,
    intermediates: &[CertificateDer<'_>],
    server_name: &ServerName<'_>,
    ocsp_response: &[u8],
    now: UnixTime,
  ) -> Result<ServerCertVerified, rustls::Error> {
    match self
      .inner
      .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
    {
      Err(rustls::Error::InvalidCertificate(CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. })) => {
        Ok(ServerCertVerified::assertion())
      }
      other => other,
    }
  }

  fn verify_tls12_signature(
    &self,
    message: &[u8],
    cert: &CertificateDer<'_>,
    dss: &DigitallySignedStruct,
  ) -> Result<HandshakeSignatureValid, rustls::Error> {
    self.inner.verify_tls12_signature(message, cert, dss)
  }

  fn verify_tls13_signature(
    &self,
    message: &[u8],
    cert: &CertificateDer<'_>,
    dss: &DigitallySignedStruct,
  ) -> Result<HandshakeSignatureValid, rustls::Error> {
    self.inner.verify_tls13_signature(message, cert, dss)
  }

  fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
    self.inner.supported_verify_schemes()
  }
}

fn normalize_keyword(keyword: &str) -> String {
  keyword
    .chars()
    .filter(|c| !c.is_whitespace() && *c != '_')
    .flat_map(char::to_lowercase)
    .collect()
}

fn parse_ssl_mode(value: &str) -> Option<SslMode> {
  match normalize_keyword(value).as_str() {
    "disable" => Some(SslMode::Disable),
    "allow" => Some(SslMode::Allow),
    "prefer" => Some(SslMode::Prefer),
    "require" => Some(SslMode::Require),
    "verifyca" => Some(SslMode::VerifyCa),
    "verifyfull" => Some(SslMode::VerifyFull),
    _ => None,
  }
}

/// Splits `Keyword=value;Keyword='quoted; value'` into pairs, following ADO.NET's connection-string rules.
fn split_pairs(input: &str) -> Result<Vec<(String, String)>, ConnectionStringError> {
  let mut pairs = Vec::new();
  let mut chars = input.chars().peekable();

  loop {
    while chars.next_if(|c| c.is_whitespace() || *c == ';').is_some() {}
    if chars.peek().is_none() {
      return Ok(pairs);
    }

    let mut keyword = String::new();
    loop {
      match chars.next() {
        // "==" is an escaped '=' inside a keyword.
        Some('=') if chars.next_if_eq(&'=').is_some() => keyword.push('='),
        Some('=') => break,
        Some(';') | None => return Err(ConnectionStringError::MissingEquals),
        Some(c) => keyword.push(c),
      }
    }

    while chars.next_if(|c| c.is_whitespace()).is_some() {}
    let mut value = String::new();
    if let Some(quote) = chars.next_if(|c| *c == '\'' || *c == '"') {
      loop {
        match chars.next() {
          Some(c) if c == quote => {
            if chars.next_if_eq(&quote).is_some() {
              value.push(quote);
            } else {
              break;
            }
          }
          Some(c) => value.push(c),
          None => return Err(ConnectionStringError::UnterminatedQuote),
        }
      }
      while chars.next_if(|c| c.is_whitespace()).is_some() {}
      if chars.next_if(|c| *c != ';').is_some() {
        return Err(ConnectionStringError::InvalidValue(keyword.trim().to_owned()));
      }
    } else {
      while let Some(c) = chars.next_if(|c| *c != ';') {
        value.push(c);
      }
      value.truncate(value.trim_end().len());
    }

    pairs.push((keyword.trim().to_owned(), value));
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_the_local_migrator_connection_string() {
    let config = ConnectionConfig::parse("Host=127.0.0.1;Port=5432;Database=calendar;Username=calendar_migrator;Password=s3cret").unwrap();

    assert_eq!(config.host, "127.0.0.1");
    assert_eq!(config.port, 5432);
    assert_eq!(config.database, "calendar");
    assert_eq!(config.username, "calendar_migrator");
    assert_eq!(config.password.as_deref(), Some("s3cret"));
    assert_eq!(config.ssl_mode, SslMode::Prefer);
    assert_eq!(config.max_pool_size, DEFAULT_MAX_POOL_SIZE);
    assert_eq!(config.connect_timeout, Duration::from_secs(15));
  }

  #[test]
  fn parses_what_the_infra_tool_builds_for_azure() {
    // NpgsqlConnectionStringBuilder { Host, Database, Username, Password, SslMode = VerifyFull }.ConnectionString
    let config = ConnectionConfig::parse(
      "Host=psql-calendar.postgres.database.azure.com;Database=calendar;Username=calendar_app;Password=p;SSL Mode=VerifyFull",
    )
    .unwrap();

    assert_eq!(config.host, "psql-calendar.postgres.database.azure.com");
    assert_eq!(config.port, 5432);
    assert_eq!(config.ssl_mode, SslMode::VerifyFull);
  }

  #[test]
  fn keywords_are_case_and_space_insensitive_and_have_aliases() {
    let config =
      ConnectionConfig::parse(" server = db ; USER ID = u ; pwd = p ; sslmode = verifyca ; Maximum Pool Size = 7 ; Timeout=3;").unwrap();

    assert_eq!(config.host, "db");
    assert_eq!(config.username, "u");
    assert_eq!(config.database, "u", "the database defaults to the user name");
    assert_eq!(config.password.as_deref(), Some("p"));
    assert_eq!(config.ssl_mode, SslMode::VerifyCa);
    assert_eq!(config.max_pool_size, 7);
    assert_eq!(config.connect_timeout, Duration::from_secs(3));
  }

  #[test]
  fn quoted_values_keep_semicolons_equals_and_quotes() {
    let config = ConnectionConfig::parse(r#"Host=h;Username=u;Password='a;b=c''d';Application Name="x ""y"" z""#).unwrap();

    assert_eq!(config.password.as_deref(), Some("a;b=c'd"));
    assert_eq!(config.application_name.as_deref(), Some(r#"x "y" z"#));
  }

  #[test]
  fn unquoted_values_keep_inner_characters() {
    let config = ConnectionConfig::parse("Host=h;Username=u;Password=p@ss=w:/rd#?&%  ").unwrap();

    assert_eq!(config.password.as_deref(), Some("p@ss=w:/rd#?&%"));
  }

  #[test]
  fn a_later_keyword_wins_and_tuning_keywords_are_ignored() {
    let config = ConnectionConfig::parse("Host=a;Host=b;Username=u;Pooling=false;Include Error Detail=true;Command Timeout=30").unwrap();

    assert_eq!(config.host, "b");
  }

  #[test]
  fn refuses_bad_input_without_quoting_values() {
    assert_eq!(ConnectionConfig::parse("  ;; "), Err(ConnectionStringError::Empty));
    assert_eq!(
      ConnectionConfig::parse("Host=h;secret-without-equals"),
      Err(ConnectionStringError::MissingEquals)
    );
    assert_eq!(
      ConnectionConfig::parse("Host=h;Password='oops"),
      Err(ConnectionStringError::UnterminatedQuote)
    );
    assert_eq!(
      ConnectionConfig::parse("Database=d;Username=u"),
      Err(ConnectionStringError::Missing("Host"))
    );
    assert_eq!(
      ConnectionConfig::parse("Host=h;Database=d"),
      Err(ConnectionStringError::Missing("Username"))
    );
    assert_eq!(
      ConnectionConfig::parse("Host=h;Username=u;Search Path=x"),
      Err(ConnectionStringError::UnsupportedKeyword("Search Path".to_owned()))
    );

    let error = ConnectionConfig::parse("Host=h;Username=u;Password=hunter2;Port=hunter2").unwrap_err();
    assert_eq!(error, ConnectionStringError::InvalidValue("Port".to_owned()));
    assert!(!error.to_string().contains("hunter2"));
    assert_eq!(
      ConnectionConfig::parse("Host=h;Username=u;SSL Mode=Sometimes"),
      Err(ConnectionStringError::InvalidValue("SSL Mode".to_owned()))
    );
  }

  #[test]
  fn debug_redacts_the_password() {
    let config = ConnectionConfig::parse("Host=h;Username=u;Password=hunter2").unwrap();

    let debug = format!("{config:?}");
    assert!(!debug.contains("hunter2"));
    assert!(debug.contains("<redacted>"));
  }

  #[test]
  fn every_ssl_mode_builds_a_tls_configuration() {
    for (mode, expects_tls) in [
      ("Disable", false),
      ("Allow", true),
      ("Prefer", true),
      ("Require", true),
      ("VerifyCA", true),
      ("VerifyFull", true),
    ] {
      let config = ConnectionConfig::parse(&format!("Host=h;Username=u;SSL Mode={mode}")).unwrap();

      assert_eq!(client_config(&config).unwrap().is_some(), expects_tls, "{mode}");
    }
  }

  #[test]
  fn a_missing_root_certificate_file_is_a_tls_error() {
    let config = ConnectionConfig::parse("Host=h;Username=u;SSL Mode=VerifyFull;Root Certificate=/nonexistent/root.pem").unwrap();

    assert!(matches!(client_config(&config), Err(ConnectionError::Tls(message)) if message.contains("/nonexistent/root.pem")));
  }
}
