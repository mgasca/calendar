---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# PostgreSQL with EF Core as the backend data store

## Context and Problem Statement

The backend needs persistent storage for calendars, events and, later, users, attendees and recurrence rules. We want something lightweight and secure for initial development that can move to production with minimal overhead. The app is deployed as a single container ([ADR-0002](0002-dotnet-10-minimal-api-backend.md)), and code is mostly written by AI agents. Development is on Linux/WSL with Docker available.

This record covers three linked decisions:

1. Which **database engine** to use.
2. How the .NET code **accesses** it.
3. How the database is **provisioned for local development and tests**.

## Decision Drivers

* **D1 Dev/prod parity**: the same engine, SQL dialect, types and migrations from a laptop to production, so "works locally" means "works in prod".
* **D2 Path to production**: managed hosting options and the effort to go live (backups, HA, scaling) without a rewrite.
* **D3 Lightweight dev experience**: fast to start, little to install, little RAM, one command to get a working database.
* **D4 Security**: authentication, least-privilege roles, encryption in transit and at rest, and secrets kept out of the repo.
* **D5 Calendar data fit**: time zone–correct timestamps, efficient time-range and overlap queries, and relational integrity between calendars, events and attendees.
* **D6 Test fidelity**: integration tests exercise the real engine, including constraints, transactions and SQL translation.
* **D7 AI-agent proficiency & ecosystem**: mainstream, well-documented tooling that agents use correctly; mature .NET support.

## Considered Options

### Database engine

* PostgreSQL
* SQLite in development, PostgreSQL in production
* SQLite everywhere (with Litestream replication)
* SQL Server
* Document database (MongoDB / Azure Cosmos DB)

### Data access

* EF Core 10 (Npgsql provider) with code-first migrations
* Dapper with hand-written SQL and a migration tool (e.g. DbUp)
* EF Core for writes, Dapper for complex reads

### Local and test provisioning

* Docker Compose for development, Testcontainers for tests
* .NET Aspire AppHost for development, Testcontainers for tests
* PostgreSQL installed natively on the developer machine

## Decision Outcome

### Database engine

Chosen option: "PostgreSQL", because the same engine runs from the first line of code to production (D1, D2). Its range types and exclusion constraints suit calendar data (D5), and it has strong built-in security (D4). It costs a ~100 MB container compared with an embedded file (D3), which is acceptable with Docker already in use.

| Driver | **PostgreSQL (chosen)** | SQLite dev / PostgreSQL prod | SQLite everywhere | SQL Server | Document DB |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Dev/prod parity | ★★★ | ★☆☆ | ★★★ | ★★★ | ★★☆ |
| D2 Path to production | ★★★ | ★★★ | ★☆☆ | ★★☆ | ★★☆ |
| D3 Lightweight dev | ★★☆ | ★★★ | ★★★ | ★☆☆ | ★★☆ |
| D4 Security | ★★★ | ★★☆ | ★☆☆ | ★★★ | ★★☆ |
| D5 Calendar data fit | ★★★ | ★☆☆ | ★☆☆ | ★★☆ | ★☆☆ |
| D6 Test fidelity | ★★★ | ★☆☆ | ★★★ | ★★☆ | ★★☆ |
| D7 AI-agent proficiency & ecosystem | ★★★ | ★★☆ | ★★☆ | ★★★ | ★★☆ |

### Data access

Chosen option: "EF Core 10 (Npgsql provider) with code-first migrations", because migrations, LINQ and the Npgsql provider's PostgreSQL features (ranges, `timestamptz`, JSON) give the most productivity and safety (D7, D4). The migrations are versioned with the code and run unchanged in every environment (D1, D2). Raw SQL stays available through `FromSql`/`SqlQuery` for the rare hot path, so a second library isn't needed up front.

| Driver | **EF Core + migrations (chosen)** | Dapper + DbUp | EF Core writes + Dapper reads |
| --- | :---: | :---: | :---: |
| D1 Dev/prod parity | ★★★ | ★★★ | ★★★ |
| D2 Path to production | ★★★ | ★★☆ | ★★☆ |
| D3 Lightweight dev | ★★★ | ★★☆ | ★☆☆ |
| D4 Security | ★★★ | ★★☆ | ★★☆ |
| D5 Calendar data fit | ★★★ | ★★★ | ★★★ |
| D6 Test fidelity | ★★★ | ★★★ | ★★★ |
| D7 AI-agent proficiency & ecosystem | ★★★ | ★★☆ | ★★☆ |

