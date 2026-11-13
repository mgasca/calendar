//! OpenTelemetry from the API (ADR-0062, #731): request and database spans joined to the caller's
//! `traceparent`, logs carrying the trace id, HTTP server metrics, and the allow-list that keeps personal
//! data out of all three. The pipeline is the production one ([`telemetry::subscriber`] and the providers),
//! with in-memory exporters in place of OTLP and spans and logs delivered as they end.

mod common;

use calendar_api::telemetry::{self, Delivery, Telemetry};
use common::*;
use opentelemetry::metrics::{Meter, MeterProvider as _};
use opentelemetry::trace::{SpanId, SpanKind, Status, TraceId};
use opentelemetry_sdk::logs::in_memory_exporter::LogDataWithResource;
use opentelemetry_sdk::logs::{InMemoryLogExporter, InMemoryLogExporterBuilder};
use opentelemetry_sdk::metrics::{InMemoryMetricExporter, InMemoryMetricExporterBuilder};
use opentelemetry_sdk::trace::{InMemorySpanExporter, InMemorySpanExporterBuilder, SpanData};
use tracing::subscriber::DefaultGuard;

const TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN_ID: &str = "00f067aa0ba902b7";
const TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

/// What the app exports during a test, read from in-memory exporters. The subscriber is this thread's
/// default while the capture lives (Tokio tests run on one thread).
struct Capture {
  spans: InMemorySpanExporter,
  logs: InMemoryLogExporter,
  metrics: InMemoryMetricExporter,
  telemetry: Telemetry,
  _subscriber: DefaultGuard,
}

impl Capture {
  fn start() -> Self {
    let spans = InMemorySpanExporterBuilder::new().build();
    let logs = InMemoryLogExporterBuilder::new().build();
    let metrics = InMemoryMetricExporterBuilder::new().build();
    let resource = telemetry::resource();
    let telemetry = Telemetry {
      tracer_provider: Some(telemetry::tracer_provider(spans.clone(), Delivery::Immediate, resource.clone())),
      logger_provider: Some(telemetry::logger_provider(logs.clone(), Delivery::Immediate, resource.clone())),
      meter_provider: Some(telemetry::meter_provider(metrics.clone(), resource)),
    };
    let subscriber = tracing::subscriber::set_default(telemetry::subscriber(&telemetry));
    Self {
      spans,
      logs,
      metrics,
      telemetry,
      _subscriber: subscriber,
    }
  }

  /// The meter the app under test must record its metrics with.
  fn meter(&self) -> Meter {
    self
      .telemetry
      .meter_provider
      .as_ref()
      .expect("metrics are captured")
      .meter(telemetry::SCOPE)
  }

  fn spans(&self) -> Vec<SpanData> {
    self.spans.get_finished_spans().expect("the spans are readable")
  }

  fn logs(&self) -> Vec<LogDataWithResource> {
    self.logs.get_emitted_logs().expect("the logs are readable")
  }

  /// Every exported span, log record and metric, as text, for the personal-data scan.
  fn everything(&self) -> String {
    let meter_provider = self.telemetry.meter_provider.as_ref().expect("metrics are captured");
    meter_provider.force_flush().expect("the metrics are collected");
    let metrics = self.metrics.get_finished_metrics().expect("the metrics are readable");
    format!("{:#?}\n{:#?}\n{metrics:#?}", self.spans(), self.logs())
  }

