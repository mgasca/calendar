---
status: proposed
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# Diesel's query builder over diesel-async, with SQL migrations embedded in a migrator binary

## Context and Problem Statement

[ADR-0015](0015-ef-core-data-access.md) chose EF Core with code-first migrations, applied only by a deploy step that connects as `calendar_migrator`. The backend moves to Rust ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), where EF Core does not exist. Article [0007](../agent-thoughts/0007-rust-database-migrations-and-postgresql.md) compared SQLx, Diesel and SeaORM from their documentation. How does the Rust backend read and write PostgreSQL, how are schema changes written and applied, and how do databases that EF Core already migrated move to the new runner?

These three questions are answered together because the library fixes the migration format, and the migration format fixes the adoption step.

## Decision Drivers

* **D1 PostgreSQL behaviour parity**: generated range columns, GiST and partial indexes, range overlap, database-side time-zone conversion, `UNION ALL` task queries, keyset pagination, `xmin` optimistic concurrency and the read-only snapshot for agenda reads ([ADR-0014](0014-postgresql-database-engine.md), [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md)) all carry over.
* **D2 Compile-time checking**: schema and query mistakes fail the build, including queries composed at run time (optional filters, seek predicates). This was the deciding driver of [ADR-0015](0015-ef-core-data-access.md), because agents write most of the code.
* **D3 Security**: parameterized by default; DDL only as `calendar_migrator`, never at application start; a password never becomes part of a URL.
* **D4 Repeatable schema deployment**: the same versioned migrations in tests, development and production, for a fresh database and for one EF Core already migrated.
* **D5 Fit with the async stack and the image**: works on tokio without blocking the runtime and without native libraries in the build or the image.
* **D6 Maturity and maintenance**: stable releases and active maintenance of the exact parts used.
* **D7 Port cost and reviewability**: hours to port, and how easily a reviewer can compare the result with the C# it replaces.

## Considered Options

### Library

* Diesel 2.3 query builder
* SQLx
* SeaORM

### Connection model

* diesel-async over tokio-postgres with a deadpool pool
* Synchronous Diesel over libpq on a blocking thread pool

### Migration history

* Translate the six EF migrations one to one, with an adoption step for EF-migrated databases
* One baseline migration of the current schema, with an adoption step
* Keep the EF migration chain for history and write only new migrations for Diesel

## Decision Outcome

Chosen option: "Diesel 2.3 query builder", over "diesel-async over tokio-postgres with a deadpool pool", with "Translate the six EF migrations one to one, with an adoption step for EF-migrated databases". The maintainer chose all three on 2026-11-11.

**Library.** Diesel checks composed queries against `schema.rs` at compile time without a database at build time (D2), and has built-in PostgreSQL range, time-zone and set operations (D1). The star table is unweighted, and on it SQLx is at least Diesel's equal: SQLx leads on D1, D4 and D5, Diesel on D2 and D3. The choice rests on the weight of D2, which also decided [ADR-0015](0015-ef-core-data-access.md). **No comparison was implemented**: the ratings come from article 0007 and the libraries' documentation, and the article's estimates for the three overlap on purpose.

| Driver | **Diesel query builder (chosen)** | SQLx | SeaORM |
| --- | :---: | :---: | :---: |
| D1 PostgreSQL behaviour parity | ★★☆ | ★★★ | ★☆☆ |
| D2 Compile-time checking | ★★★ | ★★☆ | ★★☆ |
| D3 Security | ★★★ | ★★☆ | ★★★ |
| D4 Repeatable schema deployment | ★★☆ | ★★★ | ★★☆ |
| D5 Fit with the async stack and the image | ★★☆ | ★★★ | ★★★ |
| D6 Maturity and maintenance | ★★☆ | ★★☆ | ★★☆ |
| D7 Port cost and reviewability | ★★☆ | ★★☆ | ★★☆ |

**Connection model.** diesel-async keeps database calls on the tokio runtime and needs no libpq (D5).

| Driver | **diesel-async, tokio-postgres, deadpool (chosen)** | Synchronous Diesel over libpq |
| --- | :---: | :---: |
| D1 PostgreSQL behaviour parity | ★★★ | ★★★ |
| D4 Repeatable schema deployment | ★★☆ | ★★★ |
| D5 Fit with the async stack and the image | ★★★ | ★☆☆ |
| D6 Maturity and maintenance | ★★☆ | ★★★ |

