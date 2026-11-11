# Backend

The Rust API for Calendar: events, tasks, day and week agendas, and Google sign-in, backed by PostgreSQL. It is a Cargo workspace on axum, Diesel and tokio (ADR-0051 to ADR-0057, proposed). Practices for changing the code (tests, queries, indexes, lints) are in [AGENTS.md](AGENTS.md).

## Crates

```
Cargo.toml, Cargo.lock           Workspace, lint levels and the locked dependencies
rust-toolchain.toml              The pinned Rust toolchain (rustup installs it on first use)
crates/calendar-domain/          Domain model and time-zone rules; no I/O and no framework dependencies
crates/calendar-infrastructure/  Diesel schema, queries, repositories, connection settings, SQL migrations (PostgreSQL)
crates/calendar-migrate/         The binary that applies the migrations as calendar_migrator
crates/calendar-api/             axum API (library and the calendar-api binary), OpenAPI generator
crates/calendar-testing/         Testcontainers PostgreSQL support shared by the tests
```

The API generates [`contracts/openapi.json`](../contracts/openapi.json) (`just backend contract`). Run `just contracts` after an API change and commit the result.

## Common tasks

| Task | Command |
| --- | --- |
| Run the API (http://localhost:5041) | `just backend dev` |
| Build | `just backend build` |
| Tests (API tests need Docker) | `just backend test` |
| One crate, or tests whose name contains a word | `just backend test -p calendar-domain`, `just backend test -p calendar-api task` |
| Build, then test | `just backend run build test` |
| Clippy and the formatting check | `just backend lint` |
| Format | `just backend format` |
| psql shell on the local database | `just db psql` |
| Wipe the local database | `just db reset` (then `just db migrate`) |
| Seed a sample day into the running API (additive; accepts `--date …` and `--time-zone …`) | `just db seed` (set `Auth__DevSeedKey` in `.env` and export it before starting the API in Development) |

Start the database first with `just db up` and `just db migrate` (see [Local database](../README.md#local-database)).

## Local database

The database has two roles: `calendar_migrator` (owns the schema, runs migrations) and `calendar_app` (DML only; the API always connects as this role). Migrations are applied only by `just db migrate`, never at API startup.

The API reads its connection string from the environment variable `ConnectionStrings__Calendar`, in Npgsql keyword form:

```
Host=127.0.0.1;Port=5432;Database=calendar;Username=calendar_app;Password=dev-app-password
```

`just backend dev` builds exactly that from `POSTGRES_DB` and `CALENDAR_APP_PASSWORD` in your `.env` when the variable is not set, and runs the API in Development. Set `ConnectionStrings__Calendar` in `.env` to point it elsewhere. A keyword the API does not know stops it at startup and names the keyword. Integration tests need no setup beyond a running Docker daemon: they start their own throwaway PostgreSQL (the image pinned in `compose.yaml`) with `calendar-testing`.

`just db migrate` runs `calendar-migrate` with `CALENDAR_MIGRATOR_CONNECTION`, built from the same `.env`. On a database that EF Core migrated (before the backend moved to Rust), the first run checks that the EF history is complete, records those migrations as applied and runs only the newer ones.

## Google sign-in setup

Create a Google OAuth web application client and configure its authorized redirect URIs for each environment:

* Development: `http://localhost:5173/api/auth/callback/google`
* Production: `https://<host>/api/auth/callback/google`

Set `Auth__Google__ClientId`, `Auth__Google__ClientSecret` and indexed entries such as `Auth__AllowedEmails__0` in the untracked `.env` for local development, then export them into the API process (`just backend dev` loads `.env` for you; restart it after editing); use deployment secrets for production. Add only the verified Google emails permitted to access the calendar. Keep the client secret out of version control. Use HTTPS in production and configure trusted forwarded headers when behind a proxy so redirects and secure cookies use the public origin.

To use the web app without an OAuth client, see [signing in without Google](../frontend/README.md#sign-in-without-google). For what sign-in protects and its limits, see [Authentication and limitations](../README.md#authentication-and-limitations).

## Production environment configuration

Set `ConnectionStrings__Calendar` to the PostgreSQL connection string for the least-privilege
`calendar_app` role. Supply `Auth__Google__ClientId` and `Auth__Google__ClientSecret` from
deployment secrets, and configure allowed Google email addresses as indexed environment variables
`Auth__AllowedEmails__0`, `Auth__AllowedEmails__1`, and so on. Register the public HTTPS callback
`https://<host>/api/auth/callback/google` with Google. The API trusts one forwarded hop from the
Container Apps ingress; the container must only be reachable through that ingress.

The session cookie is sealed with one key, stored unencrypted in the `session_keys` table of the calendar
database so sessions survive restarts and revisions; the API creates it on first use. To end every session,
delete that row as `calendar_migrator` and then restart every replica: each running instance keeps the key it
loaded until it stops, so the delete alone revokes nothing. Apply migrations separately as `calendar_migrator` before starting a
new revision; the application never applies them. Restrict database access and backups accordingly.

Other settings the host reads: `ASPNETCORE_ENVIRONMENT` (`Development` or anything else; Production when unset),
`ASPNETCORE_URLS` (`http://host:port` entries; the image sets `http://+:8080`), `ASPNETCORE_WEBROOT` (the folder
of the web app's files, `wwwroot` beside the working directory by default) and `ASPNETCORE_HTTPS_PORT` (enables
the HTTP to HTTPS redirect outside Development). TLS to PostgreSQL (`SSL Mode=VerifyFull`) and to Google is
verified against the system certificate store, which the image ships.

The Azure secrets that supply these settings are listed in the [Azure infrastructure runbook](../docs/runbooks/azure-infrastructure.md).

## Known differences from the .NET backend

The port keeps the HTTP contract and the behaviour of the .NET API it replaced. These differences were measured
against the running .NET API during the port and are accepted:

- **Time-zone rules are compiled in.** The .NET API read the host's tz database; this one embeds `chrono-tz`
  (tzdata 2025b at the time of the port, against 2026e on the host). Zones whose rules changed in between give day
  windows one hour off: `America/Vancouver`, `America/Edmonton`, `America/Winnipeg`, `America/Inuvik`,
  `America/Yellowknife` and `America/Rainy_River` from 2026-11-02, `Africa/Casablanca` and `Africa/El_Aaiun` from
  2026-09-21. `chrono-tz` also stops applying recurring daylight-saving rules from the year 2100. PostgreSQL's
  `AT TIME ZONE` uses the database image's own tz data, so the two can disagree for those zones. A `chrono-tz`
  release with newer data fixes the first group; keeping it current is a dependency update that changes behaviour.
- **Zone ids.** Wrong-case ids (`asia/kolkata`) and Windows-style ids (`UTC-11`) are always rejected; .NET accepted
  some of them depending on process state and ICU. Legacy slashless ids (`EST`, `CET`) are kept as sent, where .NET
  on a host without legacy tz data echoed the canonical zone.
- **Sessions.** The cookie is named `calendar_session` and sealed with the `session_keys` key, so sessions issued
  by the .NET API ended at cutover.
- **Malformed JSON bodies** answer the same 400 validation problem, always under field `$` with a generic message;
  type and required-property errors match .NET.
- **Responses.** Characters outside the BMP are written as UTF-8 rather than `\uXXXX` escapes; static files carry
  `Last-Modified` but no `ETag`; error responses are always problem JSON, whatever the `Accept` header.

## Tooling

| Concern | Choice |
| --- | --- |
| Dependencies | Cargo workspace; `Cargo.lock` committed and every build `--locked` |
| Toolchain | `rust-toolchain.toml` (exact version, with rustfmt and clippy) |
| Static analysis | Clippy (`all` denied, `pedantic` on), warnings as errors, `unsafe` forbidden |
| Formatting | rustfmt (`rustfmt.toml`) |
| Web, data, contract | axum on tokio; Diesel over diesel-async (tokio-postgres, rustls); utoipa |
| Unit tests | `cargo test`, in each crate's `tests/` and `#[cfg(test)]` modules |
| Integration tests | The axum router in process against Testcontainers PostgreSQL (`calendar-testing`, one database per test) |
| Coverage | `cargo llvm-cov` in CI (Cobertura report, `backend-test-results` artifact) |
| Dependency updates | Dependabot (`cargo`, `rust-toolchain`, `docker`) |
