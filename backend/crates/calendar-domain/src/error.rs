//! Domain error types.

use thiserror::Error;

/// An argument broke a domain rule.
///
/// `param` is the name of the offending parameter, spelled as the HTTP layer expects it (`title`, `end`,
/// `timeZoneId`, `dueAt`, `ownerId`, ...). `message` is the user-facing sentence, without any parameter suffix.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{message}")]
pub struct ArgumentError {
  /// Name of the offending parameter.
  pub param: &'static str,
  /// User-facing message.
  pub message: String,
}

impl ArgumentError {
  /// Builds an error for `param`.
  pub fn new(param: &'static str, message: impl Into<String>) -> Self {
    Self {
      param,
      message: message.into(),
    }
  }
}

/// The entity's current state does not allow the operation (for example changing a completed task's deadline).
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{message}")]
pub struct InvalidOperationError {
  /// What was refused.
  pub message: String,
}

impl InvalidOperationError {
  /// Builds an error with `message`.
  pub fn new(message: impl Into<String>) -> Self {
    Self { message: message.into() }
  }
}

/// Either kind of domain error, for operations that can fail both ways.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DomainError {
  /// An argument broke a rule.
  #[error(transparent)]
  Argument(#[from] ArgumentError),
  /// The entity's state does not allow the operation.
  #[error(transparent)]
  InvalidOperation(#[from] InvalidOperationError),
}
