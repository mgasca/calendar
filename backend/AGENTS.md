# Backend practices

Practices for the Rust backend in `backend/` (a Cargo workspace): tests, queries, indexes and the traps you meet only when editing here. The root `AGENTS.md` still applies and nothing here overrides it. The query and index lessons were learned in the performance review (issues #50–#55, story 0015) on the .NET backend and hold unchanged, because they are about PostgreSQL; the Rust lessons come from the port (the Rust backend ADRs: proposed, separate PR).

## Crates

`crates/calendar-domain` (pure rules: no I/O, no clock, no serde, Diesel or axum) ← `crates/calendar-infrastructure` (Diesel `schema.rs`, repositories as free functions over `&mut AsyncPgConnection`, `queries/`, `migrations/`, connection parsing) ← `crates/calendar-api` (axum app as a library plus the `calendar-api` binary). `crates/calendar-migrate` is the binary that applies migrations; `crates/calendar-testing` is the Testcontainers PostgreSQL support the tests share.

## Running tests

- One crate or test: `just backend test -p calendar-domain`, `just backend test -p calendar-api task` (tests whose name contains `task`), `just backend test -p calendar-api --test tasks` (one file under `tests/`), and `-- --nocapture` after the other arguments to see output. The recipe runs `cargo test --locked` in `backend/` and passes its arguments through.
- Domain tests need nothing. Infrastructure and API tests need Docker: `calendar_testing::TestDatabase::migrated()` gives each test its own database, cloned from a migrated template on one PostgreSQL container per test binary (the image pinned in `compose.yaml`). Each file under `crates/calendar-api/tests/` is its own binary and container; `crates/calendar-infrastructure/tests/database/` is one binary, so add a module there instead of a new file beside it.
- API tests start from `mod common; use common::*;` and `TestApp::start().await`: the router is called in process, the clock is a fixed test clock (`app.clock.set`, `advance`), every request is `USER_A` unless `app.client_as(USER_B)`, and no setting comes from the process environment. The module doc in `tests/common/mod.rs` has the rest.
- To see the SQL a repository sends, attach the `SqlLog` instrumentation in `crates/calendar-infrastructure/tests/database/repositories.rs` to the connection; `diesel::debug_query` prints one query without running it.
- The agreement tests (`agenda_agreement`, `week_agenda_agreement`, in both crates) assert that the SQL query forms and `calendar_domain::agenda::day_inclusion` agree. Diesel checks a query's types at compile time, but not its meaning: cover every query shape with a test that runs it.
- **The current time is injected.** Handlers read `state.now()` (a `Clock` in the app state); the domain and the repositories take `now` as a parameter. Never call `Utc::now()` or `SystemTime::now()` outside `clock.rs`: `clippy.toml` lists them under `disallowed-methods`, so the lint fails the build (tests included; use a fixed instant).
- **Never use `calendar-testing` from a `#[cfg(test)]` unit test inside `calendar-infrastructure`**: the two crates depend on each other only through integration tests.

## Measure queries, don't guess

For any query or index change, seed about 100k realistic rows (history spread over years) in a throwaway Testcontainers test. Run `ANALYZE`, then `EXPLAIN (ANALYZE, BUFFERS)` on the SQL Diesel actually sends (`diesel::debug_query::<Pg, _>(&query)` or `SqlLog`, with the bind values inlined as literals). Put the before and after plans in the PR (time and buffers), and don't commit the harness. In #52 the obvious fix (new indexes) changed nothing on its own; only the plan showed it.

## Indexes

- **Partial indexes need an implied predicate**: Postgres uses `WHERE completed_at IS NULL` only if the query's condition implies it. A single `completed_at IS NULL OR completed_at in [S, E)` defeats it and falls back to a seq scan. Split the OR into disjoint branches combined with `UNION ALL` (so no duplicates), each matching its own index (`queries::agenda::overdue_open` and `overdue_completed_within`, combined in `agenda.rs`).
- **Diesel cannot filter, count or page over a `UNION` subquery.** Push the filter into both branches, count each branch and add the counts, and order the union by position (`PositionalOrderDsl`, which Diesel documents as outside its stable API: if an upgrade breaks it, run the two ordered branches and merge them in Rust).
- **Overlap lookups use ranges + GiST**: a B-tree on `(start, end)` can't narrow `start < X AND end > Y`, because the first condition matches every past row. Store a generated half-open range (`tstzrange` for timed events, `daterange` for all-day events, `NULL` otherwise) with a GiST index, and query with `&&` / `@>`: `events::span.overlaps_with(range)` works on the nullable column, `contains` needs `events::date_span.assume_not_null().contains(day)`.
- **Generated columns and `xmin` are read-only, and only PostgreSQL knows it.** Keep `span`, `date_span` and `xmin` out of every `Insertable` and `AsChangeset`; a write fails at runtime (SQLSTATE 428C9 or 0A000), not at compile time.

## Diesel pitfalls

- **Stay in the typed builder.** There is no raw SQL statement in the data layer. When Diesel lacks an expression, declare it once in `sql.rs` (`coalesce` over dates, `date(timestamp)`: Diesel's `cast` does not cover timestamp to date) rather than reaching for `sql_query`.
- **Local dates in SQL**: `tasks::due_at.at_time_zone(zone)` then `date_of(...)` gives the local date of an instant. Pass the canonical zone id from `IanaZone::id()`, never the request text.
- **Ownership is a parameter, not a filter you remember** (ADR-0041): every event and task query starts from `queries::owned_events(owner)` or `owned_tasks(owner)`, and every repository function takes an `OwnerId`. Do not query `events::table` or `tasks::table` directly outside `queries.rs`.
- **Optimistic concurrency is `xmin`** (`RowVersion`): `UPDATE ... WHERE id AND owner_id AND xmin = expected RETURNING xmin`; no row means `Conflict` when the owner still has the row and `NotFound` otherwise. An update that changes nothing writes nothing and returns the current version without checking the expected one, as EF Core did; the tests named "changes nothing" pin that.
- **Errors**: map `diesel::result::Error` through the crate's `Error` (`NotFound`, `Conflict`, `UniqueViolation`, ...). Diesel exposes no SQLSTATE: a deadlock is recognised by its English message, so keep the server's `lc_messages` in English.
- **Agenda reads are one snapshot** (ADR-0020): `agenda::read` runs every SELECT in one `REPEATABLE READ, READ ONLY` transaction. Add a query inside it, not beside it.
- **Instants are microseconds in PostgreSQL**. `Clock::now()` is already truncated; an instant from a request keeps what the client sent until the row is read back.

## Migrations (ADR-0015)

- A migration is a directory `crates/calendar-infrastructure/migrations/YYYY-MM-DD-HHMMSS_name/` with `up.sql` and `down.sql`, plain SQL, embedded in the binary. There is no Diesel CLI in this repo: write `schema.rs` by hand to match, then update the lists in `tests/database/migrations.rs` and `tests/database/schema_definition.rs`.
- Only `calendar-migrate` applies them (`just db migrate`, as `calendar_migrator`); the API never does, and `calendar_app` cannot. New tables need no grant: the default privileges give `calendar_app` DML, so `REVOKE` what it must not have.
- The first six migrations are the EF Core migrations translated one to one, and a database EF Core migrated is adopted, not re-run. Never edit them: `the_translated_migrations_produce_the_schema_ef_core_produced` compares the result with a `pg_dump` fixture that can no longer be regenerated.
- Migrations only move forward in production (expand, then contract); `down.sql` exists for the tests that revert and re-apply the chain.

## Keyset pagination (`queries::task_list`, `endpoints::task_list_cursor`)

- Do every comparison in SQL, so uuid and collation ordering stay consistent with the `ORDER BY`. Avoid case-insensitive title tie-breakers, which depend on collation.
- Expand the seek predicate by hand around nullable keys. Row-value comparisons with NULLs are wrong.
- Fetch `limit + 1` to decide whether there is a next page (`tasks::list_page`).
- Make the cursor opaque (base64url JSON) and tied to its view, and reject a malformed cursor with 400.
- Test paging at limits 1, 2 and 3 with ties at every key, asserting every item appears exactly once and in order.
- The page key's local date comes from the embedded `chrono-tz` data and the seek from PostgreSQL's `AT TIME ZONE`. Where the two tz databases differ, a dated list can skip or repeat a timed task at a page boundary, so keep `chrono-tz` current.

## "Today" comes from the client (ADR-0021)

Any endpoint that judges overdue or upcoming takes `today` + `timeZone`, validated with `FieldErrors::require_date` / `require_time_zone`, and listed in the `params(...)` of its `#[utoipa::path]` so the contract marks them required. Keep the 1900-01-01 to 2200-12-31 date check in front of `DayWindow::create`, which panics near chrono's date limits.

## The HTTP contract

- `contracts/openapi.json` is generated from the `#[utoipa::path]` attributes and the `contracts/` types, then post-processed in `openapi.rs` into the shape the .NET API published, so the TypeScript client does not change. After changing an endpoint or a contract type run `just contracts` and commit the result; `the_committed_contract_is_the_generated_document` and CI fail on a stale file.
- Request bodies are read by the hand-written reader in `json.rs` (`FromJson`), not by serde: it reproduces the acceptance rules and the validation messages the clients already handle (case-insensitive names, numbers as strings, JSON paths, required properties, instants with an explicit offset). A new request type implements `FromJson`; deriving `Deserialize` would change the 400 bodies.
- Error bodies are problem details built in `problem.rs` and `validation.rs`. A domain `ArgumentError` carries the field name the API reports (`timeZoneId` is reported as `timeZone`); add new messages in the domain, not in the handler.
- Configuration keeps the names the .NET host read (`ConnectionStrings__Calendar` in Npgsql keyword form, `Auth__*`, `ASPNETCORE_ENVIRONMENT`, `ASPNETCORE_URLS`), because the infrastructure and Key Vault supply them. A connection-string keyword the parser does not know is an error at startup, by design; never build a URL from a password.

## In-memory ordering and bucketing

- Comparers must short-circuit: chain `Ordering::then_with`, which evaluates the next key only on a tie. Building a tuple or a `Vec` of every key per comparison evaluates them all.
- Compute expensive keys (time-zone conversions) once per item with `sort_by_cached_key`, or precompute them, not inside the comparator.
- When replacing a comparer or a bucketing algorithm, add a randomized test against a copy of the old implementation (heavy ties, case-only title differences, DST dates, a skipped date such as `Pacific/Apia` 2011-12-30) to prove the output is identical (`tests/agenda_order.rs`, `tests/agenda_bucketing.rs`).
- **Range bucketing**: don't test every item against every day. Narrow the candidate days by binary search over the sorted `DayWindow` boundaries, but keep `day_inclusion` as the final arbiter, so the per-day rules keep one implementation (`endpoints::agenda_builder::bucket`).

## Time zones

- Zone ids go through `time::time_zones::try_find_iana`, which returns an `IanaZone`; store and echo `IanaZone::id()`. Ids are case-sensitive except `UTC`.
- The zone data is compiled in with `chrono-tz`, not read from the host. A stale `chrono-tz` gives wrong day windows for zones whose rules changed, and it stops applying recurring DST rules after 2100. Bumping it is a behaviour change: run the domain tests and say so in the PR.

## Lints that break the build (warnings are errors)

- `cargo clippy --workspace --all-targets -- -D warnings` is the gate (`just backend lint`), with `clippy::all` denied and `clippy::pedantic` on (`Cargo.toml`, `[workspace.lints]`). `unsafe` is forbidden.
- When a pedantic lint is wrong for one item, allow it there with a reason: `#[allow(clippy::too_many_lines, reason = "...")]`. Do not widen the workspace list for one case.
- `cargo fmt --all` formats (`rustfmt.toml`: 140 columns, two spaces). rustfmt does not wrap long string literals or comments; wrap those by hand.
- `Cargo.lock` is committed and every recipe and CI step passes `--locked`. Change dependencies with `cargo add` or `cargo update -p <crate>` and commit the lock file; never edit it by hand. A dependency used by one crate goes in that crate's manifest.
- The repo tools under `tools/` and `.claude/skills/` are still .NET file-based apps with their own analyzers; their traps are in `tools/README.md`.
