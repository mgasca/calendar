---
status: accepted
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# cargo test with Testcontainers PostgreSQL and in-process axum tests on an injected clock

## Context and Problem Statement

[ADR-0007](0007-backend-testing-stack.md) chose xUnit v3, Shouldly and NSubstitute, with `WebApplicationFactory` for in-memory HTTP tests; [ADR-0016](0016-local-database-provisioning.md) gives database tests a throwaway PostgreSQL through Testcontainers. The backend moves to Rust ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), and its existing test suite is the specification of the port: every C# test case must reappear with the same inputs and expectations. Which runner, assertions, test doubles and HTTP test style does the Rust backend use?

## Decision Drivers

* **D1 Faithful port**: each C# test maps to one Rust test that a reviewer can compare with it; nothing in the stack forces a case to be dropped or weakened.
* **D2 Real PostgreSQL**: database and API tests run against the pinned PostgreSQL image, migrated by the real migrator ([ADR-0016](0016-local-database-provisioning.md), [ADR-0037](0037-postgresql-only-no-sqlite-fallback.md), [ADR-0052](0052-diesel-data-access-with-embedded-sql-migrations.md)).
* **D3 Deterministic time**: a test fixes "now"; no test or handler reads the system clock ([ADR-0018](0018-time-representation-and-bcl-date-time-types.md), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)).
* **D4 Low friction**: few tools and dependencies; a new test needs no setup beyond the shared helpers.
* **D5 Speed and isolation**: tests run in parallel without sharing data, and the suite stays fast in CI.
* **D6 Readable failures**: a failure says what was expected and what was found.

## Considered Options

* cargo test, standard assertions, hand-written fakes, Testcontainers, in-process axum tests
* The same libraries run by cargo-nextest
* Black-box HTTP tests against the built binary, with Testcontainers

## Decision Outcome

Chosen option: "cargo test, standard assertions, hand-written fakes, Testcontainers, in-process axum tests", because it ports the existing tests one to one (D1) against real PostgreSQL (D2) with the clock in the test's hands (D3), and needs nothing that the toolchain does not already provide (D4). It is the stack the port was started with; the alternatives were not tried.

| Driver | **cargo test, in-process axum, Testcontainers (chosen)** | Same libraries on cargo-nextest | Black-box tests against the binary |
| --- | :---: | :---: | :---: |
| D1 Faithful port | ★★★ | ★★★ | ★☆☆ |
| D2 Real PostgreSQL | ★★★ | ★★★ | ★★★ |
| D3 Deterministic time | ★★★ | ★★★ | ★☆☆ |
| D4 Low friction | ★★★ | ★★☆ | ★★☆ |
| D5 Speed and isolation | ★★☆ | ★★★ | ★☆☆ |
| D6 Readable failures | ★★☆ | ★★★ | ★★☆ |

### Conventions

* **Runner:** `cargo test --workspace --locked`, the built-in harness. Async tests use `#[tokio::test]`.
* **Where tests live:** domain tests in `backend/crates/calendar-domain/tests/`, API integration tests in `backend/crates/calendar-api/tests/`, infrastructure tests beside their crate. A test keeps the name of the C# test it ports, in snake case (`method_state_expected`).
* **Assertions:** `assert!`, `assert_eq!` and `assert!(matches!(…))` from the standard library, with a message where the values alone do not explain the failure. No assertion library.
* **Test doubles:** no mocking library. A dependency that tests replace (the clock, the Google token exchange) is a trait or a handle in the application state, and the test supplies a small hand-written implementation.
* **Clock:** the application state holds an injectable clock. Handlers and repositories take the time from it; the domain takes `now` as an argument. Tests set a fixed instant, as `FakeTimeProvider` did.
* **Database:** `calendar-testing` starts PostgreSQL with Testcontainers, using the same image tag as `compose.yaml`, creates the two roles, applies the embedded migrations as `calendar_migrator` and hands tests a pool that connects as `calendar_app`. Tests never touch the shared Compose database. Each test gets data no other test can see.
* **HTTP tests:** the test builds the same `Router` the binary serves, with the test pool and clock, and sends requests to it inside the test process. No test starts the compiled binary or depends on a fixed port. The image smoke test (`just image smoke`) stays the only test of the built artifact.
* **Sign-in in tests:** through the Development seed key or a fake of the Google exchange, as the C# tests did, never through Google.

### Effect on earlier records

