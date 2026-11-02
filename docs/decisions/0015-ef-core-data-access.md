---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# EF Core 10 with code-first migrations for data access

## Context and Problem Statement

The backend uses PostgreSQL ([ADR-0014](0014-postgresql-database-engine.md)), with SQLite on a volume kept as a budget fallback for production. How should the .NET code read and write data, and how should schema changes be managed and deployed?

## Decision Drivers

* **D1 Productivity & AI-agent proficiency**: the standard, well-documented approach agents produce correctly, with little hand-written code.
* **D2 Type safety**: schema and query mistakes are caught at compile time, not at runtime.
* **D3 Security**: SQL injection prevented by default; migrations run with elevated rights only during deployment.
* **D4 Repeatable schema deployment**: versioned migrations applied the same way in tests, development and production.
* **D5 Provider portability**: switching to the SQLite fallback ([ADR-0014](0014-postgresql-database-engine.md)) is a contained change.
* **D6 PostgreSQL feature access**: ranges, `timestamptz`, `jsonb` and raw SQL when needed.

## Considered Options

* EF Core 10 (Npgsql provider) with code-first migrations
* Dapper with hand-written SQL, plus DbUp for migrations
* EF Core for writes, Dapper for complex reads

## Decision Outcome

Chosen option: "EF Core 10 (Npgsql provider) with code-first migrations". It is the most productive and type-safe option (D1, D2), is parameterized by default (D3), and its migrations make schema deployment repeatable (D4). It is also the only option where switching to the SQLite fallback means changing the provider rather than rewriting SQL (D5). Raw SQL remains available through `FromSql` / `SqlQuery<T>` for hot paths (D6).

| Driver | **EF Core + migrations (chosen)** | Dapper + DbUp | EF Core writes + Dapper reads |
| --- | :---: | :---: | :---: |
| D1 Productivity & AI-agent proficiency | ★★★ | ★★☆ | ★☆☆ |
| D2 Type safety | ★★★ | ★☆☆ | ★★☆ |
| D3 Security | ★★★ | ★★☆ | ★★☆ |
| D4 Repeatable schema deployment | ★★★ | ★★☆ | ★★★ |
| D5 Provider portability | ★★☆ | ☆☆☆ | ★☆☆ |
| D6 PostgreSQL feature access | ★★★ | ★★★ | ★★★ |

### Implementation plan

* **Project:** a new `Calendar.Infrastructure` project holds the `DbContext`, entity configurations (`IEntityTypeConfiguration<T>`) and migrations. `Calendar.Domain` stays free of persistence concerns ([ADR-0002](0002-dotnet-10-minimal-api-backend.md)).
* **Mapping conventions:**
  * snake_case table and column names (`EFCore.NamingConventions`).
  * `xmin` as the optimistic-concurrency token.
  * `NpgsqlRange<DateTimeOffset>` for event spans, configured only in Infrastructure ([ADR-0014](0014-postgresql-database-engine.md) fallback rule).
* **Migrations:**
  * Generated with `dotnet ef migrations add` (`dotnet-ef` is a local tool in `.config/dotnet-tools.json`) and committed.
  * CI fails if the model has unapplied changes (`dotnet ef migrations has-pending-model-changes`).
* **Deployment:**
  * Production applies migrations with an idempotent **migration bundle** (`dotnet ef migrations bundle`) as a separate deploy step, connecting as `calendar_migrator`. They are **never** applied at app startup.
  * Development and tests apply migrations explicitly (`just db-migrate`, test fixtures).
* **Query hygiene:**
  * Read paths use projections and `AsNoTracking`.
  * EF Core command logging is enabled in Development.
* **Packages:** `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.x, `Microsoft.EntityFrameworkCore.Design` (design-time only), `EFCore.NamingConventions`. All are versioned centrally ([ADR-0006](0006-dotnet-dependency-management.md)).

### Consequences

* Good, because the schema is defined once in C# and evolves through reviewed, versioned migrations.
* Good, because the app's runtime role never needs DDL rights. Only the deploy step uses `calendar_migrator`.
* Bad, because careless LINQ can cause N+1 queries or client evaluation. This is mitigated by query hygiene and Development logging.
* Neutral: if a hot read path ever needs it, Dapper can be added later for that path. That would be a new ADR.

### Confirmation

* CI runs the pending-model-changes check and integration tests against real PostgreSQL ([ADR-0016](0016-local-database-provisioning.md)).
* Code review checks that `DbContext` usage stays in Infrastructure or application services, not in endpoints.

## Pros and Cons of the Options

### EF Core 10 with code-first migrations

* Good, because **D1 Productivity & AI-agent proficiency**: the standard .NET data access approach; migrations are generated from the model.
* Good, because **D2 Type safety**: LINQ queries and mappings are compiler-checked.
* Good, because **D3 Security**: queries are parameterized by default, and migration bundles separate DDL rights from the app.
* Good, because **D4 Repeatable schema deployment**: the same migrations run in tests, development and production; bundles are idempotent.
* Good, because **D5 Provider portability**: switching to SQLite changes the provider and the migration set, not every query.
* Good, because **D6 PostgreSQL feature access**: the Npgsql provider maps ranges, `timestamptz` and `jsonb`, and `FromSql` / `SqlQuery<T>` allow raw SQL.
* Bad, because **D5 Provider portability**: provider-specific mappings (ranges, `xmin`) still need SQLite equivalents if the fallback is used.
* Bad, because **D1 Productivity & AI-agent proficiency**: LINQ can hide inefficient SQL; agents need the query-hygiene conventions.

### Dapper with hand-written SQL, plus DbUp

* Good, because **D6 PostgreSQL feature access**: full control of PostgreSQL SQL.
* Bad, because **D2 Type safety**: SQL strings aren't checked, so schema drift is found at runtime.
* Bad, because **D3 Security**: safety depends on always parameterizing; string-built SQL is an easy agent mistake.
* Bad, because **D5 Provider portability**: every query is written in the PostgreSQL dialect, so the SQLite fallback would mean rewriting them.
* Bad, because **D1 Productivity & AI-agent proficiency**: every query, mapping and DDL script is hand-written.
* Neutral, because **D4 Repeatable schema deployment**: DbUp scripts are versioned, but written by hand.

### EF Core for writes, Dapper for complex reads

* Good, because **D6 PostgreSQL feature access**: hand-tuned SQL for the heaviest reads.
* Good, because **D4 Repeatable schema deployment**: EF Core migrations still own the schema.
* Bad, because **D1 Productivity & AI-agent proficiency**: two data access styles to learn and keep consistent before any query needs it.
* Bad, because **D2 Type safety** and **D5 Provider portability**: the Dapper half has the same weaknesses as Dapper alone.

## More Information

* [ADR-0037](0037-postgresql-only-no-sqlite-fallback.md) drops the SQLite fallback, so driver D5 (provider portability) no longer applies. The decision above is unchanged.
