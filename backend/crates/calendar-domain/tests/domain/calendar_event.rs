//! Port of `Calendar.Domain.Tests/Events/CalendarEventTests.cs`.
//!
//! Instants are `DateTime<Utc>` in the domain, so the C# "offset is zero" assertions hold by type; inputs the C#
//! suite gives with another offset are converted the way a caller would.

use calendar_domain::error::ArgumentError;
use calendar_domain::events::{CalendarEvent, CalendarEventRecord, EventSchedule};
use chrono::{DateTime, FixedOffset, NaiveDate, TimeDelta, TimeZone, Utc};
use uuid::Uuid;

const NEW_YORK: &str = "America/New_York";

fn owner() -> Uuid {
  Uuid::from_u128(0x0a0b_0c0d_0e0f_4a1b_8c2d_3e4f_5a6b_7c8d)
}

fn nine() -> DateTime<Utc> {
  Utc.with_ymd_and_hms(2026, 1, 5, 9, 0, 0).unwrap()
}

fn day() -> NaiveDate {
  NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
}

fn day_plus(days: i64) -> NaiveDate {
  day() + TimeDelta::days(days)
}

fn minutes(count: i64) -> TimeDelta {
  TimeDelta::minutes(count)
}

fn hours(count: i64) -> TimeDelta {
  TimeDelta::hours(count)
}

fn timed(title: &str, start: DateTime<Utc>, end: DateTime<Utc>, zone: &str) -> Result<CalendarEvent, ArgumentError> {
  CalendarEvent::create(owner(), title, start, end, zone, None, None)
}

fn all_day(title: &str, start_date: NaiveDate, end_date: NaiveDate) -> Result<CalendarEvent, ArgumentError> {
  CalendarEvent::create_all_day(owner(), title, start_date, end_date, None, None)
}

#[test]
fn create_with_valid_range_sets_properties() {
  let event = timed("  Standup ", nine(), nine() + minutes(15), NEW_YORK).unwrap();

  assert_eq!(event.title(), "Standup");
  assert_eq!(event.duration(), Some(minutes(15)));
  assert!(!event.id().is_nil());
  assert!(!event.is_all_day());
  assert_eq!(event.time_zone_id(), Some(NEW_YORK));
  assert_eq!(event.start_date(), None);
  assert_eq!(event.end_date(), None);
}

#[test]
fn create_sets_the_owner_and_rejects_an_empty_one() {
  assert_eq!(timed("A", nine(), nine() + hours(1), NEW_YORK).unwrap().owner_id(), owner());
  assert_eq!(all_day("A", day(), day_plus(1)).unwrap().owner_id(), owner());

  assert_eq!(
    CalendarEvent::create(Uuid::nil(), "A", nine(), nine() + hours(1), NEW_YORK, None, None).unwrap_err(),
    ArgumentError::new("ownerId", "An event needs an owner.")
  );
  assert_eq!(
    CalendarEvent::create_all_day(Uuid::nil(), "A", day(), day_plus(1), None, None).unwrap_err(),
    ArgumentError::new("ownerId", "An event needs an owner.")
  );
}

#[test]
fn create_normalizes_instants_to_utc() {
  let start = FixedOffset::west_opt(5 * 3600)
    .unwrap()
    .with_ymd_and_hms(2026, 1, 5, 4, 0, 0)
    .unwrap();

  let event = timed("A", start.with_timezone(&Utc), (start + hours(1)).with_timezone(&Utc), NEW_YORK).unwrap();

  assert_eq!(event.start(), Some(nine()));
  assert_eq!(event.end(), Some(nine() + hours(1)));
}

#[test]
fn create_trims_optional_text_and_turns_blank_into_none() {
  let event = CalendarEvent::create(owner(), "A", nine(), nine() + hours(1), NEW_YORK, Some(" Room 4 "), Some("   ")).unwrap();

  assert_eq!(event.location(), Some("Room 4"));
  assert_eq!(event.notes(), None);
}

#[test]
fn create_when_end_not_after_start_fails() {
  for offset_minutes in [0, -30] {
    assert_eq!(
      timed("Bad", nine(), nine() + minutes(offset_minutes), NEW_YORK).unwrap_err(),
      ArgumentError::new("end", "Event end must be after its start.")
    );
  }
}

#[test]
fn create_with_blank_title_fails() {
  for title in ["", "   "] {
    assert_eq!(
      timed(title, nine(), nine() + hours(1), NEW_YORK).unwrap_err(),
      ArgumentError::new("title", "Title is required.")
    );
  }
}

#[test]
fn create_title_length_is_capped_at_two_hundred_after_trim() {
  let padded = format!("{}  ", "a".repeat(200));
  assert_eq!(timed(&padded, nine(), nine() + hours(1), NEW_YORK).unwrap().title().len(), 200);
  assert_eq!(
    timed(&"a".repeat(201), nine(), nine() + hours(1), NEW_YORK).unwrap_err(),
    ArgumentError::new("title", "Title must be at most 200 characters.")
  );
}

