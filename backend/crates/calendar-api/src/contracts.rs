//! The request and response bodies of the HTTP contract (ports `Calendar.Api/Contracts`).
//!
//! Field order, names, nullability and descriptions are the contract: `contracts/openapi.json` is generated
//! from these types, and the doc comments are its descriptions, carried over from the .NET XML docs.
//! Responses derive `Serialize`; requests are read by hand through [`crate::json::FromJson`], because the
//! acceptance rules and error messages of `System.Text.Json` are part of the contract too.
#![allow(
  clippy::doc_markdown,
  reason = "the doc comments are the OpenAPI descriptions, carried over verbatim from the .NET contract"
)]

mod agenda;
mod auth;
mod events;
mod problems;
mod tasks;

pub use agenda::{AgendaDay, AgendaTasks, AgendaWindow, DayAgendaResponse, WeekAgendaResponse};
pub use auth::{AuthUserResponse, HealthResponse};
pub use events::{AllDayEventItem, CreateEventRequest, EventFields, EventResponse, TimedEventItem, UpdateEventRequest};
pub use problems::{HttpValidationProblemDetails, ProblemDetails};
pub use tasks::{
  AgendaTaskItem, BulkTaskAction, BulkTaskItemResult, BulkTaskRequest, BulkTaskResponse, CreateTaskRequest, OverdueTaskFilter, TaskPage,
  TaskResponse, UpdateTaskRequest,
};

/// A count as the contract's `int`: counts are 32-bit and saturate at `i32::MAX`.
pub(crate) fn saturating_count(value: impl TryInto<i32>) -> i32 {
  value.try_into().unwrap_or(i32::MAX)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn counts_saturate_at_the_contracts_int() {
    assert_eq!(saturating_count(42_i64), 42);
    assert_eq!(saturating_count(-3_i64), -3);
    assert_eq!(saturating_count(i64::MAX), i32::MAX);
    assert_eq!(saturating_count(usize::MAX), i32::MAX);
    assert_eq!(saturating_count(7_usize), 7);
  }
}
