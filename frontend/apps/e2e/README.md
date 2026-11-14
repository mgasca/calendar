# End-to-end flow tests

Playwright Test, Chromium only ([ADR-0061](../../../docs/decisions/0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)). There is one test per user-facing flow of the architecture model, and each test proves the flow is observable ([ADR-0062](../../../docs/decisions/0062-opentelemetry-over-otlp-with-grafana-lgtm-locally-and-application-insights-in-azure.md)). Run it with `just e2e test`; the [runbook](../../../docs/runbooks/local-stack-and-e2e.md#run-the-end-to-end-flow-tests) has the rest.

| Path                      | What                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `tests/<flow-id>.spec.ts` | One flow test, tagged `@flow:<flow-id>`                                                                       |
| `src/fixtures.ts`         | `test` with a signed-in page (development seed key), `seed`, `run`, `personalData` and `observe`; `pinClock`  |
| `src/requests.ts`         | `flowRequest(page, method, routeTemplate)`: the page's next request to a route, with its trace id             |
| `src/telemetry/`          | Tempo, Loki and Prometheus queries, the trace assertion, the personal-data scanner, and `Observer.expectFlow` |
| `src/binding/`            | The flow binding check (Vitest, in `just frontend test`)                                                      |
| `pending-flows.json`      | User-facing flows without a test yet, each with its issue                                                     |

## Add a flow test

1. Write `tests/<flow-id>.spec.ts` with `test` and `expect` from `../src/fixtures.ts`, and `tag: '@flow:<flow-id>'`.
2. Pin the zone with `test.use({ timezoneId })` and the clock with `pinClock(page, instant)` before navigating (ADR-0021).
3. Pick a day no other flow test uses. Every test acts as the same user (the seed scheme), so a test owns its day and finds its own data by the run id.
4. Seed through `seed.event` and `seed.task`, with texts from `run.label(...)`. Each seeded title, location and notes is registered with the scanner. Register the flow's query values and the texts the test types into the UI too (`personalData.add`). A change "elsewhere" (the same user in another tab, for a version conflict) goes through `seed.updateEvent`, which registers its texts as well.
5. Read `observe.before(routes)`. For each user action, call `flowRequest(page, 'PUT', '/api/events/{id}')` before acting and await it after: it gives the request and its `traceId`.
6. Assert the UI, then `await observe.expectFlow({ traceId, chain, spans, routes, before })`:
   - `chain` lists spans each nested under the one before, from the browser action down to a database span: `web('ui.event.create')`, `web('POST /api/events')`, `api('POST /api/events')`, `api('INSERT events')`. The web span names are posted on #732.
   - `traces` lists the flow's further user actions, one `{ traceId, chain, spans }` each: every action is a trace of its own (opening a dialog, then saving it). Each gets the trace and logs assertions, and the scan covers its spans. `expectFlow` returns the spans of each trace, for a check such as a 409 on the API's server span.
   - `routes` are the route templates the flow hit, with `times` when it hits one more than once.
   - A full-page navigation to the API (the sign-in redirects) sends no `traceparent`, so the API starts its trace: take its id with `await observe.rootTrace('GET /api/auth/login')`, which finds exactly one trace with that root since the test began. `logs` on a trace names log messages that must carry its id.
7. Remove the flow from `pending-flows.json`, and set `metadata["e2e-test"]` on the flow in `docs/architecture/calendar.architecture.json` to the test's repository-relative path. `just frontend test` checks both.
