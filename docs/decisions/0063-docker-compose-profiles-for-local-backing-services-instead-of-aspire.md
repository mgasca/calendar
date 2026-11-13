---
status: proposed
date: 2026-11-13
decision-makers: mgasca, Claude (AI assistant)
---

# Docker Compose with opt-in profiles and per-run projects for local backing services, instead of Aspire

## Context and Problem Statement

[ADR-0016](0016-local-database-provisioning.md) chose Docker Compose for the local database and Testcontainers for tests, and deferred .NET Aspire with a trigger: "when a second backing service … is added, re-evaluate Aspire in a new ADR that supersedes the provisioning part of this one". Epic #728 (story [0064](../stories/0064-test-every-user-flow-end-to-end-and-prove-it-is-observable.md)) adds two: a Grafana LGTM container for telemetry ([ADR-0062](0062-opentelemetry-over-otlp-with-grafana-lgtm-locally-and-application-insights-in-azure.md)) and a stub OIDC provider ([ADR-0064](0064-stub-oidc-provider-for-sign-in-tests.md)). They are needed locally and in a throwaway end-to-end stack ([ADR-0061](0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md)) that must never touch the shared `calendar` Compose project. Since [ADR-0016](0016-local-database-provisioning.md), the backend moved to Rust ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)) and repository tooling to TypeScript on Deno ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)), whose first driver removes C# and the .NET SDK from application and tooling code. How should local and end-to-end backing services be provisioned now?

## Decision Drivers

* **D1 Lightweight dev**: one command to a working database, with the new services opt-in; no new SDK, project type or IDE requirement.
* **D2 Isolation of throwaway stacks**: an end-to-end run gets its own containers, volumes and loopback ports, and tears down only those, never the shared `calendar` project, its volume or port 5432, nor another checkout's stack.
* **D3 Dev/prod parity**: pinned images, and one PostgreSQL tag shared by development, tests and production's major version.
* **D4 Security**: services bind to loopback only, credentials stay out of the repo, and development-only services (LGTM, the stub provider) cannot reach a deployment.
* **D5 Growth to more services**: wiring several services, their health checks and the API's settings without hand-written glue for each.
* **D6 Toolchain fit**: no C# or .NET in application or tooling code ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)'s D1), and the app processes are a Rust binary and a Vite server.
* **D7 AI familiarity**: mainstream, stable tooling that agents use reliably.

## Considered Options

* Docker Compose with opt-in profiles and per-run projects
* Aspire AppHost
* Testcontainers for Node started from the end-to-end suite's global setup
* Hand-written `docker run` scripts, as in the run-calendar skill

## Decision Outcome

Chosen option: "Docker Compose with opt-in profiles and per-run projects", because it keeps the one-command database (D1), isolates each end-to-end run by project name (D2), keeps `compose.yaml` the single source of the PostgreSQL tag (D3), binds everything to loopback (D4) and adds no runtime or language (D6, D7). Aspire still scores best on growth (D5), but its Rust support is a C#-only community package and it would bring back the .NET SDK or a new AppHost runtime for three containers and two processes.

| Driver | **Docker Compose with opt-in profiles (chosen)** | Aspire AppHost | Testcontainers for Node | Hand-written `docker run` scripts |
| --- | :---: | :---: | :---: | :---: |
| D1 Lightweight dev | ★★★ | ★★☆ | ★☆☆ | ★★☆ |
| D2 Isolation of throwaway stacks | ★★★ | ★★☆ | ★★★ | ★★☆ |
| D3 Dev/prod parity | ★★★ | ★★★ | ★★★ | ★★☆ |
| D4 Security | ★★★ | ★★★ | ★★★ | ★★☆ |
| D5 Growth to more services | ★★☆ | ★★★ | ★★☆ | ★☆☆ |
| D6 Toolchain fit | ★★★ | ★☆☆ | ★★☆ | ★★★ |
| D7 AI familiarity | ★★★ | ★★☆ | ★★☆ | ★★☆ |

### Conventions

