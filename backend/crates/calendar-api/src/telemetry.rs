//! OpenTelemetry for the API (ADR-0062): request and database spans, logs and HTTP server metrics, exported
//! over OTLP to wherever the standard `OTEL_*` variables point.
//!
//! - **Off unless configured.** With no `OTEL_EXPORTER_OTLP_ENDPOINT` (or per-signal endpoint), no exporter is
//!   built and the API logs to standard output exactly as before ([`init`]).
//! - **One subscriber.** `tracing` stays the instrumentation API: [`subscriber`] adds to the plain-text stdout
//!   layer a `tracing-opentelemetry` layer for spans and the [`logs::LogBridge`] for events. The stdout layer
//!   sees events only, so its lines do not change when request spans exist.
//! - **Privacy by allow-list.** Only the attribute keys in [`allow_list`] leave the process: spans pass through
//!   [`allow_list::AllowListSpanProcessor`], the log bridge copies only allowed fields, and the metrics carry
//!   only the attributes [`http::HttpMetrics`] sets.
//! - **Spans.** [`http::middleware`] makes one server span per routed request, a child of the W3C
//!   `traceparent` it carries; [`db::DatabaseSpans`] makes one client span per Diesel query, without bind values.

pub mod allow_list;
pub mod db;
pub mod http;
pub mod logs;

use std::time::Duration;

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::{BatchLogProcessor, LogExporter, SdkLoggerProvider, SimpleLogProcessor};
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider, exporter::PushMetricExporter};
use opentelemetry_sdk::trace::{BatchSpanProcessor, SdkTracerProvider, SimpleSpanProcessor, SpanExporter};
use tracing::{Level, Metadata, Subscriber};
use tracing_subscriber::filter::{FilterFn, filter_fn};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{Layer, Registry};

use crate::telemetry::allow_list::AllowListSpanProcessor;
use crate::telemetry::logs::LogBridge;

/// The service name when `OTEL_SERVICE_NAME` does not set one.
pub const DEFAULT_SERVICE_NAME: &str = "calendar-api";

/// The instrumentation scope of the API's tracer and meter.
pub const SCOPE: &str = "calendar-api";

/// How a signal is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
  /// OTLP over gRPC (`grpc`): what the Azure Container Apps managed agent accepts.
  Grpc,
  /// OTLP over HTTP with protobuf bodies (`http/protobuf`), the OTLP default.
  HttpProtobuf,
}

/// Which signals are exported, and how: read from the standard `OTEL_*` variables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TelemetryConfig {
  /// Traces, when an endpoint for them is set.
  pub traces: Option<Protocol>,
  /// Logs, when an endpoint for them is set.
  pub logs: Option<Protocol>,
  /// Metrics, when an endpoint for them is set.
  pub metrics: Option<Protocol>,
}

/// A telemetry configuration the API refuses to start with.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TelemetryError {
  /// `OTEL_EXPORTER_OTLP_PROTOCOL` (or a per-signal one) names a protocol this build does not export.
  #[error("{variable} '{value}' is not supported: use grpc or http/protobuf")]
  UnsupportedProtocol {
    /// The variable.
    variable: String,
    /// Its value.
    value: String,
  },
  /// An exporter cannot be built from the configuration.
  #[error("the OTLP {signal} exporter could not be created: {reason}")]
  Exporter {
    /// `traces`, `logs` or `metrics`.
    signal: &'static str,
    /// What the SDK said.
    reason: String,
  },
}

impl TelemetryConfig {
  /// The configuration of the process environment.
  pub fn from_env() -> Result<Self, TelemetryError> {
    Self::from_lookup(|name| std::env::var(name).ok())
  }

