---
status: implemented
date: 2026-11-11
pr:
  - https://github.com/mgasca/calendar/pull/674
  - https://github.com/mgasca/calendar/pull/675
  - https://github.com/mgasca/calendar/pull/676
  - https://github.com/mgasca/calendar/pull/677
  - https://github.com/mgasca/calendar/pull/678
adrs: ["0051", "0052", "0053", "0054", "0055", "0056", "0057"]
---

# 0058 Move the backend from .NET to Rust to learn the stack and its performance characteristics

## Story

> As a calendar owner, I need the backend to run on Rust (axum and Diesel) behind the same HTTP contract, so that I can learn a stack that is new to this repository on a real codebase and see how its performance characteristics differ from the .NET backend it replaces.

The story did not start as an issue: the maintainer asked for the port directly, after [article 0007](../agent-thoughts/0007-rust-database-migrations-and-postgresql.md) compared the Rust options for database migrations. The wording above is derived from that request and from the maintainer's later statement that the change is about performance characteristics and about learning in a new space; to be confirmed by the product owner.

## Background

Until this story the API was a .NET 10 minimal API on EF Core ([0002](../decisions/0002-dotnet-10-minimal-api-backend.md), [0015](../decisions/0015-ef-core-data-access.md)). It served events, tasks, day and week agendas and Google sign-in, and every earlier story's backend work was written and tested there.

The story has two purposes, and neither is a product feature:

* **Learning in a new space.** Rust, axum, Diesel and their tooling were new to this repository. Porting a working backend with a fixed contract and a large test suite gives every difference a concrete example: where the query builder stops, what the borrow checker and Clippy reject, how tests reach PostgreSQL, what a migration tool does and does not generate.
* **Performance characteristics.** A Rust service has no runtime to start, no JIT and no garbage collector, and ships as one static-ish binary in a distroless image. The story puts the backend in a position where start-up time, memory, image size and request latency can be compared with the .NET backend. It does not claim the result: see "Lessons learned" for what was and was not measured.

The web app, the HTTP contract, the database and the Azure infrastructure are deliberately unchanged, so the difference a user or an operator sees comes from the backend alone.

### Agreed scope

* **Replace in place:** the Rust workspace lives in `backend/` and the C# backend (`backend/src`, `backend/tests`, the solution and its build properties) is deleted in the same change. There is no period with two backends.
* **Same contract:** `contracts/openapi.json` and the generated TypeScript client are byte-identical before and after; the web app does not change.
* **Same behaviour:** status codes, validation messages, problem bodies, ordering, paging cursors, optimistic concurrency and the day and week rules match the .NET API. Measured differences are listed in `backend/README.md` ("Known differences from the .NET backend") and accepted there.
* **Same database:** PostgreSQL, the two roles (`calendar_migrator`, `calendar_app`) and the schema stay. The six EF Core migrations are translated one to one into SQL; a database EF Core migrated is adopted (its history is checked and recorded as applied), not rebuilt.
* **Same settings:** the host reads the names the .NET host read (`ConnectionStrings__Calendar` in Npgsql keyword form, `CALENDAR_MIGRATOR_CONNECTION`, `Auth__*`, `ASPNETCORE_ENVIRONMENT`, `ASPNETCORE_URLS`), so the infrastructure and Key Vault secrets are untouched.
* **Same commands:** `just backend dev`, `test`, `lint`, `format`, `just db migrate`, `just contracts` and `just check` keep their names and meaning.
* **Stack:** axum on tokio; Diesel's typed query builder over diesel-async (tokio-postgres, rustls; no libpq and no Diesel CLI); migrations embedded in a `calendar-migrate` binary; utoipa for the contract; chrono and chrono-tz for time.
* **Sessions:** the session cookie is sealed with a key held in a new `session_keys` table, replacing ASP.NET Data Protection and its `data_protection_keys` table (a seventh migration).
* **Delivery checks:** CI builds, lints (Clippy with warnings denied, rustfmt), tests with coverage (`cargo llvm-cov`, Cobertura artifact), checks the contract and builds the container image; CodeQL analyses Rust; Dependabot watches `cargo` and the toolchain pin.
* **Decisions recorded:** one ADR per decision ([0051](../decisions/0051-rust-backend-on-axum-and-tokio.md) to [0057](../decisions/0057-chrono-time-types-for-the-rust-backend.md)), in their own pull request, with the port stacked on it.

