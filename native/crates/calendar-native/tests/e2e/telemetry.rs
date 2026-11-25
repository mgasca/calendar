//! The telemetry side of a native flow test (story 0064, ADR-0062 "End-to-end assertions"), ported from
//! `frontend/apps/e2e/src/telemetry` so both apps' flows prove the same four things against otel-stack:
//!
//! 1. one trace per user action, holding a chain of API spans down to the database;
//! 2. API log records in Loki carrying each trace id;
//! 3. request count and duration metrics in Prometheus for every route the flow hit;
//! 4. no personal value the test registered, and nothing shaped like an email, a token or a cookie, in any span,
//!    log record or metric label exported since the test began.
//!
//! The native app sends `traceparent` and exports nothing of its own (#1010), so every span here is the API's.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use calendar_client::reqwest::{self, Url};
use serde_json::Value;

/// The URLs of the stack's telemetry backends.
#[derive(Clone, Debug)]
pub struct Backends {
  pub tempo: String,
  pub loki: String,
  pub prometheus: String,
}

/// Blocking HTTP for the test thread; the app's own requests run on its effects thread.
pub struct Http {
  runtime: tokio::runtime::Runtime,
  client: reqwest::Client,
}

impl Http {
  pub fn new() -> Self {
    Http {
      runtime: tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime"),
      client: reqwest::Client::new(),
    }
  }

  /// GETs `url` and parses JSON; a non-2xx status is an error with the start of the body.
  pub fn get_json(&self, url: &Url) -> Result<Value, String> {
    self.runtime.block_on(async {
      let response = self.client.get(url.clone()).send().await.map_err(|error| error.to_string())?;
      let status = response.status();
      let body = response.text().await.map_err(|error| error.to_string())?;
      if !status.is_success() {
        return Err(format!(
          "GET {} answered {status}: {}",
          url.path(),
          body.chars().take(200).collect::<String>()
        ));
      }
      serde_json::from_str(&body).map_err(|error| error.to_string())
    })
  }
}

/// Why [`poll`] has no value yet.
pub enum Wait {
  /// Not there yet: ask again.
  Retry(String),
  /// Waiting cannot fix it (two traces where one is expected).
  Fatal(String),
}

impl From<String> for Wait {
  fn from(reason: String) -> Self {
    Wait::Retry(reason)
  }
}

/// Retries `attempt` every second until it gives a value or `timeout` is up. The last reason becomes the panic
/// message, so a failure says what was missing; [`Wait::Fatal`] stops at once.
pub fn poll<T>(what: &str, timeout: Duration, mut attempt: impl FnMut() -> Result<T, Wait>) -> T {
  let deadline = Instant::now() + timeout;
  loop {
    match attempt() {
      Ok(value) => return value,
      Err(Wait::Fatal(reason)) => panic!("{what}: {reason}"),
      Err(Wait::Retry(reason)) => {
        assert!(
          Instant::now() < deadline,
          "{what}: not found within {} s. Last check: {reason}",
          timeout.as_secs()
        );
        std::thread::sleep(Duration::from_secs(1));
      }
    }
  }
}

/// How long a trace or its logs may take to arrive: the API exports in batches.
const SIGNAL_TIMEOUT: Duration = Duration::from_secs(90);
/// Metrics are pushed every 5 s in the e2e stack, and Prometheus scrapes the collector on its own interval.
const METRIC_TIMEOUT: Duration = Duration::from_secs(120);

fn nanos(at: SystemTime) -> u128 {
  at.duration_since(UNIX_EPOCH).map_or(0, |since| since.as_nanos())
}

fn endpoint(base: &str, path: &str) -> Url {
  Url::parse(base).and_then(|base| base.join(path)).expect("a backend URL")
}

// --- Tempo ---------------------------------------------------------------------------------------------------

/// One span as Tempo returns it, with the ids in hex and every value as text.
#[derive(Clone, Debug)]
pub struct Span {
  pub service: String,
  pub name: String,
  pub id: String,
  pub parent_id: String,
  pub attributes: Vec<(String, String)>,
  pub resource: Vec<(String, String)>,
  pub events: Vec<(String, Vec<(String, String)>)>,
  pub status: String,
}