These edits were made when this record was accepted, on 2026-11-11.

* **[ADR-0007](0007-backend-testing-stack.md)** becomes `superseded by` this record. Its architecture-model entry gets a `note`: the repo tools keep xUnit v3 file-based test apps, which [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) decides for itself.
* **[ADR-0016](0016-local-database-provisioning.md)** stands. Its mention of `Testcontainers.PostgreSql` and an xUnit assembly fixture gets a dated amendment naming the Rust crate and `calendar-testing`.

### Consequences

* Good, because a reviewer can read a C# test and its Rust port side by side.
* Good, because the test stack adds two dependencies (Testcontainers and its PostgreSQL module) and no tool.
* Bad, because code coverage is lost unless a tool is added: the .NET CI job collected Cobertura coverage, and `cargo test` collects none.
* Bad, because standard assertion failures are terser than Shouldly's, which quoted the source expression.
* Bad, because the built-in harness has no assembly fixture: each test binary manages its own container, so how containers and databases are shared decides both run time and isolation, and that is left to `calendar-testing`.
* Neutral, because C# tests that exercised EF Core or ASP.NET internals have no Rust counterpart; the code pull request lists each one with the reason.

### Confirmation

* CI's backend job runs `cargo test --workspace --locked` with Docker available, on every pull request that changes the backend ([ADR-0046](0046-run-ci-jobs-only-for-the-paths-they-check.md)).
* The code pull request carries a table that maps every C# test class to its Rust test file and names every case that was not ported.
* A lint bans direct clock reads in production code ([ADR-0055](0055-rust-static-analysis-and-formatting.md)).
* The run-time gate of [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) gets a new baseline for the backend job.

## Pros and Cons of the Options

### cargo test, standard assertions, hand-written fakes, Testcontainers, in-process axum tests

* Good, because **D1 Faithful port**: an in-process test controls the state the handler sees, as `WebApplicationFactory` tests did, so each case ports directly.
* Good, because **D2 Real PostgreSQL**: every database test runs on the pinned image after the real migrations.
* Good, because **D3 Deterministic time**: the test owns the clock in the application state.
* Good, because **D4 Low friction**: the runner and assertions ship with the toolchain.
* Neutral, because **D5 Speed and isolation**: tests in one binary run in parallel threads, but test binaries run one after another, and each starts its own container unless the helper shares one.
* Neutral, because **D6 Readable failures**: `assert_eq!` prints both values; anything richer is a hand-written message.

### The same libraries run by cargo-nextest

* Good, because **D1 Faithful port**, **D2 Real PostgreSQL** and **D3 Deterministic time**: the tests are the same.
* Good, because **D5 Speed and isolation**: each test runs in its own process, in parallel across binaries, with retries and timeouts per test.
* Good, because **D6 Readable failures**: clearer per-test output and JUnit reports.
* Bad, because **D4 Low friction**: a tool to install and pin in CI and locally, outside `rust-toolchain.toml`; a process per test also means a container per test unless the helper is redesigned.

### Black-box HTTP tests against the built binary, with Testcontainers

* Good, because **D2 Real PostgreSQL**: the same database.
* Neutral, because **D4 Low friction**: no test-only wiring inside the application, but process and port management in every test.
* Neutral, because **D6 Readable failures**: assertions are the same; a crash in the server shows up as a failed request.
* Bad, because **D1 Faithful port**: the C# tests replace services inside the host; a black-box test cannot, so those cases would change shape or be dropped.
* Bad, because **D3 Deterministic time**: the binary's clock can be set only through a test-only switch in production code.
* Bad, because **D5 Speed and isolation**: a process start and a port per test or per file.

## More Information

* **Versions** resolved in the code branch's `Cargo.lock` on 2026-11-11: testcontainers 0.27.3, testcontainers-modules 0.15.0. Read from the lock file, not re-checked against crates.io.
* **Not verified:** the run time of the Rust suite against the .NET suite; how many containers a full run starts.
* **Revisit when** the backend job's run time regresses against its gate or tests interfere with each other: adopt cargo-nextest then. Revisit coverage when the maintainer answers question 1.
* **Resolved at acceptance, 2026-11-11:** backend coverage is kept: the maintainer chose `cargo-llvm-cov`, which CI installs at a pinned version and runs the tests under, uploading a Cobertura report. `calendar-testing` starts one container per test process (so one per test binary) and gives each test its own database cloned from a migrated template.
