//! What the host does around the endpoints (ports the middleware of `Program.cs`): forwarded headers from
//! the one trusted proxy hop, HSTS and the HTTPS redirect outside Development, case-insensitive API paths,
//! and the web app's static files with their cache rules.

use std::path::Path;

use axum::body::Body;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::header::{ALLOW, CACHE_CONTROL, HOST, LOCATION, STRICT_TRANSPORT_SECURITY};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tower::ServiceExt;
use tower_http::services::ServeDir;

use crate::config::Settings;
use crate::problem::Problem;
use crate::state::AppState;

/// The scheme and host the client used, as far as the API can tell: from `X-Forwarded-Proto` and
/// `X-Forwarded-Host` when the proxy sent them, else from the request itself.
///
/// The container is reachable only through the Container Apps ingress (ADR-0027), so exactly one hop is
/// trusted: of each forwarded header only the last entry, the one that hop wrote, is used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestOrigin {
  /// `http` or `https`.
  pub scheme: String,
  /// The host, with its port when it is not the default one.
  pub host: String,
}

impl RequestOrigin {
  /// The origin of a request with these headers and URI.
  pub fn of(headers: &HeaderMap, uri: &Uri) -> Self {
    let forwarded = |name: &str| {
      headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    };
    let scheme = forwarded("x-forwarded-proto")
      .filter(|proto| proto.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
      .unwrap_or("http");
    let own_host = headers
      .get(HOST)
      .and_then(|value| value.to_str().ok())
      .or_else(|| uri.authority().map(axum::http::uri::Authority::as_str))
      .unwrap_or("");
    let host = forwarded("x-forwarded-host")
      .filter(|host| {
        host
          .chars()
          .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']'))
      })
      .unwrap_or(own_host);
    Self {
      scheme: scheme.to_owned(),
      host: host.to_owned(),
    }
  }

  /// The origin the hosting middleware recorded, or the one the request shows.
  pub fn of_parts(parts: &Parts) -> Self {
    parts
      .extensions
      .get::<Self>()
      .cloned()
      .unwrap_or_else(|| Self::of(&parts.headers, &parts.uri))
  }

  /// Whether the client used HTTPS.
  pub fn is_https(&self) -> bool {
    self.scheme.eq_ignore_ascii_case("https")
  }

  /// Whether cookies carry `Secure`: always outside Development; in Development, when the request is HTTPS.
  pub fn secure_cookies(&self, settings: &Settings) -> bool {
    !settings.is_development() || self.is_https()
  }

  /// `scheme://host`, the base of absolute URLs to this API (`Location` headers, the OAuth redirect URI).
  pub fn base_url(&self) -> String {
    format!("{}://{}", self.scheme, self.host)
  }
}

impl<S: Sync> FromRequestParts<S> for RequestOrigin {
  type Rejection = std::convert::Infallible;

  fn from_request_parts(parts: &mut Parts, _state: &S) -> impl Future<Output = Result<Self, Self::Rejection>> {
    std::future::ready(Ok(Self::of_parts(parts)))
  }
}

/// Whether `path` is `segment` or below it, ignoring case (`PathString.StartsWithSegments`).
pub fn starts_with_segment(path: &str, segment: &str) -> bool {
  path.get(..segment.len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case(segment))
    && matches!(path.as_bytes().get(segment.len()), None | Some(b'/'))
}

/// Whether `path` belongs to the API rather than to the web app.
pub fn is_api_path(path: &str) -> bool {
  starts_with_segment(path, "/api")
}

/// ASP.NET Core matched routes ignoring case and a trailing slash; axum matches exactly. API and OpenAPI
/// paths are therefore lower-cased and stripped of trailing slashes before routing.
fn normalized_uri(uri: &Uri) -> Option<Uri> {
  let path = uri.path();
  if !is_api_path(path) && !starts_with_segment(path, "/openapi") {
    return None;
  }
  let trimmed = path.trim_end_matches('/');
  let normalized = trimmed.to_ascii_lowercase();
  if normalized == path {
    return None;
  }
  let path_and_query = match uri.query() {
    Some(query) => format!("{normalized}?{query}"),
    None => normalized,
  };
  let mut parts = uri.clone().into_parts();
  parts.path_and_query = Some(path_and_query.parse().ok()?);
  Uri::from_parts(parts).ok()
}

