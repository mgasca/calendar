---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Docker Compose for local databases and Testcontainers for tests; adopt .NET Aspire later

## Context and Problem Statement

Development and tests need a PostgreSQL database ([ADR-0014](0014-postgresql-database-engine.md)). Developers work on Linux/WSL with Docker available, and CI runs on GitHub-hosted Ubuntu runners. How should the database be provisioned for local development and for automated tests?

## Decision Drivers

* **D1 Lightweight dev experience**: one command to a working database; no new projects, SDK workloads or IDE requirements.
* **D2 Test fidelity & isolation**: tests use the real engine version, and each run starts clean, with nothing shared between developers or CI runs.
* **D3 Dev/prod parity**: the same PostgreSQL image version as production.
* **D4 Security**: local databases are not reachable from the network, and credentials stay out of the repo.
* **D5 Growth to more services**: how well the approach scales when a cache, queue or other backing service is added.
* **D6 AI-agent proficiency & ecosystem**: mainstream, stable tooling.

## Considered Options

* Docker Compose for development, Testcontainers for tests
* .NET Aspire AppHost for development, Testcontainers for tests
* PostgreSQL installed natively on the developer machine

## Decision Outcome

Chosen option: "Docker Compose for development, Testcontainers for tests". It is the lightest option for a single database (D1). Tests get an isolated, throwaway real PostgreSQL (D2), and the same pinned image tag is used everywhere (D3).

**Aspire is deferred, not rejected.** It scores best on growth to more services (D5), but with one database it adds projects and concepts for little gain.

> **Revisit trigger:** when a second backing service (e.g. Redis, a message queue, blob storage, an identity provider) is added, re-evaluate Aspire in a new ADR that supersedes the provisioning part of this one. This trigger also appears in `compose.yaml`, the PR template checklist and the README.

| Driver | **Compose + Testcontainers (chosen)** | Aspire AppHost + Testcontainers | Native install |
| --- | :---: | :---: | :---: |
| D1 Lightweight dev | ★★★ | ★★☆ | ★☆☆ |
| D2 Test fidelity & isolation | ★★★ | ★★★ | ★☆☆ |
| D3 Dev/prod parity | ★★★ | ★★★ | ★★☆ |
| D4 Security | ★★★ | ★★★ | ★★☆ |
| D5 Growth to more services | ★★☆ | ★★★ | ★☆☆ |
| D6 AI-agent proficiency & ecosystem | ★★★ | ★★☆ | ★★☆ |

### Implementation plan

**Local development**

* `compose.yaml` at the repo root has a `postgres` service:
  * the pinned image `postgres:18.x-alpine`
  * port bound to **`127.0.0.1:5432` only**
  * a named volume, and a health check
  * an init script that creates the `calendar_migrator` and `calendar_app` roles ([ADR-0014](0014-postgresql-database-engine.md))
  * a header comment carrying the Aspire revisit trigger
* Credentials:
  * An untracked `.env` holds them, with a committed `.env.example` of placeholders.
  * The API's dev connection string comes from `dotnet user-secrets` or the environment.
* Make targets: `db-up`, `db-down`, `db-reset` (drop the volume), `db-migrate`, `db-psql`.
* `make doctor` checks that Docker is available and running.

**Tests**

* Infrastructure tests:
  * `Calendar.Infrastructure.Tests` uses **Testcontainers.PostgreSql**, with one container per test assembly via an xUnit assembly fixture.
  * Migrations are applied once, and **Respawn** resets data between tests.
* API tests: `Calendar.Api.Tests` injects the container's connection string into `WebApplicationFactory`, so HTTP tests run against real PostgreSQL.
* Image tag: the tests read the same tag as `compose.yaml` (a shared constant or a `Directory.Build.props` property), so the two can't drift.
* A test verifies `calendar_app` cannot run DDL.

**CI and updates**

* CI needs no extra setup, because GitHub `ubuntu-latest` runners include Docker.
* Dependabot gets a `docker` ecosystem entry for `compose.yaml` ([ADR-0012](0012-ci-and-dependency-updates.md)).

### Consequences

* Good, because new contributors run `make db-up && make db-migrate`; nothing is installed on the host.
* Good, because each test run gets a clean database, so tests are order-independent and parallel-safe across assemblies.
* Bad, because Docker becomes a hard requirement for development and integration tests.
* Bad, because integration test startup grows by ~2–5 s per test assembly (container start). Sharing one container per assembly keeps this small.
* Bad, because service wiring (connection strings, health checks) is configured by hand. That's fine for one service; this is what the Aspire revisit trigger is for.

### Confirmation

* CI runs the Testcontainers-based tests on every PR.
* The PR template's checklist item for new backing services points back to this ADR.

## Pros and Cons of the Options

### Docker Compose for development, Testcontainers for tests

* Good, because **D1 Lightweight dev**: one YAML file and a `make` target; no new .NET projects or workloads.
* Good, because **D2 Test fidelity & isolation**: Testcontainers starts a fresh, real PostgreSQL per test assembly, locally and in CI.
* Good, because **D3 Dev/prod parity**: the same pinned image tag as production's major and minor version.
* Good, because **D4 Security**: binds to localhost only, and credentials live in an untracked `.env`.
* Good, because **D6 AI-agent proficiency & ecosystem**: both tools are ubiquitous, with stable APIs.
* Bad, because **D5 Growth to more services**: each new service means more hand-written Compose config and connection wiring, with no shared dashboard or telemetry.

### .NET Aspire AppHost for development, Testcontainers for tests

* Good, because **D5 Growth to more services**: models the app and all its resources in C#, injects connection strings, and provides an OpenTelemetry dashboard; it can also generate deployment manifests.
* Good, because **D2**, **D3**, **D4**: uses the same containers, so isolation, parity and localhost-only access are all achievable.
* Bad, because **D1 Lightweight dev**: adds AppHost and ServiceDefaults projects and their concepts, which is heavy for one database.
* Bad, because **D6 AI-agent proficiency & ecosystem**: younger and evolving quickly (yearly major versions), with fewer stable examples.

### PostgreSQL installed natively

* Good, because **D1 Lightweight dev** (runtime): no container overhead once installed.
* Bad, because **D1 Lightweight dev** (setup): a manual install that varies per machine.
* Bad, because **D2 Test fidelity & isolation**: tests share one mutable database, and CI needs separate setup.
* Bad, because **D3 Dev/prod parity**: the installed version drifts from production.
* Bad, because **D4 Security**: a long-running service, often configured with `trust` auth for convenience.
* Bad, because **D5 Growth to more services**: every new service is another native install.
