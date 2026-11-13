---
status: proposed
date: 2026-11-13
decision-makers: mgasca, Claude (AI assistant)
---

# OpenTelemetry over OTLP from the API and the web app, with Grafana LGTM locally and Application Insights in Azure

## Context and Problem Statement

The calendar cannot show what a flow did after it ran. Today:

* **API:** logs with `tracing` and `tracing-subscriber`'s plain-text formatter at INFO, to standard output (`calendar-api/src/main.rs`). It has no request spans, no trace ids, no JSON output and no metrics, and uses `tower-http` only for `ServeDir`.
* **Azure:** Container Apps sends console logs to the Log Analytics workspace `law-calendar-<suffix>`, with 30-day retention. Application Insights `appi-calendar-<suffix>` is provisioned workspace-based (`infra/modules/monitoring.bicep`), but the container app gets no connection string and the API sends it nothing. Key Vault audit events go to the same workspace.
* **Health:** `GET /api/health` backs the startup, liveness and readiness probes.
* **Web:** the web app has no telemetry.
* **Local:** development runs PostgreSQL only.

The model's `observability` control records this gap. Epic #728 (story [0064](../stories/0064-test-every-user-flow-end-to-end-and-prove-it-is-observable.md)) asks every end-to-end flow test ([ADR-0061](0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)) to prove its flow is observable: one trace from the browser to the database, logs correlated with it, request metrics, and no personal data. The question: which telemetry standard and which destinations should the API and the web app use, locally, in end-to-end runs and in Azure, and under which privacy rules?

## Decision Drivers

* **D1 Per-flow verifiability**: a test can find one trace that joins the browser action, the API request and the database queries, the logs of that request and the request metrics, through query APIs on a local stack.
* **D2 One path, destination by configuration**: the code emits the same signals everywhere; where they go (local stack, Azure, nowhere) is configuration, not code.
* **D3 Privacy by construction**: personal data (emails, names, titles, locations, notes, query values, cookies, tokens) cannot leak into telemetry by default, and a test can prove it ([ADR-0041](0041-per-user-data-ownership.md)).
* **D4 Azure fit**: lands in the Application Insights resource that is already provisioned, beside the Log Analytics logs, with no new paid service.
* **D5 Off by default and cheap**: with nothing configured, nothing is exported and the API and web app behave as today; the overhead when on is small for a 0.25 vCPU container.
* **D6 SDK maturity**: maintained libraries for Rust (axum, tower, Diesel through `tracing`) and the browser (fetch instrumentation).

## Considered Options

* OpenTelemetry SDKs exporting OTLP, destination by configuration
* Application Insights SDKs directly
* Structured JSON logs to standard output only
* Prometheus metrics endpoint and JSON logs, without tracing

## Decision Outcome

Chosen option: "OpenTelemetry SDKs exporting OTLP, destination by configuration", because it is the only option that joins browser, API and database in one trace a local test can query (D1), keeps one export path whose destination is configuration (D2), and reaches the provisioned Application Insights (D4) while staying off when unconfigured (D5). Its costs are SDK maturity (D6: the Rust traces signal is beta, browser instrumentation is experimental) and the work of an attribute allow-list (D3), both taken on deliberately.

| Driver | **OpenTelemetry SDKs exporting OTLP (chosen)** | Application Insights SDKs directly | Structured JSON logs only | Prometheus endpoint and JSON logs |
| --- | :---: | :---: | :---: | :---: |
| D1 Per-flow verifiability | ★★★ | ★☆☆ | ★☆☆ | ★☆☆ |
| D2 One path, destination by configuration | ★★★ | ☆☆☆ | ★★☆ | ★☆☆ |
| D3 Privacy by construction | ★★☆ | ★★☆ | ★★☆ | ★★☆ |
| D4 Azure fit | ★★☆ | ★★★ | ★★☆ | ★☆☆ |
| D5 Off by default and cheap | ★★★ | ★★☆ | ★★★ | ★★☆ |
| D6 SDK maturity | ★★☆ | ★☆☆ | ★★★ | ★★★ |

### Signals and wiring