  /// The configuration `lookup` describes. A signal is exported when its own endpoint
  /// (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, ...) or the generic `OTEL_EXPORTER_OTLP_ENDPOINT` is set, unless
  /// `OTEL_SDK_DISABLED` is `true` or `OTEL_<SIGNAL>_EXPORTER` is `none`.
  pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, TelemetryError> {
    let value = |name: &str| lookup(name).map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    if value("OTEL_SDK_DISABLED").is_some_and(|disabled| disabled.eq_ignore_ascii_case("true")) {
      return Ok(Self::default());
    }
    let generic_endpoint = value("OTEL_EXPORTER_OTLP_ENDPOINT").is_some();
    let generic_protocol = value("OTEL_EXPORTER_OTLP_PROTOCOL");
    let signal = |signal: &str, exporter_variable: &str| -> Result<Option<Protocol>, TelemetryError> {
      if value(exporter_variable).is_some_and(|exporter| exporter.eq_ignore_ascii_case("none")) {
        return Ok(None);
      }
      if !generic_endpoint && value(&format!("OTEL_EXPORTER_OTLP_{signal}_ENDPOINT")).is_none() {
        return Ok(None);
      }
      let protocol_variable = format!("OTEL_EXPORTER_OTLP_{signal}_PROTOCOL");
      let (variable, protocol) = match value(&protocol_variable) {
        Some(protocol) => (protocol_variable, Some(protocol)),
        None => ("OTEL_EXPORTER_OTLP_PROTOCOL".to_owned(), generic_protocol.clone()),
      };
      match protocol.as_deref() {
        None | Some("http/protobuf") => Ok(Some(Protocol::HttpProtobuf)),
        Some("grpc") => Ok(Some(Protocol::Grpc)),
        Some(other) => Err(TelemetryError::UnsupportedProtocol {
          variable,
          value: other.to_owned(),
        }),
      }
    };
    Ok(Self {
      traces: signal("TRACES", "OTEL_TRACES_EXPORTER")?,
      logs: signal("LOGS", "OTEL_LOGS_EXPORTER")?,
      metrics: signal("METRICS", "OTEL_METRICS_EXPORTER")?,
    })
  }

  /// Whether anything is exported.
  pub fn is_enabled(&self) -> bool {
    self.traces.is_some() || self.logs.is_some() || self.metrics.is_some()
  }
}

/// The SDK providers of the signals that are exported; flushed and shut down by [`Telemetry::shutdown`].
#[derive(Default)]
pub struct Telemetry {
  /// Spans.
  pub tracer_provider: Option<SdkTracerProvider>,
  /// Logs.
  pub logger_provider: Option<SdkLoggerProvider>,
  /// Metrics.
  pub meter_provider: Option<SdkMeterProvider>,
}

impl Telemetry {
  /// Whether nothing is exported.
  pub fn is_disabled(&self) -> bool {
    self.tracer_provider.is_none() && self.logger_provider.is_none() && self.meter_provider.is_none()
  }

  /// Exports what is still buffered and stops the exporters. It blocks: call it outside the async runtime's
  /// worker threads (`spawn_blocking`).
  pub fn shutdown(&self) {
    let timeout = Duration::from_secs(5);
    if let Some(provider) = &self.tracer_provider {
      let _ = provider.shutdown_with_timeout(timeout);
    }
    if let Some(provider) = &self.logger_provider {
      let _ = provider.shutdown_with_timeout(timeout);
    }
    if let Some(provider) = &self.meter_provider {
      let _ = provider.shutdown_with_timeout(timeout);
    }
  }
}

/// How spans and logs reach their exporter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
  /// In batches on a background thread: production.
  Batch,
  /// One by one, as each ends: tests, which read an in-memory exporter straight after a request.
  Immediate,
}

/// The resource every signal carries: `service.name` (`OTEL_SERVICE_NAME`, else [`DEFAULT_SERVICE_NAME`]) and
/// `service.version`, plus what `OTEL_RESOURCE_ATTRIBUTES` adds.
pub fn resource() -> Resource {
  let named = std::env::var("OTEL_SERVICE_NAME").is_ok_and(|name| !name.trim().is_empty())
    || std::env::var("OTEL_RESOURCE_ATTRIBUTES").is_ok_and(|attributes| attributes.contains("service.name="));
  let builder = Resource::builder().with_attribute(opentelemetry::KeyValue::new("service.version", env!("CARGO_PKG_VERSION")));
  if named {
    builder.build()
  } else {
    builder.with_service_name(DEFAULT_SERVICE_NAME).build()
  }
}

/// A tracer provider whose spans pass the allow-list on their way to `exporter`.
pub fn tracer_provider(exporter: impl SpanExporter + 'static, delivery: Delivery, resource: Resource) -> SdkTracerProvider {
  let builder = SdkTracerProvider::builder().with_resource(resource);
  match delivery {
    Delivery::Batch => builder.with_span_processor(AllowListSpanProcessor::new(BatchSpanProcessor::builder(exporter).build())),
    Delivery::Immediate => builder.with_span_processor(AllowListSpanProcessor::new(SimpleSpanProcessor::new(exporter))),
  }
  .build()
}

/// A logger provider sending to `exporter`. The allow-list is applied earlier, by [`LogBridge`].
pub fn logger_provider(exporter: impl LogExporter + 'static, delivery: Delivery, resource: Resource) -> SdkLoggerProvider {
  let builder = SdkLoggerProvider::builder().with_resource(resource);
  match delivery {
    Delivery::Batch => builder.with_log_processor(BatchLogProcessor::builder(exporter).build()),
    Delivery::Immediate => builder.with_log_processor(SimpleLogProcessor::new(exporter)),
  }
  .build()
}