### Local and test provisioning

Chosen option: "Docker Compose for development, Testcontainers for tests", because it is one command (`make db-up`) with no new projects or SDK workloads (D3). Tests get an isolated, throwaway real PostgreSQL (D6), and the same image tag is used in every environment (D1).

| Driver | **Compose + Testcontainers (chosen)** | Aspire AppHost + Testcontainers | Native install |
| --- | :---: | :---: | :---: |
| D1 Dev/prod parity | ★★★ | ★★★ | ★★☆ |
| D2 Path to production | ★★☆ | ★★★ | ★☆☆ |
| D3 Lightweight dev | ★★★ | ★★☆ | ★☆☆ |
| D4 Security | ★★★ | ★★★ | ★★☆ |
| D6 Test fidelity | ★★★ | ★★★ | ★☆☆ |
| D7 AI-agent proficiency & ecosystem | ★★★ | ★★☆ | ★★☆ |

### Implementation plan

When this ADR is accepted, the implementation PR will set things up as follows.

**Engine and image**

* PostgreSQL **18**, image pinned to a minor version (e.g. `postgres:18.6-alpine`). The same tag is used in `compose.yaml` and the Testcontainers fixtures, and Dependabot (`docker` ecosystem) keeps both current.

**Project structure**

* A new `Calendar.Infrastructure` project holds the `DbContext`, entity configurations (`IEntityTypeConfiguration<T>`) and migrations. `Calendar.Domain` stays free of persistence concerns, as planned in [ADR-0002](0002-dotnet-10-minimal-api-backend.md).

**Schema conventions**

* All instants are stored as `timestamptz` (`DateTimeOffset` in UTC). The IANA time zone of each event and calendar is stored separately, because recurrence needs the wall-clock zone, not just an offset.
* Event time spans use `tstzrange` with a GiST index for overlap queries. An exclusion constraint can be added where double-booking must be impossible.
* Column names are snake_case, via `EFCore.NamingConventions`.
* `xmin` is used as the optimistic-concurrency token.

**Migrations**

* Migrations are generated with `dotnet ef migrations add` (`dotnet-ef` is a local tool in `.config/dotnet-tools.json`) and committed.
* Production applies them with an idempotent **migration bundle** (`dotnet ef migrations bundle`), run as a separate deploy step under a privileged role. They are **never** applied at app startup.

**Security**

* Local development:
  * The compose service binds to **`127.0.0.1` only**.
  * The password comes from an untracked `.env`; a committed `.env.example` holds placeholders.
  * The app reads its connection string from **user-secrets** or environment variables. Nothing secret goes in `appsettings*.json`, and secret scanning and push protection back this up ([ADR-0013](0013-public-repository-for-github-security-features.md)).
* Two roles:
  * `calendar_migrator` owns the schema and runs migrations.
  * `calendar_app` gets only `SELECT/INSERT/UPDATE/DELETE` on application tables. The app always connects as `calendar_app`.
* Production: TLS required (`SSL Mode=VerifyFull`), and identity-based auth where the host supports it (e.g. Entra ID / IAM tokens via Npgsql password providers) instead of static passwords. Encryption at rest and automated backups/PITR come from the managed service.

**Tests**

* `Calendar.Infrastructure.Tests` uses **Testcontainers.PostgreSql** with one container per test assembly and **Respawn** to reset data between tests.
* `Calendar.Api.Tests` swaps the connection string into `WebApplicationFactory` so HTTP tests hit real PostgreSQL.
* Testcontainers needs Docker in CI; `ubuntu-latest` runners have it.

**Developer workflow**

* `make db-up`, `db-down`, `db-reset` and `db-migrate` targets.
* `make doctor` gains a check that Docker is available.

### Consequences

* Good, because development, CI and production all run the same PostgreSQL major version and the same migrations. Going to production is a connection-string and secrets change, plus a migration step in the deploy pipeline.
* Good, because PostgreSQL is offered as a managed service by every major cloud (Azure Database for PostgreSQL, AWS RDS/Aurora, Google Cloud SQL) and by smaller hosts (Neon, Supabase, Fly), so the hosting choice stays open.
* Good, because range types and exclusion constraints let the database itself enforce calendar invariants such as "no overlapping bookings for a resource".
* Bad, because Docker is now required for local development and integration tests. This is acceptable: it is already installed, and `make doctor` will check for it.
* Bad, because integration tests get slower: container startup is ~2–5 s per test assembly, mitigated by sharing one container per assembly plus Respawn.
* Bad, because the production database is a second deployable alongside the app container. It's a managed service rather than something we operate, but it still has a cost: managed PostgreSQL has no free tier on most clouds beyond trials or small serverless plans.
* Neutral: Aspire can be adopted later for dev orchestration (database, cache, dashboard) without changing this decision. Revisit when a second backing service (e.g. a cache or queue) is added.

