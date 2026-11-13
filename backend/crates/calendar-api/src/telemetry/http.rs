//! One server span per routed request, joined to the caller's W3C `traceparent`, and the HTTP server request
//! duration histogram (whose count is the request count).

use std::time::Instant;

use axum::extract::{MatchedPath, Request, State};
use axum::http::{HeaderMap, Method};
use axum::middleware::Next;
use axum::response::Response;
use opentelemetry::KeyValue;
use opentelemetry::metrics::{Histogram, Meter};
use opentelemetry::propagation::{Extractor, TextMapPropagator};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use tracing::Instrument;
use tracing::field::Empty;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::state::AppState;

/// The route of the startup, liveness and readiness probes. It is counted but not traced: the probes call it every
/// few seconds per replica, so a span each would be most of what the API exports.
const HEALTH_ROUTE: &str = "/api/health";

/// The OpenTelemetry semantic-convention buckets for `http.server.request.duration`, in seconds.
const DURATION_BUCKETS: [f64; 14] = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0];

/// The HTTP server metrics.
#[derive(Clone)]
pub struct HttpMetrics {
  duration: Histogram<f64>,
}

impl HttpMetrics {
  /// The instruments, from `meter`.
  pub fn new(meter: &Meter) -> Self {
    Self {
      duration: meter
        .f64_histogram("http.server.request.duration")
        .with_unit("s")
        .with_description("Duration of HTTP server requests.")
        .with_boundaries(DURATION_BUCKETS.to_vec())
        .build(),
    }
  }

  fn record(&self, seconds: f64, method: &'static str, route: Option<&str>, status: u16) {
    let mut attributes = Vec::with_capacity(3);
    attributes.push(KeyValue::new("http.request.method", method));
    if let Some(route) = route {
      attributes.push(KeyValue::new("http.route", route.to_owned()));
    }
    attributes.push(KeyValue::new("http.response.status_code", i64::from(status)));
    self.duration.record(seconds, &attributes);
  }
}

/// The method as the semantic conventions name it: one of the known methods, else `_OTHER`, so a client
/// cannot put text of its own into a span name or a metric label.
fn method_name(method: &Method) -> &'static str {
  match *method {
    Method::GET => "GET",
    Method::HEAD => "HEAD",
    Method::POST => "POST",
    Method::PUT => "PUT",
    Method::DELETE => "DELETE",
    Method::PATCH => "PATCH",
    Method::OPTIONS => "OPTIONS",
    Method::CONNECT => "CONNECT",
    Method::TRACE => "TRACE",
    _ => "_OTHER",
  }
}

/// Reads W3C trace context headers.
struct HeaderExtractor<'a>(&'a HeaderMap);

impl Extractor for HeaderExtractor<'_> {
  fn get(&self, key: &str) -> Option<&str> {
    self.0.get(key).and_then(|value| value.to_str().ok())
  }

  fn keys(&self) -> Vec<&str> {
    self.0.keys().map(axum::http::HeaderName::as_str).collect()
  }
}

/// Wraps a routed request in its server span and records its duration. The span is named
/// `<METHOD> <route template>` (`GET /api/tasks/{id}`), or `<METHOD>` when no route matched; it carries only
/// the method, the route template and the status code, never the path's values or the query string.
pub async fn middleware(State(state): State<AppState>, request: Request, next: Next) -> Response {
  let method = method_name(request.method());
  let route = request.extensions().get::<MatchedPath>().map(|path| path.as_str().to_owned());
  if route.as_deref() == Some(HEALTH_ROUTE) {
    let started = Instant::now();
    let response = next.run(request).await;
    let status = response.status().as_u16();
    state
      .http_metrics()
      .record(started.elapsed().as_secs_f64(), method, route.as_deref(), status);
    return response;
  }
  let name = match &route {
    Some(route) => format!("{method} {route}"),
    None => method.to_owned(),
  };
  let span = tracing::info_span!(
    "http.server.request",
    otel.name = %name,
    otel.kind = "server",
    otel.status_code = Empty,
    http.request.method = method,
    http.route = route.as_deref(),
    http.response.status_code = Empty,
    error.type = Empty,
  );
  if !span.is_disabled() {
    let parent = TraceContextPropagator::new().extract(&HeaderExtractor(request.headers()));
    let _ = span.set_parent(parent);
  }

  let started = Instant::now();
  let response = next.run(request).instrument(span.clone()).await;
  let status = response.status().as_u16();
  span.record("http.response.status_code", status);
  if response.status().is_server_error() {
    span.record("otel.status_code", "error");
    span.record("error.type", status.to_string());
  }
  // One log record per traced request, inside its span, so the request's logs carry its trace id even when it
  // succeeds (ADR-0062: a flow's logs are found by its trace id). Only allow-listed fields; never the path or query.
  if !span.is_disabled() {
    span.in_scope(|| {
      tracing::info!(
        http.request.method = method,
        http.route = route.as_deref(),
        http.response.status_code = status,
        "request finished"
      );
    });
  }
  state
    .http_metrics()
    .record(started.elapsed().as_secs_f64(), method, route.as_deref(), status);
  response
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn unknown_methods_are_named_other() {
    assert_eq!(method_name(&Method::from_bytes(b"PROPFIND").unwrap()), "_OTHER");
    assert_eq!(method_name(&Method::PUT), "PUT");
  }
}
