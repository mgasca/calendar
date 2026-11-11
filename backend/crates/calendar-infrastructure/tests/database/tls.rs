//! The SSL modes against a PostgreSQL that serves TLS with a certificate from a private authority, the shape of
//! the Azure connection (`SSL Mode=VerifyFull`). A container of its own: the shared one serves no TLS.

use calendar_infrastructure::connection::{self, ConnectionConfig, ConnectionError};
use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair, KeyUsagePurpose};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{CopyTargetOptions, ImageExt};

/// Runs during the image's first start, as the postgres user: installs the certificate and turns TLS on for the
/// server that starts once initialisation is done.
const ENABLE_TLS: &str = r#"#!/bin/sh
set -eu
printf '%s\n' "$TLS_CERTIFICATE" > "$PGDATA/server.crt"
printf '%s\n' "$TLS_KEY" > "$PGDATA/server.key"
chmod 600 "$PGDATA/server.key"
echo "ssl = on" >> "$PGDATA/postgresql.conf"
"#;

/// PEM text.
struct Certificates {
  authority: String,
  server: String,
  server_key: String,
}

/// A private certificate authority and a server certificate it signed for the DNS name `localhost` only.
fn certificates() -> Certificates {
  let authority_key = KeyPair::generate().unwrap();
  let mut authority = CertificateParams::new(Vec::<String>::new()).unwrap();
  authority.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
  authority.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
  authority.distinguished_name.push(DnType::CommonName, "Calendar test authority");
  let authority_certificate = authority.self_signed(&authority_key).unwrap();
  let issuer = Issuer::new(authority, authority_key);

  let server_key = KeyPair::generate().unwrap();
  let server = CertificateParams::new(vec!["localhost".to_owned()]).unwrap();
  let server_certificate = server.signed_by(&server_key, &issuer).unwrap();

  Certificates {
    authority: authority_certificate.pem(),
    server: server_certificate.pem(),
    server_key: server_key.serialize_pem(),
  }
}

async fn connect(connection_string: &str) -> Result<tokio_postgres::Client, ConnectionError> {
  // The server restarts once after initialisation; give it a moment before judging a refused connection.
  let config = ConnectionConfig::parse(connection_string).unwrap();
  let mut attempt = 0;
  loop {
    match connection::connect_client(&config).await {
      Err(ConnectionError::Connect { reason, .. }) if attempt < 50 && (reason.contains("refused") || reason.contains("starting up")) => {
        attempt += 1;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
      }
      result => return result,
    }
  }
}

async fn session_uses_tls(client: &tokio_postgres::Client) -> bool {
  client
    .query_one("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()", &[])
    .await
    .unwrap()
    .get(0)
}

#[tokio::test]
async fn ssl_modes_encrypt_and_verify_as_named() {
  let certificates = certificates();
  let directory = tempfile::tempdir().unwrap();
  let authority_file = directory.path().join("authority.pem");
  std::fs::write(&authority_file, &certificates.authority).unwrap();
  let authority_file = authority_file.display();

  let (_, tag) = calendar_testing::repo_files::postgres_image();
  let container = Postgres::default()
    .with_password("tls-test-password")
    .with_tag(tag)
    .with_env_var("TLS_CERTIFICATE", certificates.server)
    .with_env_var("TLS_KEY", certificates.server_key)
    .with_copy_to(
      CopyTargetOptions::new("/docker-entrypoint-initdb.d/00-tls.sh").with_mode(0o755),
      ENABLE_TLS.as_bytes().to_vec(),
    )
    .start()
    .await
    .unwrap();
  let port = container.get_host_port_ipv4(5432).await.unwrap();
  let by_name = format!("Host=localhost;Port={port};Database=postgres;Username=postgres;Password=tls-test-password");
  let by_address = by_name.replace("Host=localhost", "Host=127.0.0.1");

  // VerifyFull, as Azure: the chain leads to the given root and the certificate names the host.
  let client = connect(&format!("{by_name};SSL Mode=VerifyFull;Root Certificate={authority_file}"))
    .await
    .unwrap();
  assert!(session_uses_tls(&client).await);

  // VerifyFull refuses a certificate that does not name the host; VerifyCA accepts it, the chain being good.
  let error = connect(&format!("{by_address};SSL Mode=VerifyFull;Root Certificate={authority_file}"))
    .await
    .unwrap_err();
  assert!(error.to_string().contains("not valid for name"), "{error}");
  let client = connect(&format!("{by_address};SSL Mode=VerifyCA;Root Certificate={authority_file}"))
    .await
    .unwrap();
  assert!(session_uses_tls(&client).await);

  // Without the private root, the system's roots do not vouch for this server, under either verifying mode.
  for mode in ["VerifyFull", "VerifyCA"] {
    let error = connect(&format!("{by_name};SSL Mode={mode}")).await.unwrap_err();
    assert!(error.to_string().contains("invalid peer certificate"), "{mode}: {error}");
  }

  // Require and Prefer (the default) encrypt without verifying; Disable does not encrypt.
  let client = connect(&format!("{by_name};SSL Mode=Require")).await.unwrap();
  assert!(session_uses_tls(&client).await);
  let client = connect(&by_name).await.unwrap();
  assert!(session_uses_tls(&client).await);
  let client = connect(&format!("{by_name};SSL Mode=Disable")).await.unwrap();
  assert!(!session_uses_tls(&client).await);

  // The Diesel connection the migrator and the pool use takes the same path.
  let config = ConnectionConfig::parse(&format!("{by_name};SSL Mode=VerifyFull;Root Certificate={authority_file}")).unwrap();
  assert!(connection::connect(&config).await.is_ok());
  assert!(connection::create_pool(&config).unwrap().get().await.is_ok());
}

/// Require needs TLS; Prefer falls back to plain text when the server offers none (local development).
#[tokio::test]
async fn a_server_without_tls_is_refused_by_require_and_accepted_by_prefer() {
  let database = calendar_testing::TestDatabase::migrated().await;

  let client = connect(&database.app_connection_string()).await.unwrap();
  assert!(!session_uses_tls(&client).await);

  let error = connect(&format!("{};SSL Mode=Require", database.app_connection_string()))
    .await
    .unwrap_err();
  assert!(matches!(error, ConnectionError::Connect { .. }), "{error:?}");
}

#[tokio::test]
async fn a_wrong_password_reports_the_server_message_without_the_password() {
  let database = calendar_testing::TestDatabase::migrated().await;
  let wrong = database.app_connection_string().replace("test-app-password", "not-the-password");

  let error = connect(&wrong).await.unwrap_err().to_string();

  assert!(error.contains("password authentication failed"), "{error}");
  assert!(error.contains("as calendar_app"), "{error}");
  assert!(!error.contains("not-the-password"), "{error}");
}
