//! Pure calendar rules: no I/O, no framework dependencies.
//!
//! * [`time`]: IANA zone ids ([`time::time_zones`]), the UTC interval of a local day ([`time::DayWindow`]) and of
//!   a run of days ([`time::DateRangeWindow`]).
//! * [`agenda`]: what a day shows ([`agenda::day_inclusion`]).
//! * [`events`], [`tasks`], [`users`]: the entities and their invariants.
//! * [`error`]: the error types; an [`error::ArgumentError`] names the offending parameter so the API can turn it
//!   into a field error.
//!
//! Instants are `DateTime<Utc>` everywhere, so "normalized to UTC" is enforced by the type. The current time is
//! always a parameter; nothing here reads a clock.

pub mod agenda;
pub mod error;
pub mod events;
pub mod tasks;
pub mod time;
pub mod users;
pub mod validation;
