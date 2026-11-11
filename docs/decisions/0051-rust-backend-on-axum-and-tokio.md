---
status: proposed
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# Rust backend on axum and tokio, replacing the .NET minimal API in place

## Context and Problem Statement

[ADR-0002](0002-dotnet-10-minimal-api-backend.md) took ".NET" as a given requirement and chose .NET 10 with ASP.NET Core Minimal APIs; [ADR-0050](0050-adopt-dotnet-11-once-the-providers-support-it.md) later scheduled the move to .NET 11. On 2026-11-11 the maintainer withdrew that requirement and asked for the backend to be ported to Rust, keeping PostgreSQL, the HTTP contract and the deployment unchanged. Article [0007](../agent-thoughts/0007-rust-database-migrations-and-postgresql.md) explored the database side of such a move. Which Rust web stack serves the API, and does it replace the .NET API in one step or run beside it?

This record covers the web framework, the runtime, the workspace structure and the shape of the cutover. Linked records cover data access ([ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md)), dependencies ([ADR-0053](0053-cargo-workspace-dependency-management.md)), tests ([ADR-0054](0054-rust-backend-testing-stack.md)), static analysis ([ADR-0055](0055-rust-static-analysis-and-formatting.md)), the session cookie ([ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md)) and time types ([ADR-0057](0057-chrono-time-types-for-the-rust-backend.md)).

## Decision Drivers

* **D1 Given requirement**: the maintainer asked for a Rust backend on 2026-11-11. As ".NET" was in [ADR-0002](0002-dotnet-10-minimal-api-backend.md), the language is an input to this record, not a result of its comparison.
* **D2 Contract parity**: paths, methods, status codes, JSON shapes, problem-details bodies, validation messages, `operationId`s and schema names match the .NET API, so the frontend and the generated client need no change ([ADR-0004](0004-openapi-contract-and-generated-client.md)). `contracts/openapi.json` is the oracle.
* **D3 Behaviour parity and testability**: the domain rules stay testable without the web host, the API is testable in process, and the clock is injected ([ADR-0018](0018-time-representation-and-bcl-date-time-types.md), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)).
* **D4 Operational continuity**: one container serving the API and the web UI ([ADR-0030](0030-single-container-for-api-and-spa.md)), the same configuration names, database roles and infrastructure; no Key Vault or Bicep change.
* **D5 Ecosystem and maintenance**: a maintained, widely used framework whose middleware, documentation and examples agents reproduce reliably.
* **D6 Cost and risk of the move**: hours of work, and how much can go wrong at the cutover.
* **D7 Right-sized structure**: one backend to build, test and deploy; no speculative or duplicate parts ([ADR-0002](0002-dotnet-10-minimal-api-backend.md) D5).

## Considered Options

* Rust on axum and tokio, replacing the .NET API in place
* Rust on actix-web, replacing the .NET API in place
* Rust on axum beside the .NET API, moving one route group at a time
* Stay on the .NET minimal API (status quo)

## Decision Outcome

Chosen option: "Rust on axum and tokio, replacing the .NET API in place", because it meets the requirement (D1) with the framework that shares its runtime and middleware with the rest of the chosen stack (D5), keeps one backend and one container (D4, D7), and makes the contract a single diff against the committed document (D2). The maintainer chose it on 2026-11-11.

D1 separates Rust from .NET. It is a requirement, not a weight, so the status quo's better ratings on the other drivers do not outvote it. The remaining drivers choose among the Rust options. axum and actix-web are close: no comparison was implemented, and the ratings rest on the projects' documentation.

