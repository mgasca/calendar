//! The UTC interval covered by one local calendar date.

use chrono::{DateTime, NaiveDate, NaiveTime, Offset, TimeDelta, TimeZone, Utc};
use chrono_tz::Tz;

use super::IanaZone;

// The largest UTC offset is +14h and the smallest -12h, so a local date's first instant lies within
// [midnight - 15h, midnight + 13h] when midnight is read as a UTC clock time.
const SEARCH_BEFORE_SECONDS: i64 = 15 * 3600;
const SEARCH_AFTER_SECONDS: i64 = 13 * 3600;
const SAMPLE_STEP_SECONDS: i64 = 30 * 60;

/// The half-open UTC interval `[start, end)` covered by a local calendar `date` in a time zone.
///
/// The window runs from the first instant of the local date to the first instant of the next local date, so it is
/// 24h on ordinary days, 23h/25h across DST transitions, and shorter/longer for other offset changes.
///
/// If local midnight does not exist (the clock jumps over it, e.g. America/Santiago 2026-09-06) the window starts
/// at the transition itself, i.e. the first valid local instant of that day. If local midnight occurs twice (the
/// clock falls back over it) the window starts at the first occurrence. If the whole date is skipped (e.g.
/// Pacific/Apia 2011-12-30) the window is empty, with `start` equal to `end` at the transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct DayWindow {
  date: NaiveDate,
  start: DateTime<Utc>,
  end: DateTime<Utc>,
}

impl DayWindow {
  /// Builds the window covered by local `date` in `zone`.
  ///
  /// # Panics
  ///
  /// When `date` is within a day of the first or last date `chrono` can represent (see [`DayWindow::try_create`]).
  /// Callers validate dates to a sane range long before that.
  pub fn create(date: NaiveDate, zone: IanaZone) -> Self {
    Self::try_create(date, zone).expect("the date is too close to the limits of the supported date range")
  }

  /// Builds the window covered by local `date` in `zone`; `None` when the date arithmetic would leave the range
  /// `chrono` can represent.
  pub fn try_create(date: NaiveDate, zone: IanaZone) -> Option<Self> {
    let tz = zone.tz();
    Some(Self {
      date,
      start: start_of_day(date, tz)?,
      end: start_of_day(date.succ_opt()?, tz)?,
    })
  }

  /// The local calendar date.
  pub fn date(&self) -> NaiveDate {
    self.date
  }

  /// Inclusive start.
  pub fn start(&self) -> DateTime<Utc> {
    self.start
  }

  /// Exclusive end.
  pub fn end(&self) -> DateTime<Utc> {
    self.end
  }

  /// Duration of the window: 24h on ordinary days, shorter or longer across offset changes.
  pub fn length(&self) -> TimeDelta {
    self.end - self.start
  }

  /// True when `instant` is within `[start, end)`.
  pub fn contains(&self, instant: DateTime<Utc>) -> bool {
    instant >= self.start && instant < self.end
  }
}

/// The earliest instant whose local date in `tz` is on or after `date`.
///
/// That is local midnight when it exists (its first occurrence if it repeats), and the transition instant when
/// the clock jumps over midnight (including a jump that skips the whole date, which gives an empty window). It
/// never asks whether a local time is valid; it only compares offsets and local dates of instants.
fn start_of_day(date: NaiveDate, tz: Tz) -> Option<DateTime<Utc>> {
  // Unix seconds throughout: tz database offsets and transitions are whole seconds.
  let midnight = date.and_time(NaiveTime::MIN).and_utc().timestamp();
  let first = midnight.checked_sub(SEARCH_BEFORE_SECONDS)?;
  let last = midnight.checked_add(SEARCH_AFTER_SECONDS)?;

  let first_offset = offset_seconds(tz, first)?;
  if first_offset == offset_seconds(tz, last)? {
    // No transition in the window (the overwhelmingly common case): local midnight is unambiguous.
    return DateTime::from_timestamp(midnight - first_offset, 0);
  }

  // Boundaries of "local date >= date" are local midnight under some offset in force, or a transition instant.
  let mut candidates = vec![midnight - first_offset];
  let mut previous = first;
  let mut previous_offset = first_offset;
  while previous < last {
    let t = (previous + SAMPLE_STEP_SECONDS).min(last);
    let offset = offset_seconds(tz, t)?;
    if offset != previous_offset {
      candidates.push(midnight - offset);
      candidates.push(find_transition(tz, previous, t, previous_offset)?);
    }

    previous = t;
    previous_offset = offset;
  }

  let mut earliest = None;
  for candidate in candidates {
    if earliest.is_none_or(|current| candidate < current) && local_date(tz, candidate)? >= date {
      earliest = Some(candidate);
    }
  }

  DateTime::from_timestamp(earliest?, 0)
}

fn offset_seconds(tz: Tz, unix_seconds: i64) -> Option<i64> {
  let instant = DateTime::from_timestamp(unix_seconds, 0)?;
  Some(i64::from(tz.offset_from_utc_datetime(&instant.naive_utc()).fix().local_minus_utc()))
}

fn local_date(tz: Tz, unix_seconds: i64) -> Option<NaiveDate> {
  Some(DateTime::from_timestamp(unix_seconds, 0)?.with_timezone(&tz).date_naive())
}

/// First instant in `(before, after]` whose offset differs from `offset_before`.
fn find_transition(tz: Tz, before: i64, after: i64, offset_before: i64) -> Option<i64> {
  let mut low = before;
  let mut high = after;
  while high - low > 1 {
    let mid = low + (high - low) / 2;
    if offset_seconds(tz, mid)? == offset_before {
      low = mid;
    } else {
      high = mid;
    }
  }

  Some(high)
}