#[test]
fn create_location_and_notes_are_capped_at_their_max_lengths() {
  let create =
    |location: Option<&str>, notes: Option<&str>| CalendarEvent::create(owner(), "E", nine(), nine() + hours(1), NEW_YORK, location, notes);

  let ok = create(Some(&"l".repeat(200)), Some(&"n".repeat(4000))).unwrap();
  assert_eq!(ok.location().unwrap().len(), 200);
  assert_eq!(ok.notes().unwrap().len(), 4000);

  assert_eq!(
    create(Some(&"l".repeat(201)), None).unwrap_err(),
    ArgumentError::new("location", "Value must be at most 200 characters.")
  );
  assert_eq!(
    create(None, Some(&"n".repeat(4001))).unwrap_err(),
    ArgumentError::new("notes", "Value must be at most 4000 characters.")
  );
}

#[test]
fn create_stores_the_canonical_zone_id() {
  assert_eq!(timed("E", nine(), nine() + hours(1), "utc").unwrap().time_zone_id(), Some("UTC"));
}

#[test]
fn create_with_invalid_zone_fails() {
  for zone in ["", "Nowhere/Land", "Eastern Standard Time"] {
    assert_eq!(
      timed("A", nine(), nine() + hours(1), zone).unwrap_err(),
      ArgumentError::new("timeZoneId", format!("'{zone}' is not a valid IANA time zone id."))
    );
  }
}

#[test]
fn overlaps_detects_intersection() {
  for (other_start_minutes, other_end_minutes, expected) in [(30, 90, true), (60, 120, false), (-60, 0, false)] {
    let event = timed("A", nine(), nine() + hours(1), NEW_YORK).unwrap();
    let other = timed(
      "B",
      nine() + minutes(other_start_minutes),
      nine() + minutes(other_end_minutes),
      NEW_YORK,
    )
    .unwrap();

    assert_eq!(event.overlaps(&other), expected);
  }
}

#[test]
fn create_all_day_with_valid_range_sets_properties() {
  let event = all_day(" Holiday ", day(), day_plus(1)).unwrap();

  assert_eq!(event.title(), "Holiday");
  assert!(event.is_all_day());
  assert_eq!(event.start_date(), Some(day()));
  assert_eq!(event.end_date(), Some(day_plus(1)));
  assert_eq!(event.start(), None);
  assert_eq!(event.end(), None);
  assert_eq!(event.time_zone_id(), None);
  assert_eq!(event.duration(), None);
  assert!(!event.id().is_nil());
}

#[test]
fn create_all_day_when_end_not_after_start_fails() {
  for offset_days in [0, -1] {
    assert_eq!(
      all_day("Bad", day(), day_plus(offset_days)).unwrap_err(),
      ArgumentError::new("endDate", "All-day event end date must be after its start date (end is exclusive).")
    );
  }
}

#[test]
fn create_all_day_with_blank_title_fails() {
  for title in ["", " "] {
    assert_eq!(all_day(title, day(), day_plus(1)).unwrap_err().param, "title");
  }
}

#[test]
fn create_all_day_with_too_long_title_fails() {
  assert_eq!(all_day(&"a".repeat(201), day(), day_plus(1)).unwrap_err().param, "title");
}

#[test]
fn overlaps_all_day_uses_exclusive_end() {
  for (other_start_days, other_end_days, expected) in [(1, 3, true), (2, 4, false), (-2, 0, false)] {
    let event = all_day("A", day(), day_plus(2)).unwrap();
    let other = all_day("B", day_plus(other_start_days), day_plus(other_end_days)).unwrap();

    assert_eq!(event.overlaps(&other), expected);
  }
}

#[test]
fn overlaps_timed_and_all_day_is_false() {
  let timed_event = timed("A", nine(), nine() + hours(1), NEW_YORK).unwrap();
  let all_day_event = all_day(
    "B",
    NaiveDate::from_ymd_opt(2026, 1, 5).unwrap(),
    NaiveDate::from_ymd_opt(2026, 1, 6).unwrap(),
  )
  .unwrap();

  assert!(!timed_event.overlaps(&all_day_event));
  assert!(!all_day_event.overlaps(&timed_event));
}

#[test]
fn update_replaces_the_fields_and_keeps_id_and_owner() {
  let mut event = CalendarEvent::create(
    owner(),
    "Standup",
    nine(),
    nine() + minutes(15),
    NEW_YORK,
    Some("Room 1"),
    Some("Agenda"),
  )
  .unwrap();
  let id = event.id();

  let start = (nine() + hours(1)).with_timezone(&FixedOffset::west_opt(5 * 3600).unwrap());
  event
    .update(" Retro ", start.with_timezone(&Utc), nine() + hours(2), "Europe/Madrid", None, None)
    .unwrap();

  assert_eq!(event.id(), id);
  assert_eq!(event.owner_id(), owner());
  assert_eq!(event.title(), "Retro");
  assert_eq!(event.start(), Some(nine() + hours(1)));
  assert_eq!(event.end(), Some(nine() + hours(2)));
  assert_eq!(event.time_zone_id(), Some("Europe/Madrid"));
  assert_eq!(event.location(), None);
  assert_eq!(event.notes(), None);
}