### Not in this story

* **Repo tooling:** the tools under `tools/` and `.claude/skills/` stay .NET file-based apps ([0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md)). The .NET SDK pin remains for them.
* **New features or API changes:** nothing is added to or removed from the contract.
* **Performance work:** no query, index or algorithm was changed to be faster; the port keeps the query shapes of the performance review (story [0015](0015-backend-performance-review-closeout.md) and its issues).
* **A measured comparison with .NET:** owed, and listed under follow-ups. This story makes it possible; it does not contain it.
* **Frontend, infrastructure templates and the database engine:** unchanged.
* **Keeping .NET sessions alive:** sessions issued by the .NET API end at cutover; users sign in again.

### Acceptance criteria

1. **Given** the Rust API, **when** the contract is generated, **then** it equals the committed `contracts/openapi.json`, which is the document the .NET API published. Test `the_committed_contract_is_the_generated_document` in [openapi.rs](../../backend/crates/calendar-api/src/openapi.rs), and the "OpenAPI contract is up to date" step in [ci.yml](../../.github/workflows/ci.yml).
2. **Given** a fresh database, **when** the translated migrations run, **then** the schema is the one EF Core produced. [migrations.rs](../../backend/crates/calendar-infrastructure/tests/database/migrations.rs) (`the_translated_migrations_produce_the_schema_ef_core_produced`, against a `pg_dump` fixture taken from the EF-migrated schema).
3. **Given** a database that EF Core migrated and that holds rows, **when** `calendar-migrate` runs, **then** the EF migrations are recorded as applied, only the newer ones run and the rows are kept. Same file (`an_ef_migrated_database_is_adopted_and_keeps_its_rows`).
4. **Given** the `calendar_app` role, **when** it runs `calendar-migrate`, **then** the run fails and says why; **given** `calendar_migrator`, it applies the chain and a second run finds nothing pending. [binary.rs](../../backend/crates/calendar-migrate/tests/binary.rs) (`the_app_role_cannot_migrate_and_the_failure_is_reported`, `applies_the_chain_prints_it_and_then_finds_nothing_pending`).
5. **Given** the API on real PostgreSQL as `calendar_app`, **when** I create, read, list and complete a task and create an event, **then** the responses, the agenda and the conflict on a stale version behave as before. [smoke.rs](../../backend/crates/calendar-api/tests/smoke.rs), with the endpoint suites beside it ([tasks.rs](../../backend/crates/calendar-api/tests/tasks.rs), [events.rs](../../backend/crates/calendar-api/tests/events.rs), [agenda_endpoints.rs](../../backend/crates/calendar-api/tests/agenda_endpoints.rs), [week_agenda_endpoints.rs](../../backend/crates/calendar-api/tests/week_agenda_endpoints.rs)), which are the .NET API tests ported case by case.
6. **Given** two users, **when** each reads and writes, **then** each sees only their own rows. [ownership.rs](../../backend/crates/calendar-api/tests/ownership.rs) and [ownership.rs](../../backend/crates/calendar-infrastructure/tests/database/ownership.rs) in the infrastructure tests.
7. **Given** the SQL forms of the day rules and the domain rule, **when** both judge the same rows, **then** they agree. [agenda_agreement.rs](../../backend/crates/calendar-api/tests/agenda_agreement.rs) and [week_agenda_agreement.rs](../../backend/crates/calendar-api/tests/week_agenda_agreement.rs).
8. **Given** a session cookie sealed by one instance, **when** another instance on the same database receives it, **then** the user is signed in; a tampered or expired cookie, or one sealed with another database's key, is rejected. [session_keys.rs](../../backend/crates/calendar-api/tests/session_keys.rs).
9. **Given** the Google sign-in flow, **when** an allow-listed verified email completes it, **then** a session starts, and any other outcome is refused. [google_sign_in.rs](../../backend/crates/calendar-api/tests/google_sign_in.rs) and [sign_in.rs](../../backend/crates/calendar-api/tests/sign_in.rs), against a fake provider. Not exercised against Google itself.
10. **Given** the container image, **when** CI builds it, **then** the build succeeds from the pinned Rust toolchain (the "Container image" job). The image running against Azure PostgreSQL over TLS was not exercised; TLS to a local PostgreSQL is covered by [tls.rs](../../backend/crates/calendar-infrastructure/tests/database/tls.rs).
11. **Given** the change is complete, **when** I run `just check`, **then** it passes, with the regenerated contract showing no diff.

