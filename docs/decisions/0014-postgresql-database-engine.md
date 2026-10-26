---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# PostgreSQL as the database engine, with SQLite on a volume as a budget fallback

## Context and Problem Statement

The backend needs persistent storage for calendars, events and, later, users, attendees and recurrence rules. We want something lightweight and secure for initial development that can move to production with minimal overhead.

The app is deployed as a single container ([ADR-0002](0002-dotnet-10-minimal-api-backend.md)), code is mostly written by AI agents, and production hosting and budget are not decided yet. Which database engine should we use?

How .NET code accesses the database is decided in [ADR-0015](0015-ef-core-data-access.md). How databases are provisioned for development and tests is decided in [ADR-0016](0016-local-database-provisioning.md).

## Decision Drivers

* **D1 Dev/prod parity**: the same engine, SQL dialect, types and migrations from a laptop to production.
* **D2 Path to production**: managed hosting options and the effort to go live (backups, HA, scaling) without a rewrite.
* **D3 Lightweight dev experience**: fast to start, little to install, little RAM.
* **D4 Security**: authentication, least-privilege roles, encryption in transit and at rest.
* **D5 Calendar data fit**: time zone–correct timestamps, efficient time-range and overlap queries, and relational integrity between calendars, events and attendees.
* **D6 Production cost**: running cost at small scale.
* **D7 AI-agent proficiency & ecosystem**: mainstream, well documented, mature .NET support.

## Considered Options

* PostgreSQL
* SQLite in development, PostgreSQL in production
* SQLite everywhere (on a persistent volume, replicated with Litestream)
* SQL Server
* Document database (MongoDB / Azure Cosmos DB)

## Decision Outcome

Chosen option: "PostgreSQL", because the same engine runs from the first line of code to production (D1, D2). It fits calendar data best (D5) and has strong built-in security (D4).

Its weakness is production cost (D6), since managed PostgreSQL is a paid service. That's covered by keeping **"SQLite everywhere on a persistent volume" as the agreed budget fallback** for production. The fallback is only for production hosting: development and tests always use PostgreSQL.

| Driver | **PostgreSQL (chosen)** | SQLite dev / PostgreSQL prod | SQLite everywhere (fallback) | SQL Server | Document DB |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Dev/prod parity | ★★★ | ★☆☆ | ★★★ | ★★★ | ★★☆ |
| D2 Path to production | ★★★ | ★★★ | ★☆☆ | ★★☆ | ★★☆ |
| D3 Lightweight dev | ★★☆ | ★★★ | ★★★ | ★☆☆ | ★★☆ |
| D4 Security | ★★★ | ★★☆ | ★☆☆ | ★★★ | ★★☆ |
| D5 Calendar data fit | ★★★ | ★☆☆ | ★☆☆ | ★★☆ | ★☆☆ |
| D6 Production cost | ★★☆ | ★★☆ | ★★★ | ★☆☆ | ★★☆ |
| D7 AI-agent proficiency & ecosystem | ★★★ | ★★☆ | ★★☆ | ★★★ | ★★☆ |

### Engine conventions

* **Version:** PostgreSQL **18**, with the image pinned to a minor version (e.g. `postgres:18.6-alpine`) and kept current by Dependabot's `docker` ecosystem.
* **Time:**
  * All instants are stored as `timestamptz` (`DateTimeOffset` in UTC).
  * The IANA time zone of each event and calendar is stored separately, because recurrence needs the wall-clock zone, not just an offset.
* **Overlap queries:**
  * Event time spans use `tstzrange` with a GiST index.
  * **Double-booking rejection (exclusion constraints) is deferred.** It will be added per resource type when that resource type is modelled (e.g. rooms or people), not as a global rule now.
* **Roles:**
  * `calendar_migrator` owns the schema and runs migrations.
  * `calendar_app` gets only `SELECT/INSERT/UPDATE/DELETE` on application tables. The app always connects as `calendar_app`.
* **Credentials and secrets:**
  * Local and test credentials are disposable and come from untracked files ([ADR-0016](0016-local-database-provisioning.md)).
  * The app reads its connection string from user-secrets or environment variables, never from tracked `appsettings*.json`. Secret scanning and push protection back this up ([ADR-0013](0013-public-repository-for-github-security-features.md)).
* **Production:**
  * TLS is required (`SSL Mode=VerifyFull`).
  * Use identity-based auth where the host supports it (e.g. Entra ID / IAM tokens via Npgsql password providers) rather than static passwords.
  * Encryption at rest and backups/PITR come from the managed service.

### Budget fallback: SQLite on a persistent volume

If managed PostgreSQL is too expensive when production hosting is chosen, the fallback is **SQLite inside the app container on a persistent disk volume**, with **Litestream** streaming the database to encrypted object storage for backup and point-in-time restore.

Rules that keep the fallback viable at low cost:

* **Contain PostgreSQL-specific features.** Use them (ranges, `jsonb`, exclusion constraints, `xmin` concurrency) only inside `Calendar.Infrastructure`, never in `Calendar.Domain` or API code.
* **Record the fallback impact.** Any PR that adopts a new PostgreSQL-specific feature states, in its description, what the SQLite equivalent or degradation would be (e.g. `tstzrange` → two indexed `DateTimeOffset` columns stored as UTC ticks).
* **What switching requires:** a SQLite EF Core provider configuration, a separate SQLite migration set, and the provider-specific query paths above. Switching is a planned project, not a configuration toggle.
* **Limits of the fallback:** a single app replica (one writer). Security relies on volume encryption and file permissions, with no database authentication or roles.

