//! The one error type of the data layer. The API maps it to HTTP: [`Error::NotFound`] to 404,
//! [`Error::Conflict`] to 409, and the rest to 500, except where an endpoint documents otherwise.

use calendar_domain::error::DomainError;
use diesel::result::{DatabaseErrorKind, Error as DieselError};

/// What a repository function can fail with.
#[derive(Debug, thiserror::Error)]
pub enum Error {
  /// The row does not exist, or belongs to someone else (ADR-0041: another user's row is indistinguishable
  /// from a missing one).
  #[error("the row does not exist")]
  NotFound,

  /// The row exists but no longer has the version the caller expected, or a guarded set-based change found
  /// the data changed (count mismatch, serialization failure or deadlock).
  #[error("the row was changed by another request")]
  Conflict,

  /// A unique constraint or index refused the write (SQLSTATE 23505).
  #[error("a unique constraint was violated{}", constraint.as_deref().map_or_default(|name| format!(" ({name})")))]
  UniqueViolation {
    /// The constraint or index name PostgreSQL reported.
    constraint: Option<String>,
  },

  /// A row was offered for insert or update under an owner other than its own. Nothing was written.
  #[error("A row can only be added for the signed-in user.")]
  OwnerMismatch,

  /// A domain rule refused the change (only [`users::resolve`](crate::users::resolve) applies domain rules).
  #[error(transparent)]
  Domain(#[from] DomainError),

  /// A stored row does not form a valid entity. The schema's check constraints make this unreachable.
  #[error("the stored {entity} row is not valid: {reason}")]
  InvalidRow {
    /// Which kind of row.
    entity: &'static str,
    /// What is wrong with it.
    reason: &'static str,
  },

  /// Anything else the database or the connection reported.
  #[error("database failure: {0}")]
  Database(#[source] DieselError),
}

impl Error {
  /// Whether PostgreSQL aborted the transaction with a serialization failure (40001) or a deadlock (40P01).
  /// Diesel has no kind for a deadlock, so that one is recognised by the server's message.
  pub(crate) fn is_serialization_or_deadlock(&self) -> bool {
    match self {
      Self::Database(DieselError::DatabaseError(DatabaseErrorKind::SerializationFailure, _)) => true,
      Self::Database(DieselError::DatabaseError(DatabaseErrorKind::Unknown, info)) => info.message() == "deadlock detected",
      _ => false,
    }
  }
}

impl From<DieselError> for Error {
  fn from(error: DieselError) -> Self {
    match error {
      DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, info) => Self::UniqueViolation {
        constraint: info.constraint_name().map(str::to_owned),
      },
      other => Self::Database(other),
    }
  }
}

impl From<calendar_domain::error::ArgumentError> for Error {
  fn from(error: calendar_domain::error::ArgumentError) -> Self {
    Self::Domain(error.into())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn database_error(kind: DatabaseErrorKind, message: &str) -> Error {
    Error::from(DieselError::DatabaseError(kind, Box::new(message.to_owned())))
  }

  /// Ports `TaskEndpointsTests.SerializationAndDeadlockErrors_AreRecognizedThroughDbUpdateException`: 40001
  /// reaches Diesel as its own kind, 40P01 as an unknown kind with the server's message.
  #[test]
  fn serialization_and_deadlock_errors_are_recognized() {
    assert!(database_error(DatabaseErrorKind::SerializationFailure, "database conflict").is_serialization_or_deadlock());
    assert!(database_error(DatabaseErrorKind::Unknown, "deadlock detected").is_serialization_or_deadlock());
  }

  #[test]
  fn other_errors_are_not_serialization_or_deadlock() {
    assert!(!database_error(DatabaseErrorKind::Unknown, "database conflict").is_serialization_or_deadlock());
    assert!(!database_error(DatabaseErrorKind::CheckViolation, "deadlock detected").is_serialization_or_deadlock());
    assert!(!Error::Conflict.is_serialization_or_deadlock());
    assert!(!Error::from(DieselError::NotFound).is_serialization_or_deadlock());
  }
}