/// The middleware in front of the router.
pub async fn middleware(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
  let settings = state.settings();
  let origin = RequestOrigin::of(request.headers(), request.uri());

  if !settings.is_development()
    && !origin.is_https()
    && let Some(port) = settings.https_port
  {
    return https_redirect(&origin, request.uri(), port);
  }

  if let Some(uri) = normalized_uri(request.uri()) {
    *request.uri_mut() = uri;
  }

  if request.method() == Method::HEAD && is_api_path(request.uri().path()) {
    // ASP.NET Core's `MapGet` matched GET only, so a HEAD fell through to the 404; axum would answer it.
    return Problem::not_found().into_response();
  }

  let served = match static_probe(&request) {
    Some(probe) => static_file(&settings.web_root, probe).await,
    None => None,
  };
  let mut response = if let Some(response) = served {
    response
  } else {
    request.extensions_mut().insert(origin.clone());
    next.run(request).await
  };

  if response.status() == StatusCode::NOT_FOUND {
    // axum names the allowed methods when a path matches under another method; ASP.NET Core answered a bare 404.
    response.headers_mut().remove(ALLOW);
  }
  if !settings.is_development() && origin.is_https() && !is_loopback_host(&origin.host) {
    response
      .headers_mut()
      .insert(STRICT_TRANSPORT_SECURITY, HeaderValue::from_static("max-age=2592000"));
  }
  response
}

fn https_redirect(origin: &RequestOrigin, uri: &Uri, port: u16) -> Response {
  let host = origin.host.rsplit_once(':').map_or(origin.host.as_str(), |(host, port)| {
    if port.bytes().all(|byte| byte.is_ascii_digit()) {
      host
    } else {
      origin.host.as_str()
    }
  });
  let port = if port == 443 { String::new() } else { format!(":{port}") };
  let path_and_query = uri.path_and_query().map_or("/", axum::http::uri::PathAndQuery::as_str);
  let mut response = StatusCode::TEMPORARY_REDIRECT.into_response();
  if let Ok(location) = HeaderValue::from_str(&format!("https://{host}{port}{path_and_query}")) {
    response.headers_mut().insert(LOCATION, location);
  }
  response
}

/// The hosts ASP.NET Core's HSTS middleware never sends the header to.
fn is_loopback_host(host: &str) -> bool {
  let name = if host.starts_with('[') {
    host.split_once(']').map_or(host, |(name, _)| &host[..=name.len()])
  } else {
    host.split(':').next().unwrap_or(host)
  };
  name.eq_ignore_ascii_case("localhost") || name == "127.0.0.1" || name == "[::1]"
}

/// The `Cache-Control` of a static file: the entry page is always revalidated, and a fingerprinted asset
/// (`/assets/name-HASH8.ext`) never changes. Other files get none.
pub fn static_cache_control(path: &str) -> Option<&'static str> {
  if path.eq_ignore_ascii_case("/index.html") {
    Some("no-cache")
  } else if is_fingerprinted_asset(path) {
    Some("public, max-age=31536000, immutable")
  } else {
    None
  }
}

/// `^/assets/[^/]+-[A-Za-z0-9_-]{8}\.[^/]+$`
fn is_fingerprinted_asset(path: &str) -> bool {
  let Some(file) = path.strip_prefix("/assets/").filter(|file| !file.contains('/')) else {
    return false;
  };
  let bytes = file.as_bytes();
  (1..bytes.len()).any(|dash| {
    bytes[dash] == b'-'
      && bytes
        .get(dash + 1..dash + 9)
        .is_some_and(|hash| hash.iter().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))
      && bytes.get(dash + 9) == Some(&b'.')
      && bytes.len() > dash + 10
  })
}

/// The request to try against the web root, or `None` when the request is for the API, is not a `GET` or
/// `HEAD`, or names a file of an unknown type (which, like ASP.NET Core's static files, is not served).
fn static_probe(request: &Request) -> Option<Request> {
  let path = request.uri().path();
  if is_api_path(path) || !matches!(*request.method(), Method::GET | Method::HEAD) {
    return None;
  }
  mime_guess::from_path(path).first()?;

  let mut probe = Request::builder().method(request.method().clone()).uri(request.uri().clone());
  if let Some(headers) = probe.headers_mut() {
    headers.clone_from(request.headers());
  }
  probe.body(Body::empty()).ok()
}

/// Serves a file of the web root, or `None` when there is no such file, so that routing takes over.
async fn static_file(web_root: &Path, probe: Request) -> Option<Response> {
  let cache_control = static_cache_control(probe.uri().path());
  let response = ServeDir::new(web_root)
    .append_index_html_on_directories(false)
    .oneshot(probe)
    .await
    .ok()?;
  if !(response.status().is_success() || response.status() == StatusCode::NOT_MODIFIED) {
    return None;
  }
  let mut response = response.map(Body::new);
  if let Some(cache_control) = cache_control {
    response
      .headers_mut()
      .insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
  }
  Some(response)
}