* **Development:** `compose.yaml` keeps `postgres` as its only default service, so `just db up` is unchanged. LGTM joins it under the profile `observability` and the stub OIDC provider under `sign-in-stub`; both images are pinned and both bind to `127.0.0.1` only. `just db` recipes keep addressing only the shared `calendar` project.
* **End-to-end runs:** the E2E recipe starts its own Compose project (a unique project name per run, with both profiles enabled and ports from the run-calendar skill's 55xxx range), runs the API and the built web app as processes against it, and on teardown removes only that project's containers and volumes. It never uses the `calendar` project name, its volume or port 5432.
* **Tests:** unchanged from [ADR-0016](0016-local-database-provisioning.md). Database tests use Testcontainers through `calendar-testing` (one container per test process, a database per test, [ADR-0054](0054-rust-backend-testing-stack.md)), with the PostgreSQL tag read from `compose.yaml`.
* **Deployments:** Compose describes local and test stacks only. LGTM and the stub provider never appear in `infra/`.
* **Revisit trigger:** re-evaluate an orchestrator when the local stack needs more application processes than the API and the web app, or service discovery between them. #730 records this trigger, in place of [ADR-0016](0016-local-database-provisioning.md)'s, in the `compose.yaml` header comment, the PR template checklist and the README.

### Consequences

* Good, because nothing new is installed: Docker and `just` already are.
* Good, because two worktrees and an end-to-end run can each have their own stack without touching the shared database.
* Bad, because the API's settings for the stack (OTLP endpoint, stub endpoints, connection string) are wired by hand in recipes, and there is no shared dashboard beyond Grafana.
* Bad, because `compose.yaml` grows, and port variables are needed so one file serves both the shared project and per-run projects.
* Neutral, because Aspire's OpenTelemetry dashboard is not needed: LGTM's Grafana covers it.

### Confirmation

* #730's tests show that starting and stopping an end-to-end stack leaves the shared project and another checkout's stack untouched.
* The repository hook that guards the shared Compose project keeps applying to `just db` recipes.
* Review rule: a new backing service joins `compose.yaml` under a profile, or reopens this record if it meets the revisit trigger.

## Pros and Cons of the Options

### Docker Compose with opt-in profiles and per-run projects

* Good, because **D1 Lightweight dev**: services with `profiles` start only when the profile is enabled (`--profile` or `COMPOSE_PROFILES`), so the default stays the database alone.
* Good, because **D2 Isolation of throwaway stacks**: a project name scopes containers, networks and volumes, so a per-run project cannot collide with `calendar`.
* Good, because **D3 Dev/prod parity**: `compose.yaml` stays the one place the PostgreSQL tag is pinned, read by Testcontainers and bumped by Dependabot.
* Good, because **D4 Security**: loopback-only port bindings and credentials from the untracked `.env`, as today.
* Good, because **D6 Toolchain fit**: YAML and the Docker CLI, no language or runtime.
* Good, because **D7 AI familiarity**: ubiquitous.
* Bad, because **D5 Growth to more services**: settings and health waits between services are written by hand in recipes.

### Aspire AppHost

* Good, because **D5 Growth to more services**: models every resource and injects connection strings and OTLP settings, with a dashboard.
* Good, because **D3 Dev/prod parity** and **D4 Security**: runs the same pinned containers on loopback.
* Neutral, because **D2 Isolation of throwaway stacks**: each AppHost run has its own resources, but a run that must leave other stacks and fixed ports alone needs care with persistent containers and port allocation.
* Neutral, because **D1 Lightweight dev**: a new CLI and an AppHost project, heavy for three containers.
* Bad, because **D6 Toolchain fit**: Rust apps are supported only by `CommunityToolkit.Aspire.Hosting.Rust`, used from a C# AppHost, which brings back the .NET SDK that [ADR-0058](0058-typescript-on-deno-for-repository-tooling.md) removed. The TypeScript AppHost is generally available, but it would add an orchestration runtime of its own for a Rust binary it does not host natively.
* Neutral, because **D7 AI familiarity**: well documented, but fast-moving, with yearly majors and a rename.

### Testcontainers for Node started from the end-to-end suite's global setup

* Good, because **D2 Isolation of throwaway stacks**: every run gets fresh containers on random ports, removed automatically.
* Good, because **D3 Dev/prod parity** and **D4 Security**: the same pinned images on loopback.
* Neutral, because **D5 Growth to more services**: services are code, but wiring stays hand-written.
* Neutral, because **D6 Toolchain fit**: a second Testcontainers library, in TypeScript, beside the Rust one.
* Bad, because **D1 Lightweight dev**: covers only the test suite; everyday development would still need Compose for LGTM.
* Neutral, because **D7 AI familiarity**: well known, though less so for multi-service stacks.

### Hand-written `docker run` scripts, as in the run-calendar skill

* Good, because **D6 Toolchain fit**: plain Docker commands.
* Neutral, because **D1 Lightweight dev**: works, but every service is another script.
* Neutral, because **D2 Isolation of throwaway stacks**: container names and cleanup are managed by hand.
* Bad, because **D3 Dev/prod parity**: image tags are repeated outside `compose.yaml`.
* Neutral, because **D4 Security**: loopback binding depends on each script.
* Bad, because **D5 Growth to more services**: grows linearly with each service.
* Neutral, because **D7 AI familiarity**: simple, but with no structure an agent can rely on.

## More Information

* **Supersedes** [ADR-0016](0016-local-database-provisioning.md) once accepted. [ADR-0016](0016-local-database-provisioning.md)'s test half still stands and is restated under Conventions: Testcontainers for tests, with the image tag read from `compose.yaml`.
* **Versions and sources at the time of writing (2026-11-13):**
  * Aspire v13.6.5 (MIT). aspire.dev "What's new in Aspire 13.4": TypeScript AppHosts generally available.
  * `CommunityToolkit.Aspire.Hosting.Rust` in toolkit v13.6.1; its README shows C# usage only.
  * Docker Compose v5.7.1. Profiles were introduced in Compose 1.28.0; docs.docker.com "Using profiles with Compose".
  * Whether a TypeScript AppHost still needs the .NET SDK installed was not confirmed.
* **Delivery:** #730 builds the stack and moves the revisit trigger.