Revisit this section when production hosting is decided. Either drop the fallback (and these rules) or adopt it (and plan the switch).

### Consequences

* Good, because development, CI and production (on managed PostgreSQL) share one engine and one migration set. Going live is a connection-string and secrets change, plus a migration deploy step.
* Good, because every major cloud (Azure Database for PostgreSQL, AWS RDS/Aurora, Google Cloud SQL) and smaller hosts (Neon, Supabase, Fly) offer PostgreSQL, so the hosting choice stays open.
* Good, because the database can enforce calendar invariants (e.g. no overlapping bookings for a resource) when those resource types arrive.
* Bad, because the fallback rules add a small, ongoing review cost to PostgreSQL-specific features.
* Bad, because managed PostgreSQL is a second paid deployable next to the app container (unless the fallback is used).

### Confirmation

* Code review checks that PostgreSQL-specific types and SQL appear only in `Calendar.Infrastructure`, and that PRs adopting them note the fallback impact.
* An integration test verifies that `calendar_app` cannot run DDL ([ADR-0016](0016-local-database-provisioning.md)).
* Code review and secret scanning reject credentials in tracked files.

## Pros and Cons of the Options

### PostgreSQL

* Good, because **D1 Dev/prod parity**: the identical engine runs in a container locally, in tests, and as a managed service in production.
* Good, because **D2 Path to production**: available fully managed everywhere, with PITR, replicas and HA; open source, with no licence lock-in.
* Good, because **D4 Security**: role-based least privilege, row-level security (useful for multi-tenant calendars later), SCRAM auth, TLS, and cloud identity integration.
* Good, because **D5 Calendar data fit**: `timestamptz`, `tstzrange` + GiST for overlap queries, exclusion constraints for double-booking, and `jsonb` for flexible metadata.
* Good, because **D7 AI-agent proficiency & ecosystem**: the most popular open-source database, with a first-class EF Core provider (Npgsql).
* Bad, because **D3 Lightweight dev**: needs Docker and a ~100 MB image, and isn't embedded.
* Bad, because **D6 Production cost**: managed instances are paid, with free tiers limited to trials or small serverless plans.

### SQLite in development, PostgreSQL in production

* Good, because **D3 Lightweight dev**: zero setup; a single file.
* Good, because **D2 Path to production**: production is still PostgreSQL.
* Bad, because **D1 Dev/prod parity**: EF Core migrations are provider-specific (two sets). SQLite has no native `DateTimeOffset`, and EF Core can't translate ordering or comparisons on it, so bugs surface only in production.
* Bad, because **D5 Calendar data fit**: no range types or exclusion constraints in the development path.
* Neutral, because **D4 Security**: no auth on the dev file, which is fine locally but builds no production habits.
* Neutral, because **D6 Production cost**: same as PostgreSQL.

### SQLite everywhere (on a persistent volume, with Litestream)

* Good, because **D6 Production cost**: no database service at all; only volume and object-storage costs.
* Good, because **D1 Dev/prod parity** and **D3 Lightweight dev**: one embedded engine, and the database lives inside the single container.
* Bad, because **D2 Path to production**: a single writer on a single node, so it can't scale out app replicas; backups depend on Litestream.
* Bad, because **D4 Security**: no authentication or roles; at-rest encryption comes from the volume (or SQLCipher).
* Bad, because **D5 Calendar data fit**: weak date/time types, no range types, no exclusion constraints.
* Neutral, because **D7 AI-agent proficiency & ecosystem**: SQLite is ubiquitous, but production SQLite with Litestream is a less common pattern for .NET.

### SQL Server

* Good, because **D7 AI-agent proficiency & ecosystem**: the traditional .NET pairing, with an excellent EF Core provider.
* Good, because **D4 Security**: Always Encrypted, TDE, Entra auth on Azure SQL.
* Bad, because **D3 Lightweight dev**: a ~1.5 GB container needing ≥2 GB RAM; LocalDB is Windows-only.
* Bad, because **D6 Production cost**: licensing outside Azure SQL, and Azure SQL itself isn't cheap.
* Neutral, because **D5 Calendar data fit**: has `datetimeoffset`, but no range types or exclusion constraints.

### Document database (MongoDB / Cosmos DB)

* Good, because **D3 Lightweight dev**: light MongoDB containers; a Cosmos DB emulator exists.
* Bad, because **D5 Calendar data fit**: calendar data is relational, and overlap queries and cross-document integrity are harder.
* Bad, because **D1 Dev/prod parity**: the Cosmos DB emulator differs from the service; the EF Core providers are less complete.
* Neutral, because **D2 Path to production** and **D6 Production cost**: managed offerings exist, but with RU-based pricing and more lock-in.

## More Information

* Related: [ADR-0015](0015-ef-core-data-access.md) (data access; its provider portability is what keeps the fallback possible), [ADR-0016](0016-local-database-provisioning.md) (development and test provisioning).
* A self-hosted PostgreSQL container on a persistent volume would be a fallback with full parity, at the cost of operating PostgreSQL ourselves (upgrades, backups). It's worth reconsidering when hosting is decided.
