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
