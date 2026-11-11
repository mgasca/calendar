//! RFC 9457 problem details, in the shape ASP.NET Core wrote them: `type`, `title`, `status`, then `detail`
//! and `errors` when present, then `traceId`.

use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, EXPIRES, PRAGMA};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

/// The media type of a problem response.
pub const PROBLEM_JSON: &str = "application/problem+json";

/// The title of every validation problem.
pub const VALIDATION_TITLE: &str = "One or more validation errors occurred.";

/// A problem-details response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
  status: StatusCode,
  title: Option<String>,
  detail: Option<String>,
  errors: Option<Vec<(String, Vec<String>)>>,
  no_cache: bool,
  headers: Vec<(HeaderName, HeaderValue)>,
}

impl Problem {
  /// A problem with the standard title of `status`, as the status-code pages wrote for a bare status.
  pub fn status(status: StatusCode) -> Self {
    Self {
      status,
      title: None,
      detail: None,
      errors: None,
      no_cache: false,
      headers: Vec::new(),
    }
  }

  /// A problem with its own title.
  pub fn titled(status: StatusCode, title: impl Into<String>) -> Self {
    Self {
      title: Some(title.into()),
      ..Self::status(status)
    }
  }

  /// `404 Not Found` with the standard title: an unknown route.
  pub fn not_found() -> Self {
    Self::status(StatusCode::NOT_FOUND)
  }

  /// A `400` validation problem listing `errors` by field, in the order given.
  pub fn validation(errors: Vec<(String, Vec<String>)>) -> Self {
    Self {
      errors: Some(errors),
      ..Self::titled(StatusCode::BAD_REQUEST, VALIDATION_TITLE)
    }
  }

  /// The `400` of a request that could not be bound and names no field (`BadRequestExceptionHandler`).
  pub fn bad_request() -> Self {
    Self {
      no_cache: true,
      ..Self::titled(StatusCode::BAD_REQUEST, "Bad request.")
    }
  }

  /// The `400` validation problem of a JSON body that could not be read, naming the offending field.
  pub fn binding(field: impl Into<String>, message: impl Into<String>) -> Self {
    Self {
      no_cache: true,
      ..Self::validation(vec![(field.into(), vec![message.into()])])
    }
  }

  /// Adds the `detail` member.
  #[must_use]
  pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
    self.detail = Some(detail.into());
    self
  }

  /// Adds a response header (a `Set-Cookie` that ends a rejected session, for example).
  #[must_use]
  pub fn with_header(mut self, name: HeaderName, value: HeaderValue) -> Self {
    self.headers.push((name, value));
    self
  }

  /// The HTTP status.
  pub fn status_code(&self) -> StatusCode {
    self.status
  }

  /// The JSON body.
  pub fn body(&self) -> Value {
    let (reference, default_title) = defaults(self.status);
    let mut body = Map::new();
    if let Some(reference) = reference {
      body.insert("type".to_owned(), json!(reference));
    }
    if let Some(title) = self.title.as_deref().or(default_title) {
      body.insert("title".to_owned(), json!(title));
    }
    body.insert("status".to_owned(), json!(self.status.as_u16()));
    if let Some(detail) = &self.detail {
      body.insert("detail".to_owned(), json!(detail));
    }
    if let Some(errors) = &self.errors {
      let errors: Map<String, Value> = errors.iter().map(|(field, messages)| (field.clone(), json!(messages))).collect();
      body.insert("errors".to_owned(), Value::Object(errors));
    }
    body.insert("traceId".to_owned(), json!(trace_id()));
    Value::Object(body)
  }
}

impl IntoResponse for Problem {
  fn into_response(self) -> Response {
    let mut response = (self.status, self.body().to_string()).into_response();
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(PROBLEM_JSON));
    if self.no_cache {
      // The ASP.NET exception handler cleared the caching headers of the responses it wrote.
      headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache,no-store"));
      headers.insert(EXPIRES, HeaderValue::from_static("-1"));
      headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
    }
    for (name, value) in self.headers {
      headers.append(name, value);
    }
    response
  }
}