**Migration history.** A one-to-one translation lets a reviewer compare each SQL file with one EF migration, and a fresh database replays the same six steps production went through (D4, D7).

| Driver | **One-to-one translation with adoption (chosen)** | One baseline with adoption | Keep the EF chain for history |
| --- | :---: | :---: | :---: |
| D3 Security | ★★★ | ★★★ | ★★☆ |
| D4 Repeatable schema deployment | ★★★ | ★★☆ | ★☆☆ |
| D7 Port cost and reviewability | ★★☆ | ★★☆ | ☆☆☆ |

### Conventions

* **Crate:** `calendar-infrastructure` holds `schema.rs`, the models, queries, repositories, connection configuration, the pool and `migrations/`. `calendar-domain` stays free of persistence.
* **Queries:** Diesel's typed builder. Where it lacks an expression, a typed custom SQL function or fragment is declared once in Infrastructure and bound with parameters; SQL is never built by string concatenation. Generated columns are never written.
* **Concurrency:** `xmin` stays the version token. An update or delete carries the version predicate and treats zero affected rows as a conflict or a missing row, explicitly, because Diesel has no change tracker.
* **Agenda reads:** one read-only transaction with the isolation level [ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) requires.
* **Connections:** `ConnectionStrings__Calendar` and `CALENDAR_MIGRATOR_CONNECTION` keep their Npgsql keyword form (`Host=…;Port=…;Database=…;Username=…;Password=…;SSL Mode=VerifyFull`). Rust parses the keywords into a tokio-postgres configuration; no URL is ever assembled from a password. TLS uses rustls.
* **Migrations:** plain SQL (`up.sql`, `down.sql`) under `backend/crates/calendar-infrastructure/migrations/`, embedded at compile time with `diesel_migrations` in the `calendar-migrate` binary. That binary connects as `calendar_migrator` through diesel-async's `AsyncConnectionWrapper`, and is the only thing that applies migrations: in tests, in `just db migrate` and in the deploy step. The application never does. The Diesel CLI is not used anywhere, so there is no extra tool to pin.
* **The chain:** six migrations that translate the six EF migrations (`InitialCreate` to `PerUserOwnership`) one to one, then a seventh that adds `session_keys` and drops `DataProtectionKeys` ([ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md)).
* **Adoption of an EF-migrated database:** when `__EFMigrationsHistory` exists, the migrator checks that its last row is `20261102232144_PerUserOwnership`, records the six translated migrations as applied **without running them**, then runs the newer ones. If the history is at any other point, it stops without changing anything. A database with no EF history gets all migrations from the first.
* **Roles and grants:** unchanged. `calendar_app` keeps data rights only; `calendar_migrator` owns the schema.

### Effect on earlier records, once this record is accepted

None of these edits is made while this record is `proposed`.

* **[ADR-0015](0015-ef-core-data-access.md)** becomes `superseded by` this record. Its rules that migrations run only as `calendar_migrator` and never at application start, and that `xmin` is the concurrency token, are restated above. Its architecture-model entry needs no `note` if every node that cites it is moved to this record in the code pull request.
* **[ADR-0018](0018-time-representation-and-bcl-date-time-types.md)** is handled by [ADR-0057](0057-chrono-time-types-for-the-rust-backend.md).
* **[ADR-0016](0016-local-database-provisioning.md)** stands (Compose for development, Testcontainers for tests); the test-library detail is in [ADR-0054](0054-rust-backend-testing-stack.md).

### Consequences

* Good, because every schema change is a reviewed SQL file that is exactly what PostgreSQL executes.
* Good, because the build and the image need neither libpq nor a migration CLI.
* Good, because production, staging and local databases keep their data: the adoption step changes only the migration bookkeeping.
* Bad, because nothing generates a migration from a model change, and nothing replaces `dotnet ef migrations has-pending-model-changes`. `schema.rs` is written by hand and can disagree with the migrations; the disagreement is found by the database tests, not by the compiler.
* Bad, because the six translated migrations are a second implementation of the schema. A translation mistake would make a fresh database differ from an adopted one. This must be tested by comparing the two schemas (see Confirmation).
* Bad, because the adoption step runs once per environment, on production data, in code that no later deployment exercises.
* Bad, because diesel-async is a 0.x crate, and running `diesel_migrations` through a wrapper is less direct than Diesel's synchronous harness.
* Bad, because complex typed queries produce long Rust types and compiler errors, which article 0007 names as the thing to evaluate early and which was not evaluated.
* Neutral, because the database slice alone is estimated at 70 to 130 person-hours for Diesel in article 0007, against 60 to 110 for SQLx and 60 to 120 for SeaORM: differences too small to count for or against any of them.

