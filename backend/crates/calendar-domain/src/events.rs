//! Calendar events.

use chrono::{DateTime, NaiveDate, TimeDelta, Utc};
use uuid::Uuid;

use crate::error::ArgumentError;
use crate::time::time_zones;
use crate::validation::{self, MAX_LOCATION_LENGTH, MAX_NOTES_LENGTH};

/// When an event happens: at instants in a zone, or on floating dates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventSchedule {
  /// A timed event: `[start, end)` in UTC, plus the canonical IANA zone id it was created in.
  Timed {
    /// Inclusive start.
    start: DateTime<Utc>,
    /// Exclusive end, after `start`.
    end: DateTime<Utc>,
    /// Canonical IANA zone id.
    time_zone_id: String,
  },
  /// An all-day event: floating dates `[start_date, end_date)`, no zone.
  AllDay {
    /// First date.
    start_date: NaiveDate,
    /// Exclusive end date, after `start_date`.
    end_date: NaiveDate,
  },
}

/// The stored fields of a [`CalendarEvent`], for persistence to read and rebuild one without validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarEventRecord {
  /// Unique id.
  pub id: Uuid,
  /// Owning user.
  pub owner_id: Uuid,
  /// Normalized, non-empty title.
  pub title: String,
  /// Optional location.
  pub location: Option<String>,
  /// Optional notes.
  pub notes: Option<String>,
  /// Timed or all-day.
  pub schedule: EventSchedule,
}

/// A scheduled occurrence on a calendar: either **timed** (UTC instants plus the IANA zone it was created in)
/// or **all-day** (floating dates, end exclusive, no zone).
///
/// Accessors for values that do not apply to the event's kind return `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarEvent {
  id: Uuid,
  owner_id: Uuid,
  title: String,
  location: Option<String>,
  notes: Option<String>,
  schedule: EventSchedule,
}

impl CalendarEvent {
  /// Creates a timed event owned by `owner_id`, with a new random id. `time_zone_id` must be IANA; its canonical
  /// id is stored.
  ///
  /// Errors, in this order, by parameter name: `title` (blank or too long), `end` (not after `start`),
  /// `timeZoneId`, `ownerId` (nil), `location`, `notes` (too long).
  pub fn create(
    owner_id: Uuid,
    title: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    time_zone_id: &str,
    location: Option<&str>,
    notes: Option<&str>,
  ) -> Result<Self, ArgumentError> {
    let title = validation::normalize_title(title, "title")?;
    if end <= start {
      return Err(ArgumentError::new("end", "Event end must be after its start."));
    }

    let zone = time_zones::find_iana(time_zone_id)?;

    Ok(Self {
      id: Uuid::new_v4(),
      owner_id: require_owner(owner_id)?,
      title,
      location: validation::normalize_optional(location, MAX_LOCATION_LENGTH, "location")?,
      notes: validation::normalize_optional(notes, MAX_NOTES_LENGTH, "notes")?,
      schedule: EventSchedule::Timed {
        start,
        end,
        time_zone_id: zone.id().to_owned(),
      },
    })
  }

  /// Creates an all-day event owned by `owner_id`, covering `[start_date, end_date)` (end exclusive), with a new
  /// random id.
  ///
  /// Errors, in this order, by parameter name: `title`, `endDate` (not after `start_date`), `ownerId` (nil),
  /// `location`, `notes`.
  pub fn create_all_day(
    owner_id: Uuid,
    title: &str,
    start_date: NaiveDate,
    end_date: NaiveDate,
    location: Option<&str>,
    notes: Option<&str>,
  ) -> Result<Self, ArgumentError> {
    let title = validation::normalize_title(title, "title")?;
    if end_date <= start_date {
      return Err(ArgumentError::new(
        "endDate",
        "All-day event end date must be after its start date (end is exclusive).",
      ));
    }

    Ok(Self {
      id: Uuid::new_v4(),
      owner_id: require_owner(owner_id)?,
      title,
      location: validation::normalize_optional(location, MAX_LOCATION_LENGTH, "location")?,
      notes: validation::normalize_optional(notes, MAX_NOTES_LENGTH, "notes")?,
      schedule: EventSchedule::AllDay { start_date, end_date },
    })
  }

  /// Rebuilds a stored event without validation.
  pub fn restore(record: CalendarEventRecord) -> Self {
    let CalendarEventRecord {
      id,
      owner_id,
      title,
      location,
      notes,
      schedule,
    } = record;
    Self {
      id,
      owner_id,
      title,
      location,
      notes,
      schedule,
    }
  }

  /// The stored fields, for persistence.
  pub fn into_record(self) -> CalendarEventRecord {
    CalendarEventRecord {
      id: self.id,
      owner_id: self.owner_id,
      title: self.title,
      location: self.location,
      notes: self.notes,
      schedule: self.schedule,
    }
  }

  /// Unique id, generated on creation.
  pub fn id(&self) -> Uuid {
    self.id
  }

