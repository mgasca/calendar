//! The privacy rule of ADR-0062: telemetry attributes come from an allow-list, never from request or row
//! content. Anything else (emails, titles, notes, query strings, cookies, tokens, error details) is dropped
//! before export, whichever code recorded it.

use std::time::Duration;

use opentelemetry::Context;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::error::OTelSdkResult;
use opentelemetry_sdk::trace::{Span, SpanData, SpanEvents, SpanProcessor};

/// The attribute keys a span or log record may carry.
pub const ALLOWED_KEYS: &[&str] = &[
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "error.type",
  "db.system.name",
  "db.operation.name",
  "db.collection.name",
  "db.query.text",
];

/// Whether `key` may leave the process.
pub fn is_allowed(key: &str) -> bool {
  ALLOWED_KEYS.contains(&key)
}

/// Removes every attribute that is not allow-listed from each span, and every span event (log records carry
/// what events say, under the same rule), before handing the span to the next processor.
#[derive(Debug)]
pub struct AllowListSpanProcessor<P> {
  next: P,
}

impl<P> AllowListSpanProcessor<P> {
  /// Filters spans on their way to `next`.
  pub fn new(next: P) -> Self {
    Self { next }
  }
}

/// `span` with only allow-listed attributes and no events.
pub fn redact(mut span: SpanData) -> SpanData {
  let before = span.attributes.len();
  span.attributes.retain(|attribute| is_allowed(attribute.key.as_str()));
  let removed = u32::try_from(before - span.attributes.len()).unwrap_or(u32::MAX);
  span.dropped_attributes_count = span.dropped_attributes_count.saturating_add(removed);
  span.events = SpanEvents::default();
  span
}

impl<P: SpanProcessor> SpanProcessor for AllowListSpanProcessor<P> {
  fn on_start(&self, span: &mut Span, cx: &Context) {
    self.next.on_start(span, cx);
  }

  fn on_end(&self, span: SpanData) {
    self.next.on_end(redact(span));
  }

  fn force_flush(&self) -> OTelSdkResult {
    self.next.force_flush()
  }

  fn shutdown_with_timeout(&self, timeout: Duration) -> OTelSdkResult {
    self.next.shutdown_with_timeout(timeout)
  }

  fn set_resource(&mut self, resource: &Resource) {
    self.next.set_resource(resource);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn route_templates_and_database_shapes_are_allowed() {
    for key in [
      "http.route",
      "http.request.method",
      "http.response.status_code",
      "db.query.text",
      "db.collection.name",
    ] {
      assert!(is_allowed(key), "{key}");
    }
  }

  #[test]
  fn content_and_raw_request_data_are_not() {
    for key in [
      "url.full",
      "url.query",
      "url.path",
      "http.request.header.cookie",
      "user_agent.original",
      "client.address",
      "enduser.id",
      "reason",
      "message",
      "title",
      "email",
      "code.filepath",
      "thread.name",
    ] {
      assert!(!is_allowed(key), "{key}");
    }
  }
}
