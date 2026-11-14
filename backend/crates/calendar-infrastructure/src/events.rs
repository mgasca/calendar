//! The event repository: every read and write the event endpoints perform, each scoped to an owner
//! (ADR-0041), with `xmin` optimistic concurrency (ADR-0052). The generated `span` and `date_span` columns are
//! the database's and appear in no insert or update here.

#![allow(clippy::ref_option_ref, reason = "the AsChangeset derive borrows the Option<&str> fields")]

use calendar_domain::events::{CalendarEvent, CalendarEventRecord, EventSchedule};
use chrono::{DateTime, NaiveDate, Utc};
use diesel::pg::Pg;
use diesel::prelude::*;
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use uuid::Uuid;

use crate::error::Error;
use crate::ownership::{OwnerId, RowVersion, Versioned};
use crate::queries::owned_events;
use crate::schema::events;

#[derive(Queryable, Selectable)]
#[diesel(table_name = events, check_for_backend(Pg))]
struct EventRow {
  id: Uuid,
  owner_id: Uuid,
  title: String,
  location: Option<String>,
  notes: Option<String>,
  is_all_day: bool,
  starts_at: Option<DateTime<Utc>>,
  ends_at: Option<DateTime<Utc>>,
  time_zone_id: Option<String>,
  start_date: Option<NaiveDate>,
  end_date: Option<NaiveDate>,
  xmin: RowVersion,
}

/// A stored event row that lacks a column its kind needs.
const fn missing(reason: &'static str) -> Error {
  Error::InvalidRow { entity: "event", reason }
}

impl EventRow {
  /// Rebuilds the event from the row. The schedule takes the columns of the row's kind (timed or all-day) and
  /// ignores the other kind's; one that is missing is an [`Error::InvalidRow`] naming it. Nothing is validated:
  /// stored rows are trusted.
  fn into_versioned(self) -> Result<Versioned<CalendarEvent>, Error> {
    let schedule = if self.is_all_day {
      EventSchedule::AllDay {
        start_date: self.start_date.ok_or(missing("an all-day event has no start_date"))?,
        end_date: self.end_date.ok_or(missing("an all-day event has no end_date"))?,
      }
    } else {
      EventSchedule::Timed {
        start: self.starts_at.ok_or(missing("a timed event has no starts_at"))?,
        end: self.ends_at.ok_or(missing("a timed event has no ends_at"))?,
        time_zone_id: self.time_zone_id.ok_or(missing("a timed event has no time_zone_id"))?,
      }
    };
    Ok(Versioned {
      entity: CalendarEvent::restore(CalendarEventRecord {
        id: self.id,
        owner_id: self.owner_id,
        title: self.title,
        location: self.location,
        notes: self.notes,
        schedule,
      }),
      version: self.xmin,
    })
  }
}

/// The columns an insert writes: not `span`, `date_span` (generated) or `xmin` (system).
#[derive(Insertable)]
#[diesel(table_name = events)]
struct NewEvent<'a> {
  id: Uuid,
  owner_id: Uuid,
  #[diesel(embed)]
  fields: EventFields<'a>,
}

/// The columns an update may change: never the id, the owner, the generated ranges or `xmin`. Every column
/// is written, so switching between timed and all-day clears the other kind's columns.
#[derive(Insertable, AsChangeset)]
#[diesel(table_name = events, treat_none_as_null = true)]
struct EventFields<'a> {
  title: &'a str,
  location: Option<&'a str>,
  notes: Option<&'a str>,
  is_all_day: bool,
  starts_at: Option<DateTime<Utc>>,
  ends_at: Option<DateTime<Utc>>,
  time_zone_id: Option<&'a str>,
  start_date: Option<NaiveDate>,
  end_date: Option<NaiveDate>,
}

impl<'a> EventFields<'a> {
  fn of(event: &'a CalendarEvent) -> Self {
    Self {
      title: event.title(),
      location: event.location(),
      notes: event.notes(),
      is_all_day: event.is_all_day(),
      starts_at: event.start(),
      ends_at: event.end(),
      time_zone_id: event.time_zone_id(),
      start_date: event.start_date(),
      end_date: event.end_date(),
    }
  }
}

/// Inserts `event` for `owner` and returns the new row's version. An event of another owner is refused with
/// [`Error::OwnerMismatch`] before anything is sent.
pub async fn insert(conn: &mut AsyncPgConnection, owner: OwnerId, event: &CalendarEvent) -> Result<RowVersion, Error> {
  if event.owner_id() != owner.0 {
    return Err(Error::OwnerMismatch);
  }

  let version = diesel::insert_into(events::table)
    .values(NewEvent {
      id: event.id(),
      owner_id: owner.0,
      fields: EventFields::of(event),
    })
    .returning(events::xmin)
    .get_result(conn)
    .await?;
  Ok(version)
}

/// The owner's event `id` with its version, or `None`.
pub async fn find(conn: &mut AsyncPgConnection, owner: OwnerId, id: Uuid) -> Result<Option<Versioned<CalendarEvent>>, Error> {
  owned_events(owner)
    .filter(events::id.eq(id))
    .select(EventRow::as_select())
    .first::<EventRow>(conn)
    .await
    .optional()?
    .map(EventRow::into_versioned)
    .transpose()
}

