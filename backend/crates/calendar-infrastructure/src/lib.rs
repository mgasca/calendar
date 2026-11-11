//! Data access for the Calendar backend: PostgreSQL through Diesel (ports `Calendar.Infrastructure`).
//!
//! Repositories ([`events`], [`tasks`], [`agenda`], [`users`], [`session_keys`]) are free functions over a
//! connection. Those for events and tasks take the [`ownership::OwnerId`] whose rows they touch (ADR-0041),
//! and all fail with the one [`error::Error`].

pub mod agenda;
pub mod connection;
pub mod error;
pub mod events;
pub mod migrations;
pub mod ownership;
pub mod queries;
pub mod schema;
pub mod session_keys;
mod sql;
pub mod tasks;
pub mod users;

pub use error::Error;
pub use ownership::{OwnerId, RowVersion, Versioned};
