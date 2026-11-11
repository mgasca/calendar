//! Port of `Calendar.Domain.Tests/Time/TimeZonesTests.cs`.

use calendar_domain::time::{IanaZone, iana_aliases, time_zones};
use chrono::{TimeZone, Utc};

#[test]
fn is_valid_iana_id_accepts_iana_ids() {
  for id in ["America/New_York", "Europe/London", "Asia/Kolkata", "UTC"] {
    assert!(time_zones::is_valid_iana_id(id), "{id}");
  }
}

#[test]
fn is_valid_iana_id_rejects_blank_unknown_and_windows_ids() {
  // The C# theory also has a null id; an id is a `&str` here, so the empty string stands for it.
  let ids = [
    "",
    "   ",
    "Nowhere/Land",
    "Eastern Standard Time",
    "W. Europe Standard Time",
    " America/New_York",
    "../etc/passwd",
    "America",
    "Etc",
    "America/Indiana",
    "localtime",
    "posixrules",
    "Factory",
    "posix/America/New_York",
    "America//New_York",
    "/America/New_York",
    "America/New_York/",
    "America/../America/New_York",
    "zone.tab",
  ];
  for id in ids {
    assert!(!time_zones::is_valid_iana_id(id), "{id:?}");
  }
}

#[test]
fn try_find_iana_returns_canonical_id() {
  for (input, canonical) in [("utc", "UTC"), ("America/New_York", "America/New_York")] {
    let zone = time_zones::try_find_iana(input).expect(input);
    assert_eq!(zone.id(), canonical);
  }
}

#[test]
fn try_find_iana_maps_legacy_aliases_to_the_canonical_id() {
  let cases = [
    ("Asia/Calcutta", "Asia/Kolkata"),
    ("Europe/Kiev", "Europe/Kyiv"),
    ("US/Eastern", "America/New_York"),
    ("US/Pacific", "America/Los_Angeles"),
    ("Australia/ACT", "Australia/Sydney"),
    ("Asia/Saigon", "Asia/Ho_Chi_Minh"),
    ("America/Buenos_Aires", "America/Argentina/Buenos_Aires"),
    ("Etc/Zulu", "Etc/UTC"),
  ];
  for (alias, canonical) in cases {
    let zone = time_zones::try_find_iana(alias).expect(alias);
    assert_eq!(zone.id(), canonical, "{alias}");
  }
}

#[test]
fn try_find_iana_resolves_every_alias_in_the_table() {
  assert_eq!(iana_aliases::CANONICAL.len(), 252);
  for (alias, canonical) in iana_aliases::CANONICAL {
    let zone = time_zones::try_find_iana(alias).unwrap_or_else(|| panic!("{alias} does not resolve"));
    if alias.contains('/') {
      assert_eq!(zone.id(), canonical, "{alias}");
    }
  }
}

#[test]
fn try_find_iana_accepts_etc_gmt_offset_zones() {
  let instant = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();
  for (id, hours) in [("Etc/GMT+5", -5), ("Etc/GMT-14", 14), ("Etc/GMT", 0)] {
    let zone = time_zones::try_find_iana(id).expect(id);
    assert_eq!(zone.id(), id);
    assert_eq!(zone.utc_offset_at(instant).local_minus_utc(), hours * 3600, "{id}");
  }
}

#[test]
fn try_find_iana_still_rejects_malformed_or_wrong_case_aliases() {
  for id in ["Asia/Calcutta/", "asia/calcutta", "US//Eastern"] {
    assert!(!time_zones::is_valid_iana_id(id), "{id}");
  }
}

#[test]
fn try_find_iana_with_very_long_or_odd_input_returns_false_without_panicking() {
  assert!(!time_zones::is_valid_iana_id(&"a".repeat(5000)));
  assert!(!time_zones::is_valid_iana_id("America/New_York\0"));
  assert!(!time_zones::is_valid_iana_id("\u{c5}/\u{d6}"));
}

#[test]
fn find_iana_returns_zone() {
  assert_eq!(time_zones::find_iana("Europe/London").unwrap().id(), "Europe/London");
}

#[test]
fn find_iana_with_invalid_id_fails() {
  let error = time_zones::find_iana("Nope").unwrap_err();
  assert_eq!(error.param, "timeZoneId");
  assert_eq!(error.message, "'Nope' is not a valid IANA time zone id.");
  assert_eq!(error.to_string(), "'Nope' is not a valid IANA time zone id.");
}

// ---- beyond the C# suite: behaviour the port has to pin down ----

#[test]
fn utc_constant_has_the_id_utc_and_no_offset() {
  assert_eq!(IanaZone::UTC.id(), "UTC");
  assert_eq!(time_zones::try_find_iana("UTC"), Some(IanaZone::UTC));
  assert_eq!(
    IanaZone::UTC
      .utc_offset_at(Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap())
      .local_minus_utc(),
    0
  );
}

#[test]
fn ids_are_case_sensitive_except_utc() {
  assert_eq!(time_zones::try_find_iana("Utc").map(IanaZone::id), Some("UTC"));
  for id in [
    "america/new_york",
    "AMERICA/NEW_YORK",
    "etc/utc",
    "gmt",
    "FACTORY",
    "Posix/UTC",
    "RIGHT/UTC",
  ] {
    assert!(!time_zones::is_valid_iana_id(id), "{id}");
  }
}

#[test]
fn slashless_legacy_ids_keep_their_own_id() {
  for id in ["CET", "EST", "GB", "Japan"] {
    assert_eq!(time_zones::try_find_iana(id).map(IanaZone::id), Some(id));
  }
}

#[test]
fn a_trailing_line_feed_or_an_over_long_id_is_rejected() {
  assert!(!time_zones::is_valid_iana_id("America/New_York\n"));
  let long = format!("America/{}", "a".repeat(57));
  assert_eq!(long.len(), 65);
  assert!(!time_zones::is_valid_iana_id(&long));
}

#[test]
fn local_date_and_local_time_follow_the_zone() {
  let zone = time_zones::find_iana("America/New_York").unwrap();
  let instant = Utc.with_ymd_and_hms(2026, 10, 27, 2, 0, 0).unwrap();

  assert_eq!(zone.local_date(instant).to_string(), "2026-10-26");
  assert_eq!(zone.to_local(instant).to_rfc3339(), "2026-10-26T22:00:00-04:00");
  assert_eq!(zone.tz().name(), "America/New_York");
}
