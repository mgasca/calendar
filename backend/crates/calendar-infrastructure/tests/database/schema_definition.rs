//! `src/schema.rs` is written by hand, so these tests hold it to the migrated database: the same columns, types
//! that load, generated ranges that read back, and `xmin` as a working optimistic concurrency token.

use std::ops::Bound;

use calendar_infrastructure::schema::{RowVersion, events, session_keys, tasks, users};
use calendar_testing::TestDatabase;
use chrono::{DateTime, NaiveDate, Utc};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use uuid::Uuid;

use crate::repositories::{date, utc};
use crate::support::strings;

/// A PostgreSQL range as Diesel loads it: the lower and the upper bound.
type Range<T> = (Bound<T>, Bound<T>);

/// `events::all_columns`, loaded by position: the field order is the column order of `schema.rs`.
#[derive(Queryable, Debug, PartialEq)]
struct EventRow {
  id: Uuid,
  title: String,
  location: Option<String>,
  notes: Option<String>,
  is_all_day: bool,
  starts_at: Option<DateTime<Utc>>,
  ends_at: Option<DateTime<Utc>>,
  time_zone_id: Option<String>,
  start_date: Option<NaiveDate>,
  end_date: Option<NaiveDate>,
  span: Option<Range<DateTime<Utc>>>,
  date_span: Option<Range<NaiveDate>>,
  owner_id: Uuid,
  version: RowVersion,
}

/// `tasks::all_columns`, loaded by position.
#[derive(Queryable, Debug, PartialEq)]
struct TaskRow {
  id: Uuid,
  title: String,
  due_date: Option<NaiveDate>,
  due_at: Option<DateTime<Utc>>,
  completed_at: Option<DateTime<Utc>>,
  notes: Option<String>,
  priority: String,
  owner_id: Uuid,
  version: RowVersion,
}

/// `users::all_columns`, loaded by position.
#[derive(Queryable, Debug, PartialEq)]
struct UserRow {
  id: Uuid,
  google_subject: Option<String>,
  email: Option<String>,
  display_name: Option<String>,
  picture_url: Option<String>,
  created_at: DateTime<Utc>,
  last_signed_in_at: Option<DateTime<Utc>>,
}

#[tokio::test]
async fn schema_rs_declares_exactly_the_columns_of_each_table() {
  let database = TestDatabase::migrated().await;
  let client = database.migrator_client().await;

  // In the order of `schema.rs`; `xmin` is a system column, which information_schema does not list.
  for (table, declared) in [
    (
      "events",
      "id title location notes is_all_day starts_at ends_at time_zone_id start_date end_date span date_span owner_id",
    ),
    ("tasks", "id title due_date due_at completed_at notes priority owner_id"),
    (
      "users",
      "id google_subject email display_name picture_url created_at last_signed_in_at",
    ),
    ("session_keys", "id key_material created_at"),
  ] {
    let columns = strings(
      &client,
      &format!("SELECT column_name::text FROM information_schema.columns WHERE table_name = '{table}' ORDER BY ordinal_position"),
    )
    .await;

    assert_eq!(columns, declared.split(' ').collect::<Vec<_>>(), "{table}");
  }

  let tables = strings(
    &client,
    "SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_%' ORDER BY 1",
  )
  .await;
  assert_eq!(tables, ["events", "session_keys", "tasks", "users"]);
}