  /// The HTTP server duration data points as `(method, route, status, count)`.
  fn request_metrics(&self) -> Vec<(String, Option<String>, i64, u64)> {
    use opentelemetry_sdk::metrics::data::{AggregatedMetrics, MetricData};
    let meter_provider = self.telemetry.meter_provider.as_ref().expect("metrics are captured");
    meter_provider.force_flush().expect("the metrics are collected");
    let mut points = Vec::new();
    for resource_metrics in self.metrics.get_finished_metrics().expect("the metrics are readable") {
      for scope in resource_metrics.scope_metrics() {
        for metric in scope.metrics().filter(|metric| metric.name() == "http.server.request.duration") {
          assert_eq!(metric.unit(), "s");
          let AggregatedMetrics::F64(MetricData::Histogram(histogram)) = metric.data() else {
            panic!("the request duration is a histogram of seconds")
          };
          for point in histogram.data_points() {
            let attribute = |key: &str| point.attributes().find(|kv| kv.key.as_str() == key).map(|kv| kv.value.clone());
            points.push((
              attribute("http.request.method")
                .expect("every point has a method")
                .as_str()
                .into_owned(),
              attribute("http.route").map(|route| route.as_str().into_owned()),
              match attribute("http.response.status_code") {
                Some(opentelemetry::Value::I64(status)) => status,
                other => panic!("the status code is an integer: {other:?}"),
              },
              point.count(),
            ));
          }
        }
      }
    }
    points
  }
}

fn attribute(span: &SpanData, key: &str) -> Option<String> {
  span
    .attributes
    .iter()
    .find(|kv| kv.key.as_str() == key)
    .map(|kv| kv.value.as_str().into_owned())
}

fn trace_id() -> TraceId {
  TraceId::from_hex(TRACE_ID).unwrap()
}

#[tokio::test]
async fn a_request_with_a_traceparent_joins_its_server_and_database_spans_to_that_trace() {
  let capture = Capture::start();
  let app = TestApp::builder().meter(capture.meter()).start().await;

  let response = app
    .client()
    .header("traceparent", TRACEPARENT)
    .get("/api/agenda/day?date=2026-10-26&timeZone=Europe%2FMadrid")
    .await;
  assert_eq!(response.status, StatusCode::OK);

  let spans = capture.spans();
  let server = spans
    .iter()
    .find(|span| span.span_kind == SpanKind::Server)
    .unwrap_or_else(|| panic!("a server span: {spans:#?}"));
  assert_eq!(server.name, "GET /api/agenda/day");
  assert_eq!(server.span_context.trace_id(), trace_id());
  assert_eq!(server.parent_span_id, SpanId::from_hex(PARENT_SPAN_ID).unwrap());
  assert!(server.parent_span_is_remote);
  assert_eq!(attribute(server, "http.request.method").as_deref(), Some("GET"));
  assert_eq!(attribute(server, "http.route").as_deref(), Some("/api/agenda/day"));
  assert_eq!(attribute(server, "http.response.status_code").as_deref(), Some("200"));
  assert_eq!(server.status, Status::Unset);

  let database: Vec<&SpanData> = spans.iter().filter(|span| span.span_kind == SpanKind::Client).collect();
  assert!(!database.is_empty(), "database spans: {spans:#?}");
  for span in &database {
    assert_eq!(span.span_context.trace_id(), trace_id(), "{}", span.name);
    assert_eq!(span.parent_span_id, server.span_context.span_id(), "{}", span.name);
    assert_eq!(attribute(span, "db.system.name").as_deref(), Some("postgresql"));
  }
  let names: Vec<&str> = database.iter().map(|span| span.name.as_ref()).collect();
  assert!(names.contains(&"SELECT events"), "{names:?}");
  assert!(names.contains(&"SELECT tasks"), "{names:?}");
  // The agenda is one read-only snapshot (ADR-0020).
  assert!(names.contains(&"BEGIN"), "{names:?}");
  let select = database.iter().find(|span| span.name == "SELECT events").unwrap();
  let statement = attribute(select, "db.query.text").expect("the statement is recorded");
  assert!(statement.starts_with("SELECT"), "{statement}");
  assert!(statement.contains("$1"), "{statement}");
  assert!(!statement.contains("binds"), "{statement}");
  assert_eq!(attribute(select, "db.operation.name").as_deref(), Some("SELECT"));
  assert_eq!(attribute(select, "db.collection.name").as_deref(), Some("events"));
}