| Driver | **axum and tokio, in place (chosen)** | actix-web, in place | axum beside .NET, route by route | Stay on .NET |
| --- | :---: | :---: | :---: | :---: |
| D1 Given requirement | ★★★ | ★★★ | ★★☆ | ☆☆☆ |
| D2 Contract parity | ★★☆ | ★★☆ | ★★★ | ★★★ |
| D3 Behaviour parity and testability | ★★★ | ★★★ | ★★☆ | ★★★ |
| D4 Operational continuity | ★★★ | ★★★ | ★☆☆ | ★★★ |
| D5 Ecosystem and maintenance | ★★★ | ★★☆ | ★★★ | ★★★ |
| D6 Cost and risk of the move | ★☆☆ | ★☆☆ | ★★☆ | ★★★ |
| D7 Right-sized structure | ★★★ | ★★★ | ☆☆☆ | ★★★ |

### Conventions

* **Stack:** axum 0.8 on tokio, with tower and tower-http middleware. `unsafe` code is forbidden in the workspace.
* **Workspace:** `backend/` becomes a Cargo workspace ([ADR-0053](0053-cargo-workspace-dependency-management.md)) whose crates mirror the .NET projects and keep their dependency direction:
  * `calendar-domain`: pure rules, no I/O (ports `Calendar.Domain`);
  * `calendar-infrastructure`: schema, queries, repositories, connection configuration, migrations (ports `Calendar.Infrastructure`);
  * `calendar-api`: the axum application as a library plus a binary (ports `Calendar.Api`);
  * `calendar-migrate`: the migration binary ([ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md));
  * `calendar-testing`: shared test helpers ([ADR-0054](0054-rust-backend-testing-stack.md)).
* **Contract:** utoipa 6 generates the OpenAPI document from annotations on the handlers and types. `just contracts` still writes `contracts/openapi.json` and the TypeScript client, and CI still fails on a stale contract. The code-first choice of [ADR-0004](0004-openapi-contract-and-generated-client.md) stands; only the generator changes.
* **Errors:** problem details (RFC 9457) with the same bodies and validation messages as the .NET API.
* **Hosting:** the binary serves the built web UI with the fallback and cache rules of [ADR-0026](0026-client-side-routing-with-tanstack-router.md) and [ADR-0030](0030-single-container-for-api-and-spa.md).
* **Configuration:** the names stay exactly as they are: `ConnectionStrings__Calendar` and `CALENDAR_MIGRATOR_CONNECTION` in Npgsql keyword form, `Auth__Google__ClientId`, `Auth__Google__ClientSecret`, `Auth__AllowedEmails__N`, `Auth__DevSeedKey`, `ASPNETCORE_ENVIRONMENT` (Development or not) and `ASPNETCORE_URLS` for the listen address (default `http://localhost:5041` in Development; the image sets `http://+:8080`).
* **Carried over unchanged:** per-user ownership ([ADR-0041](0041-per-user-data-ownership.md)), the read-only snapshot for agenda reads ([ADR-0020](0020-aggregate-day-agenda-endpoint-as-read-model.md)), client-supplied `today` and `timeZone` ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)), authentication on every endpoint except health and sign-in ([ADR-0027](0027-google-oidc-bff-session.md)), and the least-privilege `calendar_app` role.
* **Cutover:** one code pull request ports the API and its tests, with the C# sources kept on disk as the reference until the port passes, then deleted in the same pull request. The repo tools under `tools/` and `.claude/skills/` stay .NET file-based apps ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)).

### Effect on earlier records, once this record is accepted

None of these edits is made while this record is `proposed`.