#[tokio::test]
#[expect(clippy::too_many_lines, reason = "one arrangement of rows feeds the assertions for every table")]
async fn every_declared_column_loads_with_its_rust_type() {
  let database = TestDatabase::migrated().await;
  let mut app = database.app_connection().await;
  let owner = Uuid::new_v4();
  let created = utc(2026, 11, 1, 8, 0);
  let (start, end) = (utc(2026, 10, 26, 10, 0), utc(2026, 10, 26, 11, 0));
  let (first_day, day_after) = (date(2026, 10, 26), date(2026, 10, 28));

  diesel::insert_into(users::table)
    .values((
      users::id.eq(owner),
      users::email.eq("ana@example.com"),
      users::created_at.eq(created),
    ))
    .execute(&mut app)
    .await
    .unwrap();
  let timed = Uuid::new_v4();
  diesel::insert_into(events::table)
    .values((
      events::id.eq(timed),
      events::owner_id.eq(owner),
      events::title.eq("timed"),
      events::is_all_day.eq(false),
      events::starts_at.eq(start),
      events::ends_at.eq(end),
      events::time_zone_id.eq("Europe/Lisbon"),
    ))
    .execute(&mut app)
    .await
    .unwrap();
  let all_day = Uuid::new_v4();
  diesel::insert_into(events::table)
    .values((
      events::id.eq(all_day),
      events::owner_id.eq(owner),
      events::title.eq("days"),
      events::location.eq("Lisbon"),
      events::notes.eq("n"),
      events::is_all_day.eq(true),
      events::start_date.eq(first_day),
      events::end_date.eq(day_after),
    ))
    .execute(&mut app)
    .await
    .unwrap();
  let task = Uuid::new_v4();
  diesel::insert_into(tasks::table)
    .values((
      tasks::id.eq(task),
      tasks::owner_id.eq(owner),
      tasks::title.eq("t"),
      tasks::due_at.eq(start),
    ))
    .execute(&mut app)
    .await
    .unwrap();

  let user: UserRow = users::table.find(owner).first(&mut app).await.unwrap();
  assert_eq!(
    user,
    UserRow {
      id: owner,
      google_subject: None,
      email: Some("ana@example.com".to_owned()),
      display_name: None,
      picture_url: None,
      created_at: created,
      last_signed_in_at: None,
    }
  );

  let event: EventRow = events::table.find(timed).select(events::all_columns).first(&mut app).await.unwrap();
  assert_eq!(
    (event.starts_at, event.ends_at, event.time_zone_id.as_deref()),
    (Some(start), Some(end), Some("Europe/Lisbon"))
  );
  assert_eq!(
    event.span,
    Some((Bound::Included(start), Bound::Excluded(end))),
    "span is the half-open instant range"
  );
  assert_eq!(event.date_span, None);
  assert_eq!(event.owner_id, owner);

  let event: EventRow = events::table
    .find(all_day)
    .select(events::all_columns)
    .first(&mut app)
    .await
    .unwrap();
  assert_eq!(
    (event.location.as_deref(), event.notes.as_deref(), event.is_all_day),
    (Some("Lisbon"), Some("n"), true)
  );
  assert_eq!((event.start_date, event.end_date), (Some(first_day), Some(day_after)));
  assert_eq!(event.span, None);
  assert_eq!(
    event.date_span,
    Some((Bound::Included(first_day), Bound::Excluded(day_after))),
    "date_span is the half-open date range"
  );

  let loaded: TaskRow = tasks::table.find(task).select(tasks::all_columns).first(&mut app).await.unwrap();
  assert_eq!(
    loaded,
    TaskRow {
      id: task,
      title: "t".to_owned(),
      due_date: None,
      due_at: Some(start),
      completed_at: None,
      notes: None,
      priority: "medium".to_owned(),
      owner_id: owner,
      version: loaded.version,
    }
  );

  // The range columns filter with the operators the agenda uses.
  let overlapping: Vec<Uuid> = events::table
    .filter(events::span.overlaps_with((Bound::Included(start), Bound::Excluded(end))))
    .select(events::id)
    .load(&mut app)
    .await
    .unwrap();
  assert_eq!(overlapping, [timed]);
  let containing: Vec<Uuid> = events::table
    .filter(events::date_span.assume_not_null().contains(date(2026, 10, 27)))
    .select(events::id)
    .load(&mut app)
    .await
    .unwrap();
  assert_eq!(containing, [all_day]);
}

#[tokio::test]
async fn xmin_is_the_optimistic_concurrency_token() {
  let database = TestDatabase::migrated().await;
  let mut app = database.app_connection().await;
  let owner = Uuid::new_v4();
  diesel::insert_into(users::table)
    .values((users::id.eq(owner), users::created_at.eq(chrono::DateTime::UNIX_EPOCH)))
    .execute(&mut app)
    .await
    .unwrap();
  let task = Uuid::new_v4();
  diesel::insert_into(tasks::table)
    .values((tasks::id.eq(task), tasks::owner_id.eq(owner), tasks::title.eq("first")))
    .execute(&mut app)
    .await
    .unwrap();

  let read: RowVersion = tasks::table.find(task).select(tasks::xmin).first(&mut app).await.unwrap();
  let rename = |title: &'static str, version: RowVersion| {
    diesel::update(tasks::table.find(task).filter(tasks::xmin.eq(version))).set(tasks::title.eq(title))
  };

  // Returning the new version saves a second read, as EF Core did.
  let written: RowVersion = rename("second", read).returning(tasks::xmin).get_result(&mut app).await.unwrap();
  assert_ne!(written, read, "a write changes the version");

  assert_eq!(
    rename("stale", read).execute(&mut app).await.unwrap(),
    0,
    "the version read before the write no longer matches"
  );
  assert_eq!(rename("third", written).execute(&mut app).await.unwrap(), 1);
  let title: String = tasks::table.find(task).select(tasks::title).first(&mut app).await.unwrap();
  assert_eq!(title, "third");

  assert_eq!(
    diesel::delete(tasks::table.find(task).filter(tasks::xmin.eq(read)))
      .execute(&mut app)
      .await
      .unwrap(),
    0
  );
}

#[tokio::test]
async fn session_key_round_trips_through_the_schema() {
  let database = TestDatabase::migrated().await;
  let mut app = database.app_connection().await;
  let key = vec![7u8; 32];

  let inserted = diesel::insert_into(session_keys::table)
    .values(session_keys::key_material.eq(&key))
    .on_conflict(session_keys::id)
    .do_nothing()
    .execute(&mut app)
    .await
    .unwrap();
  let (id, material, _created): (i16, Vec<u8>, DateTime<Utc>) = session_keys::table.first(&mut app).await.unwrap();

  assert_eq!((inserted, id, material), (1, 1, key));
}
