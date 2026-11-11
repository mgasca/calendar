//! The current time, injected so that nothing reads the system clock directly and tests can fix it (the .NET
//! API used `TimeProvider`).

use chrono::{DateTime, DurationRound, TimeDelta, Utc};

/// Tells the current instant.
pub trait Clock: Send + Sync + 'static {
  /// The current instant, in UTC.
  fn now(&self) -> DateTime<Utc>;
}

/// The system clock, truncated to microseconds: the precision PostgreSQL stores, so an instant the API
/// returns right after writing it equals the one it reads back later.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
  #[expect(clippy::disallowed_methods, reason = "the one place that reads the system clock")]
  fn now(&self) -> DateTime<Utc> {
    let now = Utc::now();
    now.duration_trunc(TimeDelta::microseconds(1)).unwrap_or(now)
  }
}
