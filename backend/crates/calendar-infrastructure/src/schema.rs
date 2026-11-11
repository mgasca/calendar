//! The database schema as Diesel sees it, written by hand to match `migrations/` (no Diesel CLI is used).
//! `tests/database/schema_definition.rs` compares it with a migrated database, so a migration that forgets this file fails there.
//!
//! Columns the application must never write:
//! - `events.span` and `events.date_span` are `GENERATED ALWAYS ... STORED` ranges. They exist here for
//!   filters (`span.overlaps_with(..)`); never put them in an `Insertable` or `AsChangeset`. PostgreSQL rejects
//!   a write to them. They are nullable, and Diesel implements `contains` only for a non-null range, so write
//!   `date_span.assume_not_null().contains(day)`: a `NULL` range matches nothing either way.
//! - `xmin` is PostgreSQL's system column holding the transaction that last wrote the row. It is the optimistic
//!   concurrency token (as it was with EF Core): select it with the row, and update or delete with
//!   `.filter(xmin.eq(version))`, treating zero affected rows as a conflict. It maps to [`RowVersion`].

/// SQL types Diesel does not ship.
pub mod sql_types {
  /// PostgreSQL's `xid`, the type of the `xmin` system column. Maps to [`RowVersion`](super::RowVersion).
  #[derive(diesel::sql_types::SqlType, diesel::query_builder::QueryId, Debug, Clone, Copy, Default)]
  #[diesel(postgres_type(oid = 28, array_oid = 1011))]
  pub struct Xid;
}

/// The value of a row's `xmin`: the optimistic concurrency token. It changes on every write to the row, so an
/// update or delete filtered by the version the client read affects no row when someone else wrote first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, diesel::expression::AsExpression, diesel::deserialize::FromSqlRow)]
#[diesel(sql_type = sql_types::Xid)]
pub struct RowVersion(pub u32);

impl diesel::deserialize::FromSql<sql_types::Xid, diesel::pg::Pg> for RowVersion {
  fn from_sql(value: diesel::pg::PgValue<'_>) -> diesel::deserialize::Result<Self> {
    let bytes: [u8; 4] = value.as_bytes().try_into().map_err(|_| "an xid is 4 bytes")?;
    Ok(Self(u32::from_be_bytes(bytes)))
  }
}

impl diesel::serialize::ToSql<sql_types::Xid, diesel::pg::Pg> for RowVersion {
  fn to_sql<'b>(&'b self, out: &mut diesel::serialize::Output<'b, '_, diesel::pg::Pg>) -> diesel::serialize::Result {
    std::io::Write::write_all(out, &self.0.to_be_bytes())?;
    Ok(diesel::serialize::IsNull::No)
  }
}

diesel::table! {
  use diesel::sql_types::{Bool, Date, Daterange, Nullable, Timestamptz, Tstzrange, Uuid, Varchar};
  use super::sql_types::Xid;

  events (id) {
    id -> Uuid,
    #[max_length = 200]
    title -> Varchar,
    #[max_length = 200]
    location -> Nullable<Varchar>,
    #[max_length = 4000]
    notes -> Nullable<Varchar>,
    is_all_day -> Bool,
    starts_at -> Nullable<Timestamptz>,
    ends_at -> Nullable<Timestamptz>,
    #[max_length = 64]
    time_zone_id -> Nullable<Varchar>,
    start_date -> Nullable<Date>,
    end_date -> Nullable<Date>,
    /// Generated: `[starts_at, ends_at)` of a timed event, `NULL` for an all-day one. Never written.
    span -> Nullable<Tstzrange>,
    /// Generated: `[start_date, end_date)` of an all-day event, `NULL` for a timed one. Never written.
    date_span -> Nullable<Daterange>,
    owner_id -> Uuid,
    /// System column: the row version for optimistic concurrency. Never written.
    xmin -> Xid,
  }
}

diesel::table! {
  use diesel::sql_types::{Date, Nullable, Timestamptz, Uuid, Varchar};
  use super::sql_types::Xid;

  tasks (id) {
    id -> Uuid,
    #[max_length = 200]
    title -> Varchar,
    due_date -> Nullable<Date>,
    due_at -> Nullable<Timestamptz>,
    completed_at -> Nullable<Timestamptz>,
    #[max_length = 4000]
    notes -> Nullable<Varchar>,
    #[max_length = 6]
    priority -> Varchar,
    owner_id -> Uuid,
    /// System column: the row version for optimistic concurrency. Never written.
    xmin -> Xid,
  }
}

diesel::table! {
  users (id) {
    id -> Uuid,
    #[max_length = 255]
    google_subject -> Nullable<Varchar>,
    #[max_length = 320]
    email -> Nullable<Varchar>,
    #[max_length = 200]
    display_name -> Nullable<Varchar>,
    #[max_length = 2048]
    picture_url -> Nullable<Varchar>,
    created_at -> Timestamptz,
    last_signed_in_at -> Nullable<Timestamptz>,
  }
}

diesel::table! {
  /// The key that seals session cookies: at most one row, whose `id` is always 1. Insert it with
  /// `ON CONFLICT (id) DO NOTHING` and read back the row that exists; `calendar_app` may only select and insert.
  session_keys (id) {
    id -> Int2,
    /// Exactly 32 bytes.
    key_material -> Bytea,
    created_at -> Timestamptz,
  }
}

diesel::joinable!(events -> users (owner_id));
diesel::joinable!(tasks -> users (owner_id));

diesel::allow_tables_to_appear_in_same_query!(events, tasks, users, session_keys);
