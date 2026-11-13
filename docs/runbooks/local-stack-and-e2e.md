---
order: 6
---

# Run the optional local services and the end-to-end stack

Use this runbook to look at telemetry locally, to sign in through a stand-in for Google without an OAuth client, or to start the throwaway stack the end-to-end flow tests run against. The decisions are [ADR-0063](../decisions/0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md) (Compose profiles and per-run projects), [ADR-0062](../decisions/0062-opentelemetry-over-otlp-with-grafana-lgtm-locally-and-application-insights-in-azure.md) (OpenTelemetry and Grafana LGTM) and [ADR-0064](../decisions/0064-stub-oidc-provider-for-sign-in-tests.md) (the stub sign-in provider); the story is [0064](../stories/0064-test-every-user-flow-end-to-end-and-prove-it-is-observable.md).

Terms used here:

- **Shared project**: the Compose project `calendar` that `just db` recipes use from every checkout, with the volume `calendar-pgdata` and port 5432.
- **Run**: one end-to-end stack started by `just e2e up`: its own Compose project `calendar-e2e-<time>-<random>`, its own volume and network, and an API and a web server process.
- **Slot**: the block of 55xxx ports a run uses. Slot *k* (2, 3, 5, 6, 7, 8 or 9) uses 55*k*00 plus the offsets in the table below; slots 0, 1 and 4 hold the `run-calendar` agent stack's ports and are never used.
- **LGTM**: the `grafana/otel-lgtm` container: an OpenTelemetry collector with Tempo (traces), Loki (logs), Prometheus (metrics) and Grafana.
- **Stub**: `navikt/mock-oauth2-server`, an OpenID Connect provider whose sign-in page lets you type the username and the claims of each sign-in.

## Before you start

- Run `just doctor`. It checks Docker, the Compose plugin (2.20 or newer: profiles and `up --wait --wait-timeout`) and `curl`, besides the toolchain.
- Run `just frontend install` in this checkout: `just e2e up` builds the web app.
- Allow about 4.5 GB of disk for the images: LGTM is about 3.8 GB, the stub about 0.5 GB. The first `just e2e up` pulls them.
- Nothing here needs `.env` or a Google client. `just e2e` sets its own throwaway passwords and seed key and ignores `.env`.

## Look at telemetry while developing

