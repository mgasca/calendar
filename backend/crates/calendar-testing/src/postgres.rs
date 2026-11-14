use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use calendar_infrastructure::connection::{self, ConnectionConfig, PgPool};
use calendar_infrastructure::migrations;
use diesel_async::AsyncPgConnection;
use testcontainers_modules::postgres::Postgres;

use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, CopyTargetOptions, ImageExt};
use tokio::sync::{Mutex, OnceCell, OwnedSemaphorePermit, Semaphore};
use tokio_postgres::error::SqlState;

/// The most test databases that exist at once; a further [`TestDatabase::migrated`] or [`TestDatabase::empty`]
/// waits for one to be dropped. Each holds a few connections per role, so this keeps a run well under
/// PostgreSQL's default `max_connections` of 100 on any machine.
pub const MAX_DATABASES: usize = 8;

/// The container's own database: initialised by the role script and migrated, the source of the template.
/// Tests do not connect to it; they compare their clone with it.
pub const MIGRATED_DATABASE: &str = "calendar";

const MIGRATED_TEMPLATE: &str = "calendar_template";
const EMPTY_TEMPLATE: &str = "calendar_empty_template";
const ADMIN_USER: &str = "postgres";

/// The passwords of this test process's container, made up when first needed. Nothing outside the process
/// needs them, so they are random rather than written in the source.
struct Passwords {
  admin: String,
  migrator: String,
  app: String,
}

static PASSWORDS: LazyLock<Passwords> = LazyLock::new(|| Passwords {
  admin: random_password(),
  migrator: random_password(),
  app: random_password(),
});

/// 32 hex digits from the standard library's randomly keyed hasher: enough for a container that lives as long
/// as one test run, and free of characters a connection string would need to quote.
fn random_password() -> String {
  let word = || RandomState::new().build_hasher().finish();
  format!("{:016x}{:016x}", word(), word())
}

fn admin_password() -> &'static str {
  &PASSWORDS.admin
}

fn migrator_password() -> &'static str {
  &PASSWORDS.migrator
}

fn app_password() -> &'static str {
  &PASSWORDS.app
}

static SERVER: OnceCell<Server> = OnceCell::const_new();

/// The one container of this test process. Never dropped (it lives in a static), so `_reaper` removes it.
struct Server {
  host: String,
  port: u16,
  container_id: String,
  slots: Arc<Semaphore>,
  creating: Mutex<()>,
  created: AtomicU32,
  _container: ContainerAsync<Postgres>,
  _reaper: ChildStdin,
}

/// A database of the test's own on the shared container, dropped (in the background) when this value is.
///
/// Connect with the least-privilege `calendar_app` role the application uses, with `calendar_migrator` (the
/// schema owner) to arrange data or run DDL, or with the bootstrap superuser.
pub struct TestDatabase {
  server: &'static Server,
  name: String,
  permit: Option<OwnedSemaphorePermit>,
}

impl TestDatabase {
  /// A database at the latest migration, cloned from the template the real migrator produced. It holds what
  /// the migrations insert (the legacy owner) and nothing else.
  pub async fn migrated() -> Self {
    Self::create(MIGRATED_TEMPLATE).await
  }

  /// A database with the roles and privileges of `docker/postgres/init/01-roles.sh` and no migration applied,
  /// for tests of the migrator itself.
  pub async fn empty() -> Self {
    Self::create(EMPTY_TEMPLATE).await
  }

  /// The database's name, unique in the container.
  pub fn name(&self) -> &str {
    &self.name
  }