### Confirmation

* Database tests ([ADR-0054](0054-rust-backend-testing-stack.md)) run against PostgreSQL that `calendar-migrate`'s embedded migrations created, so a `schema.rs` that disagrees with the migrations fails them.
* A test builds one database with the EF migrations (from the committed EF SQL or a schema dump taken before the C# sources are deleted) and adopts it, builds another from the Diesel chain alone, and compares the two schemas, including indexes, generated columns, constraints and grants.
* A test runs the migrator against an EF history that stops before `PerUserOwnership` and expects a refusal with no change.
* Tests cover a version conflict on update and delete, the read-only agenda transaction, and that `calendar_app` cannot run DDL.
* Code review rejects SQL built by string concatenation and any call that applies migrations outside `calendar-migrate`.

## Pros and Cons of the Options

### Diesel 2.3 query builder

* Good, because **D2 Compile-time checking**: queries, including ones assembled from optional parts, are checked against `schema.rs` by the compiler, with no database at build time.
* Good, because **D1 PostgreSQL behaviour parity**: built-in range operators (`overlaps_with`, `contains`), `at_time_zone`, `union_all` and transaction configuration, as article 0007 lists.
* Good, because **D3 Security**: the builder binds every value; raw SQL is an explicit, visible escape.
* Neutral, because **D6 Maturity and maintenance**: Diesel's core has a long stable history; the async crate is separate and 0.x.
* Neutral, because **D7 Port cost and reviewability**: typed expressions read close to the LINQ they replace, but the largest queries become hard-to-read types. Article 0007's estimate is 70 to 130 person-hours for the database slice.
* Bad, because **D1 PostgreSQL behaviour parity**: `xmin` and some expressions need custom SQL fragments, which the builder cannot check.
* Bad, because **D4 Repeatable schema deployment**: migrations are tracked by version only, with no checksum of an applied file, and `schema.rs` is maintained apart from them.
* Bad, because **D5 Fit with the async stack and the image**: Diesel itself is synchronous; async needs the separate diesel-async crate.

### SQLx

* Good, because **D1 PostgreSQL behaviour parity**: the query is the PostgreSQL statement, so every feature is available as written.
* Good, because **D4 Repeatable schema deployment**: embedded SQL migrations with integrity checks of applied files.
* Good, because **D5 Fit with the async stack and the image**: async from the start, pure Rust.
* Neutral, because **D2 Compile-time checking**: the checked macros validate static SQL against a live database or prepared metadata that CI must keep current; queries composed at run time are not checked.
* Neutral, because **D3 Security**: bind parameters are the norm, but SQL is text, and string-built SQL is an easy agent mistake ([ADR-0015](0015-ef-core-data-access.md) said the same of Dapper).
* Neutral, because **D6 Maturity and maintenance**: widely used; its release state was not re-checked for this record.
* Neutral, because **D7 Port cost and reviewability**: 60 to 110 person-hours in article 0007; result mapping is written by hand.

### SeaORM

* Good, because **D5 Fit with the async stack and the image**: async, pure Rust.
* Good, because **D3 Security**: entity operations are parameterized.
* Neutral, because **D2 Compile-time checking**: entities are typed, but less of a composed query is checked than with Diesel's builder.
* Neutral, because **D4 Repeatable schema deployment**: migrations are Rust modules in a separate crate; versioned, but another layer between the review and the SQL.
* Neutral, because **D6 Maturity and maintenance**: actively developed; not re-checked for this record.
* Neutral, because **D7 Port cost and reviewability**: 60 to 120 person-hours in article 0007.
* Bad, because **D1 PostgreSQL behaviour parity**: the highest abstraction of the three; ranges, generated columns, `xmin` and the `UNION ALL` queries would lean on its raw-SQL escape more than the other two. Article 0007 names this as its early experiment; it was not run.

### diesel-async over tokio-postgres with a deadpool pool

* Good, because **D5 Fit with the async stack and the image**: queries are futures on the tokio runtime; tokio-postgres is pure Rust, so the build and the image need no libpq.
* Good, because **D1 PostgreSQL behaviour parity**: the same query builder and PostgreSQL types as synchronous Diesel.
* Neutral, because **D6 Maturity and maintenance**: maintained in the Diesel organisation, but 0.x (0.9.2).
* Bad, because **D4 Repeatable schema deployment**: `diesel_migrations` expects a synchronous connection, so the migrator goes through `AsyncConnectionWrapper`.

### Synchronous Diesel over libpq on a blocking thread pool

* Good, because **D4 Repeatable schema deployment**: the migration harness runs on its native connection type.
* Good, because **D6 Maturity and maintenance**: the oldest and most used configuration of Diesel.
* Good, because **D1 PostgreSQL behaviour parity**: the same builder.
* Bad, because **D5 Fit with the async stack and the image**: every query must be moved off the async runtime to a blocking pool, and libpq is needed at build time and in the runtime image.

### Translate the six EF migrations one to one, with an adoption step for EF-migrated databases

* Good, because **D4 Repeatable schema deployment**: a fresh database replays the same six steps the existing ones took, then the same new ones.
* Good, because **D7 Port cost and reviewability**: each SQL file is reviewed against one EF migration.
* Good, because **D3 Security**: one runner, one role, no .NET tool left in the deploy step.
* Bad, because **D7 Port cost and reviewability**: six translations and an adoption step to write and test.
* Bad, because **D4 Repeatable schema deployment**: correctness of the translation is assumed until the schema comparison proves it.

### One baseline migration of the current schema, with an adoption step

* Good, because **D3 Security**: one runner and one role.
* Good, because **D7 Port cost and reviewability**: one file to write, which can come from a schema dump.
* Neutral, because **D4 Repeatable schema deployment**: a fresh database is built in one step that no existing database ever ran; the adoption step is still needed.
* Bad, because **D7 Port cost and reviewability**: the reviewer compares one large file with the sum of six migrations, and the step-by-step history leaves the repository with the C# sources.

### Keep the EF migration chain for history and write only new migrations for Diesel

* Good, because **D4 Repeatable schema deployment**: nothing is translated, so nothing can be mistranslated.
* Bad, because **D4 Repeatable schema deployment**: a fresh database needs two runners in order, in every test run, local setup and environment.
* Bad, because **D7 Port cost and reviewability**: the EF project, the .NET SDK and `dotnet-ef` stay in the backend forever, which contradicts replacing it ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)).
* Bad, because **D3 Security**: two tools hold the migrator credentials.