/// The RFC 9110 section and reason phrase ASP.NET Core's problem-details defaults give a status.
fn defaults(status: StatusCode) -> (Option<String>, Option<&'static str>) {
  let (section, title) = match status.as_u16() {
    400 => ("15.5.1", "Bad Request"),
    401 => ("15.5.2", "Unauthorized"),
    403 => ("15.5.4", "Forbidden"),
    404 => ("15.5.5", "Not Found"),
    405 => ("15.5.6", "Method Not Allowed"),
    406 => ("15.5.7", "Not Acceptable"),
    408 => ("15.5.9", "Request Timeout"),
    409 => ("15.5.10", "Conflict"),
    412 => ("15.5.13", "Precondition Failed"),
    413 => ("15.5.14", "Content Too Large"),
    415 => ("15.5.16", "Unsupported Media Type"),
    422 => ("15.5.21", "Unprocessable Entity"),
    426 => ("15.5.22", "Upgrade Required"),
    500 => ("15.6.1", "An error occurred while processing your request."),
    502 => ("15.6.3", "Bad Gateway"),
    503 => ("15.6.4", "Service Unavailable"),
    504 => ("15.6.5", "Gateway Timeout"),
    _ => return (None, status.canonical_reason()),
  };
  (Some(format!("https://tools.ietf.org/html/rfc9110#section-{section}")), Some(title))
}

/// A fresh W3C trace id, in the `00-<trace>-<span>-00` form of the `traceId` ASP.NET Core added.
fn trace_id() -> String {
  let (trace, span): (u128, u64) = (rand::random(), rand::random());
  format!("00-{trace:032x}-{span:016x}-00")
}

#[cfg(test)]
mod tests {
  use super::*;

  fn without_trace(problem: &Problem) -> String {
    let mut body = problem.body();
    let trace = body.as_object_mut().unwrap().remove("traceId").unwrap();
    assert_eq!(trace.as_str().unwrap().len(), 55);
    body.to_string()
  }

  #[test]
  fn a_bare_status_has_the_standard_type_and_title() {
    assert_eq!(
      without_trace(&Problem::status(StatusCode::UNAUTHORIZED)),
      r#"{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.2","title":"Unauthorized","status":401}"#
    );
    assert_eq!(
      without_trace(&Problem::not_found()),
      r#"{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found","status":404}"#
    );
  }

  #[test]
  fn members_are_in_the_dotnet_order() {
    let problem = Problem::titled(StatusCode::SERVICE_UNAVAILABLE, "Google sign-in is not configured.").with_detail("Set it.");
    assert_eq!(
      without_trace(&problem),
      r#"{"type":"https://tools.ietf.org/html/rfc9110#section-15.6.4","title":"Google sign-in is not configured.","status":503,"detail":"Set it."}"#
    );
    let validation = Problem::validation(vec![
      ("start".to_owned(), vec!["start is required for a timed event.".to_owned()]),
      ("end".to_owned(), vec!["a".to_owned(), "b".to_owned()]),
    ]);
    assert_eq!(
      without_trace(&validation),
      concat!(
        r#"{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"One or more validation errors occurred.","status":400,"#,
        r#""errors":{"start":["start is required for a timed event."],"end":["a","b"]}}"#
      )
    );
  }

  #[test]
  fn binding_failures_forbid_caching() {
    let response = Problem::bad_request().into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers()[CONTENT_TYPE], PROBLEM_JSON);
    assert_eq!(response.headers()[CACHE_CONTROL], "no-cache,no-store");
    assert_eq!(response.headers()[EXPIRES], "-1");
    assert_eq!(response.headers()[PRAGMA], "no-cache");
    assert!(!Problem::not_found().into_response().headers().contains_key(CACHE_CONTROL));
  }
}
