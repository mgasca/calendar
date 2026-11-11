//! The event repository against a real database: round trips, optimistic concurrency by `xmin`, and what a
//! write that matches no row means.

use calendar_infrastructure::{Error, OwnerId, RowVersion, events};
use uuid::Uuid;

use crate::repositories::{OWNER, SqlLog, USER_B, all_day_event, date, fixture, timed_event, utc};
use crate::support::scalar;

#[tokio::test]
async fn a_timed_event_round_trips_with_its_version() {
  let mut f = fixture().await;
  let event = calendar_domain::events::CalendarEvent::create(
    OWNER.0,
    " Standup ",
    utc(2026, 10, 26, 9, 0),
    utc(2026, 10, 26, 9, 30),
    "Europe/Berlin",
    Some("Room 1"),
    Some("Bring notes"),
  )
  .unwrap();

  let version = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let found = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();

  assert_eq!(found.entity, event);
  assert_eq!(found.version, version);
  assert_eq!(found.entity.title(), "Standup");
  assert_eq!(found.entity.time_zone_id(), Some("Europe/Berlin"));
  // The database derived the range the overlap queries use; the application never wrote it.
  let client = f.database.migrator_client().await;
  assert_eq!(
    scalar(&client, "SELECT (span IS NOT NULL AND date_span IS NULL)::text FROM events").await,
    "true"
  );
}

#[tokio::test]
async fn an_all_day_event_round_trips_with_its_version() {
  let mut f = fixture().await;
  let event = all_day_event(OWNER, "Holiday", date(2026, 10, 26), date(2026, 10, 29));

  let version = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let found = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();

  assert_eq!(found.entity, event);
  assert_eq!(found.version, version);
  assert!(found.entity.is_all_day());
  let client = f.database.migrator_client().await;
  assert_eq!(
    scalar(
      &client,
      "SELECT (span IS NULL AND date_span = '[2026-10-26,2026-10-29)')::text FROM events"
    )
    .await,
    "true"
  );
}

#[tokio::test]
async fn writes_never_name_the_generated_columns_or_the_version() {
  let mut f = fixture().await;
  let mut event = timed_event(OWNER, "Standup", utc(2026, 10, 26, 9, 0), utc(2026, 10, 26, 10, 0), "UTC");
  let log = SqlLog::record(&mut f.conn);

  let version = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let loaded = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  event
    .update_all_day("Offsite", date(2026, 10, 26), date(2026, 10, 27), None, None)
    .unwrap();
  events::update(&mut f.conn, OWNER, &loaded, &event, version).await.unwrap();

  let statements = log.statements();
  let insert = statements.iter().find(|sql| sql.starts_with("INSERT")).expect("an insert");
  let update = statements.iter().find(|sql| sql.starts_with("UPDATE")).expect("an update");
  for (statement, written) in [
    (insert, insert.split("RETURNING").next().unwrap()),
    (update, update.split("WHERE").next().unwrap()),
  ] {
    assert!(!written.contains("\"span\""), "{statement}");
    assert!(!written.contains("\"date_span\""), "{statement}");
    assert!(!written.contains("\"xmin\""), "{statement}");
  }
  // The update is guarded by owner, id and version, and never moves a row to another owner.
  let guard = update.split("WHERE").nth(1).unwrap();
  assert!(
    guard.contains("\"owner_id\"") && guard.contains("\"id\"") && guard.contains("\"xmin\""),
    "{update}"
  );
  assert!(!update.split("WHERE").next().unwrap().contains("\"owner_id\""), "{update}");
}

#[tokio::test]
async fn update_replaces_every_field_and_returns_a_new_version() {
  let mut f = fixture().await;
  let mut event = timed_event(OWNER, "Standup", utc(2026, 10, 26, 9, 0), utc(2026, 10, 26, 9, 30), "Europe/Berlin");
  let created = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let loaded = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();

  event
    .update(
      "Retro",
      utc(2026, 10, 27, 14, 0),
      utc(2026, 10, 27, 15, 0),
      "America/New_York",
      Some("Room 2"),
      Some("Notes"),
    )
    .unwrap();
  let updated = events::update(&mut f.conn, OWNER, &loaded, &event, created).await.unwrap();

  assert_ne!(updated, created);
  let found = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  assert_eq!(found.entity, event);
  assert_eq!(found.version, updated);
}

#[tokio::test]
async fn update_can_switch_a_timed_event_to_all_day_and_back() {
  let mut f = fixture().await;
  let mut event = timed_event(OWNER, "Dentist", utc(2026, 10, 26, 9, 0), utc(2026, 10, 26, 10, 0), "UTC");
  let created = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let loaded = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();

  event
    .update_all_day("Dentist", date(2026, 10, 26), date(2026, 10, 27), None, None)
    .unwrap();
  let all_day = events::update(&mut f.conn, OWNER, &loaded, &event, created).await.unwrap();
  let found = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  assert_eq!(found.entity, event);
  assert_eq!(
    (found.entity.start(), found.entity.end(), found.entity.time_zone_id()),
    (None, None, None)
  );

  event
    .update("Dentist", utc(2026, 10, 26, 9, 0), utc(2026, 10, 26, 10, 0), "UTC", None, None)
    .unwrap();
  events::update(&mut f.conn, OWNER, &found, &event, all_day).await.unwrap();
  let found = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  assert_eq!(found.entity, event);
  assert_eq!((found.entity.start_date(), found.entity.end_date()), (None, None));
}