/// Whether the last segment of `path` has an extension (`Path.HasExtension`): the web app's client-side
/// routes have none, so a path with one that is not a file is a `404`, not the app.
pub fn has_extension(path: &str) -> bool {
  let file = path.rsplit('/').next().unwrap_or(path);
  file.rfind('.').is_some_and(|dot| dot + 1 < file.len())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn origin(headers: &[(&'static str, &'static str)]) -> RequestOrigin {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
      map.insert(*name, HeaderValue::from_static(value));
    }
    RequestOrigin::of(&map, &Uri::from_static("/api/health"))
  }

  #[test]
  fn the_last_forwarded_entry_is_the_trusted_one() {
    let direct = origin(&[("host", "internal:8080")]);
    assert_eq!((direct.scheme.as_str(), direct.host.as_str()), ("http", "internal:8080"));
    assert!(!direct.is_https());

    let forwarded = origin(&[
      ("host", "internal"),
      ("x-forwarded-proto", "http, https"),
      ("x-forwarded-host", "spoofed.example, calendar.example"),
    ]);
    assert_eq!(forwarded.base_url(), "https://calendar.example");
    assert!(forwarded.is_https());

    let invalid = origin(&[
      ("host", "internal"),
      ("x-forwarded-host", "evil/host"),
      ("x-forwarded-proto", "ja va"),
    ]);
    assert_eq!(invalid.base_url(), "http://internal");
  }

  #[test]
  fn cookies_are_secure_outside_development() {
    let development = Settings::from_vars([("ASPNETCORE_ENVIRONMENT", "Development")]);
    let production = Settings::default();
    let http = origin(&[("host", "h")]);
    let https = origin(&[("host", "h"), ("x-forwarded-proto", "https")]);
    assert!(!http.secure_cookies(&development));
    assert!(https.secure_cookies(&development));
    assert!(http.secure_cookies(&production));
  }

  #[test]
  fn api_paths_are_matched_by_segment_ignoring_case() {
    assert!(is_api_path("/api"));
    assert!(is_api_path("/API/tasks"));
    assert!(!is_api_path("/apix"));
    assert!(!is_api_path("/assets/api"));
    assert!(!is_api_path("/"));
  }

  #[test]
  fn api_paths_are_normalized_for_routing() {
    let normalized = |uri: &'static str| normalized_uri(&Uri::from_static(uri)).map(|uri| uri.to_string());
    assert_eq!(
      normalized("/API/Tasks/?View=Completed").as_deref(),
      Some("/api/tasks?View=Completed")
    );
    assert_eq!(normalized("/api/tasks/").as_deref(), Some("/api/tasks"));
    assert_eq!(normalized("/OpenAPI/v1.json").as_deref(), Some("/openapi/v1.json"));
    assert_eq!(normalized("/api/tasks"), None);
    assert_eq!(normalized("/Day/2026-10-29/"), None);
  }

  #[test]
  fn cache_rules_of_static_files() {
    assert_eq!(static_cache_control("/index.html"), Some("no-cache"));
    assert_eq!(static_cache_control("/INDEX.HTML"), Some("no-cache"));
    assert_eq!(
      static_cache_control("/assets/app-Abc123_X.js"),
      Some("public, max-age=31536000, immutable")
    );
    assert_eq!(
      static_cache_control("/assets/my-app-Abc123_X.min.js"),
      Some("public, max-age=31536000, immutable")
    );
    assert_eq!(static_cache_control("/assets/plain.js"), None);
    assert_eq!(static_cache_control("/assets/app-short.js"), None);
    assert_eq!(static_cache_control("/assets/-Abc123_X.js"), None);
    assert_eq!(static_cache_control("/assets/app-Abc123_X."), None);
    assert_eq!(static_cache_control("/assets/sub/app-Abc123_X.js"), None);
    assert_eq!(static_cache_control("/other/app-Abc123_X.js"), None);
  }

  #[test]
  fn extensions_and_loopback_hosts() {
    assert!(has_extension("/assets/missing.js"));
    assert!(has_extension("/favicon.ico"));
    assert!(!has_extension("/day/2026-10-29"));
    assert!(!has_extension("/"));
    assert!(!has_extension("/a.b/c"));
    assert!(!has_extension("/trailing."));
    assert!(is_loopback_host("localhost:5041"));
    assert!(is_loopback_host("127.0.0.1"));
    assert!(is_loopback_host("[::1]:8080"));
    assert!(!is_loopback_host("calendar.example"));
  }
}