#[tokio::test]
async fn a_request_without_a_traceparent_starts_a_trace_of_its_own() {
  let capture = Capture::start();
  let app = TestApp::builder().meter(capture.meter()).start().await;

  app.client().get("/api/tasks/00000000-0000-0000-0000-000000000001").await;

  let spans = capture.spans();
  let server = spans.iter().find(|span| span.span_kind == SpanKind::Server).expect("a server span");
  assert_eq!(server.name, "GET /api/tasks/{id}");
  assert_eq!(attribute(server, "http.response.status_code").as_deref(), Some("404"));
  assert_ne!(server.span_context.trace_id(), TraceId::INVALID);
  assert_eq!(server.parent_span_id, SpanId::INVALID);
  assert!(
    spans
      .iter()
      .filter(|span| span.span_kind == SpanKind::Client)
      .all(|span| span.span_context.trace_id() == server.span_context.trace_id())
  );
}

#[tokio::test]
async fn a_failed_request_exports_its_error_log_with_the_trace_id_and_without_the_reason() {
  let capture = Capture::start();
  let app = TestApp::builder().without_database().meter(capture.meter()).start().await;

  let response = app
    .client()
    .header("traceparent", TRACEPARENT)
    .get("/api/events/00000000-0000-0000-0000-000000000001")
    .await;
  assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);

  let logs = capture.logs();
  let failed = logs
    .iter()
    .find(|log| {
      log
        .record
        .body()
        .is_some_and(|body| format!("{body:?}").contains("the request failed"))
    })
    .unwrap_or_else(|| panic!("the failure is logged: {logs:#?}"));
  assert_eq!(failed.record.severity_number(), Some(opentelemetry::logs::Severity::Error));
  let context = failed.record.trace_context().expect("the record carries the trace context");
  assert_eq!(context.trace_id, trace_id());
  let server = capture
    .spans()
    .into_iter()
    .find(|span| span.span_kind == SpanKind::Server)
    .expect("a server span");
  assert_eq!(context.span_id, server.span_context.span_id());
  // The reason (here a configuration message; elsewhere a database error) stays on standard output only.
  assert_eq!(failed.record.attributes_iter().count(), 0, "{failed:#?}");

  assert_eq!(server.name, "GET /api/events/{id}");
  assert!(matches!(server.status, Status::Error { .. }), "{:?}", server.status);
  assert_eq!(attribute(&server, "error.type").as_deref(), Some("500"));
}

#[tokio::test]
async fn a_successful_request_exports_one_log_record_with_its_trace_id_and_only_allow_listed_fields() {
  let capture = Capture::start();
  let app = TestApp::builder().meter(capture.meter()).start().await;

  let response = app
    .client()
    .header("traceparent", TRACEPARENT)
    .get("/api/agenda/day?date=2026-10-26&timeZone=Europe%2FMadrid")
    .await;
  assert_eq!(response.status, StatusCode::OK);

  let logs = capture.logs();
  let finished: Vec<_> = logs
    .iter()
    .filter(|log| {
      log
        .record
        .body()
        .is_some_and(|body| format!("{body:?}").contains("request finished"))
    })
    .collect();
  assert_eq!(finished.len(), 1, "one record per request: {logs:#?}");
  let record = &finished[0].record;
  assert_eq!(record.severity_number(), Some(opentelemetry::logs::Severity::Info));
  let server = capture
    .spans()
    .into_iter()
    .find(|span| span.span_kind == SpanKind::Server)
    .expect("a server span");
  let context = record.trace_context().expect("the record carries the trace context");
  assert_eq!(context.trace_id, trace_id());
  assert_eq!(context.span_id, server.span_context.span_id());
  let mut attributes: Vec<(String, String)> = record
    .attributes_iter()
    .map(|(key, value)| (key.as_str().to_owned(), format!("{value:?}")))
    .collect();
  attributes.sort();
  assert_eq!(
    attributes,
    [
      (
        "http.request.method".to_owned(),
        format!("{:?}", opentelemetry::logs::AnyValue::from("GET".to_owned()))
      ),
      (
        "http.response.status_code".to_owned(),
        format!("{:?}", opentelemetry::logs::AnyValue::Int(200))
      ),
      (
        "http.route".to_owned(),
        format!("{:?}", opentelemetry::logs::AnyValue::from("/api/agenda/day".to_owned()))
      ),
    ],
    "only the method, route template and status: {record:#?}"
  );
}

