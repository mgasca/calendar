---
status: accepted
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# rustfmt and Clippy with warnings denied for the Rust backend

## Context and Problem Statement

[ADR-0009](0009-static-analysis-and-formatting.md) enforces .NET quality at build time with Roslyn and Sonar analyzers and warnings as errors, and [ADR-0036](0036-csharp-layout-rules-with-stylecop-and-sonar.md) adds layout rules, a 140-character line limit and a ban on reading the system clock. Those tools check C#. The backend moves to Rust ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), and agents still write most of the code, so automated checks remain the main gate before review. Which formatter and lints does the Rust backend use, and how strict are they?

## Decision Drivers

* **D1 Bug-finding depth**: catches real defects (ignored results, lossy casts, needless clones, blocking calls in async code), not only style.
* **D2 Local and CI parity**: the same checks with the same results on a developer's machine and in CI.
* **D3 Fast feedback**: quick enough to run on every build.
* **D4 No style debate**: formatting is automatic and deterministic.
* **D5 Low setup and maintenance**: few tools, little configuration, mainstream defaults.
* **D6 Guards carried over**: the rules [ADR-0036](0036-csharp-layout-rules-with-stylecop-and-sonar.md) added keep an equivalent: the line limit and the ban on direct clock reads.

## Considered Options

* rustfmt, and Clippy's default and pedantic groups with warnings denied
* rustfmt, and Clippy's default group only
* The chosen set plus selected restriction lints (`unwrap_used`, `expect_used`, `panic`, `indexing_slicing`, `missing_docs`)

## Decision Outcome

Chosen option: "rustfmt, and Clippy's default and pedantic groups with warnings denied", because it gives the deepest checking available from the pinned toolchain alone (D1, D5), runs identically everywhere because the toolchain is pinned (D2), and rustfmt settles layout, including the line limit, by rewriting the code (D4, D6).

| Driver | **rustfmt, Clippy default and pedantic, warnings denied (chosen)** | rustfmt, Clippy default only | Chosen set plus restriction lints |
| --- | :---: | :---: | :---: |
| D1 Bug-finding depth | ★★☆ | ★☆☆ | ★★★ |
| D2 Local and CI parity | ★★★ | ★★★ | ★★★ |
| D3 Fast feedback | ★★☆ | ★★★ | ★★☆ |
| D4 No style debate | ★★★ | ★★★ | ★★★ |
| D5 Low setup and maintenance | ★★☆ | ★★★ | ★☆☆ |
| D6 Guards carried over | ★★★ | ★★☆ | ★★★ |

### Conventions

* **Lints**, in `[workspace.lints]` of `backend/Cargo.toml`, inherited by every crate with `[lints] workspace = true`:
  * `unsafe_code = "forbid"` and `warnings = "deny"` for rustc;
  * `clippy::all` at `deny`;
  * `clippy::pedantic` at `warn`; the lint command passes `-D warnings`, so these fail it too. Four pedantic lints are allowed workspace-wide because they ask for documentation and attributes this code base does not write: `module_name_repetitions`, `missing_errors_doc`, `missing_panics_doc`, `must_use_candidate`.
* **Suppressions:** any other lint is silenced at the narrowest scope with `#[expect(clippy::name, reason = "…")]`. A suppression without a reason is rejected in review, as [ADR-0009](0009-static-analysis-and-formatting.md) required.
* **Formatting:** `backend/rustfmt.toml` sets `max_width = 140` and `tab_spaces = 2`, the limit and indent the C# code used. `just backend format` runs `cargo fmt --all`; lint and CI run `cargo fmt --all --check`.
* **Clock ban:** `backend/clippy.toml` lists `chrono::Utc::now`, `chrono::Local::now`, `std::time::SystemTime::now` and `std::time::Instant::now` under `disallowed-methods`, each with a reason that points to the injected clock ([ADR-0057](0057-chrono-time-types-for-the-rust-backend.md)). The one implementation of the system clock carries the only `#[expect]`. This replaces `BannedSymbols.txt`.
* **Commands:** `just backend lint` and CI run `cargo fmt --all --check` and `cargo clippy --workspace --all-targets --locked -- -D warnings`. Tests are linted with the same rules as production code.
* **Scope:** the Rust workspace under `backend/`. The .NET repo tools and the TypeScript code keep their rules.

### Effect on earlier records

These edits were made when this record was accepted, on 2026-11-11.