### Confirmation

* An integration test project runs against Testcontainers PostgreSQL in CI.
* A test verifies the application role cannot run DDL.
* CI checks that the model and migrations are in sync (`dotnet ef migrations has-pending-model-changes`).
* Code review rejects connection strings or credentials in tracked config files.

## Pros and Cons of the Options

### PostgreSQL

* Good, because **D1 Dev/prod parity**: the identical engine runs in a container locally, in tests and as a managed service in production.
* Good, because **D2 Path to production**: available fully managed everywhere, with PITR, read replicas and HA; open source, so there's no licence cost or lock-in.
* Good, because **D4 Security**: role-based least privilege, row-level security (useful later for multi-tenant calendars), SCRAM auth, TLS, and cloud identity integration.
* Good, because **D5 Calendar data fit**: `timestamptz`, `tstzrange` with GiST indexes for overlap queries, exclusion constraints to prevent double-booking, and `jsonb` for flexible metadata.
* Good, because **D6 Test fidelity**: Testcontainers gives tests the real engine.
* Good, because **D7 AI-agent proficiency & ecosystem**: the most popular open-source database, with a first-class EF Core provider (Npgsql) maintained alongside EF Core releases.
* Bad, because **D3 Lightweight dev**: needs Docker and a ~100 MB image, and isn't an embedded file.

### SQLite in development, PostgreSQL in production

* Good, because **D3 Lightweight dev**: zero setup; a single file.
* Good, because **D2 Path to production**: production is still PostgreSQL.
* Bad, because **D1 Dev/prod parity**: EF Core migrations are provider-specific, so two migration sets are needed. Types differ too: SQLite has no native `DateTimeOffset`, and EF Core can't translate ordering or comparisons on it. Bugs then appear only in production.
* Bad, because **D5 Calendar data fit**: no range types, exclusion constraints or real time zone–aware timestamps in the SQLite path.
* Bad, because **D6 Test fidelity**: tests against SQLite don't validate the production SQL.
* Neutral, because **D4 Security**: the dev file has no authentication (file permissions only), which is fine locally but builds no habits for production.

### SQLite everywhere (with Litestream)

* Good, because **D3 Lightweight dev** and **D1 Dev/prod parity**: one embedded engine everywhere, and the database lives inside the single container.
* Bad, because **D2 Path to production**: a single writer on a single node. It needs a persistent volume and streaming replication (Litestream) for backups, and can't scale out to multiple app replicas.
* Bad, because **D4 Security**: no authentication or roles, and encryption at rest needs SQLCipher; security is file permissions only.
* Bad, because **D5 Calendar data fit**: weak date/time types and no range or exclusion support.

### SQL Server

* Good, because **D7 AI-agent proficiency & ecosystem**: the most traditional .NET pairing, with an excellent EF Core provider.
* Good, because **D4 Security**: mature security features (Always Encrypted, TDE, Entra auth on Azure SQL).
* Bad, because **D3 Lightweight dev**: a ~1.5 GB Linux container needing ≥2 GB RAM; LocalDB is Windows-only.
* Bad, because **D2 Path to production**: licensing cost outside Azure SQL; ties hosting toward Azure.
* Neutral, because **D5 Calendar data fit**: has `datetimeoffset`, but no range types or exclusion constraints.

### Document database (MongoDB / Cosmos DB)

* Good, because **D3 Lightweight dev**: MongoDB containers are light, and the Cosmos DB emulator exists.
* Bad, because **D5 Calendar data fit**: calendar data is relational (calendars ↔ events ↔ attendees ↔ users), and overlap queries and cross-document integrity are harder.
* Bad, because **D1 Dev/prod parity** and **D6 Test fidelity**: the Cosmos DB emulator differs from the service; the EF Core providers for both are less complete than for relational engines.
* Neutral, because **D2 Path to production**: managed offerings exist, but with a different cost model (RU-based) and more lock-in.

### EF Core 10 with code-first migrations