  /// The user who owns the event (ADR-0041); only they can ever read or change it.
  pub fn owner_id(&self) -> Uuid {
    self.owner_id
  }

  /// Normalized, non-empty title.
  pub fn title(&self) -> &str {
    &self.title
  }

  /// Optional location; `None` when not set.
  pub fn location(&self) -> Option<&str> {
    self.location.as_deref()
  }

  /// Optional free-form notes; `None` when not set.
  pub fn notes(&self) -> Option<&str> {
    self.notes.as_deref()
  }

  /// Timed or all-day, with the values of that kind.
  pub fn schedule(&self) -> &EventSchedule {
    &self.schedule
  }

  /// True for an all-day event (floating dates), false for a timed event.
  pub fn is_all_day(&self) -> bool {
    matches!(self.schedule, EventSchedule::AllDay { .. })
  }

  /// Timed events only: inclusive start.
  pub fn start(&self) -> Option<DateTime<Utc>> {
    match self.schedule {
      EventSchedule::Timed { start, .. } => Some(start),
      EventSchedule::AllDay { .. } => None,
    }
  }

  /// Timed events only: exclusive end, after [`start`](Self::start).
  pub fn end(&self) -> Option<DateTime<Utc>> {
    match self.schedule {
      EventSchedule::Timed { end, .. } => Some(end),
      EventSchedule::AllDay { .. } => None,
    }
  }

  /// Timed events only: IANA zone id the event was created in.
  pub fn time_zone_id(&self) -> Option<&str> {
    match &self.schedule {
      EventSchedule::Timed { time_zone_id, .. } => Some(time_zone_id),
      EventSchedule::AllDay { .. } => None,
    }
  }

  /// All-day events only: first date (floating).
  pub fn start_date(&self) -> Option<NaiveDate> {
    match self.schedule {
      EventSchedule::AllDay { start_date, .. } => Some(start_date),
      EventSchedule::Timed { .. } => None,
    }
  }

  /// All-day events only: exclusive end date, after [`start_date`](Self::start_date).
  pub fn end_date(&self) -> Option<NaiveDate> {
    match self.schedule {
      EventSchedule::AllDay { end_date, .. } => Some(end_date),
      EventSchedule::Timed { .. } => None,
    }
  }

  /// Length of a timed event; `None` for all-day events.
  pub fn duration(&self) -> Option<TimeDelta> {
    match self.schedule {
      EventSchedule::Timed { start, end, .. } => Some(end - start),
      EventSchedule::AllDay { .. } => None,
    }
  }

  /// Replaces every editable field with a timed event's, by the rules of [`create`](Self::create). An all-day
  /// event becomes timed. The id and owner are kept. Nothing changes when a value is invalid.
  pub fn update(
    &mut self,
    title: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    time_zone_id: &str,
    location: Option<&str>,
    notes: Option<&str>,
  ) -> Result<(), ArgumentError> {
    let validated = Self::create(self.owner_id, title, start, end, time_zone_id, location, notes)?;
    self.copy_from(validated);
    Ok(())
  }

  /// Replaces every editable field with an all-day event's, by the rules of
  /// [`create_all_day`](Self::create_all_day). A timed event becomes all-day. The id and owner are kept. Nothing
  /// changes when a value is invalid.
  pub fn update_all_day(
    &mut self,
    title: &str,
    start_date: NaiveDate,
    end_date: NaiveDate,
    location: Option<&str>,
    notes: Option<&str>,
  ) -> Result<(), ArgumentError> {
    let validated = Self::create_all_day(self.owner_id, title, start_date, end_date, location, notes)?;
    self.copy_from(validated);
    Ok(())
  }

  /// True when both events are of the same kind and their spans intersect (half-open, so back-to-back events do
  /// not overlap). A timed and an all-day event never overlap here: all-day dates are floating and have no
  /// instant range without picking a zone.
  pub fn overlaps(&self, other: &CalendarEvent) -> bool {
    match (&self.schedule, &other.schedule) {
      (
        EventSchedule::Timed { start, end, .. },
        EventSchedule::Timed {
          start: other_start,
          end: other_end,
          ..
        },
      ) => start < other_end && other_start < end,
      (
        EventSchedule::AllDay { start_date, end_date },
        EventSchedule::AllDay {
          start_date: other_start_date,
          end_date: other_end_date,
        },
      ) => start_date < other_end_date && other_start_date < end_date,
      _ => false,
    }
  }

  /// Takes the editable fields of an already validated event, keeping this one's id and owner.
  fn copy_from(&mut self, validated: CalendarEvent) {
    self.title = validated.title;
    self.location = validated.location;
    self.notes = validated.notes;
    self.schedule = validated.schedule;
  }
}

fn require_owner(owner_id: Uuid) -> Result<Uuid, ArgumentError> {
  if owner_id.is_nil() {
    Err(ArgumentError::new("ownerId", "An event needs an owner."))
  } else {
    Ok(owner_id)
  }
}
