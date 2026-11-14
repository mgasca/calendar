//! Fixtures shared by the domain test modules: the fixed owner id, the tick size and the date, instant, zone and
//! duration constructors. A helper only one module uses stays in that module.

use calendar_domain::time::{IanaZone, time_zones};
use chrono::{DateTime, NaiveDate, TimeDelta, TimeZone, Utc};
use uuid::Uuid;

/// The smallest step the tests take across a boundary: 100 ns, a .NET tick.
pub const TICK: TimeDelta = TimeDelta::nanoseconds(100);

/// The owner of every event and task the tests create.
pub fn owner() -> Uuid {
  Uuid::from_u128(0x0a0b_0c0d_0e0f_4a1b_8c2d_3e4f_5a6b_7c8d)
}

pub fn date(year: i32, month: u32, day: u32) -> NaiveDate {
  NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

pub fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
  Utc.with_ymd_and_hms(year, month, day, hour, minute, 0).unwrap()
}

pub fn zone(id: &str) -> IanaZone {
  time_zones::find_iana(id).unwrap()
}

pub fn hours(count: i64) -> TimeDelta {
  TimeDelta::hours(count)
}