  /// The `calendar_app` password of this test process's container, for tests that assert it never leaks into
  /// a message or that swap it for a wrong one.
  pub fn app_password(&self) -> &'static str {
    app_password()
  }

  /// Npgsql keyword connection string of the least-privilege role the application uses.
  pub fn app_connection_string(&self) -> String {
    self.connection_string("calendar_app", app_password())
  }

  /// Npgsql keyword connection string of the schema owner that runs migrations.
  pub fn migrator_connection_string(&self) -> String {
    self.connection_string("calendar_migrator", migrator_password())
  }

  /// Npgsql keyword connection string of the container's bootstrap superuser.
  pub fn admin_connection_string(&self) -> String {
    self.connection_string(ADMIN_USER, admin_password())
  }

  pub fn app_config(&self) -> ConnectionConfig {
    parse(&self.app_connection_string())
  }

  pub fn migrator_config(&self) -> ConnectionConfig {
    parse(&self.migrator_connection_string())
  }

  pub fn admin_config(&self) -> ConnectionConfig {
    parse(&self.admin_connection_string())
  }

  /// A Diesel connection as `calendar_app`.
  pub async fn app_connection(&self) -> AsyncPgConnection {
    connection::connect(&self.app_config()).await.expect("connects as calendar_app")
  }

  /// A Diesel connection as `calendar_migrator`.
  pub async fn migrator_connection(&self) -> AsyncPgConnection {
    connection::connect(&self.migrator_config())
      .await
      .expect("connects as calendar_migrator")
  }

  /// A pool as `calendar_app`, built the way the application builds its own.
  pub fn app_pool(&self) -> PgPool {
    connection::create_pool(&self.app_config()).expect("the pool builds")
  }

  /// A plain client as `calendar_app`, for SQL text.
  pub async fn app_client(&self) -> tokio_postgres::Client {
    connection::connect_client(&self.app_config())
      .await
      .expect("connects as calendar_app")
  }

  /// A plain client as `calendar_migrator`, for arranging data or running DDL with SQL text.
  pub async fn migrator_client(&self) -> tokio_postgres::Client {
    connection::connect_client(&self.migrator_config())
      .await
      .expect("connects as calendar_migrator")
  }

  /// A plain client as the bootstrap superuser.
  pub async fn admin_client(&self) -> tokio_postgres::Client {
    connection::connect_client(&self.admin_config())
      .await
      .expect("connects as the superuser")
  }

  /// Applies every pending migration with the real migrator, as `calendar_migrator`.
  pub async fn migrate(&self) -> Result<migrations::MigrationReport, migrations::MigrateError> {
    migrations::migrate(self.migrator_connection().await).await
  }

  /// `pg_dump --schema-only` of this database, run inside the container as the superuser.
  ///
  /// # Panics
  /// When the `docker` CLI is missing or `pg_dump` fails.
  pub fn dump_schema(&self) -> String {
    let output = Command::new("docker")
      .args([
        "exec",
        &self.server.container_id,
        "pg_dump",
        "--schema-only",
        "-U",
        ADMIN_USER,
        "-d",
        &self.name,
      ])
      .output()
      .expect("the docker CLI runs");
    assert!(
      output.status.success(),
      "pg_dump failed: {}",
      String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("pg_dump writes UTF-8")
  }

  async fn create(template: &str) -> Self {
    let server = SERVER.get_or_init(Server::start).await;
    let permit = Arc::clone(&server.slots)
      .acquire_owned()
      .await
      .expect("the semaphore is never closed");
    let name = format!("{MIGRATED_DATABASE}_test_{}", server.created.fetch_add(1, Ordering::Relaxed) + 1);

    // One at a time: concurrent copies of one template compete for the same locks for no gain.
    let _creating = server.creating.lock().await;
    let admin = server.maintenance_client().await;
    // CREATE DATABASE cannot share a batch: it refuses to run inside the batch's implicit transaction.
    admin
      .batch_execute(&format!("CREATE DATABASE {name} TEMPLATE {template} OWNER calendar_migrator"))
      .await
      .expect("the template is copied");
    admin
      .batch_execute(&database_acl(&name))
      .await
      .expect("the database access list is set");

    Self {
      server,
      name,
      permit: Some(permit),
    }
  }

  fn connection_string(&self, username: &str, password: &str) -> String {
    self.server.connection_string(&self.name, username, password)
  }
}

impl Drop for TestDatabase {
  /// Drops the database on a thread of its own (a destructor cannot await, and the test's runtime may be
  /// shutting down), then frees its slot. A run that ends first leaves the database to the container's removal.
  fn drop(&mut self) {
    let config = parse(&self.server.connection_string("postgres", ADMIN_USER, admin_password()));
    let name = std::mem::take(&mut self.name);
    let permit = self.permit.take();
    std::thread::spawn(move || {
      if let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
        runtime.block_on(async {
          if let Ok(admin) = connection::connect_client(&config).await {
            // Best effort: a failure only costs disk space in a container that is about to be removed.
            let _ = admin.batch_execute(&format!("DROP DATABASE IF EXISTS {name} WITH (FORCE)")).await;
          }
        });
      }
      drop(permit);
    });
  }
}

