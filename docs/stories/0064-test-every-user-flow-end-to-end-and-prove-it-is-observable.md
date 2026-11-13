---
status: planned
date: 2026-11-13
issue: https://github.com/mgasca/calendar/issues/728
pr:
  - https://github.com/mgasca/calendar/pull/740
  - https://github.com/mgasca/calendar/pull/767
  - https://github.com/mgasca/calendar/pull/769
adrs: ["0008", "0021", "0027", "0030", "0039", "0058", "0061", "0062", "0063", "0064"]
---

# 0064 Test every user flow end to end and prove it is observable

## Story

> As the calendar owner, I need every flow people use to be exercised end to end in a real browser, and each run to leave a trace, logs and request metrics that carry no personal data, so that a regression or a blind spot in production shows up before a user finds it.

Tracked in epic #728; this card is PR 0, issue #729. The scope below is the epic's "Approved decisions", agreed with the maintainer on 2026-11-13.

## Background

The architecture model (`docs/architecture/calendar.architecture.json`, [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md)) describes nine flows. Seven are things a person does in the web app: sign in, view today, add an event, edit an event, edit a task, tick a task off and triage overdue tasks. Each is covered today by Vitest component tests with MSW ([ADR-0008](../decisions/0008-frontend-testing-stack.md)) and by Rust API tests on Testcontainers PostgreSQL, but nothing drives the built web app, the API and the database together in a browser. ADR-0008 deferred Playwright end-to-end tests "until there are real user flows"; those flows now exist.

Nothing shows what a flow did once it ran either. What exists today:

- **API logs:** `tracing` with `tracing-subscriber`'s plain-text formatter at INFO, to standard output (`calendar-api/src/main.rs`). No request spans, trace ids, JSON output or metrics. `tower-http` is used only for `ServeDir`.
- **Azure:** Container Apps sends console logs to the Log Analytics workspace `law-calendar-<suffix>` (30-day retention). Application Insights `appi-calendar-<suffix>` is provisioned workspace-based (`infra/modules/monitoring.bicep`), but the container app gets no connection string and the API sends it nothing. Key Vault audit events go to the same workspace.
- **Health:** `GET /api/health` backs the startup, liveness and readiness probes. Stale PR #120 added a database readiness endpoint, alerts and budgets for the .NET backend; none of it is on `main`, and it is closed as superseded.
- **Web:** no telemetry.
- **Local:** Docker Compose runs PostgreSQL only; ADR-0016 (now superseded by ADR-0063) deferred Aspire until a second backing service.
- **Sign-in tests:** the Rust API tests already run the Google round trip against an in-process fake of Google's token and userinfo endpoints (`calendar-api/tests/google_sign_in.rs`: allow-listed sign-in, denial, foreign callback, `Secure` cookies behind the proxy). In the running API, Google's endpoints are injectable only through `AppOptions` in tests, and the accepted issuers are a constant.