No criterion covers performance: the story has no agreed number to meet, and none was measured (see below).

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0051](../decisions/0051-rust-backend-on-axum-and-tokio.md) | Rust backend on axum and tokio, replacing the .NET API in place | The story itself; supersedes [0002](../decisions/0002-dotnet-10-minimal-api-backend.md). |
| [0052](../decisions/0052-diesel-data-access-with-embedded-sql-migrations.md) | Diesel's query builder over diesel-async, SQL migrations embedded in a migrator binary, adoption of EF-migrated databases | Data access and `just db migrate`; supersedes [0015](../decisions/0015-ef-core-data-access.md). |
| [0053](../decisions/0053-cargo-workspace-dependency-management.md) | Cargo workspace, committed lock file, locked builds, pinned toolchain | Reproducible builds; supersedes [0006](../decisions/0006-dotnet-dependency-management.md) for the backend. |
| [0054](../decisions/0054-rust-backend-testing-stack.md) | `cargo test`, Testcontainers PostgreSQL, the router in process on an injected clock | How the ported suites run; supersedes [0007](../decisions/0007-backend-testing-stack.md) for the backend. |
| [0055](../decisions/0055-rust-static-analysis-and-formatting.md) | rustfmt and Clippy with warnings denied | The lint gate. |
| [0056](../decisions/0056-session-cookie-sealed-with-a-database-held-key.md) | Session cookie sealed with a key held in the database | Replaces ASP.NET Data Protection; ends .NET sessions at cutover. |
| [0057](../decisions/0057-chrono-time-types-for-the-rust-backend.md) | chrono and chrono-tz for instants, dates and IANA zones | Source of the accepted time-zone differences; supersedes [0018](../decisions/0018-time-representation-and-bcl-date-time-types.md). |

The seven records were merged as `proposed` in the first pull request; their acceptance and the supersession of the .NET records are the fourth. Decisions that stand unchanged and that the port had to keep: [0014](../decisions/0014-postgresql-database-engine.md) (PostgreSQL), [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) (agenda as one snapshot), [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) (the client supplies the day), [0027](../decisions/0027-google-oidc-bff-session.md) (Google sign-in with a cookie session) and [0041](../decisions/0041-per-user-data-ownership.md) (ownership as a parameter).

### Other decisions (not ADR-worthy)

* **Setting names kept:** the Rust host reads `ASPNETCORE_*` and `ConnectionStrings__Calendar` although nothing in it is ASP.NET, because renaming them would change the infrastructure and Key Vault in the same step as the backend.
* **Hand-written request reader:** request bodies are parsed by a reader in `json.rs`, not by serde derives, because the web app already handles the .NET validation messages and paths and serde's differ.
* **Contract post-processing:** the utoipa document is reshaped in `openapi.rs` into the shape the .NET generator published, so the TypeScript client does not change.
* **Hand-written `schema.rs`:** there is no Diesel CLI in the repository; tests compare the schema with the migrations instead.
* **Random test secrets:** test database passwords and nonces are generated per run, after CodeQL flagged fixed ones.
* **Infra tool keeps secrets off disk:** found by CodeQL on the same branch; the tool now passes the secret on standard input and deploys with a Key Vault reference.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Workspace, lint levels, toolchain pin | `backend/Cargo.toml`, `backend/Cargo.lock`, `backend/rust-toolchain.toml`, `backend/clippy.toml`, `backend/rustfmt.toml` |
| Domain rules (no I/O, no clock) | `backend/crates/calendar-domain` |
| Schema, queries, repositories, migrations, connection settings | `backend/crates/calendar-infrastructure` |
| Migrator binary | `backend/crates/calendar-migrate` |
| API, contract generator, sessions, sign-in | `backend/crates/calendar-api` |
| Test database support | `backend/crates/calendar-testing` |
| Recipes | `backend/mod.just`, `db.just` |
| CI, image | `.github/workflows/ci.yml`, `Dockerfile` |
| Practices and known differences | `backend/AGENTS.md`, `backend/README.md` |

### API

No changes. `contracts/openapi.json` and the TypeScript client are byte-identical.

### Persistence