/// Saves `changed`, the entity of `loaded` after a domain change, provided the row still has `expected` (the
/// version the client read). Returns the row's version afterwards.
///
/// As with EF Core's change tracking, nothing is written when `changed` equals `loaded.entity`: the result is
/// then `loaded.version`, and `expected` is not checked. When the write matches no row: [`Error::Conflict`]
/// if the owner still has the event, [`Error::NotFound`] if not.
pub async fn update(
  conn: &mut AsyncPgConnection,
  owner: OwnerId,
  loaded: &Versioned<CalendarEvent>,
  changed: &CalendarEvent,
  expected: RowVersion,
) -> Result<RowVersion, Error> {
  if changed.owner_id() != owner.0 || changed.id() != loaded.entity.id() {
    return Err(Error::OwnerMismatch);
  }
  if *changed == loaded.entity {
    return Ok(loaded.version);
  }

  let written = diesel::update(
    events::table
      .filter(events::owner_id.eq(owner.0))
      .filter(events::id.eq(changed.id()))
      .filter(events::xmin.eq(expected)),
  )
  .set(EventFields::of(changed))
  .returning(events::xmin)
  .get_result(conn)
  .await
  .optional()?;
  match written {
    Some(version) => Ok(version),
    None => Err(conflict_or_not_found(conn, owner, changed.id()).await?),
  }
}

/// Deletes the owner's event `id`, provided the row still has `expected` (the version it was loaded with:
/// the endpoint deletes whatever changed since the client read it, so only a write between its own read and
/// delete conflicts). [`Error::Conflict`] when the event exists with another version, [`Error::NotFound`]
/// when the owner has no such event.
pub async fn delete(conn: &mut AsyncPgConnection, owner: OwnerId, id: Uuid, expected: RowVersion) -> Result<(), Error> {
  let deleted = diesel::delete(
    events::table
      .filter(events::owner_id.eq(owner.0))
      .filter(events::id.eq(id))
      .filter(events::xmin.eq(expected)),
  )
  .execute(conn)
  .await?;
  if deleted > 0 {
    Ok(())
  } else {
    Err(conflict_or_not_found(conn, owner, id).await?)
  }
}

/// After a write that matched no row: the error that says why.
async fn conflict_or_not_found(conn: &mut AsyncPgConnection, owner: OwnerId, id: Uuid) -> Result<Error, Error> {
  let exists: i64 = owned_events(owner).filter(events::id.eq(id)).count().get_result(conn).await?;
  Ok(if exists > 0 { Error::Conflict } else { Error::NotFound })
}

#[cfg(test)]
mod tests {
  use chrono::TimeZone;

  use super::*;

  const NEW_YORK: &str = "America/New_York";

  fn nine() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 5, 9, 0, 0).unwrap()
  }

  fn ten() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 5, 10, 0, 0).unwrap()
  }

  fn day(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, day).unwrap()
  }

  /// A row of the given kind with the columns of both kinds set; each case clears the ones it needs to.
  fn row(is_all_day: bool) -> EventRow {
    EventRow {
      id: Uuid::from_u128(1),
      owner_id: Uuid::from_u128(2),
      title: "E".to_owned(),
      location: None,
      notes: None,
      is_all_day,
      starts_at: Some(nine()),
      ends_at: Some(ten()),
      time_zone_id: Some(NEW_YORK.to_owned()),
      start_date: Some(day(26)),
      end_date: Some(day(27)),
      xmin: RowVersion(7),
    }
  }

  fn schedule(row: EventRow) -> Result<EventSchedule, &'static str> {
    match row.into_versioned() {
      Ok(versioned) => Ok(versioned.entity.into_record().schedule),
      Err(Error::InvalidRow { entity: "event", reason }) => Err(reason),
      Err(other) => panic!("unexpected error: {other}"),
    }
  }

  #[test]
  fn a_row_rebuilds_the_schedule_from_the_columns_of_its_kind() {
    let timed = EventRow {
      start_date: None,
      end_date: None,
      ..row(false)
    };
    assert_eq!(
      schedule(timed),
      Ok(EventSchedule::Timed {
        start: nine(),
        end: ten(),
        time_zone_id: NEW_YORK.to_owned()
      })
    );

    let all_day = EventRow {
      starts_at: None,
      ends_at: None,
      time_zone_id: None,
      ..row(true)
    };
    assert_eq!(
      schedule(all_day),
      Ok(EventSchedule::AllDay {
        start_date: day(26),
        end_date: day(27)
      })
    );
  }

  #[test]
  fn a_row_without_a_column_of_its_kind_is_invalid_and_names_it() {
    assert_eq!(
      schedule(EventRow {
        time_zone_id: None,
        ..row(false)
      }),
      Err("a timed event has no time_zone_id")
    );
    assert_eq!(
      schedule(EventRow {
        starts_at: None,
        ..row(false)
      }),
      Err("a timed event has no starts_at")
    );
    assert_eq!(
      schedule(EventRow {
        ends_at: None,
        ..row(false)
      }),
      Err("a timed event has no ends_at")
    );
    assert_eq!(
      schedule(EventRow {
        start_date: None,
        ..row(true)
      }),
      Err("an all-day event has no start_date")
    );
    assert_eq!(
      schedule(EventRow {
        end_date: None,
        ..row(true)
      }),
      Err("an all-day event has no end_date")
    );
  }
}
