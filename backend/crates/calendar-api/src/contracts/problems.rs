use std::collections::BTreeMap;

use utoipa::ToSchema;

/// RFC 9457 problem details. Documentation only: responses are written by [`crate::problem::Problem`].
#[derive(Debug, ToSchema)]
#[schema(description = "")]
#[allow(dead_code, reason = "describes a response body in the OpenAPI document; never constructed")]
pub struct ProblemDetails {
  r#type: Option<String>,
  title: Option<String>,
  status: Option<i32>,
  detail: Option<String>,
  instance: Option<String>,
}

/// Problem details of a `400` with the invalid fields. Documentation only.
#[derive(Debug, ToSchema)]
#[schema(description = "")]
#[allow(dead_code, reason = "describes a response body in the OpenAPI document; never constructed")]
pub struct HttpValidationProblemDetails {
  r#type: Option<String>,
  title: Option<String>,
  status: Option<i32>,
  detail: Option<String>,
  instance: Option<String>,
  #[schema(required = false)]
  errors: BTreeMap<String, Vec<String>>,
}