* **[ADR-0002](0002-dotnet-10-minimal-api-backend.md)** becomes `superseded by` this record. Its Domain/Api layering and problem-details convention are restated above.
* **[ADR-0050](0050-adopt-dotnet-11-once-the-providers-support-it.md)** stays `accepted` and gets a dated amendment. Its gate (a stable Npgsql EF Core provider 11 and `EFCore.NamingConventions`) and its file set (target frameworks, runtime image, EF packages, `dotnet-ef`, the contract) concern the backend only and lapse with it. What remains is the .NET SDK that the repo tools run on, pinned in the root `global.json`: the chosen direction (".NET 11, then .NET 12") still governs that pin, and the move no longer waits for any EF package. Story 0056 needs the same narrowing. Open question 2 asks whether the maintainer prefers to supersede [ADR-0050](0050-adopt-dotnet-11-once-the-providers-support-it.md) instead.
* **Amendments, each a dated bullet:** [ADR-0001](0001-monorepo-layout.md) (`backend/` holds a Cargo workspace; the repository has three languages: Rust, TypeScript, and C# for tooling), [ADR-0004](0004-openapi-contract-and-generated-client.md) (utoipa generates the contract), [ADR-0012](0012-ci-and-dependency-updates.md) (CI jobs, CodeQL languages and Dependabot ecosystems), [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) (the tools' package versions can no longer be matched to `backend/Directory.Packages.props`) and [ADR-0030](0030-single-container-for-api-and-spa.md) (the runtime image is no longer an ASP.NET image).
* **Architecture model:** the component and technology changes, and every node that cites [ADR-0002](0002-dotnet-10-minimal-api-backend.md), are updated in the code pull request, as is the planned story card that lists [ADR-0002](0002-dotnet-10-minimal-api-backend.md).

### Consequences

* Good, because the frontend, the contract, the database, the roles, the configuration and the infrastructure stay as they are.
* Good, because the backend has one stack and one cutover, with no period in which two backends serve traffic.
* Bad, because the port is a rewrite. Article [0007](../agent-thoughts/0007-rust-database-migrations-and-postgresql.md) gives a low-confidence estimate of 200 to 420 person-hours for a developer already productive in Rust, and names authentication parity, daylight-saving behaviour, optimistic concurrency and adopting a populated database as the items most likely to exceed it.
* Bad, because contract parity depends on hand-written utoipa annotations reproducing a document that ASP.NET derived from the endpoint types. Any drift appears as a diff in `contracts/openapi.json`, which must be reviewed line by line at the cutover.
* Bad, because existing sessions end at the cutover ([ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md)), and a rollback to the .NET image after the seventh migration needs the dropped key table restored.
* Bad, because the repository now has three toolchains (Rust, .NET for tooling, Node), where [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) counted "no new toolchain" in favour of .NET tools.
* Neutral, because .NET 10 and 11 remain supported until 2028-11-14 ([ADR-0050](0050-adopt-dotnet-11-once-the-providers-support-it.md)): no support deadline forced this move.

### Confirmation

* `just contracts` regenerates `contracts/openapi.json` from the Rust API. The code pull request shows its diff against the committed document, and the frontend builds and passes its tests without source changes.
* Every C# test case has a Rust test with the same inputs and expectations ([ADR-0054](0054-rust-backend-testing-stack.md)); the pull request lists any case that has no Rust equivalent, with the reason.
* The CI `Container image` job builds the image and runs `just image smoke` against PostgreSQL.
* `just check` passes with no .NET project left under `backend/`.

## Pros and Cons of the Options

### Rust on axum and tokio, replacing the .NET API in place

* Good, because **D1 Given requirement**: the whole backend is Rust after one pull request.
* Good, because **D3 Behaviour parity and testability**: a `Router` is a value that a test can build with its own state (database pool, clock) and call without a network listener; the domain crate has no web dependency.
* Good, because **D4 Operational continuity**: one statically linked binary reads the same environment variables and serves the same port from the same single image.
* Good, because **D5 Ecosystem and maintenance**: axum is maintained in the tokio project and uses tower middleware, the same runtime and layer model as tokio-postgres, reqwest and tower-http, which the port already needs.
* Good, because **D7 Right-sized structure**: five crates, each a port of an existing project or a binary that is needed.
* Bad, because **D2 Contract parity**: utoipa builds the document from annotations that a person or agent writes; a handler and its annotation can disagree, which ASP.NET's derivation from `TypedResults` prevented.
* Bad, because **D6 Cost and risk of the move**: the full rewrite cost, taken in one step, with every parity risk landing at the same cutover.

### Rust on actix-web, replacing the .NET API in place

* Good, because **D1 Given requirement**: the whole backend is Rust.
* Good, because **D3 Behaviour parity and testability**: actix-web has in-process test utilities, and the domain crate is the same.
* Good, because **D4 Operational continuity**: the same single binary and configuration.
* Good, because **D7 Right-sized structure**: the same crates.
* Neutral, because **D5 Ecosystem and maintenance**: mature and widely used, but with its own middleware model and actor-derived runtime wrapper, so tower layers are not reused directly. Not evaluated in code.
* Bad, because **D2 Contract parity**: the same hand-written utoipa annotations.
* Bad, because **D6 Cost and risk of the move**: the same rewrite.

### Rust on axum beside the .NET API, moving one route group at a time

* Good, because **D2 Contract parity**: the .NET API keeps generating the contract until its last route moves, and each step is small enough to compare.
* Good, because **D5 Ecosystem and maintenance**: the same axum stack.
* Neutral, because **D6 Cost and risk of the move**: each step risks less, but the total work is larger: routing between two processes, and a session cookie both can read, which means implementing ASP.NET Data Protection's format in Rust ([ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md)).
* Neutral, because **D1 Given requirement**: met only when the last route has moved.
* Bad, because **D3 Behaviour parity and testability**: two test stacks and two implementations of shared rules until the end.
* Bad, because **D4 Operational continuity**: two processes behind a proxy in one container, or two containers, either of which changes [ADR-0030](0030-single-container-for-api-and-spa.md) and the infrastructure.
* Bad, because **D7 Right-sized structure**: two backends, two dependency sets and two CI jobs for the length of the transition.

### Stay on the .NET minimal API (status quo)

* Good, because **D2 Contract parity**: nothing changes.
* Good, because **D3 Behaviour parity and testability**: the existing tests keep covering the existing code.
* Good, because **D4 Operational continuity**: nothing changes.
* Good, because **D5 Ecosystem and maintenance**: ASP.NET Core is supported until 2028-11-14 on either .NET 10 or 11.
* Good, because **D6 Cost and risk of the move**: no cost and no cutover.
* Good, because **D7 Right-sized structure**: one backend, one language shared with the repo tools.
* Bad, because **D1 Given requirement**: it does not deliver the Rust backend the maintainer asked for.

## More Information

* **Versions** resolved in the code branch's `Cargo.lock` on 2026-11-11: axum 0.8.9, tokio 1.54.1, tower 0.5.3, tower-http 0.7.1, utoipa 6.0.0; Rust toolchain 1.99.1. They were read from the lock file, not re-checked against crates.io for this record.
* **Not verified:** nothing in this record was measured. No Rust build of the API has served the web app or been deployed, and axum was not compared with actix-web in code. The hours figure is article 0007's estimate, which its author calls a low-confidence judgment.
* **Related:** [ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md), [ADR-0053](0053-cargo-workspace-dependency-management.md), [ADR-0054](0054-rust-backend-testing-stack.md), [ADR-0055](0055-rust-static-analysis-and-formatting.md), [ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md), [ADR-0057](0057-chrono-time-types-for-the-rust-backend.md).
* **Revisit when** the repo tools are the only .NET code left and a tool needs a larger change: whether they stay .NET is then a decision for [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)'s successor, not for this record.
* **Open questions for the reviewer:**
  1. This draft records the Rust requirement as given, because the maintainer's reasons were not stated to the author. Should the Context name them (for example performance, memory use, image size or learning), so a later reader can tell whether the drivers changed?
  2. [ADR-0050](0050-adopt-dotnet-11-once-the-providers-support-it.md): amend it to cover only the repo tools' SDK, as proposed above, or supersede it with a short record of its own?
  3. Is utoipa's place inside this record acceptable, or should the contract generator get its own record that amends [ADR-0004](0004-openapi-contract-and-generated-client.md)?