* Good, because **D7 AI-agent proficiency & ecosystem**: the standard .NET data access approach, which agents produce reliably; LINQ queries are type-checked.
* Good, because **D4 Security**: parameterized queries by default, which removes most SQL-injection risk.
* Good, because **D2 Path to production**: migration bundles and idempotent scripts make schema deployment a repeatable pipeline step.
* Good, because **D3 Lightweight dev**: migrations are generated from the model, with no hand-written DDL.
* Good, because **D5 Calendar data fit**: the Npgsql provider maps `NpgsqlRange<DateTimeOffset>`, `timestamptz` and `jsonb`.
* Bad, because **D7 AI-agent proficiency & ecosystem**: careless LINQ can produce N+1 queries or client evaluation. Mitigated by projections, `AsNoTracking`, and logging in development.

### Dapper with hand-written SQL and DbUp

* Good, because **D5 Calendar data fit**: full control of PostgreSQL SQL.
* Good, because **D6 Test fidelity**: what runs in tests is exactly the SQL that runs in production.
* Bad, because **D3 Lightweight dev**: every query, mapping and migration is written by hand.
* Bad, because **D4 Security**: safety depends on always parameterizing correctly; string-built SQL is an easy agent mistake.
* Bad, because **D7 AI-agent proficiency & ecosystem**: SQL strings aren't type-checked, so schema drift is found at runtime.

### EF Core for writes, Dapper for complex reads

* Good, because **D5 Calendar data fit**: hand-tuned SQL is available for the heaviest queries.
* Bad, because **D3 Lightweight dev** and **D7 AI-agent proficiency & ecosystem**: two data access styles to learn and keep consistent, before any query needs it. EF Core's `SqlQuery<T>` covers the same need without a second library.

### Docker Compose for development, Testcontainers for tests

* Good, because **D3 Lightweight dev**: a `compose.yaml` and a `make db-up`; no new projects, SDK workloads or IDE requirements.
* Good, because **D6 Test fidelity**: each test run gets a fresh, real PostgreSQL, with nothing shared between developers or CI runs.
* Good, because **D4 Security**: the port is bound to localhost, and credentials come from an untracked `.env`.
* Good, because **D7 AI-agent proficiency & ecosystem**: Compose and Testcontainers are ubiquitous.
* Bad, because **D2 Path to production**: Compose is dev-only, and production wiring (connection strings, secrets) is configured separately.

### .NET Aspire AppHost for development, Testcontainers for tests

* Good, because **D2 Path to production**: the AppHost models the app and its resources and can generate deployment manifests (e.g. for Azure Container Apps).
* Good, because **D3 Lightweight dev**: `dotnet run` on the AppHost starts PostgreSQL, injects the connection string, and provides a telemetry dashboard.
* Bad, because **D3 Lightweight dev**: adds AppHost and ServiceDefaults projects and their concepts, which is heavy for a single database.
* Bad, because **D7 AI-agent proficiency & ecosystem**: younger and evolving quickly (major versions yearly), so there are fewer stable examples.

### PostgreSQL installed natively

* Good, because **D3 Lightweight dev** (runtime): no container overhead once installed.
* Bad, because **D3 Lightweight dev** (setup): a manual install, with version and configuration varying per machine.
* Bad, because **D1 Dev/prod parity** and **D6 Test fidelity**: versions drift from production, and tests share one mutable database.
* Bad, because **D4 Security**: a long-running local service, often configured with `trust` auth for convenience.

## More Information

* Related: [ADR-0002](0002-dotnet-10-minimal-api-backend.md) (the project structure this adds `Calendar.Infrastructure` to), [ADR-0006](0006-dotnet-dependency-management.md) (new packages go through Central Package Management), [ADR-0007](0007-backend-testing-stack.md) (testing stack the Testcontainers tests extend), [ADR-0012](0012-ci-and-dependency-updates.md) (CI and Dependabot will need the `docker` ecosystem added).
* Package versions at the time of writing: `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3, `Microsoft.EntityFrameworkCore` 10.0.14, `Testcontainers.PostgreSql` 4.16.0, `Respawn` 7.0.0.
* Open questions for review:
  * Is a managed PostgreSQL service acceptable for production cost-wise, or should SQLite + Litestream on a volume be kept as a budget fallback?
  * Should double-booking prevention (exclusion constraints) be a domain rule from the start, or added per resource type later?
  * Adopt Aspire now or later? This ADR proposes later.