/// A span a trace must hold: the API's span with one of these names.
#[derive(Clone, Copy, Debug)]
pub struct Matcher(&'static [&'static str]);

impl Matcher {
  fn matches(self, span: &Span) -> bool {
    span.service == "calendar-api" && self.0.contains(&span.name.as_str())
  }

  fn describe(self) -> String {
    format!("calendar-api '{}'", self.0.join("' or '"))
  }
}

/// The API's span named one of `names` (`&["SELECT users", "UPDATE users"]`).
pub const fn api(names: &'static [&'static str]) -> Matcher {
  Matcher(names)
}

fn text(value: &Value) -> String {
  if let Some(values) = value
    .get("arrayValue")
    .and_then(|array| array.get("values"))
    .and_then(Value::as_array)
  {
    return values.iter().map(text).collect::<Vec<_>>().join(",");
  }
  for key in ["stringValue", "intValue", "doubleValue", "boolValue"] {
    match value.get(key) {
      Some(Value::String(text)) => return text.clone(),
      Some(other @ (Value::Number(_) | Value::Bool(_))) => return other.to_string(),
      _ => {}
    }
  }
  String::new()
}

fn pairs(attributes: Option<&Value>) -> Vec<(String, String)> {
  attributes
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .map(|attribute| {
      (
        attribute["key"].as_str().unwrap_or_default().to_owned(),
        attribute.get("value").map(text).unwrap_or_default(),
      )
    })
    .collect()
}

/// Tempo's v2 API sends span ids in base64; the traceparent and Loki use hex.
fn hex(id: Option<&str>) -> String {
  let Some(id) = id.filter(|id| !id.is_empty()) else {
    return String::new();
  };
  if id.len() >= 16 && id.len() % 2 == 0 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
    return id.to_owned();
  }
  base64::engine::general_purpose::STANDARD
    .decode(id)
    .map(|bytes| {
      bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
      })
    })
    .unwrap_or_default()
}

/// The spans of a Tempo `GET /api/v2/traces/<id>` answer.
fn flatten(body: &Value) -> Vec<Span> {
  let mut spans = Vec::new();
  for resource_spans in body["trace"]["resourceSpans"].as_array().into_iter().flatten() {
    let resource = pairs(resource_spans["resource"].get("attributes"));
    let service = resource
      .iter()
      .find(|(key, _)| key == "service.name")
      .map(|(_, value)| value.clone())
      .unwrap_or_default();
    for scope in resource_spans["scopeSpans"].as_array().into_iter().flatten() {
      for span in scope["spans"].as_array().into_iter().flatten() {
        let status = [span["status"]["code"].as_str(), span["status"]["message"].as_str()]
          .into_iter()
          .flatten()
          .filter(|part| !part.is_empty())
          .collect::<Vec<_>>()
          .join(": ");
        spans.push(Span {
          service: service.clone(),
          name: span["name"].as_str().unwrap_or_default().to_owned(),
          id: hex(span["spanId"].as_str()),
          parent_id: hex(span["parentSpanId"].as_str()),
          attributes: pairs(span.get("attributes")),
          resource: resource.clone(),
          events: span["events"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|event| {
              (
                event["name"].as_str().unwrap_or_default().to_owned(),
                pairs(event.get("attributes")),
              )
            })
            .collect(),
          status,
        });
      }
    }
  }
  spans
}

/// What one user action's trace must hold: `chain`, each span nested under the one before it (a descendant, not
/// necessarily a child), and `spans` anywhere in the trace.
#[derive(Clone, Debug, Default)]
pub struct Expect {
  pub chain: Vec<Matcher>,
  pub spans: Vec<Matcher>,
}

