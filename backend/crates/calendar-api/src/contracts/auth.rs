use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The body of `GET /api/health`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(description = "")]
pub struct HealthResponse {
  #[allow(missing_docs, reason = "undocumented in the contract")]
  pub status: String,
}

/// The signed-in person, as `GET /api/auth/me` returns them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(description = "")]
pub struct AuthUserResponse {
  #[allow(missing_docs, reason = "undocumented in the contract")]
  pub name: String,
  #[allow(missing_docs, reason = "undocumented in the contract")]
  pub email: String,
  #[allow(missing_docs, reason = "undocumented in the contract")]
  #[schema(required = true)]
  pub picture_url: Option<String>,
}
