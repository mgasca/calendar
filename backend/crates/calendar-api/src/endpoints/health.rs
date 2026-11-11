//! `GET /api/health`: anonymous, and independent of the database.

use axum::response::Response;

use super::request;
use crate::contracts::HealthResponse;
use crate::error::ApiError;

// Answers `{"status":"ok"}`.
#[utoipa::path(
  get,
  path = "/api/health",
  operation_id = "GetHealth",
  tag = "Health",
  responses((status = 200, description = "OK", body = HealthResponse))
)]
pub async fn get_health() -> Result<Response, ApiError> {
  request::ok(&HealthResponse { status: "ok".to_owned() })
}