/// Every way `spans` falls short of `expect`; empty when the trace is as expected.
pub fn trace_problems(spans: &[Span], expect: &Expect) -> Vec<String> {
  let mut problems: Vec<String> = expect
    .chain
    .iter()
    .chain(&expect.spans)
    .filter(|matcher| !spans.iter().any(|span| matcher.matches(span)))
    .map(|matcher| format!("no span {}", matcher.describe()))
    .collect();
  if !problems.is_empty() {
    return problems;
  }
  let by_id: HashMap<&str, &Span> = spans.iter().map(|span| (span.id.as_str(), span)).collect();
  let is_under = |span: &Span, ancestor: &Span| {
    let mut seen = HashSet::new();
    let mut parent = by_id.get(span.parent_id.as_str());
    while let Some(current) = parent {
      if std::ptr::eq(*current, ancestor) {
        return true;
      }
      if !seen.insert(current.id.as_str()) {
        return false;
      }
      parent = by_id.get(current.parent_id.as_str());
    }
    false
  };
  let Some(first) = expect.chain.first() else {
    return problems;
  };
  let mut candidates: Vec<&Span> = spans.iter().filter(|span| first.matches(span)).collect();
  for pair in expect.chain.windows(2) {
    let next: Vec<&Span> = spans
      .iter()
      .filter(|span| pair[1].matches(span) && candidates.iter().any(|parent| is_under(span, parent)))
      .collect();
    if next.is_empty() {
      problems.push(format!("no span {} under {}", pair[1].describe(), pair[0].describe()));
      break;
    }
    candidates = next;
  }
  problems
}

/// Service and name per span, for an assertion message; no attribute values.
fn outline(spans: &[Span]) -> String {
  spans
    .iter()
    .map(|span| format!("{}: {}", span.service, span.name))
    .collect::<Vec<_>>()
    .join("; ")
}

/// The trace `trace_id`, once Tempo holds every span `expect` asks for.
fn wait_for_trace(http: &Http, backends: &Backends, trace_id: &str, expect: &Expect) -> Vec<Span> {
  let url = endpoint(&backends.tempo, &format!("/api/v2/traces/{trace_id}"));
  poll(&format!("Trace {trace_id} in Tempo"), SIGNAL_TIMEOUT, || {
    let spans = flatten(&http.get_json(&url)?);
    let problems = trace_problems(&spans, expect);
    if problems.is_empty() {
      return Ok(spans);
    }
    let has = outline(&spans);
    Err(Wait::Retry(format!(
      "{} (has: {})",
      problems.join(", "),
      if has.is_empty() { "nothing" } else { &has }
    )))
  })
}

