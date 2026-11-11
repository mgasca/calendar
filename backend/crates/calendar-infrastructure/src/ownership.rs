//! Per-user ownership (ADR-0041) and the row version that travels with an entity.
//!
//! The .NET context scoped events and tasks with global query filters and an `ICurrentUser`. Here every
//! repository function takes the [`OwnerId`] as an argument and starts from an owner-filtered query
//! ([`queries::owned_events`](crate::queries::owned_events), [`queries::owned_tasks`](crate::queries::owned_tasks)),
//! so there is no query without an owner and no "current user" to forget.

use uuid::Uuid;

pub use crate::schema::RowVersion;

/// The user whose rows a repository call reads and writes. A distinct type, so that an owner and a row id
/// (both UUIDs) cannot be swapped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OwnerId(pub Uuid);

impl OwnerId {
  /// The user's id.
  pub fn get(self) -> Uuid {
    self.0
  }
}

/// An entity with the version (`xmin`) of the row it was read from or written to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Versioned<T> {
  /// The entity.
  pub entity: T,
  /// The row's optimistic-concurrency version.
  pub version: RowVersion,
}
