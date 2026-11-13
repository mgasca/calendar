//! What a handler can fail with, and its HTTP form.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::problem::Problem;

/// A handler's failure: a deliberate problem response, or anything else, which is logged and answered `500`.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
  /// The response to send.
  #[error("problem response {}", .0.status_code())]
  Problem(Box<Problem>),
  /// An unexpected failure. Its text goes to the log, never to the client.
  #[error("{0}")]
  Internal(String),
}

impl ApiError {
  /// An unexpected failure described by `error`.
  pub fn internal(error: impl std::fmt::Display) -> Self {
    Self::Internal(error.to_string())
  }
}

impl From<Problem> for ApiError {
  fn from(problem: Problem) -> Self {
    Self::Problem(Box::new(problem))
  }
}

impl From<calendar_infrastructure::Error> for ApiError {
  fn from(error: calendar_infrastructure::Error) -> Self {
    Self::internal(error)
  }
}

impl IntoResponse for ApiError {
  fn into_response(self) -> Response {
    match self {
      Self::Problem(problem) => problem.into_response(),
      Self::Internal(reason) => {
        tracing::error!(%reason, "the request failed");
        Problem::status(StatusCode::INTERNAL_SERVER_ERROR).into_response()
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_error_displays_its_message_not_its_debug_form() {
    assert_eq!(ApiError::internal("no database connection").to_string(), "no database connection");
    assert_eq!(
      ApiError::from(Problem::status(StatusCode::SERVICE_UNAVAILABLE)).to_string(),
      "problem response 503 Service Unavailable"
    );
  }
}