#[tokio::test]
async fn health_probes_are_not_logged() {
  let capture = Capture::start();
  let app = TestApp::builder().meter(capture.meter()).start().await;

  app.client().get("/api/health").await;

  let logs = capture.logs();
  assert!(
    !logs.iter().any(|log| log
      .record
      .body()
      .is_some_and(|body| format!("{body:?}").contains("request finished"))),
    "{logs:#?}"
  );
}

#[tokio::test]
async fn requests_are_counted_and_timed_by_method_route_template_and_status() {
  let capture = Capture::start();
  let app = TestApp::builder().meter(capture.meter()).start().await;

  for _ in 0..2 {
    let _ = app.client().get("/api/agenda/day?date=2026-10-26&timeZone=UTC").await.success();
  }
  app.client().get("/api/tasks/00000000-0000-0000-0000-000000000001").await;
  app.client().get("/api/nothing-here?x=1").await;

  let points = capture.request_metrics();
  assert!(
    points.contains(&("GET".to_owned(), Some("/api/agenda/day".to_owned()), 200, 2)),
    "{points:#?}"
  );
  assert!(
    points.contains(&("GET".to_owned(), Some("/api/tasks/{id}".to_owned()), 404, 1)),
    "{points:#?}"
  );
  // No route matched: no route attribute, never the raw path.
  assert!(points.contains(&("GET".to_owned(), None, 404, 1)), "{points:#?}");
}

/// Values a flow puts in requests, rows and cookies; none may reach telemetry.
const EMAIL: &str = "ana.private@example.org";
const NAME: &str = "Ana Privada";
const EVENT_TITLE: &str = "Dentist with Ana";
const LOCATION: &str = "Calle Secreta 7";
const EVENT_NOTES: &str = "Bring the X-ray results";
const TASK_TITLE: &str = "Call the clinic about Ana";
const TASK_NOTES: &str = "Ask for Dr. Ruiz";
const QUERY_VALUE: &str = "QueryValueSecret123";

fn leaks<'a>(exported: &str, values: &[&'a str]) -> Vec<&'a str> {
  values.iter().copied().filter(|value| exported.contains(value)).collect()
}