#[test]
fn update_all_day_turns_a_timed_event_into_an_all_day_one_and_back() {
  let mut event = timed("Standup", nine(), nine() + minutes(15), NEW_YORK).unwrap();

  event
    .update_all_day("Offsite", day(), day_plus(2), Some("Lodge"), Some("Bring boots"))
    .unwrap();

  assert!(event.is_all_day());
  assert_eq!(event.start_date(), Some(day()));
  assert_eq!(event.end_date(), Some(day_plus(2)));
  assert_eq!(event.start(), None);
  assert_eq!(event.end(), None);
  assert_eq!(event.time_zone_id(), None);
  assert_eq!(event.location(), Some("Lodge"));
  assert_eq!(event.notes(), Some("Bring boots"));

  event.update("Standup", nine(), nine() + hours(1), NEW_YORK, None, None).unwrap();

  assert!(!event.is_all_day());
  assert_eq!(event.start_date(), None);
  assert_eq!(event.end_date(), None);
  assert_eq!(event.start(), Some(nine()));
}

#[test]
fn update_with_invalid_values_fails_and_changes_nothing() {
  let mut event = CalendarEvent::create(owner(), "Standup", nine(), nine() + minutes(15), NEW_YORK, Some("Room 1"), None).unwrap();

  assert_eq!(
    event.update("Standup", nine(), nine(), NEW_YORK, None, None).unwrap_err().param,
    "end"
  );
  assert_eq!(
    event
      .update("  ", nine(), nine() + hours(1), NEW_YORK, None, None)
      .unwrap_err()
      .param,
    "title"
  );
  assert_eq!(
    event
      .update("A", nine(), nine() + hours(1), "Not/AZone", None, None)
      .unwrap_err()
      .param,
    "timeZoneId"
  );
  assert_eq!(event.update_all_day("A", day(), day(), None, None).unwrap_err().param, "endDate");

  assert_eq!(event.title(), "Standup");
  assert_eq!(event.end(), Some(nine() + minutes(15)));
  assert_eq!(event.location(), Some("Room 1"));
  assert!(!event.is_all_day());
}

// ---- beyond the C# suite ----

#[test]
fn create_reports_the_first_broken_rule_in_a_fixed_order() {
  let long = "x".repeat(4001);
  let param = |owner_id, title, end, zone| {
    CalendarEvent::create(owner_id, title, nine(), end, zone, Some(&long), Some(&long))
      .unwrap_err()
      .param
  };

  assert_eq!(param(Uuid::nil(), " ", nine(), "Nope"), "title");
  assert_eq!(param(Uuid::nil(), "A", nine(), "Nope"), "end");
  assert_eq!(param(Uuid::nil(), "A", nine() + hours(1), "Nope"), "timeZoneId");
  assert_eq!(param(Uuid::nil(), "A", nine() + hours(1), NEW_YORK), "ownerId");
  assert_eq!(param(owner(), "A", nine() + hours(1), NEW_YORK), "location");

  let all_day_param = |owner_id, title, end_date| {
    CalendarEvent::create_all_day(owner_id, title, day(), end_date, None, Some(&long))
      .unwrap_err()
      .param
  };
  assert_eq!(all_day_param(Uuid::nil(), " ", day()), "title");
  assert_eq!(all_day_param(Uuid::nil(), "A", day()), "endDate");
  assert_eq!(all_day_param(Uuid::nil(), "A", day_plus(1)), "ownerId");
  assert_eq!(all_day_param(owner(), "A", day_plus(1)), "notes");
}

#[test]
fn create_maps_a_legacy_alias_to_the_canonical_zone_id() {
  assert_eq!(
    timed("E", nine(), nine() + hours(1), "Asia/Calcutta").unwrap().time_zone_id(),
    Some("Asia/Kolkata")
  );
}

#[test]
fn restore_and_into_record_round_trip_without_validation() {
  let record = CalendarEventRecord {
    id: Uuid::from_u128(9),
    owner_id: owner(),
    title: "Stored".to_owned(),
    location: None,
    notes: Some("n".to_owned()),
    schedule: EventSchedule::AllDay {
      start_date: day(),
      end_date: day_plus(3),
    },
  };

  let event = CalendarEvent::restore(record.clone());

  assert_eq!(event.id(), Uuid::from_u128(9));
  assert_eq!(event.schedule(), &record.schedule);
  assert_eq!(event.into_record(), record);
}