* **[ADR-0009](0009-static-analysis-and-formatting.md)** stays `accepted` and gets a dated amendment bullet: its TypeScript half is untouched, and its .NET half now applies only to the repo tools ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)). It is amended, not superseded, because both of its chosen options stand for the code they still cover. [ADR-0014](0014-postgresql-database-engine.md) is the precedent for the other route (superseded, with a model `note` for what still stands); that route fits a record whose chosen option was partly withdrawn, which is not the case here.
* **[ADR-0036](0036-csharp-layout-rules-with-stylecop-and-sonar.md)** stays `accepted` and gets a dated amendment bullet: the layout rules apply to the repo tools' C#; the banned-API analyzer, which ran only on `backend/src`, is replaced for the backend by the Clippy list above; the `Migrations/.editorconfig` exception goes with the EF migrations.

### Consequences

* Good, because long lines are rewrapped by the formatter; under [ADR-0036](0036-csharp-layout-rules-with-stylecop-and-sonar.md) they were reported and wrapped by hand.
* Good, because the lints, the formatter and their versions come from one pinned toolchain ([ADR-0053](0053-cargo-workspace-dependency-management.md)), with no analyzer packages to version.
* Bad, because nothing replaces Sonar's rule set; Clippy's pedantic group is the nearest equivalent and is smaller.
* Bad, because public items no longer need documentation comments: CS1591 made them mandatory in C#, and `missing_docs` is not enabled here.
* Bad, because pedantic lints produce findings that are matters of taste; each costs a fix or a reasoned suppression.
* Bad, because a toolchain bump can add lints and fail the build until the new findings are fixed. The bump is its own pull request for that reason.
* Neutral, because CodeQL's coverage of the backend changes with the language ([ADR-0012](0012-ci-and-dependency-updates.md)); that is decided with the CI changes, not here.

### Confirmation

* CI's backend job runs `cargo fmt --all --check` and `cargo clippy --workspace --all-targets --locked -- -D warnings` and fails on any finding; `just lint` runs the same commands.
* A direct call to `Utc::now()` outside the system clock implementation fails Clippy.
* Code review checks that every `#[expect]` or `#[allow]` has a reason.

## Pros and Cons of the Options

### rustfmt, and Clippy's default and pedantic groups with warnings denied

* Good, because **D1 Bug-finding depth**: the default group covers correctness and suspicious code; pedantic adds lossy casts, needless passes by value and similar findings.
* Good, because **D2 Local and CI parity**: `rustfmt` and `clippy` are components of the pinned toolchain, so every machine runs the same version.
* Good, because **D4 No style debate**: rustfmt has few options and two are set.
* Good, because **D6 Guards carried over**: `max_width` replaces S103, and `disallowed-methods` replaces the banned clock APIs.
* Neutral, because **D3 Fast feedback**: Clippy costs about one extra check build; it does not run on a plain `cargo build`, unlike Roslyn analyzers.
* Neutral, because **D5 Low setup and maintenance**: three small files, but pedantic needs a short allow list and occasional suppressions.

### rustfmt, and Clippy's default group only

* Good, because **D3 Fast feedback** and **D5 Low setup and maintenance**: the defaults, with no allow list.
* Good, because **D2 Local and CI parity** and **D4 No style debate**: the same tools.
* Neutral, because **D6 Guards carried over**: the line limit and the clock ban still work, since both are configuration, not pedantic lints.
* Bad, because **D1 Bug-finding depth**: the default group leaves out the pedantic findings, as "Roslyn only" left out Sonar's in [ADR-0009](0009-static-analysis-and-formatting.md).

### The chosen set plus selected restriction lints

* Good, because **D1 Bug-finding depth**: forbids panicking shortcuts (`unwrap`, `expect`, indexing) in request paths and makes documentation mandatory again.
* Good, because **D2 Local and CI parity**, **D4 No style debate** and **D6 Guards carried over**: the same as the chosen option.
* Neutral, because **D3 Fast feedback**: the same run time.
* Bad, because **D5 Low setup and maintenance**: Clippy's own documentation says restriction lints are not meant to be enabled as a group; each one needs a decision, and tests need blanket exceptions for `unwrap` and `expect`.

## More Information

* **Toolchain** pinned in the code branch on 2026-11-11: Rust 1.99.1 with the `rustfmt` and `clippy` components.
* **State of the code branch on 2026-11-11:** `backend/Cargo.toml` and `backend/rustfmt.toml` are as described. `backend/clippy.toml` with the clock ban does not exist yet; adding it is part of delivering this record.
* **Not verified:** how many pedantic findings the ported code produces, and Clippy's run time on the full workspace.
* **Revisit when** a panic from `unwrap` or indexing reaches a deployed environment: enable those restriction lints for non-test code then.
* **Resolved at acceptance, 2026-11-11:** [ADR-0009](0009-static-analysis-and-formatting.md) and [ADR-0036](0036-csharp-layout-rules-with-stylecop-and-sonar.md) are amended, not superseded.
* **Still open:** whether public items must be documented (`missing_docs`), as CS1591 required. It is not enabled today.
