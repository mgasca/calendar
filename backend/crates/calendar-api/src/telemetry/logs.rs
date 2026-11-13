//! Turns `tracing` events into OpenTelemetry log records, copying only allow-listed fields.
//!
//! This replaces `opentelemetry-appender-tracing`, which copies every field of an event, while an SDK log
//! record cannot drop an attribute once it has one. The record's trace and span ids come from the
//! OpenTelemetry context that `tracing-opentelemetry` activates while a span is entered.

use std::fmt;

use opentelemetry::logs::{AnyValue, LogRecord, Logger, LoggerProvider, Severity};
use opentelemetry_sdk::logs::{SdkLogger, SdkLoggerProvider};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::Layer;
use tracing_subscriber::layer::Context;

use crate::telemetry::SCOPE;
use crate::telemetry::allow_list::is_allowed;

/// The layer that exports events as log records.
pub struct LogBridge {
  logger: SdkLogger,
}

impl LogBridge {
  /// Exports to `provider`.
  pub fn new(provider: &SdkLoggerProvider) -> Self {
    Self {
      logger: provider.logger(SCOPE),
    }
  }
}

fn severity(level: Level) -> Severity {
  match level {
    Level::TRACE => Severity::Trace,
    Level::DEBUG => Severity::Debug,
    Level::INFO => Severity::Info,
    Level::WARN => Severity::Warn,
    Level::ERROR => Severity::Error,
  }
}

impl<S: Subscriber> Layer<S> for LogBridge {
  fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
    let metadata = event.metadata();
    let mut record = self.logger.create_log_record();
    record.set_target(metadata.target());
    record.set_event_name(metadata.name());
    record.set_severity_number(severity(*metadata.level()));
    record.set_severity_text(metadata.level().as_str());
    event.record(&mut AllowedFields { record: &mut record });
    self.logger.emit(record);
  }
}

/// Copies the message into the body and the allow-listed fields into attributes; ignores the rest.
struct AllowedFields<'a, R> {
  record: &'a mut R,
}

impl<R: LogRecord> Visit for AllowedFields<'_, R> {
  fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
    if field.name() == "message" {
      self.record.set_body(AnyValue::from(format!("{value:?}")));
    } else if is_allowed(field.name()) {
      self.record.add_attribute(field.name(), format!("{value:?}"));
    }
  }

  fn record_str(&mut self, field: &Field, value: &str) {
    if field.name() == "message" {
      self.record.set_body(AnyValue::from(value.to_owned()));
    } else if is_allowed(field.name()) {
      self.record.add_attribute(field.name(), value.to_owned());
    }
  }

  fn record_i64(&mut self, field: &Field, value: i64) {
    if is_allowed(field.name()) {
      self.record.add_attribute(field.name(), value);
    }
  }

  fn record_u64(&mut self, field: &Field, value: u64) {
    if is_allowed(field.name()) {
      self.record.add_attribute(field.name(), i64::try_from(value).unwrap_or(i64::MAX));
    }
  }

  fn record_bool(&mut self, field: &Field, value: bool) {
    if is_allowed(field.name()) {
      self.record.add_attribute(field.name(), value);
    }
  }
}