impl Server {
  async fn start() -> Self {
    let (_, tag) = crate::repo_files::postgres_image();
    let role_script = crate::repo_files::find("docker/postgres/init/01-roles.sh");
    let container = Postgres::default()
      .with_db_name(MIGRATED_DATABASE)
      .with_user(ADMIN_USER)
      .with_password(admin_password())
      .with_tag(tag)
      .with_env_var("CALENDAR_MIGRATOR_PASSWORD", migrator_password())
      .with_env_var("CALENDAR_APP_PASSWORD", app_password())
      .with_copy_to(
        CopyTargetOptions::new("/docker-entrypoint-initdb.d/01-roles.sh").with_mode(0o755),
        role_script,
      )
      .start()
      .await
      .expect("the PostgreSQL container starts (is Docker running?)");

    let reaper = remove_container_when_this_process_exits(container.id());
    let host = match container.get_host().await.expect("the container has a host").to_string() {
      // The mapped port below is the IPv4 one.
      host if host == "localhost" => "127.0.0.1".to_owned(),
      host => host,
    };
    let port = container.get_host_port_ipv4(5432).await.expect("the PostgreSQL port is mapped");

    let server = Self {
      host,
      port,
      container_id: container.id().to_owned(),
      slots: Arc::new(Semaphore::new(MAX_DATABASES)),
      creating: Mutex::new(()),
      created: AtomicU32::new(0),
      _container: container,
      _reaper: reaper,
    };
    server.prepare_templates().await;
    server
  }

  /// Snapshots the role-initialised database, migrates it with the real migrator, and snapshots it again.
  /// Nobody can connect to a template, because PostgreSQL copies only a database without connections.
  async fn prepare_templates(&self) {
    let admin = self.maintenance_client().await;
    copy_when_idle(&admin, EMPTY_TEMPLATE).await;

    let migrator = parse(&self.connection_string(MIGRATED_DATABASE, "calendar_migrator", migrator_password()));
    let connection = connection::connect(&migrator).await.expect("connects as calendar_migrator");
    migrations::migrate(connection).await.expect("the migrations apply");

    copy_when_idle(&admin, MIGRATED_TEMPLATE).await;
  }

  /// A superuser client on the maintenance database, because PostgreSQL will not copy or drop the database a
  /// session is connected to. Retries while the container finishes starting.
  async fn maintenance_client(&self) -> tokio_postgres::Client {
    let config = parse(&self.connection_string("postgres", ADMIN_USER, admin_password()));
    let mut attempt = 0;
    loop {
      match connection::connect_client(&config).await {
        Ok(client) => return client,
        Err(error) if attempt >= 50 => panic!(
          "the test PostgreSQL does not accept connections: {}",
          connection::error_chain(&error)
        ),
        Err(_) => {
          attempt += 1;
          tokio::time::sleep(Duration::from_millis(200)).await;
        }
      }
    }
  }

  fn connection_string(&self, database: &str, username: &str, password: &str) -> String {
    format!(
      "Host={};Port={};Database={database};Username={username};Password={password}",
      self.host, self.port
    )
  }
}

/// Copies the container's own database into a template. The session that just migrated it may still be
/// closing, so retry while PostgreSQL reports the source as in use.
async fn copy_when_idle(admin: &tokio_postgres::Client, template: &str) {
  let sql = format!("CREATE DATABASE {template} TEMPLATE {MIGRATED_DATABASE} ALLOW_CONNECTIONS false");
  let mut attempt = 0;
  loop {
    match admin.batch_execute(&sql).await {
      Ok(()) => return,
      Err(error) if error.code() == Some(&SqlState::OBJECT_IN_USE) && attempt < 50 => {
        attempt += 1;
        tokio::time::sleep(Duration::from_millis(100)).await;
      }
      Err(error) => panic!("cannot create the template {template}: {error:?}"),
    }
  }
}

/// A copy keeps the schema's grants and default privileges, but not the database's own access list, so repeat
/// the database-level part of `docker/postgres/init/01-roles.sh`.
fn database_acl(name: &str) -> String {
  format!(
    "REVOKE ALL ON DATABASE {name} FROM PUBLIC; \
     GRANT CONNECT ON DATABASE {name} TO CURRENT_USER; \
     GRANT CONNECT ON DATABASE {name} TO calendar_app"
  )
}

/// Rust never runs destructors of statics, and a test process may be killed, so the container cannot remove
/// itself. A child process blocks on a pipe this process holds open; when this process ends for any reason the
/// pipe closes and the child removes the container and its volume. Returns the pipe's write end: keep it alive.
#[expect(
  clippy::zombie_processes,
  reason = "the child must outlive this process: it acts only once this process has exited, so nobody can wait on it"
)]
fn remove_container_when_this_process_exits(container_id: &str) -> ChildStdin {
  let mut child = Command::new("sh")
    .args([
      "-c",
      "trap '' INT TERM HUP; cat >/dev/null; docker rm -fv \"$1\" >/dev/null 2>&1",
      "sh",
      container_id,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .expect("sh runs");
  child.stdin.take().expect("the child's stdin is piped")
}

fn parse(connection_string: &str) -> ConnectionConfig {
  ConnectionConfig::parse(connection_string).expect("the test connection string parses")
}