This story makes each user-facing flow a browser test on a real stack and makes the same run prove the flow is observable: one trace from the browser click to the database, logs carrying that trace id, request metrics, and no personal data in any of them. It builds on stories [0001](0001-today-view.md) to [0005](0005-google-sign-in.md) (the flows), [0021](0021-sign-in-locally-without-google.md) (the dev sign-in scheme the fixtures use), [0058](0058-move-the-backend-from-dotnet-to-rust.md) (the Rust API that is instrumented) and [0060](0060-bring-the-architecture-model-back-in-line-with-the-repo.md) (the model's `observability` control, which states the gap).

### Agreed scope

- **Flows:** the 7 user-facing CALM flows, `sign-in-flow`, `view-today-flow`, `add-event-flow`, `edit-event-flow`, `edit-task-flow`, `toggle-task-flow` and `overdue-triage-flow`. A flow is user-facing when one of its transitions uses the `user-uses-web-app` relationship; today that is exactly these 7.
- **Checked binding:** every test is tagged with its flow's `unique-id`. A check fails when a user-facing flow has no test or a tag names a flow the model does not define. Until the last slice lands, uncovered flows sit on an explicit pending list that must end empty. Each flow's entry in the model links its test.
- **Tool:** Playwright Test in a new pnpm workspace package, `frontend/apps/e2e`, consuming the contract and UI like any other client. Chromium only ([ADR-0061](../decisions/0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)).
- **Stack:** the suite runs on its own throwaway stack: PostgreSQL, the API, the built web app, Grafana LGTM and the stub OIDC provider on their own ports and project name, never the shared `calendar` Compose project, volume or port 5432 ([ADR-0063](../decisions/0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md)).
- **Cadence:** nightly and on demand (`workflow_dispatch`, plus a `just` recipe locally), not on every pull request. Playwright traces and the HTML report are kept as CI artifacts. The binding check needs no browser and runs with the frontend tests.
- **Sign-in:** a stub OIDC provider stands in for Google in the E2E stack, so the real login → callback → session → `returnUrl` round trip runs ([ADR-0064](../decisions/0064-stub-oidc-provider-for-sign-in-tests.md)). The other flows sign in with the dev scheme as a fixture. The API accepts the stub only when it runs as `Development` and the stub is on a loopback address; otherwise it refuses to start.
- **Telemetry:** the API and the web app emit OpenTelemetry over OTLP only; where it goes is configuration. Locally and in E2E it goes to a Grafana LGTM container (`grafana/otel-lgtm`: Tempo, Loki, Prometheus, Grafana); in Azure the API's telemetry goes to Application Insights ([ADR-0062](../decisions/0062-opentelemetry-over-otlp-with-grafana-lgtm-locally-and-application-insights-in-azure.md)). With no endpoint configured, nothing is exported and the API behaves as today.
- **Per-flow assertions**, from the LGTM stack's query APIs:
  - **one trace per flow:** the browser action, the API span or spans and the database span or spans share one trace id (the web app sends `traceparent`), with the span names expected for the flow's transitions;
  - **correlated logs:** Loki holds the API's logs for the flow, carrying that trace id;
  - **request metrics:** Prometheus has the HTTP request count and duration series for the routes the flow hit;
  - **no personal data:** no email, event or task title, location, notes, query-string value, session cookie or token in any span, log or metric label, checked against the values the test itself seeded.
- **Privacy rule for telemetry:** attributes come from an allow-list (route template, method, status, durations, database operation and table, error kind, opaque ids), never from request or row content ([ADR-0062](../decisions/0062-opentelemetry-over-otlp-with-grafana-lgtm-locally-and-application-insights-in-azure.md)).
- **Local orchestration:** LGTM and the stub are new backing services, which meets ADR-0016's trigger. ADR-0063 re-evaluates Aspire against Compose now that the backend is Rust: Compose with opt-in profiles is chosen, LGTM is available opt-in for everyday development, and ADR-0016 is superseded with its test half restated.
- **#104** (Google sign-in test gaps) is a child of this epic; its API-level tests stay in its own scope and may reuse the stub or the in-process fake.

### Not in this story

- **`database-migration-flow` and `publish-docs-flow`:** operator flows with no web UI; they are out of scope for the browser suite.
- **Firefox and WebKit:** Chromium only. Another browser would be its own decision.
- **E2E on every pull request:** the suite is nightly and on demand; only the binding check runs per PR.
- **Alerts and budgets:** stay with #80. This story owns telemetry wiring, including the Azure route.
- **#120:** the .NET S8 PR is closed as superseded by the move to Rust.
- **Visual regression, accessibility audits and load tests:** not part of these flow tests.
- **Production dashboards in Grafana:** LGTM is a development and test tool only; Azure uses Application Insights and Log Analytics.

### Children

Each slice is a child issue with its own PR. Their acceptance criteria are copied from the issues on 2026-11-13; the issue stays the place where they change.

| # | Slice | Depends on | Acceptance criteria |
| --- | --- | --- | --- |
| [#729](https://github.com/mgasca/calendar/issues/729) | PR 0: this card, four proposed ADRs and the model update (docs-only) | — | One docs-only PR that references the epic and closes only #729. The ADRs follow the repo's MADR conventions and pass `just tools adr`. The card lists the epic's children and their acceptance criteria; the ADRs merged as `proposed` in #740 and were accepted in the follow-up PR. |
| [#730](https://github.com/mgasca/calendar/issues/730) | Throwaway E2E stack: Grafana LGTM and the stub OIDC provider | #729 (ADRs 0063, 0064) | **Given** a clean machine with Docker, **when** the E2E stack recipe runs, **then** every service is healthy and the API reaches PostgreSQL, the OTLP endpoint and the stub issuer. **Given** another checkout's stack or the shared dev database is running, **when** the E2E stack starts and stops, **then** the other resources are untouched. **Given** the stub OIDC provider, **when** the API runs outside the Development configuration, **then** it refuses to use the stub issuer. `just doctor` and the runbooks name any new prerequisite. |
| [#731](https://github.com/mgasca/calendar/issues/731) | API: OpenTelemetry traces, logs and metrics over OTLP | #729 (ADR-0062) | **Given** an OTLP endpoint, **when** a request carrying `traceparent` is served, **then** its server and database spans join that trace. **Given** a request that fails, **when** it is logged, **then** the exported log record carries the trace id. **Given** any span, log or metric, **then** it carries no email, event or task title, notes, query-string values or cookie; a test proves the redaction. **Given** no OTLP endpoint, **when** the API starts, **then** it starts and serves as before. Tests run with `cargo test` against an in-process OTLP receiver or exporter; Clippy and rustfmt clean. |
| [#732](https://github.com/mgasca/calendar/issues/732) | Web app: OpenTelemetry with `traceparent` to the API | #729 (ADR-0062) | **Given** telemetry is configured, **when** the person saves an event, **then** the browser span and the API request share one trace id. **Given** any browser span, **then** it carries no email, title, notes or cookie; a test proves the attribute filter. **Given** telemetry is not configured, **then** no exporter is loaded and the existing Vitest suite passes unchanged. The theme guide and ADR-0047 are unaffected; the bundle size change is reported. |
| [#733](https://github.com/mgasca/calendar/issues/733) | Playwright harness, telemetry assertions, flow binding and `view-today-flow` | #729, #730, #731, #732 | **Given** the stack, **when** `view-today-flow`'s test runs, **then** it passes in Chromium and its trace, logs and metrics assertions pass. **Given** a user-facing flow in the model with no tagged test, **when** the binding check runs, **then** it fails naming the flow (flows not yet covered are listed as pending, not silently ignored). **Given** seeded titles and the user's email appear in a span or log, **then** the scanner fails the test. The model's `view-today-flow` links its test. |
| [#734](https://github.com/mgasca/calendar/issues/734) | `add-event-flow` and `edit-event-flow` | #733 | Each flow's test passes in Chromium with its trace, logs, metrics and no-personal-data assertions, and is tagged with its flow id. The model's two flows link their tests and leave the pending list. |
| [#735](https://github.com/mgasca/calendar/issues/735) | `toggle-task-flow`, `edit-task-flow` and `overdue-triage-flow` | #733 | Each flow's test passes in Chromium with its trace, logs, metrics and no-personal-data assertions, and is tagged with its flow id. The model's three flows link their tests and leave the pending list. |
| [#736](https://github.com/mgasca/calendar/issues/736) | `sign-in-flow` through the stub OIDC provider | #730, #733 | **Given** an allow-listed verified email at the stub, **when** the person signs in from `/day/<date>`, **then** they land on `/day/<date>` signed in. **Given** an email that is not allow-listed, **then** they land on `/signin?error=access_denied` with no session cookie. No telemetry signal carries the email, the token or the cookie. With this test, the binding check has no pending user-facing flows. |
| [#737](https://github.com/mgasca/calendar/issues/737) | Nightly and on-demand CI workflow | #733 | **Given** a nightly schedule, **when** the workflow runs on `main`, **then** it runs every tagged flow and uploads the report and traces. **Given** a failing flow, **then** the run fails and the report shows the Playwright trace and the telemetry assertion that failed. The workflow passes actionlint and follows the repo's CI conventions (ADR-0012, ADR-0046); a failure is visible and its run time is recorded for ADR-0045's trend. |
| [#738](https://github.com/mgasca/calendar/issues/738) | Azure: API telemetry to Application Insights | #729, #731 | `just infra` what-if for staging shows only the intended telemetry changes; Bicep lint and build pass. **Given** a deployed staging revision, **when** a flow runs, **then** its trace and logs appear in Application Insights (owner-verified; record what was and was not verified). **Given** staging telemetry, **then** it carries no personal data (owner check per the runbook). |
| [#104](https://github.com/mgasca/calendar/issues/104) | Google sign-in test gaps at API level | #729; may reuse the stub from #730 | **Given** a Google callback for an email that is not allow-listed or not verified, **when** it is processed, **then** the response redirects to `/signin?error=access_denied` and no auth cookie is issued. **Given** a callback for an allow-listed verified email, **then** a session cookie is issued and the user is redirected to the original local `returnUrl`. **Given** a non-Development environment behind `X-Forwarded-Proto: https`, **when** signing in, **then** the cookie is `Secure`, `HttpOnly`, `SameSite=Lax` and the `redirect_uri` uses the public HTTPS origin. Story 0005's notes drop the "known gaps" sentence. The Rust tests in `google_sign_in.rs` may already cover part of this; #104's own design post says what is left. |

Dependencies: #729 first; then #730, #731 and #732 in parallel; #733 when all three have landed; then #734, #735 and #736 in parallel, with #737 able to start once one flow runs. #738 needs only #731, and #104 only #729. The epic's dependency map is the live version.

### Acceptance criteria

1. **Given** the model's user-facing flows, **when** the nightly E2E run finishes on `main`, **then** each of the 7 flows has a test tagged with its `unique-id` that passed in Chromium against the throwaway stack.
2. **Given** a user-facing flow with no tagged test, or a test tagged with a flow id the model does not define, **when** the binding check runs on a pull request, **then** it fails and names the flow or the tag.
3. **Given** a flow test runs, **when** it queries the LGTM stack, **then** it finds one trace holding the browser span, the API span or spans and the database span or spans with the flow's expected span names, Loki log records carrying that trace id, and Prometheus request count and duration series for the routes the flow hit.
4. **Given** a flow test seeded titles, notes and a signed-in email, **when** it scans the flow's spans, logs and metric labels, **then** none of those values, nor the session cookie or a token, appears; and a planted value makes the scan fail.
5. **Given** the shared `calendar` Compose project, or another checkout's E2E stack, is running, **when** an E2E run starts and tears down, **then** those resources are untouched and the run removes only its own containers and volumes.
6. **Given** a signed-out deep link to `/day/<date>`, **when** the person signs in through the stub as an allow-listed verified email, **then** they land on `/day/<date>` signed in; **and given** an email that is not allow-listed, **then** they land on `/signin?error=access_denied` with no session cookie.
7. **Given** the API's Google endpoint or issuer overrides are set, **when** the API starts as anything but `Development`, or the override names a non-loopback host, **then** it refuses to start.
8. **Given** no OTLP endpoint is configured, **when** the API and the web app run, **then** no exporter is loaded and behaviour and existing tests are unchanged.
9. **Given** a deployed staging revision, **when** a flow runs, **then** its API trace and logs appear in Application Insights without personal data (owner-verified).
10. **Given** a failed nightly run, **when** the maintainer opens it, **then** the Playwright HTML report, the trace and the failing telemetry assertion are available as artifacts, and the failure is visible without opening the Actions tab.
11. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0061](../decisions/0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md) | Playwright Test in `frontend/apps/e2e`, Chromium only, nightly and on demand, tests tagged with CALM flow ids and a binding check | The tool, home, cadence and binding of every flow test |
| [0062](../decisions/0062-opentelemetry-over-otlp-with-grafana-lgtm-locally-and-application-insights-in-azure.md) | OpenTelemetry over OTLP from the API and the web app; LGTM locally and in E2E; Application Insights in Azure; privacy allow-list | What each flow test asserts, and the telemetry wiring of #731, #732 and #738 |
| [0063](../decisions/0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md) | Compose with opt-in profiles and per-run projects for the new backing services; Aspire not adopted (supersedes 0016) | How the E2E stack and local LGTM run (#730) |
| [0064](../decisions/0064-stub-oidc-provider-for-sign-in-tests.md) | `navikt/mock-oauth2-server` as the stub OIDC provider, pointed to by Development-only, loopback-only settings | The sign-in flow test (#736) and #104 |
| [0008](../decisions/0008-frontend-testing-stack.md) | Vitest, Testing Library and MSW; Playwright E2E deferred (amended to point to 0061) | Component tests stay; E2E is added beside them, not instead |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client supplies `today` and `timeZone` | The tests pin the browser clock and time zone |
| [0027](../decisions/0027-google-oidc-bff-session.md) | Google OIDC with a BFF cookie session | The round trip the stub must reproduce |
| [0030](../decisions/0030-single-container-for-api-and-spa.md) | One container serves the API and the SPA | Why browser telemetry has no export path in Azure in this story |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | FINOS CALM model | The flows the tests bind to, and where the new nodes are recorded |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | TypeScript on Deno for repository tooling, with Playwright as the run-calendar browser driver | The driver stays a tooling concern; the test runner is Playwright Test in the frontend workspace |

### Other decisions (not ADR-worthy)

- **User-facing is derived:** a flow is user-facing when a transition uses `user-uses-web-app`, so a new flow in the model needs a test without anyone updating a list.
- **Tag format:** `@flow:<unique-id>` through Playwright's `tag` option, so `--grep @flow:add-event-flow` runs one flow.
- **Pending list:** a committed list of flows not yet covered, which each slice shrinks; the binding check fails if a pending flow has a test (the list is stale) or if the list is not empty once #736 lands.
- **Fixed clock and zone:** each test pins the browser clock and time zone, so day boundaries and overdue states are deterministic ([ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md)).
- **Ports:** the E2E stack uses the run-calendar skill's 55xxx range, distinct from the agent stack where they could collide, and is chosen in #730.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| E2E suite, fixtures, telemetry helpers, binding check | `frontend/apps/e2e` |
| E2E stack and recipes | `compose.yaml` profiles `observability` (`lgtm`) and `sign-in-stub` (`oidc-stub`); `e2e.just` (`just e2e up`, `check`, `env`, `ls`, `down`); `just db observability` and `just db sign-in-stub`; [runbook](../runbooks/local-stack-and-e2e.md) (#730) |
| API telemetry | `backend/crates/calendar-api` (startup in `src/main.rs`, request and database spans) |
| Stub issuer settings and guard | `backend/crates/calendar-api/src/config.rs` (`GoogleOverrides`, the two refusals), `src/auth/google.rs`, `src/state.rs`; tests in `config.rs`, `google.rs` and `tests/google_overrides_startup.rs` (#730) |
| Web telemetry | `frontend/apps/web` |
| Nightly workflow | `.github/workflows/` (#737) |
| Azure route | `infra/modules/app.bicep`: the Container Apps managed OpenTelemetry agent on the environment sends traces and logs to Application Insights; the app sets `OTEL_SERVICE_NAME=calendar-api` and `OTEL_METRICS_EXPORTER=none` (#738). Where to look: [the Azure infrastructure runbook](../runbooks/azure-infrastructure.md#monitoring-where-to-look) |
| Model | `docs/architecture/calendar.architecture.json` (nodes `e2e-suite`, `lgtm`, `oidc-stub`; the `observability` control; flow test links) |

### API

No endpoint changes expected. New settings: the OpenTelemetry `OTEL_*` variables, and the Development-only Google endpoint and issuer overrides of ADR-0064.

API telemetry (#731) lives in `calendar-api/src/telemetry/`:

- **Switch:** telemetry is on only when `OTEL_EXPORTER_OTLP_ENDPOINT` or a per-signal endpoint is set. `OTEL_EXPORTER_OTLP_PROTOCOL` chooses `grpc` or `http/protobuf`, which is the default. `OTEL_SDK_DISABLED=true` and `OTEL_<SIGNAL>_EXPORTER=none` turn signals off. With no endpoint, no exporter is built, and request spans are disabled at their callsites. Standard output keeps its plain-text format, which shows events only.
- **Server spans:** a `Router::layer` middleware makes one server span per routed request, named `<METHOD> <route template>`. It is the child of the W3C `traceparent` the request carries. The layer also records the `http.server.request.duration` histogram by method, route template and status. Its count is the request count.
- **Database spans:** a Diesel `Instrumentation` is set on each pooled connection in `AppState::db()`. It makes one client span per query, named `<operation> <table>`. The span holds `db.query.text` cut before Diesel's `-- binds:`, so bind values are never formatted.
- **Logs:** an in-repo bridge layer (`logs.rs`) exports INFO and above with the trace and span ids of the entered span. It copies only allow-listed fields. `opentelemetry-appender-tracing` was not used because it copies every field, and an SDK log record cannot drop an attribute afterwards.
- **Allow-list:** the allow-list is in `allow_list.rs`. A span processor drops every other attribute and all span events before export.

### Testing

- Browser: the Playwright flow tests, nightly and on demand.
- Binding: the browser-free check on every pull request.
- API: `cargo test` for the exporter wiring, `traceparent` extraction, redaction and the stub guard. `crates/calendar-api/tests/telemetry.rs` runs the production pipeline with in-memory exporters and scans every exported span, log and metric for seeded personal data. The unit tests in `src/telemetry*` cover the `OTEL_*` configuration, the statement shape and the allow-list.
- Web: Vitest for the attribute filter and the no-exporter default.

### Delivered in #730

- **Settings:** `Auth__Google__AuthorizationEndpoint`, `Auth__Google__TokenEndpoint`, `Auth__Google__UserInfoEndpoint`, `Auth__Google__Issuer`; each replaces only its own value. Refused at startup outside `Development` (`GoogleOverrideOutsideDevelopment`) or when not an `http(s)` URL on `localhost`, `127.0.0.1` or `[::1]` (`GoogleOverrideNotLoopback`); the binary test runs `calendar-api` with each override to prove both.
- **Ports:** a run takes a 55xxx slot k ∈ {2, 3, 5, 6, 7, 8, 9}: 55k00 + 17 OTLP gRPC, 18 OTLP HTTP, 20 Tempo, 30 Grafana, 31 Loki, 32 PostgreSQL, 41 API, 73 web, 80 stub, 90 Prometheus, away from the agent stack's 55041, 55173 and 55432.
- **Stack settings for the next slices:** the API gets `OTEL_EXPORTER_OTLP_ENDPOINT` (OTLP HTTP), `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_SERVICE_NAME=calendar-api` and `OTEL_METRIC_EXPORT_INTERVAL=5000` (#731; with #731 merged, a run's API traces, logs with trace ids and `http_server_request_duration_seconds` series reached Tempo, Loki and Prometheus, the metric 4 s after the request); the web app is built with `VITE_OTEL_TRACES_EXPORTER=otlp` and served with `CALENDAR_OTLP_URL` (#732); `just e2e env` gives the harness every URL, the seed key and the allow-listed email (#733).
- **Measured (WSL2 laptop, Docker Desktop 29.9.2, images present):** the stub was ready 3.9 s after `docker run` and used 173 MiB; containers healthy in 33 to 48 s; `just e2e up` ready in 49 s with cached builds, 111 s with the first build. ADR-0064 had left the stub's start-up unmeasured.
- **Image pin:** `grafana/otel-lgtm:0.41.0` failed to pull three times with the same layer digest mismatch, so `0.40.0` is pinned; Dependabot can propose the next tag.

### Lessons learned, known issues and follow-ups

- Browser OpenTelemetry is marked experimental upstream, and the Rust traces signal is beta; ADR-0062 records the versions checked.
- **Follow-up:** web telemetry in Azure stays off in this story (`traceparent` is still sent), as the maintainer chose on #729 on 2026-11-13; turning it on is a later decision (ADR-0062).

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

This story changes nothing a calendar user sees. For the maintainer:

### Run the end-to-end tests

Run the E2E recipe from the repository root. It starts a private stack (database, API, web app, telemetry and a stand-in for Google sign-in), runs every flow in Chromium, and removes the stack afterwards. Your own development database is not touched. A failed run leaves the HTML report and the Playwright trace for the failing test.

### Look at a flow's telemetry locally

Start the optional telemetry service with the development stack, use the app, then open Grafana on its local port to see the trace of each click, the API logs linked to it and the request metrics.

### Nightly runs

The suite runs every night on `main` and can be started by hand from the Actions tab. A failure is reported where the maintainer already looks, with the report and traces attached to the run.