/// The ids (32 hex digits each) of the API traces whose root server span is `name`, started at or after `since`.
pub fn root_traces(http: &Http, backends: &Backends, name: &str, since: SystemTime) -> Result<Vec<String>, String> {
  // No time range: with one, Tempo reads only flushed blocks and misses the traces still in the ingester.
  let mut url = endpoint(&backends.tempo, "/api/search");
  url
    .query_pairs_mut()
    .append_pair(
      "q",
      &format!(r#"{{ resource.service.name = "calendar-api" && name = "{name}" && kind = server }}"#),
    )
    .append_pair("limit", "100");
  let body = http.get_json(&url)?;
  let since = nanos(since);
  Ok(
    body["traces"]
      .as_array()
      .into_iter()
      .flatten()
      .filter(|trace| {
        trace["rootServiceName"] == "calendar-api"
          && trace["rootTraceName"] == name
          && trace["startTimeUnixNano"]
            .as_str()
            .and_then(|started| started.parse::<u128>().ok())
            .is_some_and(|started| started >= since)
      })
      // Tempo's search drops the id's leading zeros; Loki and the traceparent keep all 32 digits.
      .filter_map(|trace| trace["traceID"].as_str().map(|id| format!("{id:0>32}")))
      .collect(),
  )
}

/// The ids of the traces since `since` that hold the API's server span `name` anywhere: the traces the app starts
/// with its own `traceparent`, whose root (the app's span) Tempo never receives.
pub fn traces_with_span(http: &Http, backends: &Backends, name: &str, since: SystemTime) -> Result<Vec<String>, String> {
  let mut url = endpoint(&backends.tempo, "/api/search");
  url
    .query_pairs_mut()
    .append_pair(
      "q",
      &format!(r#"{{ resource.service.name = "calendar-api" && name = "{name}" && kind = server }}"#),
    )
    .append_pair("limit", "100");
  let body = http.get_json(&url)?;
  let since = nanos(since);
  Ok(
    body["traces"]
      .as_array()
      .into_iter()
      .flatten()
      .filter(|trace| {
        trace["startTimeUnixNano"]
          .as_str()
          .and_then(|started| started.parse::<u128>().ok())
          .is_some_and(|started| started >= since)
      })
      .filter_map(|trace| trace["traceID"].as_str().map(|id| format!("{id:0>32}")))
      .collect(),
  )
}

/// The id of the one trace since `since` that holds the API's server span `name` (see [`traces_with_span`]).
pub fn trace_with_span(http: &Http, backends: &Backends, name: &str, since: SystemTime) -> String {
  poll(
    &format!("A trace with the span '{name}' in Tempo"),
    SIGNAL_TIMEOUT,
    || match traces_with_span(http, backends, name, since)?.as_slice() {
      [one] => Ok(one.clone()),
      [] => Err(Wait::Retry("none since the test began".to_owned())),
      many => Err(Wait::Fatal(format!(
        "{} traces with the span '{name}' since the test began; expected exactly one",
        many.len()
      ))),
    },
  )
}

/// The id of the one trace a full-page navigation to `name` started since `since`. The browser's redirects carry no
/// `traceparent`, so the API starts these traces itself and the test finds them by their root span. More than one is
/// an error: the test could not tell which is its own.
pub fn root_trace(http: &Http, backends: &Backends, name: &str, since: SystemTime) -> String {
  poll(
    &format!("A trace with root '{name}' in Tempo"),
    SIGNAL_TIMEOUT,
    || match root_traces(http, backends, name, since)?.as_slice() {
      [one] => Ok(one.clone()),
      [] => Err(Wait::Retry("none since the test began".to_owned())),
      many => Err(Wait::Fatal(format!(
        "{} traces with root '{name}' since the test began; expected exactly one",
        many.len()
      ))),
    },
  )
}

// --- Loki ----------------------------------------------------------------------------------------------------

/// One Loki stream: its labels (structured metadata included) and its lines.
struct Stream {
  labels: Vec<(String, String)>,
  lines: Vec<String>,
}

/// The most records one scan reads; Loki returns no more than this per query.
const SCAN_LIMIT: usize = 5000;

fn object_pairs(value: &Value) -> Vec<(String, String)> {
  value
    .as_object()
    .into_iter()
    .flatten()
    .map(|(key, value)| (key.clone(), value.as_str().unwrap_or_default().to_owned()))
    .collect()
}

fn query_logs(http: &Http, backends: &Backends, query: &str, since: SystemTime) -> Result<Vec<Stream>, String> {
  let mut url = endpoint(&backends.loki, "/loki/api/v1/query_range");
  url
    .query_pairs_mut()
    .append_pair("query", query)
    .append_pair("start", &nanos(since).to_string())
    .append_pair("end", &nanos(SystemTime::now() + Duration::from_secs(60)).to_string())
    .append_pair("limit", &SCAN_LIMIT.to_string())
    .append_pair("direction", "forward");
  let body = http.get_json(&url)?;
  Ok(
    body["data"]["result"]
      .as_array()
      .into_iter()
      .flatten()
      .map(|result| Stream {
        labels: object_pairs(&result["stream"]),
        lines: result["values"]
          .as_array()
          .into_iter()
          .flatten()
          .filter_map(|value| value[1].as_str().map(str::to_owned))
          .collect(),
      })
      .collect(),
  )
}

/// Waits until Loki holds API log records carrying `trace_id`, with a record of each of `messages` among them.
fn wait_for_trace_logs(http: &Http, backends: &Backends, trace_id: &str, since: SystemTime, messages: &[&str]) {
  poll(&format!("API log records with trace id {trace_id} in Loki"), SIGNAL_TIMEOUT, || {
    let query = format!(r#"{{service_name="calendar-api"}} | trace_id="{trace_id}""#);
    let streams = query_logs(http, backends, &query, since)?;
    let lines: Vec<&str> = streams.iter().flat_map(|stream| &stream.lines).map(String::as_str).collect();
    if lines.is_empty() {
      return Err(Wait::Retry("no record carries the trace id".to_owned()));
    }
    let missing: Vec<&&str> = messages.iter().filter(|message| !lines.contains(message)).collect();
    if missing.is_empty() {
      Ok(())
    } else {
      Err(Wait::Retry(format!("no record {missing:?} carries the trace id")))
    }
  });
}

/// Every log record of the API and the web app since `since`, for the personal-data scan.
fn logs_since(http: &Http, backends: &Backends, since: SystemTime) -> Vec<Stream> {
  let streams = query_logs(http, backends, r#"{service_name=~"calendar-api|calendar-web"}"#, since).expect("Loki");
  let count: usize = streams.iter().map(|stream| stream.lines.len()).sum();
  assert!(
    count < SCAN_LIMIT,
    "Loki returned {count} log records, its limit, so the personal-data scan would be incomplete. Run the tests on a \
     fresh stack (just e2e native)."
  );
  streams
}

// --- Prometheus ----------------------------------------------------------------------------------------------

/// A route the flow calls, as the API's metrics label it, and how many requests the flow makes to it at least.
#[derive(Clone, Copy, Debug)]
pub struct Route {
  pub method: &'static str,
  /// The route template, as `http_route` labels it.
  pub path: &'static str,
  pub times: u32,
}

/// `times` requests to `method route`.
pub const fn route(method: &'static str, path: &'static str, times: u32) -> Route {
  Route { method, path, times }
}

/// The API's HTTP server duration histogram; its `_count` is the request count.
const HISTOGRAM: &str = "http_server_request_duration_seconds";

fn selector(hit: &Route) -> String {
  format!(
    r#"{{job="calendar-api",http_route="{}",http_request_method="{}"}}"#,
    hit.path, hit.method
  )
}

fn instant(http: &Http, backends: &Backends, query: &str) -> Result<Option<f64>, String> {
  let mut url = endpoint(&backends.prometheus, "/api/v1/query");
  url.query_pairs_mut().append_pair("query", query);
  let body = http.get_json(&url)?;
  Ok(body["data"]["result"][0]["value"][1].as_str().and_then(|value| value.parse().ok()))
}

fn count_of(http: &Http, backends: &Backends, hit: &Route) -> Result<f64, String> {
  Ok(instant(http, backends, &format!("sum({HISTOGRAM}_count{})", selector(hit)))?.unwrap_or(0.0))
}

/// Each route's request count so far (0 for a route with no series yet), read before the flow starts.
pub fn request_counts(http: &Http, backends: &Backends, hits: &[Route]) -> Vec<f64> {
  hits.iter().map(|hit| count_of(http, backends, hit).expect("Prometheus")).collect()
}

/// Waits until each route's count has grown by its `times` since `before`, and its duration buckets exist.
fn wait_for_request_metrics(http: &Http, backends: &Backends, hits: &[Route], before: &[f64]) {
  let what = hits
    .iter()
    .map(|hit| format!("{} {}", hit.method, hit.path))
    .collect::<Vec<_>>()
    .join(", ");
  poll(&format!("Request metrics for {what} in Prometheus"), METRIC_TIMEOUT, || {
    for (hit, before) in hits.iter().zip(before) {
      let grown = count_of(http, backends, hit)? - before;
      if grown < f64::from(hit.times) {
        return Err(Wait::Retry(format!("{} {} count grew by {grown}", hit.method, hit.path)));
      }
      let buckets = instant(http, backends, &format!("count({HISTOGRAM}_bucket{})", selector(hit)))?;
      if buckets.is_none_or(|count| count == 0.0) {
        return Err(Wait::Retry(format!("{} {} has no duration buckets", hit.method, hit.path)));
      }
    }
    Ok(())
  });
}

/// The label sets of every series the API and the web app export, for the personal-data scan.
fn series_labels(http: &Http, backends: &Backends, since: SystemTime) -> Vec<Vec<(String, String)>> {
  let mut url = endpoint(&backends.prometheus, "/api/v1/series");
  let start = since
    .duration_since(UNIX_EPOCH)
    .map_or(0, |since| since.as_secs())
    .saturating_sub(60);
  url
    .query_pairs_mut()
    .append_pair("match[]", r#"{job=~"calendar-api|calendar-web"}"#)
    .append_pair("start", &start.to_string());
  http.get_json(&url).expect("Prometheus")["data"]
    .as_array()
    .into_iter()
    .flatten()
    .map(object_pairs)
    .collect()
}

// --- Personal data -------------------------------------------------------------------------------------------

/// Values the telemetry must never carry, each with a description for the report (never the value itself).
#[derive(Default)]
pub struct PersonalData {
  values: Vec<(String, String)>,
}

impl PersonalData {
  /// Registers `value` (case-insensitively) under `description`.
  pub fn add(&mut self, description: &str, value: &str) {
    let value = value.trim().to_lowercase();
    if !value.is_empty() && !self.values.iter().any(|(known, _)| *known == value) {
      self.values.push((value, description.to_owned()));
    }
  }
}

fn is_word(byte: u8) -> bool {
  byte.is_ascii_alphanumeric() || byte == b'_'
}

/// `[\w.%+-]+@[\w-]+(\.[\w-]+)+`.
fn has_email(text: &str) -> bool {
  let bytes = text.as_bytes();
  let local = |b: u8| is_word(b) || matches!(b, b'.' | b'%' | b'+' | b'-');
  let label = |b: u8| is_word(b) || b == b'-';
  bytes.iter().enumerate().any(|(at, &byte)| {
    if byte != b'@' || at == 0 || !local(bytes[at - 1]) {
      return false;
    }
    let rest = &bytes[at + 1..];
    let first = rest.iter().take_while(|&&b| label(b)).count();
    first > 0 && rest.get(first) == Some(&b'.') && rest.get(first + 1).is_some_and(|&b| label(b))
  })
}

/// `eyJ[\w-]{8,}\.[\w-]{8,}\.`: a JWT's header and payload.
fn has_jwt(text: &str) -> bool {
  let segment = |s: &str| s.bytes().take_while(|&b| is_word(b) || b == b'-').count();
  text.match_indices("eyJ").any(|(at, _)| {
    let rest = &text[at + 3..];
    let header = segment(rest);
    if header < 8 || rest.as_bytes().get(header) != Some(&b'.') {
      return false;
    }
    let rest = &rest[header + 1..];
    let payload = segment(rest);
    payload >= 8 && rest.as_bytes().get(payload) == Some(&b'.')
  })
}

/// `\b(set-)?cookie\s*[:=]`, case-insensitively.
fn has_cookie_header(text: &str) -> bool {
  let lower = text.to_lowercase();
  lower.match_indices("cookie").any(|(at, _)| {
    (at == 0 || !is_word(lower.as_bytes()[at - 1])) && matches!(lower[at + 6..].trim_start().as_bytes().first(), Some(b':' | b'='))
  })
}

/// `\bbearer\s+[\w.~+/-]{8,}`, case-insensitively.
fn has_bearer(text: &str) -> bool {
  let lower = text.to_lowercase();
  lower.match_indices("bearer").any(|(at, _)| {
    let rest = &lower[at + 6..];
    let token = rest.trim_start();
    (at == 0 || !is_word(lower.as_bytes()[at - 1]))
      && token.len() < rest.len()
      && token
        .bytes()
        .take_while(|&b| is_word(b) || matches!(b, b'.' | b'~' | b'+' | b'/' | b'-'))
        .count()
        >= 8
  })
}

/// The generic shapes of ADR-0062's privacy check: personal data or secrets whoever wrote them.
type Pattern = (&'static str, fn(&str) -> bool);

const PATTERNS: [Pattern; 4] = [
  ("an email address", has_email),
  ("a JWT-shaped token", has_jwt),
  ("a cookie header", has_cookie_header),
  ("a bearer token", has_bearer),
];

/// Every leak in `exported` (`where`, text) of `personal` or of a generic pattern: where it was and what matched,
/// never the value itself, so the report does not leak it again.
pub fn scan(exported: &[(String, String)], personal: &PersonalData) -> Vec<String> {
  let mut findings = Vec::new();
  for (place, text) in exported {
    let lower = text.to_lowercase();
    for (value, description) in &personal.values {
      if lower.contains(value.as_str()) {
        findings.push(format!("{description} in {place}"));
      }
    }
    for (description, found) in PATTERNS {
      if found(text) {
        findings.push(format!("{description} in {place}"));
      }
    }
  }
  findings
}

fn exported_spans(spans: &[Span]) -> Vec<(String, String)> {
  let mut out = Vec::new();
  for span in spans {
    let at = format!("{} span '{}'", span.service, span.name);
    out.push((format!("{at} name"), span.name.clone()));
    out.push((format!("{at} status"), span.status.clone()));
    for (key, value) in span.attributes.iter().chain(&span.resource) {
      out.push((format!("{at} attribute {key}"), format!("{key}={value}")));
    }
    for (name, attributes) in &span.events {
      out.push((format!("{at} event"), name.clone()));
      for (key, value) in attributes {
        out.push((format!("{at} event '{name}' attribute {key}"), format!("{key}={value}")));
      }
    }
  }
  out
}

fn exported_logs(streams: &[Stream]) -> Vec<(String, String)> {
  let mut out = Vec::new();
  for stream in streams {
    let service = stream
      .labels
      .iter()
      .find(|(key, _)| key == "service_name")
      .map_or("unknown service", |(_, value)| value.as_str());
    let at = format!("log stream of {service}");
    for (key, value) in &stream.labels {
      out.push((format!("{at} label {key}"), format!("{key}={value}")));
    }
    for (index, line) in stream.lines.iter().enumerate() {
      out.push((format!("{at} line {}", index + 1), line.clone()));
    }
  }
  out
}

fn exported_series(series: &[Vec<(String, String)>]) -> Vec<(String, String)> {
  let mut out = Vec::new();
  for labels in series {
    let name = labels
      .iter()
      .find(|(key, _)| key == "__name__")
      .map_or("series", |(_, value)| value.as_str());
    for (key, value) in labels {
      out.push((format!("metric {name} label {key}"), format!("{key}={value}")));
    }
  }
  out
}

// --- The four assertions -------------------------------------------------------------------------------------

/// One user action's trace, and log messages that must be among the records carrying its id (any when empty).
pub struct Action {
  pub trace_id: String,
  pub expect: Expect,
  pub logs: &'static [&'static str],
  /// The app started this trace with its own `traceparent`: the chain's first span must have a parent outside the
  /// trace (the app's span, which it never exports), not be a root the API started itself.
  pub from_app: bool,
}

/// Why `spans` is not a trace the app started at `first`, or `None` when it is: the API's span `first` has a parent,
/// the app's span from its `traceparent`, rather than being a root the API started itself.
pub fn started_by_the_app(spans: &[Span], first: Matcher) -> Option<String> {
  let server = spans.iter().find(|span| first.matches(span))?;
  server
    .parent_id
    .is_empty()
    .then(|| format!("{} is the trace's root: the app sent no traceparent", first.describe()))
}

/// What a flow's telemetry must prove.
pub struct Flow<'a> {
  /// When the test began: the scan and the root-trace search start here.
  pub since: SystemTime,
  pub personal: &'a PersonalData,
  /// One trace per user action.
  pub actions: Vec<Action>,
  /// The routes the flow hit, and their request counts from [`request_counts`] before it.
  pub routes: &'a [Route],
  pub before: &'a [f64],
}

/// Makes the four assertions for `flow`, and returns each action's spans.
pub fn expect_flow(http: &Http, backends: &Backends, flow: &Flow<'_>) -> Vec<Vec<Span>> {
  let mut traces = Vec::new();
  for action in &flow.actions {
    let spans = wait_for_trace(http, backends, &action.trace_id, &action.expect);
    if action.from_app
      && let Some(first) = action.expect.chain.first()
      && let Some(problem) = started_by_the_app(&spans, *first)
    {
      panic!("Trace {}: {problem}", action.trace_id);
    }
    traces.push(spans);
    wait_for_trace_logs(http, backends, &action.trace_id, flow.since, action.logs);
  }
  wait_for_request_metrics(http, backends, flow.routes, flow.before);
  let mut exported: Vec<(String, String)> = traces.iter().flat_map(|spans| exported_spans(spans)).collect();
  exported.extend(exported_logs(&logs_since(http, backends, flow.since)));
  exported.extend(exported_series(&series_labels(http, backends, flow.since)));
  let findings = scan(&exported, flow.personal);
  assert!(
    findings.is_empty(),
    "Personal data in the flow's telemetry:\n{}",
    findings.join("\n")
  );
  traces
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_generic_patterns_match_as_the_web_suites_do() {
    assert!(has_email("user e2e-user@example.com signed in"));
    assert!(!has_email("@example.com"), "no local part");
    assert!(!has_email("a@b"), "no dot in the domain");
    assert!(has_jwt("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig"));
    assert!(!has_jwt("eyJshort.eyJalsoshort.x"));
    assert!(has_cookie_header("Set-Cookie: calendar_session=x"));
    assert!(has_cookie_header("cookie=abc"));
    assert!(!has_cookie_header("http.route=/api/cookies"), "a word, not a header");
    assert!(!has_cookie_header("calendar_cookie_policy"));
    assert!(has_bearer("Authorization: Bearer abcdefgh123"));
    assert!(!has_bearer("bearer short"));
  }

  #[test]
  fn the_scan_names_the_place_and_the_value_never_the_value_itself() {
    let mut personal = PersonalData::default();
    personal.add("the email", "E2E-User@Example.com");
    let findings = scan(
      &[
        (
          "span 'GET /api/auth/me' attribute user".to_owned(),
          "user=e2e-user@example.com".to_owned(),
        ),
        ("metric label route".to_owned(), "http_route=/api/auth/me".to_owned()),
      ],
      &personal,
    );
    assert_eq!(
      findings,
      [
        "the email in span 'GET /api/auth/me' attribute user",
        "an email address in span 'GET /api/auth/me' attribute user"
      ]
    );
  }

  fn span(name: &str, id: &str, parent: &str) -> Span {
    Span {
      service: "calendar-api".to_owned(),
      name: name.to_owned(),
      id: id.to_owned(),
      parent_id: parent.to_owned(),
      attributes: vec![],
      resource: vec![],
      events: vec![],
      status: String::new(),
    }
  }

  #[test]
  fn a_chain_needs_each_span_under_the_one_before() {
    let spans = [
      span("POST /api/auth/native/token", "a", ""),
      span("middle", "b", "a"),
      span("SELECT users", "c", "b"),
      span("GET /api/auth/me", "d", ""),
    ];
    let chain = |chain: Vec<Matcher>| Expect { chain, spans: vec![] };
    assert_eq!(
      trace_problems(&spans, &chain(vec![api(&["POST /api/auth/native/token"]), api(&["SELECT users"])])),
      Vec::<String>::new()
    );
    assert_eq!(
      trace_problems(&spans, &chain(vec![api(&["GET /api/auth/me"]), api(&["SELECT users"])])),
      ["no span calendar-api 'SELECT users' under calendar-api 'GET /api/auth/me'"]
    );
    assert_eq!(
      trace_problems(&spans, &chain(vec![api(&["DELETE users"])])),
      ["no span calendar-api 'DELETE users'"]
    );
  }

  #[test]
  fn span_ids_read_as_hex_from_base64_or_hex() {
    assert_eq!(hex(Some("AAECAwQFBgc=")), "0001020304050607");
    assert_eq!(hex(Some("0001020304050607")), "0001020304050607");
    assert_eq!(hex(None), "");
  }
}
