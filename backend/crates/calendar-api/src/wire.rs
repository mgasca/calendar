//! The text forms of dates and instants on the wire, as `System.Text.Json` wrote and the API's converters read
//! them.

use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, NaiveTime, TimeDelta, Timelike, Utc};
use serde::Serializer;

/// The largest offset .NET's `DateTimeOffset` accepts, in minutes.
const MAX_OFFSET_MINUTES: i64 = 14 * 60;
const NANOS_PER_TICK: u32 = 100;
const TICK_DIGITS: usize = 7;

/// Formats an instant the way `System.Text.Json` writes a UTC `DateTimeOffset`: `2026-10-26T14:00:00+00:00`,
/// with up to seven fractional digits and no trailing zeros.
pub fn format_instant(instant: DateTime<Utc>) -> String {
  let mut text = instant.format("%Y-%m-%dT%H:%M:%S").to_string();
  let ticks = instant.nanosecond() % 1_000_000_000 / NANOS_PER_TICK;
  if ticks != 0 {
    let digits = format!("{ticks:07}");
    text.push('.');
    text.push_str(digits.trim_end_matches('0'));
  }
  text.push_str("+00:00");
  text
}

/// Serializes an instant with [`format_instant`].
pub fn instant<S: Serializer>(value: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error> {
  serializer.serialize_str(&format_instant(*value))
}

/// Serializes an optional instant with [`format_instant`], or `null`.
pub fn instant_opt<S: Serializer>(value: &Option<DateTime<Utc>>, serializer: S) -> Result<S::Ok, S::Error> {
  match value {
    Some(value) => serializer.serialize_str(&format_instant(*value)),
    None => serializer.serialize_none(),
  }
}

fn digits(text: &[u8]) -> Option<u32> {
  if text.is_empty() || !text.iter().all(u8::is_ascii_digit) {
    return None;
  }
  text
    .iter()
    .try_fold(0_u32, |value, digit| value.checked_mul(10)?.checked_add(u32::from(digit - b'0')))
}

/// Reads `YYYY-MM-DD` and nothing else, as `System.Text.Json` reads a `DateOnly`.
pub fn parse_date(text: &str) -> Option<NaiveDate> {
  let bytes = text.as_bytes();
  if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
    return None;
  }
  let year = digits(&bytes[..4])?;
  if year == 0 {
    return None;
  }
  NaiveDate::from_ymd_opt(i32::try_from(year).ok()?, digits(&bytes[5..7])?, digits(&bytes[8..10])?)
}

/// Reads a date from a query string. .NET bound it with the invariant `DateOnly.TryParse`; this accepts the
/// ISO form the clients send, with or without zero padding.
pub fn parse_query_date(text: &str) -> Option<NaiveDate> {
  let text = text.trim();
  parse_date(text).or_else(|| {
    NaiveDate::parse_from_str(text, "%Y-%m-%d")
      .ok()
      .filter(|date| (1..=9999).contains(&date.year()))
  })
}

/// Reads an instant that carries an explicit offset (`Z` or `±hh:mm`), as `ExplicitOffsetConverter` did:
/// `YYYY-MM-DDThh:mm[:ss[.fraction]]` followed by the offset, `T` and `Z` in either case. The fraction is
/// rounded to 100 ns, the precision of a .NET `DateTimeOffset`. `None` for anything else, including an offset
/// beyond ±14:00 and a date or time that does not exist.
pub fn parse_explicit_offset(text: &str) -> Option<DateTime<Utc>> {
  let bytes = text.as_bytes();
  if bytes.len() < 17 || bytes[4] != b'-' || bytes[7] != b'-' || !bytes[10].eq_ignore_ascii_case(&b'T') || bytes[13] != b':' {
    return None;
  }
  let year = digits(&bytes[..4])?;
  if year == 0 {
    return None;
  }
  let date = NaiveDate::from_ymd_opt(i32::try_from(year).ok()?, digits(&bytes[5..7])?, digits(&bytes[8..10])?)?;
  let (hour, minute) = (digits(&bytes[11..13])?, digits(&bytes[14..16])?);

  let mut rest = &bytes[16..];
  let mut second = 0;
  let mut ticks = 0_u32;
  if rest.first() == Some(&b':') {
    second = digits(rest.get(1..3)?)?;
    rest = &rest[3..];
    if rest.first() == Some(&b'.') {
      let length = rest[1..].iter().take_while(|byte| byte.is_ascii_digit()).count();
      if length == 0 {
        return None;
      }
      let fraction = &rest[1..=length];
      for index in 0..TICK_DIGITS {
        ticks = ticks * 10 + fraction.get(index).map_or(0, |digit| u32::from(digit - b'0'));
      }
      if fraction.get(TICK_DIGITS).is_some_and(|digit| *digit >= b'5') {
        ticks += 1;
      }
      rest = &rest[1 + length..];
    }
  }

  let offset_minutes = match rest {
    [z] if z.eq_ignore_ascii_case(&b'Z') => 0,
    [sign @ (b'+' | b'-'), h1, h2, b':', m1, m2] => {
      let (hours, minutes) = (digits(&[*h1, *h2])?, digits(&[*m1, *m2])?);
      if minutes >= 60 {
        return None;
      }
      let total = i64::from(hours) * 60 + i64::from(minutes);
      if total > MAX_OFFSET_MINUTES {
        return None;
      }
      if *sign == b'-' { -total } else { total }
    }
    _ => return None,
  };

  let time = NaiveTime::from_hms_opt(hour, minute, second)?;
  let local = NaiveDateTime::new(date, time);
  let utc = local
    .checked_add_signed(TimeDelta::nanoseconds(i64::from(ticks) * i64::from(NANOS_PER_TICK)))?
    .checked_sub_signed(TimeDelta::minutes(offset_minutes))?;
  (1..=9999).contains(&utc.year()).then(|| utc.and_utc())
}