* **API (#731):** the `opentelemetry`, `opentelemetry_sdk` and `opentelemetry-otlp` crates, bridged from `tracing` (`tracing-opentelemetry` for spans, `opentelemetry-appender-tracing` for logs), so existing `tracing` calls become exported records and stdout logging stays.
  * One server span per request, named `<METHOD> <route template>` (for example `GET /api/agenda/day`), with method, route, status code and duration.
  * W3C `traceparent` extracted from incoming requests.
  * One client span per database query, named `<operation> <table>`.
  * HTTP server request count and duration metrics by method, route template and status.
  * Configured only by the standard `OTEL_*` variables (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME`, …). With no endpoint set, no exporter is built.
* **Web app (#732):** `@opentelemetry/sdk-trace-web` with `@opentelemetry/instrumentation-fetch`, which adds `traceparent` to same-origin `/api` requests, and one span per user action of a flow (for example "save event"). Exported with `@opentelemetry/exporter-trace-otlp-http` to the same-origin path `/otlp`, which the Vite server (`vite dev`, and `vite preview` for the built app in end-to-end runs) forwards to the local collector, so the API exposes no ingestion endpoint. Loaded only when configured at build time; otherwise no OpenTelemetry code is in the bundle's executed path.
* **Local and end-to-end:** one `grafana/otel-lgtm` container (OpenTelemetry Collector, Tempo, Loki, Prometheus, Pyroscope and Grafana), loopback ports only, opt-in for everyday development ([ADR-0063](0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md)). The image is for development and testing, as its README says, and never runs in Azure.
* **Azure (#738):** the API's OTLP goes to Application Insights `appi-calendar-<suffix>`. The default route is the Container Apps managed OpenTelemetry agent, configured on the environment with the Application Insights connection string: it carries traces and logs, accepts gRPC only, and does not send metrics to Application Insights. Request metrics in Azure then come from the Container Apps platform metrics. If OTLP metrics in Application Insights become necessary, #738 replaces the agent with an OpenTelemetry Collector using Azure Monitor's native OTLP ingestion (generally available, Microsoft Entra authentication). Web telemetry is not exported in Azure in this epic. Alerts and budgets stay with #80.

### Privacy rules

Telemetry attributes come from an allow-list, never from request or row content:

* **Allowed:** service name and version, route template, HTTP method, status code, durations, database system, operation and table, error kind and message templates, and opaque ids (trace, span, event or task UUID).
* **Never present:** email addresses, display names, event or task titles, locations, notes, query-string values (the agenda's `date` and `timeZone` included), raw URLs with a query, request or response bodies, cookies, `Authorization` headers, OAuth codes and tokens, and `enduser.*` attributes.
* **Database spans:** record the statement shape without bind values.
* **Logs:** the same rules apply to log messages and fields. A log line that needs a person to be identifiable uses the user's opaque id.
* **Enforcement:** an attribute filter in each SDK drops anything not allow-listed before export, and a unit test per stack proves it.

### End-to-end assertions

Each flow test ([ADR-0061](0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)) queries the LGTM stack's APIs for its own run:

* **One trace per flow:** the browser span, the API server span or spans and the database span or spans share one trace id, with the span names expected for the flow's transitions.
* **Correlated logs:** Loki holds the API's log records for the flow, carrying that trace id.
* **Request metrics:** Prometheus has the HTTP request count and duration series for the routes the flow hit.
* **No personal data:** none of the test's seeded titles, notes or locations, the signed-in email, the session cookie or any token appears in the spans, logs or metric labels.

### Consequences

* Good, because every flow can be followed from the click to the query, locally and in Azure, with one set of instrumentation.
* Good, because the privacy rules are tested, not only written down.
* Bad, because the Rust traces signal is beta and browser instrumentation is experimental upstream, so version bumps may need code changes.
* Bad, because the Azure managed agent is a preview feature, works at environment level and sends no metrics to Application Insights.
* Bad, because the API gains a set of OpenTelemetry crates and the web app an optional OpenTelemetry bundle.
* Neutral, because Log Analytics keeps receiving console logs as today; the OTLP logs add trace correlation in Application Insights.

### Confirmation

* API and web unit tests prove the attribute filter and the no-exporter default (#731, #732).
* Every end-to-end flow test makes the four assertions above (#733 to #736).
* The model's `observability` control records the export, destinations and privacy rules, and `just docs architecture` validates it.
* Staging is checked by the owner after #738, as its runbook says.

## Pros and Cons of the Options

### OpenTelemetry SDKs exporting OTLP, destination by configuration

* Good, because **D1 Per-flow verifiability**: W3C `traceparent` joins browser, API and database spans in one trace, and LGTM exposes Tempo, Loki and Prometheus query APIs that a test can call.
* Good, because **D2 One path, destination by configuration**: OTLP is accepted by LGTM, the Container Apps agent and Azure Monitor's native ingestion; only `OTEL_*` variables change.
* Neutral, because **D3 Privacy by construction**: instrumentation libraries add attributes such as `url.full` and `db.statement` by default, so an allow-list filter is needed; the SDKs provide the hooks for it.
* Neutral, because **D4 Azure fit**: reaches the provisioned Application Insights, but the managed agent route is preview and drops metrics.
* Good, because **D5 Off by default and cheap**: with no endpoint, no exporter is created; batching exporters keep the overhead small.
* Bad, because **D6 SDK maturity**: the Rust traces signal is beta (metrics and logs stable), and browser instrumentation is experimental.

### Application Insights SDKs directly

* Good, because **D4 Azure fit**: native to Application Insights, with its correlation and live metrics.
* Bad, because **D1 Per-flow verifiability**: nothing local to query, so an end-to-end test would need Azure.
* Bad, because **D2 One path, destination by configuration**: ties the code to one vendor; local and E2E runs could not use LGTM.
* Neutral, because **D3 Privacy by construction**: telemetry processors can filter, as in OpenTelemetry.
* Neutral, because **D5 Off by default and cheap**: off without a connection string, but heavier SDKs.
* Bad, because **D6 SDK maturity**: no official Rust SDK; only a community exporter crate exists.

### Structured JSON logs to standard output only

* Good, because **D6 SDK maturity**: `tracing-subscriber`'s JSON formatter is stable and already a dependency.
* Good, because **D5 Off by default and cheap**: no exporter at all.
* Neutral, because **D2 One path, destination by configuration**: standard output works everywhere, but locally it needs a log collector to be queryable.
* Neutral, because **D4 Azure fit**: reaches Log Analytics as today, leaving Application Insights unused.
* Neutral, because **D3 Privacy by construction**: the same field discipline is needed.
* Bad, because **D1 Per-flow verifiability**: no browser-to-database trace and no request metrics.

### Prometheus metrics endpoint and JSON logs, without tracing

* Good, because **D6 SDK maturity**: Prometheus client crates are mature.
* Neutral, because **D3 Privacy by construction**: labels and fields need the same discipline.
* Neutral, because **D5 Off by default and cheap**: a scrape endpoint is always on and must be protected from the public ingress.
* Bad, because **D1 Per-flow verifiability**: no trace joins the tiers.
* Bad, because **D2 One path, destination by configuration**: pull-based metrics need a scraper in each environment.
* Bad, because **D4 Azure fit**: Application Insights does not scrape a Prometheus endpoint; Azure would need a separate managed Prometheus.

## More Information

* **Versions at the time of writing (2026-11-13):**
  * Crates: `opentelemetry`, `opentelemetry_sdk`, `opentelemetry-otlp`, `opentelemetry-appender-tracing` and `opentelemetry-http` 0.33.1; `tracing-opentelemetry` 0.34.0; `axum-tracing-opentelemetry` 0.42.1; `tower-http` 0.7.1 (`cargo search`).
  * npm: `@opentelemetry/sdk-trace-web` 2.12.0; `@opentelemetry/instrumentation-fetch` and `@opentelemetry/exporter-trace-otlp-http` 0.301.2 (`npm view`).
  * Image: `grafana/otel-lgtm` 0.41.0 (Docker Hub; Apache-2.0).
* **Sources:**
  * opentelemetry.io: Rust signal status (traces beta, metrics and logs stable); browser instrumentation "experimental and mostly unspecified".
  * learn.microsoft.com, Container Apps OpenTelemetry agents: Application Insights takes logs and traces but not metrics; gRPC only.
  * Azure Monitor native OTLP ingestion: generally available, Azure update AZ565090, 2026-06-04.
* **Related:** [ADR-0029](0029-azure-container-apps-compute-platform.md) (Container Apps), [ADR-0030](0030-single-container-for-api-and-spa.md) (one container serves API and SPA), [ADR-0032](0032-azure-key-vault-for-secrets.md) (secrets), [ADR-0041](0041-per-user-data-ownership.md) (per-user data).
* **Delivery:** epic #728, children #731 (API), #732 (web), #733 (assertions) and #738 (Azure). Alerts and budgets: #80.
* **Answered on #729 (2026-11-13, the maintainer through the epic coordinator):** the browser exports to the same-origin `/otlp` path forwarded by `vite dev` and `vite preview` to LGTM, and the API gains no endpoint. Web telemetry stays off in Azure for this epic (`traceparent` is still sent); turning it on is a follow-up for a later decision.
* **Question 3, answered on #729 (2026-11-13, the maintainer through the epic coordinator):** the Azure route is the managed OpenTelemetry agent. Traces and logs go to Application Insights, and request metrics in Azure come from the Container Apps platform metrics, so #738's scope is traces and logs. The fallback is an OpenTelemetry Collector sidecar using native OTLP ingestion. It is triggered if OTLP metrics in Application Insights become necessary, for example for #80's alerts.
* **Revisit** when the managed agent leaves preview or gains Application Insights metrics, or when web telemetry is wanted in Azure.
