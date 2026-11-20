//! What day and time it is for the user: the client decides, never the server (ADR-0021).

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;

/// The user's time zone, and the current instant (fixed in tests and headless scenes).
#[derive(Clone, Copy, Debug)]
pub struct Clock {
  pub zone: Tz,
  fixed: Option<DateTime<Utc>>,
}

impl Clock {
  /// The system's zone (the browser's on wasm32), or UTC when it is unknown.
  #[must_use]
  pub fn system() -> Self {
    let zone = iana_time_zone::get_timezone()
      .ok()
      .and_then(|name| name.parse().ok())
      .unwrap_or(chrono_tz::UTC);
    Clock { zone, fixed: None }
  }

  /// A clock stopped at `now` in `zone`.
  #[must_use]
  pub fn fixed(zone: Tz, now: DateTime<Utc>) -> Self {
    Clock { zone, fixed: Some(now) }
  }

  /// Moves a fixed clock to `now` (tests: the next refresh, midnight).
  pub fn set_now(&mut self, now: DateTime<Utc>) {
    self.fixed = Some(now);
  }

  /// The current instant.
  #[must_use]
  pub fn now(&self) -> DateTime<Utc> {
    self.fixed.unwrap_or_else(Utc::now)
  }

  /// Today's date in the user's zone.
  #[must_use]
  pub fn today(&self) -> NaiveDate {
    crate::format::local_date(self.now(), self.zone)
  }

  /// What the API is told about the day (ADR-0021).
  #[must_use]
  pub fn day(&self) -> calendar_client::Day {
    calendar_client::Day {
      today: self.today(),
      time_zone: self.zone.name().to_owned(),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn today_is_the_users_date_not_utcs() {
    let clock = Clock::fixed(chrono_tz::Pacific::Auckland, "2026-11-20T12:00:00Z".parse().unwrap());
    assert_eq!(clock.today(), NaiveDate::from_ymd_opt(2026, 11, 21).unwrap());
    assert_eq!(clock.day().time_zone, "Pacific/Auckland");
  }
}