Seven migrations: the six EF Core migrations translated one to one, and `session_keys` (one row, a 32-byte key; drops `data_protection_keys`; revokes the app role's writes on the migration history). On a database EF Core migrated, the first `just db migrate` checks that the EF history is complete and records those six as applied.

### Testing

* 475 tests: domain tests (pure), infrastructure tests and API tests on Testcontainers PostgreSQL, one database per test.
* The API and domain suites are the .NET suites ported case by case, so the earlier stories' criteria are still asserted; links in earlier cards to C# test files point at files that no longer exist.
* During the port the Rust API was compared with the running .NET API on the same requests; that comparison produced the "Known differences" list. The harness was not committed.
* The ported tests were not each proven with a negative control (run against a deliberately broken implementation).

### Delivery

| PR | Content |
| --- | --- |
| [674](https://github.com/mgasca/calendar/pull/674) | ADR-0051 to ADR-0057 as proposed; the two pull requests below were stacked on it and reached `main` with it |
| [675](https://github.com/mgasca/calendar/pull/675) | The port: Rust workspace added, C# backend removed, recipes, CI, image, docs |
| [676](https://github.com/mgasca/calendar/pull/676) | CodeQL alerts: random test secrets, infra tool keeps secrets off disk |
| [677](https://github.com/mgasca/calendar/pull/677) | The seven ADRs accepted; the .NET backend records superseded and the guidance re-pointed |

The porting steps were run as an agent workflow, crate by crate, from the domain outwards.

### Lessons learned, known issues and follow-ups

**Performance characteristics**

* **Nothing was measured.** There is no benchmark of start-up time, memory, image size, request latency, build time or test time for the Rust backend against the .NET one. Any statement that it is faster or lighter is inferred from the absence of a runtime, JIT and garbage collector, not observed here.
* **What is expected to differ, and should be measured:** cold start and memory at rest (relevant to scale-to-zero on Container Apps), image size, latency under load, and in the other direction compile time: a clean release build and the instrumented coverage build are slower than the .NET build was, which moves the CI Backend job.
* **Follow-up owed:** a repeatable comparison recorded in `docs/benchmarks/` ([conventions](../benchmarks/README.md)), taken against the last .NET revision, and a re-baseline of `.github/ci-baseline.json` for the changed Backend job. Until then the first purpose of this story is only half met.

**Learning**

* **Diesel checks types, not meaning.** A query that compiles can still be the wrong query; every query shape needs a test that runs it, and the agreement tests carry more weight than they did under EF Core.
* **Diesel's limits met here:** no filter, count or paging over a `UNION` subquery; no cast from timestamp to date; no SQLSTATE on errors (a deadlock is recognised by its English message); generated columns and `xmin` are writable as far as the compiler knows. Each has a note in `backend/AGENTS.md`.
* **No migration generation.** EF Core derived migrations from the model and CI checked for a missing one. Here a migration is SQL written by hand, `schema.rs` is written by hand to match, and tests hold the two together.
* **Compiled-in time-zone data is a behaviour dependency.** chrono-tz embeds tzdata (2025b at the port) where .NET read the host's (2026e). Eight zones give day windows an hour off after rule changes in 2026, and recurring daylight-saving rules stop at 2100. A chrono-tz update is a behaviour change, not housekeeping.
* **Parity is mostly in the edges.** The bulk of the effort went into what a framework does silently: request-body acceptance rules and messages, the shape of the generated contract, cookie and forwarded-header handling, static files.
* **A fixed contract and a ported test suite made the port tractable.** Each crate could be finished against tests that already described the behaviour.

**Known issues**

* Not verified: sign-in against Google itself, TLS to Azure PostgreSQL, and the changed infra tool against Azure (`just infra what-if staging` first).
* The first production `just db migrate` drops the Data Protection keys and every user signs in again.
* To end every session, delete the `session_keys` row and restart every replica; a running instance keeps the key it loaded.
* The accepted differences from the .NET API are listed in `backend/README.md`.
* Story [0056](0056-bump-dotnet-sdk-to-11.md) (.NET 11) now concerns the repo tools only and its card needs rewriting.

## User guide

Nothing changes in how the calendar is used: the day, week and task views look and behave as before.

### Signing in again

After the move, you are asked to **sign in with Google** once more, because sessions from before the move are no longer valid.

### Current limitations

* In a few time zones whose daylight-saving rules changed in 2026 (parts of western and central Canada, and Morocco), a day's boundaries can be an hour off until the time-zone data shipped with the calendar is updated.