#[tokio::test]
async fn update_with_a_stale_version_conflicts_and_leaves_the_event_unchanged() {
  let mut f = fixture().await;
  let mut event = all_day_event(OWNER, "Dentist", date(2026, 10, 26), date(2026, 10, 27));
  let created = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let loaded = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  event
    .update_all_day("Changed elsewhere", date(2026, 10, 26), date(2026, 10, 27), None, None)
    .unwrap();
  events::update(&mut f.conn, OWNER, &loaded, &event, created).await.unwrap();
  let latest = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();

  let mut stale = latest.entity.clone();
  stale
    .update_all_day("Stale write", date(2026, 10, 27), date(2026, 10, 28), None, None)
    .unwrap();
  let result = events::update(&mut f.conn, OWNER, &latest, &stale, created).await;

  assert!(matches!(result, Err(Error::Conflict)), "{result:?}");
  assert_eq!(events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap(), latest);
}

/// Observed on the .NET API: EF Core's change tracking sends no UPDATE for an entity that did not change, so
/// the version is neither checked nor advanced.
#[tokio::test]
async fn an_update_that_changes_nothing_writes_nothing_whatever_the_version() {
  let mut f = fixture().await;
  let event = all_day_event(OWNER, "Dentist", date(2026, 10, 26), date(2026, 10, 27));
  let created = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let loaded = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  let log = SqlLog::record(&mut f.conn);

  let same = events::update(&mut f.conn, OWNER, &loaded, &event, created).await.unwrap();
  let stale = events::update(&mut f.conn, OWNER, &loaded, &event, RowVersion(created.0.wrapping_add(5)))
    .await
    .unwrap();

  assert_eq!((same, stale), (created, created));
  assert_eq!(log.statements(), Vec::<String>::new());
}

#[tokio::test]
async fn update_of_an_event_that_is_gone_is_not_found() {
  let mut f = fixture().await;
  let mut event = all_day_event(OWNER, "Dentist", date(2026, 10, 26), date(2026, 10, 27));
  let created = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let loaded = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  events::delete(&mut f.conn, OWNER, event.id(), created).await.unwrap();

  event
    .update_all_day("Too late", date(2026, 10, 26), date(2026, 10, 27), None, None)
    .unwrap();
  let result = events::update(&mut f.conn, OWNER, &loaded, &event, created).await;

  assert!(matches!(result, Err(Error::NotFound)), "{result:?}");
}

#[tokio::test]
async fn delete_removes_the_event_and_tells_gone_from_changed() {
  let mut f = fixture().await;
  let mut event = all_day_event(OWNER, "Dentist", date(2026, 10, 26), date(2026, 10, 27));
  let created = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let loaded = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();
  event
    .update_all_day("Changed", date(2026, 10, 26), date(2026, 10, 27), None, None)
    .unwrap();
  let latest = events::update(&mut f.conn, OWNER, &loaded, &event, created).await.unwrap();

  // Only a write between the read and the delete gets here: the row exists with another version.
  let stale = events::delete(&mut f.conn, OWNER, event.id(), created).await;
  assert!(matches!(stale, Err(Error::Conflict)), "{stale:?}");
  assert!(events::find(&mut f.conn, OWNER, event.id()).await.unwrap().is_some());

  events::delete(&mut f.conn, OWNER, event.id(), latest).await.unwrap();
  assert!(events::find(&mut f.conn, OWNER, event.id()).await.unwrap().is_none());

  let gone = events::delete(&mut f.conn, OWNER, event.id(), latest).await;
  assert!(matches!(gone, Err(Error::NotFound)), "{gone:?}");
  let unknown = events::delete(&mut f.conn, OWNER, Uuid::new_v4(), latest).await;
  assert!(matches!(unknown, Err(Error::NotFound)), "{unknown:?}");
}

#[tokio::test]
async fn find_of_an_unknown_event_is_none() {
  let mut f = fixture().await;
  assert!(events::find(&mut f.conn, OWNER, Uuid::new_v4()).await.unwrap().is_none());
}

/// Ports the data half of `OwnershipTests.AnotherUsersEvent_*`: to anyone else an event does not exist.
#[tokio::test]
async fn another_users_event_is_not_found_for_read_update_and_delete_and_stays_unchanged() {
  let mut f = fixture().await;
  let event = all_day_event(OWNER, "Mine", date(2026, 10, 26), date(2026, 10, 27));
  let version = events::insert(&mut f.conn, OWNER, &event).await.unwrap();
  let mine = events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap();

  assert!(events::find(&mut f.conn, USER_B, event.id()).await.unwrap().is_none());

  // Even holding the row and its current version, another owner's update and delete match nothing.
  let mut theirs = mine.entity.clone();
  theirs
    .update_all_day("Taken over", date(2026, 10, 26), date(2026, 10, 27), None, None)
    .unwrap();
  let update = events::update(&mut f.conn, USER_B, &mine, &theirs, version).await;
  assert!(matches!(update, Err(Error::OwnerMismatch)), "{update:?}");
  let delete = events::delete(&mut f.conn, USER_B, event.id(), version).await;
  assert!(matches!(delete, Err(Error::NotFound)), "{delete:?}");

  assert_eq!(events::find(&mut f.conn, OWNER, event.id()).await.unwrap().unwrap(), mine);
}

#[tokio::test]
async fn an_event_can_only_be_inserted_for_its_own_owner() {
  let mut f = fixture().await;
  let theirs = all_day_event(USER_B, "Theirs", date(2026, 10, 26), date(2026, 10, 27));

  let result = events::insert(&mut f.conn, OWNER, &theirs).await;

  assert!(matches!(result, Err(Error::OwnerMismatch)), "{result:?}");
  let client = f.database.migrator_client().await;
  assert_eq!(scalar(&client, "SELECT count(*)::text FROM events").await, "0");
  // The message is the .NET context's.
  assert_eq!(Error::OwnerMismatch.to_string(), "A row can only be added for the signed-in user.");
  let _ = OwnerId(theirs.owner_id());
}
