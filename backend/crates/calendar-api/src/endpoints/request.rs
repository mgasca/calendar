//! Reading the parts of a request the way ASP.NET Core's minimal APIs bound them, and writing JSON responses.

use axum::extract::{FromRequestParts, Path};
use axum::http::header::{CONTENT_TYPE, LOCATION};
use axum::http::request::Parts;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::NaiveDate;
use serde::Serialize;
use uuid::Uuid;

use crate::error::ApiError;
use crate::problem::Problem;
use crate::text::ordinal_ignore_case_eq;
use crate::wire;

/// The media type of every JSON response.
pub const JSON: &str = "application/json; charset=utf-8";

/// A JSON response with `status`.
pub fn json<T: Serialize>(status: StatusCode, body: &T) -> Result<Response, ApiError> {
  let text = serde_json::to_string(body).map_err(ApiError::internal)?;
  let mut response = (status, text).into_response();
  response.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static(JSON));
  Ok(response)
}

/// `200 OK` with a JSON body.
pub fn ok<T: Serialize>(body: &T) -> Result<Response, ApiError> {
  json(StatusCode::OK, body)
}

/// `201 Created` with a JSON body and the absolute `Location` of the new resource.
pub fn created<T: Serialize>(location: &str, body: &T) -> Result<Response, ApiError> {
  let mut response = json(StatusCode::CREATED, body)?;
  if let Ok(location) = HeaderValue::from_str(location) {
    response.headers_mut().insert(LOCATION, location);
  }
  Ok(response)
}

/// The query string. Names match ignoring case, and a name given several times has its values joined with
/// commas, as ASP.NET Core bound a `StringValues` to a single parameter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QueryParams(Vec<(String, String)>);

impl QueryParams {
  /// Parses a raw query string.
  pub fn parse(query: &str) -> Self {
    Self(form_urlencoded::parse(query.as_bytes()).into_owned().collect())
  }

  /// The value of `name`, or `None` when the query does not have it.
  pub fn get(&self, name: &str) -> Option<String> {
    let mut values = self
      .0
      .iter()
      .filter(|(key, _)| ordinal_ignore_case_eq(key, name))
      .map(|(_, value)| value.as_str());
    let first = values.next()?;
    Some(values.fold(first.to_owned(), |joined, value| joined + "," + value))
  }

  /// An optional date. A value that is not a date fails the binding: `400 Bad request.`
  pub fn date(&self, name: &str) -> Result<Option<NaiveDate>, Problem> {
    self
      .get(name)
      .map(|value| wire::parse_query_date(&value).ok_or_else(Problem::bad_request))
      .transpose()
  }

  /// An optional `int`. A value that is not one fails the binding: `400 Bad request.`
  pub fn int(&self, name: &str) -> Result<Option<i32>, Problem> {
    self
      .get(name)
      .map(|value| value.trim().parse::<i32>().map_err(|_| Problem::bad_request()))
      .transpose()
  }
}

impl<S: Sync> FromRequestParts<S> for QueryParams {
  type Rejection = std::convert::Infallible;

  fn from_request_parts(parts: &mut Parts, _state: &S) -> impl Future<Output = Result<Self, Self::Rejection>> {
    std::future::ready(Ok(Self::parse(parts.uri.query().unwrap_or_default())))
  }
}

/// The `{id}` of a route with the `guid` constraint. A segment that is not a GUID matched no route in
/// ASP.NET Core and fell through to the anonymous `404`, so put this before the authentication extractor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RouteId(pub Uuid);

impl<S: Send + Sync> FromRequestParts<S> for RouteId {
  type Rejection = Problem;

  async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
    let Path(segment) = Path::<String>::from_request_parts(parts, state)
      .await
      .map_err(|_| Problem::not_found())?;
    parse_route_guid(&segment).map(Self).ok_or_else(Problem::not_found)
  }
}

/// Reads a GUID in the forms `Guid.TryParse` accepts in a route: 32 digits, hyphenated, and hyphenated in
/// braces or parentheses.
pub fn parse_route_guid(segment: &str) -> Option<Uuid> {
  let segment = segment.trim();
  let inner = segment
    .strip_prefix('{')
    .and_then(|rest| rest.strip_suffix('}'))
    .or_else(|| segment.strip_prefix('(').and_then(|rest| rest.strip_suffix(')')));
  let (digits, lengths): (&str, &[usize]) = match inner {
    Some(hyphenated) => (hyphenated, &[36]),
    None => (segment, &[32, 36]),
  };
  lengths.contains(&digits.len()).then(|| Uuid::try_parse(digits).ok()).flatten()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn query_names_ignore_case_and_repeated_values_are_joined() {
    let query = QueryParams::parse("VIEW=completed&view=overdue&timeZone=Europe%2FMadrid&cursor=&a+b=c+d");
    assert_eq!(query.get("view").as_deref(), Some("completed,overdue"));
    assert_eq!(query.get("timezone").as_deref(), Some("Europe/Madrid"));
    assert_eq!(query.get("cursor").as_deref(), Some(""));
    assert_eq!(query.get("a b").as_deref(), Some("c d"));
    assert_eq!(query.get("missing"), None);
  }

  #[test]
  fn typed_query_values_fail_the_binding_when_malformed() {
    let query = QueryParams::parse("today=2026-11-11&bad=abc&empty=&limit=%2020&big=99999999999");
    assert_eq!(query.date("today"), Ok(NaiveDate::from_ymd_opt(2026, 11, 11)));
    assert_eq!(query.date("missing"), Ok(None));
    assert!(query.date("bad").is_err());
    assert!(query.date("empty").is_err());
    assert_eq!(query.int("limit"), Ok(Some(20)));
    assert!(query.int("bad").is_err());
    assert!(query.int("empty").is_err());
    assert!(query.int("big").is_err());
  }

  #[test]
  fn route_guids_come_in_the_dotnet_forms() {
    let id = Uuid::from_u128(1);
    assert_eq!(parse_route_guid("00000000-0000-0000-0000-000000000001"), Some(id));
    assert_eq!(parse_route_guid("00000000000000000000000000000001"), Some(id));
    assert_eq!(parse_route_guid("{00000000-0000-0000-0000-000000000001}"), Some(id));
    assert_eq!(parse_route_guid("(00000000-0000-0000-0000-000000000001)"), Some(id));
    assert_eq!(parse_route_guid("not-a-guid"), None);
    assert_eq!(parse_route_guid("{00000000000000000000000000000001}"), None);
    assert_eq!(parse_route_guid("urn:uuid:00000000-0000-0000-0000-000000000001"), None);
    assert_eq!(parse_route_guid(""), None);
  }
}
