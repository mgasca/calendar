//! Helpers for IANA time zone ids (e.g. `America/New_York`).

use std::str::FromStr;

use chrono::{DateTime, FixedOffset, NaiveDate, Offset, TimeZone, Utc};
use chrono_tz::Tz;

use super::iana_aliases;
use crate::error::ArgumentError;

const MAX_ID_LENGTH: usize = 64;

/// Entries of a zoneinfo directory that are not zones (or are alternate rule sets of one). Compared with the
/// id's first segment, ignoring ASCII case.
const NOT_ZONES: [&str; 12] = [
  "localtime",
  "posixrules",
  "Factory",
  "posix",
  "right",
  "SystemV",
  "leapseconds",
  "tzdata",
  "zone",
  "zone1970",
  "iso3166",
  "leap-seconds",
];

/// A resolved IANA time zone. [`IanaZone::id`] is the canonical id to store and echo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct IanaZone(Tz);

impl IanaZone {
  /// Coordinated Universal Time; its id is `UTC`.
  pub const UTC: IanaZone = IanaZone(Tz::UTC);

  /// The canonical id: what to store and echo.
  pub fn id(self) -> &'static str {
    self.0.name()
  }

  /// The zone's rules, for conversions with `chrono`.
  pub fn tz(self) -> Tz {
    self.0
  }

  /// The UTC offset in force at `instant`.
  pub fn utc_offset_at(self, instant: DateTime<Utc>) -> FixedOffset {
    self.0.offset_from_utc_datetime(&instant.naive_utc()).fix()
  }

  /// `instant` on the zone's local clock.
  pub fn to_local(self, instant: DateTime<Utc>) -> DateTime<Tz> {
    instant.with_timezone(&self.0)
  }

  /// The local calendar date at `instant`.
  pub fn local_date(self, instant: DateTime<Utc>) -> NaiveDate {
    self.to_local(instant).date_naive()
  }
}

/// Resolves an IANA zone id and never panics for any input.
///
/// Windows display ids (e.g. "Eastern Standard Time"), directory-like ids ("America", "America/Indiana"), pseudo
/// entries ("localtime", "Factory") and non-canonical paths (`America//New_York`, `../x`) are rejected, as are
/// ids the tz database does not know. Ids are case-sensitive, except that `UTC` is accepted in any case. Legacy
/// IANA ids without a slash (`UTC`, `CET`) are accepted and kept. Legacy aliases with a slash (`Asia/Calcutta`,
/// `US/Eastern`) are mapped to their canonical id through [`iana_aliases`].
pub fn try_find_iana(id: &str) -> Option<IanaZone> {
  if id.len() > MAX_ID_LENGTH || !is_well_formed(id) {
    return None;
  }

  let first_segment = id.split('/').next().unwrap_or(id);
  if NOT_ZONES.iter().any(|entry| entry.eq_ignore_ascii_case(first_segment)) {
    return None;
  }

  // Geographic aliases (Asia/Calcutta, US/Eastern) resolve to their canonical zone, so the stored id does not
  // depend on which legacy links the tz database ships. Slashless ids (CET, EST, UTC) are zones of their own in
  // the database, whose rules can differ from the zone they link to today, so the database is tried first.
  let canonical = iana_aliases::canonical(id);
  match canonical {
    Some(canonical) if id.contains('/') => try_load(canonical),
    _ => try_load(id).or_else(|| canonical.and_then(try_load)),
  }
}

/// True when `id` resolves to an IANA zone (see [`try_find_iana`]).
pub fn is_valid_iana_id(id: &str) -> bool {
  try_find_iana(id).is_some()
}

/// Resolves an IANA zone id (see [`try_find_iana`]), or fails with an [`ArgumentError`] for `timeZoneId`.
pub fn find_iana(id: &str) -> Result<IanaZone, ArgumentError> {
  try_find_iana(id).ok_or_else(|| ArgumentError::new("timeZoneId", format!("'{id}' is not a valid IANA time zone id.")))
}

fn try_load(id: &str) -> Option<IanaZone> {
  if id.eq_ignore_ascii_case("UTC") {
    return Some(IanaZone::UTC);
  }

  Tz::from_str(id).ok().map(IanaZone)
}

/// Letters, digits, '_', '+', '-' in segments separated by single slashes: no '..', no empty segments, no
/// leading or trailing slash, no whitespace or dots (which also rules out tzdata files such as zone.tab).
fn is_well_formed(id: &str) -> bool {
  !id.is_empty()
    && id.split('/').all(|segment| {
      !segment.is_empty()
        && segment
          .bytes()
          .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'+' | b'-'))
    })
}
