//! Query fragments shared by the repositories (ports `Calendar.Infrastructure.Queries`).
//!
//! Like the `IQueryable` extension methods they port, each takes a query and returns it narrowed, so they
//! compose. They work on boxed queries; every chain starts at [`owned_events`] or [`owned_tasks`], which is
//! where the owner filter of ADR-0041 is applied.

pub mod agenda;
pub mod task_list;

use diesel::pg::Pg;
use diesel::prelude::*;

use crate::ownership::OwnerId;
use crate::schema::{events, tasks};

/// A query over `events`, selecting `ST`.
pub type Events<'a, ST = events::SqlType> = events::BoxedQuery<'a, Pg, ST>;

/// A query over `tasks`, selecting `ST`.
pub type Tasks<'a, ST = tasks::SqlType> = tasks::BoxedQuery<'a, Pg, ST>;

/// The events of `owner`: the only way the repositories start an event query.
pub fn owned_events<'a>(owner: OwnerId) -> Events<'a> {
  events::table.filter(events::owner_id.eq(owner.0)).into_boxed()
}

/// The tasks of `owner`: the only way the repositories start a task query.
pub fn owned_tasks<'a>(owner: OwnerId) -> Tasks<'a> {
  tasks::table.filter(tasks::owner_id.eq(owner.0)).into_boxed()
}