#[tokio::test]
async fn no_span_log_or_metric_carries_personal_data_query_values_or_the_session_cookie() {
  let capture = Capture::start();
  let app = TestApp::builder().real_authentication().meter(capture.meter()).start().await;
  let ticket = SessionTicket {
    user_id: Some(USER_A),
    name: Some(NAME.to_owned()),
    email: Some(EMAIL.to_owned()),
    picture: None,
    expires_at: app.clock.now() + TimeDelta::hours(8),
  };
  let cookie = app.session_cookie(&ticket).await;
  let client = app.client().cookie(&cookie).header("traceparent", TRACEPARENT);

  let event: EventResponse = client
    .post_json(
      "/api/events",
      &json!({
        "title": EVENT_TITLE,
        "start": "2026-10-26T10:00:00+01:00",
        "end": "2026-10-26T10:30:00+01:00",
        "timeZone": "Europe/Madrid",
        "location": LOCATION,
        "notes": EVENT_NOTES,
      }),
    )
    .await
    .success()
    .json();
  let _ = client
    .post_json(
      "/api/tasks",
      &json!({"title": TASK_TITLE, "notes": TASK_NOTES, "dueDate": "2026-10-26"}),
    )
    .await
    .success();
  let _ = client
    .get("/api/agenda/day?date=2026-10-26&timeZone=Europe%2FMadrid")
    .await
    .success();
  let _ = client
    .get(&format!("/api/events/{}?secret={QUERY_VALUE}", event.id))
    .await
    .success();
  let _ = client.get(&format!("/api/auth/me?{QUERY_VALUE}=1")).await.success();
  client.get(&format!("/api/missing/{QUERY_VALUE}")).await;
  // A request that fails validation, with personal data in the body.
  client.post_json("/api/tasks", &json!({"title": "", "notes": TASK_NOTES})).await;

  let exported = capture.everything();
  assert!(exported.contains("POST /api/events"), "the scan reads the spans");
  assert!(exported.contains("http.server.request.duration"), "the scan reads the metrics");
  let cookie_value = cookie.split_once('=').map_or(cookie.as_str(), |(_, value)| value);
  let found = leaks(
    &exported,
    &[
      EMAIL,
      NAME,
      EVENT_TITLE,
      LOCATION,
      EVENT_NOTES,
      TASK_TITLE,
      TASK_NOTES,
      QUERY_VALUE,
      "Europe/Madrid",
      cookie_value,
    ],
  );
  assert!(found.is_empty(), "personal data in telemetry: {found:?}");
}

#[tokio::test]
async fn fields_off_the_allow_list_are_dropped_and_the_scan_finds_what_gets_through() {
  let capture = Capture::start();

  // Content in span fields, event fields and span events is dropped before export...
  {
    let span = tracing::info_span!("planted", title = EVENT_TITLE, email = EMAIL, http.route = "/api/planted");
    let _entered = span.enter();
    tracing::info!(notes = EVENT_NOTES, "a planted event");
  }
  // ...but a message is exported as written, so code must keep content out of messages, and the scan catches
  // it when it does not.
  tracing::warn!("a careless message about {TASK_TITLE}");

  let exported = capture.everything();
  assert!(exported.contains("/api/planted"), "allow-listed attributes are exported");
  assert!(exported.contains("a planted event"));
  assert_eq!(leaks(&exported, &[EVENT_TITLE, EMAIL, EVENT_NOTES]), Vec::<&str>::new());
  assert_eq!(leaks(&exported, &[TASK_TITLE]), vec![TASK_TITLE], "the scan finds a planted value");
}

#[tokio::test]
async fn a_caller_cannot_switch_off_tracing_with_an_unsampled_traceparent() {
  let capture = Capture::start();
  let app = TestApp::builder().meter(capture.meter()).start().await;

  let response = app
    .client()
    .header("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")
    .get("/api/agenda/day?date=2026-10-26&timeZone=UTC")
    .await;
  assert_eq!(response.status, StatusCode::OK);

  let spans = capture.spans();
  let server = spans
    .iter()
    .find(|span| span.span_kind == SpanKind::Server)
    .unwrap_or_else(|| panic!("the request is traced whatever the caller's sampled flag: {spans:#?}"));
  assert_eq!(server.span_context.trace_id(), trace_id(), "the caller's trace is still joined");
  assert!(
    spans.iter().any(|span| span.span_kind == SpanKind::Client),
    "its database spans are recorded too"
  );
}

#[tokio::test]
async fn health_probes_are_counted_but_not_traced() {
  let capture = Capture::start();
  let app = TestApp::builder().meter(capture.meter()).start().await;

  // The Container Apps probes call this every few seconds per replica; a span each would be most of the telemetry.
  let response = app.client().header("traceparent", TRACEPARENT).get("/api/health").await;
  assert_eq!(response.status, StatusCode::OK);

  let spans = capture.spans();
  assert!(spans.is_empty(), "no span for a health probe: {spans:#?}");
  let points = capture.request_metrics();
  assert!(
    points.contains(&("GET".to_owned(), Some("/api/health".to_owned()), 200, 1)),
    "{points:#?}"
  );
}
