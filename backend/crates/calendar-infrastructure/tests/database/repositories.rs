//! What the repository tests share: a migrated database with the two users the .NET `ApiTestBase` seeded, an
//! application-role connection, and a recorder of the SQL a connection sends.

use std::sync::{Arc, Mutex};

use calendar_domain::events::CalendarEvent;
use calendar_domain::tasks::TodoTask;
use calendar_infrastructure::{OwnerId, events, tasks};
use calendar_testing::TestDatabase;
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use diesel::connection::{Instrumentation, InstrumentationEvent};
use diesel_async::{AsyncConnection, AsyncPgConnection};
use uuid::{Uuid, uuid};

pub const USER_A: OwnerId = OwnerId(uuid!("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
pub const USER_B: OwnerId = OwnerId(uuid!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
pub const USER_A_EMAIL: &str = "a@example.com";
pub const USER_B_EMAIL: &str = "b@example.com";

/// The owner of rows the tests arrange: user A, as in .NET.
pub const OWNER: OwnerId = USER_A;

/// A migrated database holding users A and B (and the legacy placeholder the migration inserts), with a
/// connection as `calendar_app`.
pub struct Fixture {
  pub database: TestDatabase,
  pub conn: AsyncPgConnection,
}

pub async fn fixture() -> Fixture {
  let database = TestDatabase::migrated().await;
  database
    .migrator_client()
    .await
    .execute(
      "INSERT INTO users (id, email, created_at) VALUES ($1, $2, now()), ($3, $4, now())",
      &[&USER_A.0, &USER_A_EMAIL, &USER_B.0, &USER_B_EMAIL],
    )
    .await
    .unwrap();
  let conn = database.app_connection().await;
  Fixture { database, conn }
}

pub fn date(year: i32, month: u32, day: u32) -> NaiveDate {
  NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

pub fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
  Utc.with_ymd_and_hms(year, month, day, hour, minute, 0).unwrap()
}

/// A task of [`OWNER`] with the default priority and no notes, completed at `completed_at` when given.
pub fn task(title: &str, due_date: Option<NaiveDate>, due_at: Option<DateTime<Utc>>, completed_at: Option<DateTime<Utc>>) -> TodoTask {
  task_of(OWNER, title, due_date, due_at, completed_at)
}

pub fn task_of(
  owner: OwnerId,
  title: &str,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
  completed_at: Option<DateTime<Utc>>,
) -> TodoTask {
  let mut task = TodoTask::create(owner.0, title, due_date, due_at, "medium", None).unwrap();
  if let Some(at) = completed_at {
    task.complete(at);
  }
  task
}

pub fn timed_event(owner: OwnerId, title: &str, start: DateTime<Utc>, end: DateTime<Utc>, zone: &str) -> CalendarEvent {
  CalendarEvent::create(owner.0, title, start, end, zone, None, None).unwrap()
}

pub fn all_day_event(owner: OwnerId, title: &str, start_date: NaiveDate, end_date: NaiveDate) -> CalendarEvent {
  CalendarEvent::create_all_day(owner.0, title, start_date, end_date, None, None).unwrap()
}

/// Inserts each row through the repository, as its own owner (`SeedAsync` in .NET).
pub async fn seed(conn: &mut AsyncPgConnection, new_events: &[CalendarEvent], new_tasks: &[TodoTask]) {
  for event in new_events {
    events::insert(conn, OwnerId(event.owner_id()), event).await.unwrap();
  }
  for task in new_tasks {
    tasks::insert(conn, OwnerId(task.owner_id()), task).await.unwrap();
  }
}

pub fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
  ids.sort_unstable();
  ids
}

/// The statements a connection sent, in order, as Diesel renders them (SQL and binds).
#[derive(Clone, Default)]
pub struct SqlLog(Arc<Mutex<Vec<String>>>);

impl SqlLog {
  /// Starts recording what `conn` sends.
  pub fn record(conn: &mut AsyncPgConnection) -> Self {
    let log = Self::default();
    conn.set_instrumentation(log.clone());
    log
  }

  pub fn statements(&self) -> Vec<String> {
    self.0.lock().unwrap().clone()
  }
}

impl Instrumentation for SqlLog {
  fn on_connection_event(&mut self, event: InstrumentationEvent<'_>) {
    let entry = match event {
      InstrumentationEvent::StartQuery { query, .. } => query.to_string(),
      InstrumentationEvent::BeginTransaction { .. } => "<begin>".to_owned(),
      InstrumentationEvent::CommitTransaction { .. } => "<commit>".to_owned(),
      InstrumentationEvent::RollbackTransaction { .. } => "<rollback>".to_owned(),
      _ => return,
    };
    self.0.lock().unwrap().push(entry);
  }
}
