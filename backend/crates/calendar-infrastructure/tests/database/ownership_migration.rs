//! Ports `OwnershipMigrationTests`: the ownership migration (ADR-0041) on a database with rows from before it.
//! Every row ends up owned by the legacy placeholder, which exists unclaimed, and the backfill default stays.
//! The .NET test migrated its database down and back up; this one stops a fresh database before the migration.

use calendar_infrastructure::migrations;
use calendar_testing::TestDatabase;

use crate::support::strings;

const BEFORE_OWNERSHIP: &str = "20261029140850"; // DataProtectionKeys
const LEGACY_OWNER_ID: &str = "11111111-1111-1111-1111-111111111111";

#[tokio::test]
async fn pre_existing_rows_are_backfilled_to_the_unclaimed_legacy_owner() {
  let database = TestDatabase::empty().await;
  let report = migrations::migrate_to(database.migrator_connection().await, BEFORE_OWNERSHIP)
    .await
    .unwrap();
  assert_eq!(
    report.applied.last().map(String::as_str),
    Some("2026-10-29-140850_data_protection_keys")
  );
  let client = database.migrator_client().await;
  client
    .batch_execute(
      "INSERT INTO events (id, title, is_all_day, start_date, end_date) \
       VALUES (gen_random_uuid(), 'old event', true, '2026-10-26', '2026-10-27')",
    )
    .await
    .unwrap();
  client
    .batch_execute("INSERT INTO tasks (id, title) VALUES (gen_random_uuid(), 'old task')")
    .await
    .unwrap();

  let report = database.migrate().await.unwrap();
  assert_eq!(
    report.applied.first().map(String::as_str),
    Some("2026-11-02-232144_per_user_ownership")
  );

  assert_eq!(strings(&client, "SELECT owner_id::text FROM events").await, [LEGACY_OWNER_ID]);
  assert_eq!(strings(&client, "SELECT owner_id::text FROM tasks").await, [LEGACY_OWNER_ID]);

  // The placeholder is unclaimed: no Google subject and no email.
  let placeholder = client
    .query_one(
      "SELECT google_subject IS NULL AND email IS NULL FROM users WHERE id = $1::text::uuid",
      &[&LEGACY_OWNER_ID],
    )
    .await
    .unwrap();
  assert!(placeholder.get::<_, bool>(0));

  // The backfill default stays, so a row the previous revision creates during the rollout lands on the
  // legacy owner too (the app itself always names the owner).
  client
    .batch_execute("INSERT INTO tasks (id, title) VALUES (gen_random_uuid(), 'rollout window')")
    .await
    .unwrap();
  assert_eq!(
    strings(&client, "SELECT owner_id::text FROM tasks WHERE title = 'rollout window'").await,
    [LEGACY_OWNER_ID]
  );
}