1. Run `just db observability`. It starts LGTM in the shared project and prints the settings for the API and the web app.
2. Start the API with the printed `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL`, and the web app with `CALENDAR_OTLP_URL`. Until the API's and the web app's telemetry land (#731, #732), nothing is exported yet.
3. Open Grafana on http://127.0.0.1:3000 (admin/admin; it listens on loopback only).
4. `just db down` stops PostgreSQL and the optional services and keeps the data. LGTM keeps no data between restarts.

Every host port is a variable with the default in `compose.yaml`: `CALENDAR_GRAFANA_PORT`, `CALENDAR_OTLP_GRPC_PORT`, `CALENDAR_OTLP_HTTP_PORT`, `CALENDAR_LOKI_PORT`, `CALENDAR_TEMPO_PORT`, `CALENDAR_PROMETHEUS_PORT`, `CALENDAR_OIDC_STUB_PORT` and `CALENDAR_POSTGRES_PORT`. Set one in `.env` if its port is taken.

## Sign in through the stub while developing

1. Run `just db sign-in-stub`. It starts the stub on http://127.0.0.1:8080/google and prints the API's settings.
2. Run the API as `Development` with those settings: a client id and secret of your choice and the four `Auth__Google__*` overrides. Add the email you will type to `Auth__AllowedEmails__0`.
3. Open the web app and sign in. On the stub's page, type any username and claims such as `{"email": "you@example.com", "email_verified": true}`. The username becomes the Google subject, so use the same one each time for the same email.

The API refuses to start when an override is set outside `Development`, or names a host other than `localhost`, `127.0.0.1` or `[::1]`.

## Run the end-to-end stack

1. Run `just e2e up`. It picks the first free slot, starts PostgreSQL, LGTM and the stub with `docker compose up --wait`, migrates the database, builds and starts the API as `Development`, builds the web app with telemetry on and serves it with `vite preview`, then waits for both. It prints the run's settings. Measured on a WSL2 laptop with the images present: about 35 to 50 s until the containers were healthy, 50 s in all with the builds cached, and 110 s with the first build.
2. Run `just e2e check`. It checks the API's health, a database read through the seed key, that the OTLP endpoint accepts an export, Grafana, and a full sign-in through the stub from the web app's origin (an allow-listed email returns to `/day/2026-11-13`, and an unknown or unverified one ends at `/signin?error=access_denied`).
3. Run `just e2e env` to print the run's settings as `KEY=VALUE` lines (URLs, ports, seed key, allow-listed email, stub issuer), for a test harness or by hand.
4. Run `just e2e down` to stop every run of this checkout, or `just e2e down <project>` for one. It stops the run's processes, removes its containers, network and volume, and deletes its folder.

`just e2e ls` lists this checkout's runs. Each run's state and logs are in `.plan/e2e/<project>/` (git-ignored): `stack.env`, and `logs/` with the Compose output, the migration, both builds, the API and the web server.

| Offset | Service |
| --- | --- |
| 17 | OTLP gRPC |
| 18 | OTLP HTTP (the API's `OTEL_EXPORTER_OTLP_ENDPOINT`, the web app's `CALENDAR_OTLP_URL`) |
| 20 | Tempo |
| 30 | Grafana |
| 31 | Loki |
| 32 | PostgreSQL |
| 41 | API |
| 73 | Web app (`vite preview`) |
| 80 | Stub OpenID Connect provider (issuer `/google`) |
| 90 | Prometheus |

For example, slot 2 serves the web app on http://127.0.0.1:55273 and the API on http://127.0.0.1:55241. Set `CALENDAR_E2E_SLOT` to use one slot only.

## Run the end-to-end flow tests

The flow tests are the Playwright Test package `frontend/apps/e2e` ([ADR-0061](../decisions/0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)). Each test drives one user-facing flow of the architecture model in Chromium. It then checks the flow's trace, logs and request metrics in LGTM, and that they carry none of the test's own data.

1. Run `just e2e test`. It starts a new run, downloads Chromium the first time, runs every flow test, and removes the run, whether the tests passed or failed. Arguments go to Playwright: `just e2e test --grep @flow:view-today-flow` runs one flow.
2. To iterate, keep a stack up and run the tests against it: `just e2e up`, then `just e2e test-on <project>` as often as you like (also with Playwright arguments), then `just e2e down <project>`. `test-on` starts and stops nothing.
3. On a failure, open the HTML report: `corepack pnpm --dir frontend/apps/e2e exec playwright show-report`. It holds the Playwright trace (actions, DOM snapshots, network) and the assertion that failed. The report and the traces are in `frontend/apps/e2e/playwright-report/` and `test-results/` (git-ignored).

A test takes about a minute. Most of it is waiting for the API's request metrics, which it pushes on its metric export interval.

If Chromium fails with `error while loading shared libraries` and you have no sudo, extract its libraries into `~/.cache/calendar-chromium-libs` as the `run-calendar` skill shows; the recipe adds that folder to `LD_LIBRARY_PATH`.

The flow binding needs no stack. `just frontend test` runs it on every pull request. It fails when a user-facing flow has no test tagged `@flow:<unique-id>` and is not on the pending list (`frontend/apps/e2e/pending-flows.json`), when a tag names a flow the model does not define, when a pending flow already has a test, or when a covered flow's model entry does not link its test file (`metadata["e2e-test"]`). To add a flow test, see `frontend/apps/e2e/README.md`.

## What a run never touches

- The shared project: a run uses its own project name, so its containers, network and volume are separate, and no port is 5432.
- Another checkout's runs, and other runs of this checkout: each run takes a slot no running service uses, and `just e2e down` refuses a project this checkout did not start, as well as any project not named `calendar-e2e-*`.
- Processes it did not start: `down` stops a recorded process group only while it is still this run's API (same listen URL) or this run's web server (same build folder).

## Troubleshooting

- **"No free end-to-end slot"**: every slot has a port in use. `just e2e ls` shows this checkout's runs; stop one with `just e2e down <project>`. A run from another checkout is stopped from that checkout.
- **`just e2e up` failed**: it prints the logs folder and removes the run. Read `compose.log`, `migrate.log`, `api-build.log`, `web-build.log`, `api.log` or `web.log` there. Run it again with the same slot to retry.
- **A sign-in ends at `/signin?error=access_denied`**: the API log says why. A different username for an email that already signed in is refused, because the API binds each email to one subject.
- **A pull fails with "unexpected commit digest"**: the download was corrupted, or the registry served a broken layer. Retry; if the same tag keeps failing, report it on the issue rather than switching tags silently.