/// A meter provider that pushes to `exporter` periodically (`OTEL_METRIC_EXPORT_INTERVAL`, 60 s by default).
pub fn meter_provider(exporter: impl PushMetricExporter, resource: Resource) -> SdkMeterProvider {
  SdkMeterProvider::builder()
    .with_resource(resource)
    .with_reader(PeriodicReader::builder(exporter).build())
    .build()
}

/// The stdout layer's filter: events at INFO and above, never spans, as before telemetry existed.
fn stdout_filter() -> FilterFn<impl Fn(&Metadata<'_>) -> bool> {
  filter_fn(|metadata| metadata.is_event() && *metadata.level() <= Level::INFO)
}

/// Targets whose events are not exported as logs: the exporters' own stack, which would otherwise log about
/// its own exports.
const UNEXPORTED_TARGETS: &[&str] = &["opentelemetry", "tonic", "h2", "hyper", "reqwest", "tower", "rustls"];

fn is_exported_event(metadata: &Metadata<'_>) -> bool {
  metadata.is_event() && *metadata.level() <= Level::INFO && !is_unexported_target(metadata.target())
}

/// Whether `target`'s crate is one of [`UNEXPORTED_TARGETS`] or a crate of its family (`opentelemetry_sdk`,
/// `hyper_util`).
fn is_unexported_target(target: &str) -> bool {
  let krate = target.split("::").next().unwrap_or(target);
  UNEXPORTED_TARGETS
    .iter()
    .any(|unexported| krate == *unexported || krate.strip_prefix(unexported).is_some_and(|rest| rest.starts_with('_')))
}

/// The subscriber: stdout as before, plus spans to `telemetry`'s tracer provider and events to its logger
/// provider, for the signals it has.
pub fn subscriber(telemetry: &Telemetry) -> impl Subscriber + Send + Sync + 'static {
  // A list, not `Option` layers: an absent `Option` layer enables every span and event, so with telemetry off
  // the request spans would still be built. With only the stdout layer, spans are disabled and cost nothing.
  let mut layers: Vec<Box<dyn Layer<Registry> + Send + Sync>> = vec![tracing_subscriber::fmt::layer().with_filter(stdout_filter()).boxed()];
  if let Some(provider) = &telemetry.tracer_provider {
    layers.push(
      tracing_opentelemetry::layer()
        .with_tracer(provider.tracer(SCOPE))
        .with_location(false)
        .with_threads(false)
        .with_tracked_inactivity(false)
        .with_level(false)
        .with_target(false)
        .with_filter(filter_fn(|metadata| metadata.is_span() && *metadata.level() <= Level::INFO))
        .boxed(),
    );
  }
  if let Some(provider) = &telemetry.logger_provider {
    layers.push(LogBridge::new(provider).with_filter(filter_fn(is_exported_event)).boxed());
  }
  Registry::default().with(layers)
}

/// Builds the exporters `config` asks for and installs the global subscriber (and the global meter provider,
/// which [`crate::state::AppOptions::new`] takes its meter from). With nothing configured, only the stdout
/// layer is installed. Call it from inside the Tokio runtime: the gRPC exporters need it.
pub fn init(config: TelemetryConfig) -> Result<Telemetry, TelemetryError> {
  let telemetry = build(config)?;
  if let Some(provider) = &telemetry.meter_provider {
    opentelemetry::global::set_meter_provider(provider.clone());
  }
  subscriber(&telemetry).init();
  Ok(telemetry)
}