## More Information

* **Input:** article [0007](../agent-thoughts/0007-rust-database-migrations-and-postgresql.md), sections "Diesel", "Can Diesel keep our PostgreSQL behavior?" and "A rough budget in person-hours". Its author did not implement a Rust backend or run the commands it describes.
* **Versions** resolved in the code branch's `Cargo.lock` on 2026-11-11: diesel 2.3.14, diesel-async 0.9.2, diesel_migrations 2.3.2, tokio-postgres 0.7.18, deadpool 0.13.1, tokio-postgres-rustls 0.14.0, rustls 0.23.46. Read from the lock file, not re-checked against crates.io. SQLx and SeaORM versions were not checked.
* **Not verified:** query plans of the ported queries against the EF-generated ones; the adoption step against a copy of a real environment's database.
* **Revisit when** a query cannot be expressed without large unchecked SQL fragments (reconsider SQLx for that path), or when diesel-async reaches 1.0 or stops being maintained.
* **Open questions for the reviewer:**
  1. Article 0007 proposed a 12 to 24 hour trial slice per library before choosing. The choice was made without it. Is that accepted, or should the slice be run for SQLx before this record is accepted?
  2. After adoption, is `__EFMigrationsHistory` kept as a record or dropped by a later migration?
  3. Is a rehearsal of the adoption step on a restored copy of the production database required before the production cutover?