#[cfg(test)]
mod tests {
  use super::*;
  use chrono::TimeZone;

  #[test]
  fn instants_are_written_like_system_text_json() {
    let whole = Utc.with_ymd_and_hms(2026, 10, 26, 14, 0, 0).unwrap();
    assert_eq!(format_instant(whole), "2026-10-26T14:00:00+00:00");
    assert_eq!(format_instant(whole + TimeDelta::milliseconds(500)), "2026-10-26T14:00:00.5+00:00");
    assert_eq!(
      format_instant(whole + TimeDelta::nanoseconds(123_456_700)),
      "2026-10-26T14:00:00.1234567+00:00"
    );
    assert_eq!(
      format_instant(whole + TimeDelta::microseconds(123_456)),
      "2026-10-26T14:00:00.123456+00:00"
    );
    // Below 100 ns is not representable in .NET and is dropped.
    assert_eq!(format_instant(whole + TimeDelta::nanoseconds(99)), "2026-10-26T14:00:00+00:00");
  }

  #[test]
  fn instants_need_an_explicit_offset() {
    let expected = Utc.with_ymd_and_hms(2026, 10, 26, 14, 0, 0).unwrap();
    assert_eq!(parse_explicit_offset("2026-10-26T14:00:00Z"), Some(expected));
    assert_eq!(parse_explicit_offset("2026-10-26T10:00:00-04:00"), Some(expected));
    assert_eq!(parse_explicit_offset("2026-10-26t14:00z"), Some(expected));
    assert_eq!(parse_explicit_offset("2026-10-27T04:00+14:00"), Some(expected));
    for invalid in [
      "2026-10-26T10:00:00",
      "2026-10-26",
      "2026-10-26T10:00:00+15:00",
      "2026-10-26T10:00:00+14:01",
      "2026-10-26T24:00:00Z",
      "2026-10-26T10:00:60Z",
      "2026-10-26T10:60:00Z",
      "2026-02-30T10:00:00Z",
      "2026-10-26T10:00:00.Z",
      "2026-10-26T10:00:00+0400",
      "2026-10-26 10:00:00Z",
      "0000-10-26T10:00:00Z",
      " 2026-10-26T10:00:00Z",
      "",
    ] {
      assert_eq!(parse_explicit_offset(invalid), None, "{invalid}");
    }
  }

  #[test]
  fn fractions_round_to_one_hundred_nanoseconds() {
    let base = Utc.with_ymd_and_hms(2026, 10, 26, 14, 0, 0).unwrap();
    assert_eq!(
      parse_explicit_offset("2026-10-26T10:00:00.123456789-04:00"),
      Some(base + TimeDelta::nanoseconds(123_456_800))
    );
    assert_eq!(
      parse_explicit_offset("2026-10-26T14:00:00.5Z"),
      Some(base + TimeDelta::milliseconds(500))
    );
    assert_eq!(parse_explicit_offset("2026-10-26T13:59:59.99999995Z"), Some(base));
  }

  #[test]
  fn dates_are_iso_only() {
    assert_eq!(parse_date("2026-10-26"), NaiveDate::from_ymd_opt(2026, 10, 26));
    for invalid in [
      "2026-1-1",
      "2026-13-01",
      "2026-02-30",
      "20261026",
      "2026-10-26T00:00:00",
      "0000-01-01",
      "",
    ] {
      assert_eq!(parse_date(invalid), None, "{invalid}");
    }
    assert_eq!(parse_query_date("2026-1-1"), NaiveDate::from_ymd_opt(2026, 1, 1));
    assert_eq!(parse_query_date("abc"), None);
    assert_eq!(parse_query_date(""), None);
  }
}