fn build(config: TelemetryConfig) -> Result<Telemetry, TelemetryError> {
  if !config.is_enabled() {
    return Ok(Telemetry::default());
  }
  let resource = resource();
  let failed = |signal: &'static str| {
    move |error: opentelemetry_otlp::ExporterBuildError| TelemetryError::Exporter {
      signal,
      reason: error.to_string(),
    }
  };
  let tracer_provider = match config.traces {
    Some(protocol) => {
      let builder = opentelemetry_otlp::SpanExporter::builder();
      let exporter = match protocol {
        Protocol::Grpc => builder.with_tonic().build(),
        Protocol::HttpProtobuf => builder.with_http().build(),
      }
      .map_err(failed("traces"))?;
      Some(tracer_provider(exporter, Delivery::Batch, resource.clone()))
    }
    None => None,
  };
  let logger_provider = match config.logs {
    Some(protocol) => {
      let builder = opentelemetry_otlp::LogExporter::builder();
      let exporter = match protocol {
        Protocol::Grpc => builder.with_tonic().build(),
        Protocol::HttpProtobuf => builder.with_http().build(),
      }
      .map_err(failed("logs"))?;
      Some(logger_provider(exporter, Delivery::Batch, resource.clone()))
    }
    None => None,
  };
  let meter_provider = match config.metrics {
    Some(protocol) => {
      let builder = opentelemetry_otlp::MetricExporter::builder();
      let exporter = match protocol {
        Protocol::Grpc => builder.with_tonic().build(),
        Protocol::HttpProtobuf => builder.with_http().build(),
      }
      .map_err(failed("metrics"))?;
      Some(meter_provider(exporter, resource))
    }
    None => None,
  };
  Ok(Telemetry {
    tracer_provider,
    logger_provider,
    meter_provider,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn config(vars: &[(&str, &str)]) -> Result<TelemetryConfig, TelemetryError> {
    let vars: Vec<(String, String)> = vars.iter().map(|(name, value)| ((*name).to_owned(), (*value).to_owned())).collect();
    TelemetryConfig::from_lookup(|name| vars.iter().find(|(key, _)| key == name).map(|(_, value)| value.clone()))
  }

  #[test]
  fn nothing_is_exported_without_an_endpoint() {
    let config = config(&[("OTEL_SERVICE_NAME", "calendar-api"), ("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")]).unwrap();
    assert_eq!(config, TelemetryConfig::default());
    assert!(!config.is_enabled());
  }

  #[test]
  fn a_blank_endpoint_is_no_endpoint() {
    assert!(!config(&[("OTEL_EXPORTER_OTLP_ENDPOINT", "  ")]).unwrap().is_enabled());
  }

  #[test]
  fn the_generic_endpoint_exports_every_signal_over_http_protobuf_by_default() {
    let config = config(&[("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")]).unwrap();
    assert_eq!(
      config,
      TelemetryConfig {
        traces: Some(Protocol::HttpProtobuf),
        logs: Some(Protocol::HttpProtobuf),
        metrics: Some(Protocol::HttpProtobuf),
      }
    );
  }

  #[test]
  fn grpc_is_chosen_by_the_generic_protocol_and_a_signal_can_override_it() {
    let config = config(&[
      ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
      ("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"),
      ("OTEL_EXPORTER_OTLP_METRICS_PROTOCOL", "http/protobuf"),
    ])
    .unwrap();
    assert_eq!(config.traces, Some(Protocol::Grpc));
    assert_eq!(config.logs, Some(Protocol::Grpc));
    assert_eq!(config.metrics, Some(Protocol::HttpProtobuf));
  }

  #[test]
  fn a_signal_endpoint_exports_only_that_signal() {
    let config = config(&[("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://localhost:4318/v1/traces")]).unwrap();
    assert_eq!(
      config,
      TelemetryConfig {
        traces: Some(Protocol::HttpProtobuf),
        logs: None,
        metrics: None,
      }
    );
  }

  #[test]
  fn a_signal_exporter_of_none_turns_that_signal_off() {
    let config = config(&[
      ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
      ("OTEL_METRICS_EXPORTER", "none"),
    ])
    .unwrap();
    assert!(config.metrics.is_none());
    assert!(config.traces.is_some());
  }

  #[test]
  fn the_sdk_can_be_disabled() {
    let config = config(&[
      ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
      ("OTEL_SDK_DISABLED", "TRUE"),
    ])
    .unwrap();
    assert!(!config.is_enabled());
  }

  #[test]
  fn an_unsupported_protocol_is_refused_by_name() {
    let error = config(&[
      ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
      ("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json"),
    ])
    .unwrap_err();
    assert_eq!(
      error.to_string(),
      "OTEL_EXPORTER_OTLP_PROTOCOL 'http/json' is not supported: use grpc or http/protobuf"
    );
  }

  #[test]
  fn the_exporters_own_stack_is_not_exported_as_logs() {
    for target in [
      "opentelemetry",
      "opentelemetry_sdk::trace",
      "opentelemetry_otlp",
      "hyper::proto::h1",
      "hyper_util::client",
      "tonic",
    ] {
      assert!(is_unexported_target(target), "{target}");
    }
    for target in ["calendar_api::error", "calendar_api", "hyperion", "towers"] {
      assert!(!is_unexported_target(target), "{target}");
    }
  }

  #[test]
  fn without_telemetry_spans_are_disabled_and_only_events_reach_stdout() {
    let _subscriber = tracing::subscriber::set_default(subscriber(&Telemetry::default()));
    assert!(
      tracing::info_span!("http.server.request").is_disabled(),
      "no layer records spans, so stdout lines keep no span prefix"
    );
    assert!(tracing::event_enabled!(Level::INFO));
    assert!(!tracing::event_enabled!(Level::DEBUG));
  }
}
