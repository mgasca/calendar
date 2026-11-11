---
status: proposed
date: 2026-11-11
decision-makers: mgasca, Claude (AI assistant)
---

# Cargo workspace dependencies with a committed lock file, locked builds and a pinned toolchain

## Context and Problem Statement

[ADR-0006](0006-dotnet-dependency-management.md) manages the backend's NuGet packages with Central Package Management, a lock file per project and package source mapping. The backend becomes a Cargo workspace ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), where none of those mechanisms exists. How are crate versions and the Rust toolchain declared, locked and kept current across the workspace's crates?

## Decision Drivers

* **D1 Single source of versions**: one place to see and bump each dependency's version, with no drift between crates.
* **D2 Reproducible builds**: the same dependency graph and the same compiler locally, in CI and in the image build.
* **D3 Supply-chain safety**: packages come from the expected registry, their content is checked, and a vulnerable transitive crate can be found and patched.
* **D4 Tooling support**: works with plain `cargo`, editors and Dependabot ([ADR-0012](0012-ci-and-dependency-updates.md)) without extra tools.
* **D5 Low friction**: adding or updating a dependency stays simple.

## Considered Options

* Workspace dependency table, committed `Cargo.lock`, `--locked` in CI, pinned toolchain, Dependabot
* Versions in each crate's `Cargo.toml`, with the committed lock file
* The workspace setup plus cargo-deny in CI

## Decision Outcome

Chosen option: "Workspace dependency table, committed `Cargo.lock`, `--locked` in CI, pinned toolchain, Dependabot", because it is the built-in equivalent of what [ADR-0006](0006-dotnet-dependency-management.md) provided: one version per dependency (D1), a locked graph and compiler (D2), and updates from Dependabot (D4), with no tool beyond `cargo` (D5). It gives up the policy checks of cargo-deny (D3), which stay available as a later addition.

| Driver | **Workspace table, lock file, `--locked`, pinned toolchain (chosen)** | Per-crate versions with the lock file | Workspace setup plus cargo-deny |
| --- | :---: | :---: | :---: |
| D1 Single source of versions | ★★★ | ★☆☆ | ★★★ |
| D2 Reproducible builds | ★★★ | ★★★ | ★★★ |
| D3 Supply-chain safety | ★★☆ | ★★☆ | ★★★ |
| D4 Tooling support | ★★★ | ★★★ | ★★☆ |
| D5 Low friction | ★★☆ | ★★★ | ★☆☆ |

### Conventions

* **Versions:** every third-party dependency is declared once in `[workspace.dependencies]` of `backend/Cargo.toml`, with its features where they are common to all users. Member crates refer to it with `name.workspace = true` and add only crate-specific features. Internal crates are path entries in the same table.
* **Lock file:** `backend/Cargo.lock` is committed. CI, the image build and the `just` recipes pass `--locked`, so a build fails when the lock file does not match the manifests instead of resolving new versions.
* **Registry:** crates.io only. No alternative registry, git dependency or `[patch]` entry without a comment that names the reason and the issue that removes it.
* **Toolchain:** `backend/rust-toolchain.toml` pins an exact Rust release (1.99.1) with the `rustfmt` and `clippy` components. rustup installs it on first use, so `cargo` is the only command a developer or CI needs. `just doctor` reports a missing `cargo`.
* **Updates:** `.github/dependabot.yml` gets a `cargo` entry for `/backend`, weekly, with minor and patch updates grouped, as the `nuget` entry has today. The `nuget` entry for `/backend` and its .NET 11 ignore rules are removed with the C# projects.
* **Shared settings:** workspace-wide package metadata and lints live in `[workspace.package]` and `[workspace.lints]` ([ADR-0055](0055-rust-static-analysis-and-formatting.md)), the counterpart of `Directory.Build.props`.
* **Repo tools:** unchanged. The .NET file-based tools keep their exact NuGet pins and lock files ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)).

### Effect on earlier records, once this record is accepted

None of these edits is made while this record is `proposed`.

* **[ADR-0006](0006-dotnet-dependency-management.md)** becomes `superseded by` this record. Its architecture-model entry gets a `note`, as [ADR-0014](0014-postgresql-database-engine.md)'s has: the repo tools still restore NuGet packages in locked mode from nuget.org under [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md); only the backend's Central Package Management is gone. The planned story card that lists [ADR-0006](0006-dotnet-dependency-management.md) is updated in the same change, because the validator rejects a planned card that cites a superseded record.
* **[ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)** gets a dated amendment: `just tools versions` compared the tools' pins with `backend/Directory.Packages.props`, which no longer exists. The code pull request must give the tools another source of truth for their versions, or drop that check and say how the pins are bumped.
* **[ADR-0010](0010-toolchain-version-pins.md)** is not changed: it decides the TypeScript and ESLint versions only. The Rust pin is decided here.

### Consequences

* Good, because a version bump is one line in one file plus the lock file.
* Good, because the compiler version is part of the repository, so a new Rust release cannot change lints or formatting between two runs of the same commit.
* Bad, because the workspace table is a convention, not a rule Cargo enforces: a crate can still declare its own version. Review and a check keep it (see Confirmation).
* Bad, because nothing here audits licences, duplicate versions or advisories at build time. Dependabot alerts report known vulnerabilities after the fact.
* Bad, because the tools lose the file their versions were matched against.
* Neutral, because whether Dependabot can bump `rust-toolchain.toml` was not verified; until it is, the toolchain is bumped by hand.

### Confirmation

* CI builds, lints and tests with `--locked`; a stale `Cargo.lock` fails the job.
* A check fails when a member crate's `Cargo.toml` gives a third-party dependency a version of its own instead of `workspace = true`. Until that check exists, code review enforces it.
* `just doctor` checks that `cargo` is present; the toolchain file does the rest.
* The dependency review and Dependabot alerts of [ADR-0012](0012-ci-and-dependency-updates.md) are confirmed to read `backend/Cargo.lock` on the code pull request.

## Pros and Cons of the Options

### Workspace dependency table, committed `Cargo.lock`, `--locked` in CI, pinned toolchain, Dependabot

* Good, because **D1 Single source of versions**: `[workspace.dependencies]` plays the role of `Directory.Packages.props`.
* Good, because **D2 Reproducible builds**: the lock file fixes every transitive version and checksum, `--locked` refuses to change it, and the toolchain file fixes the compiler.
* Good, because **D4 Tooling support**: all of it is built into Cargo and rustup; Dependabot has a `cargo` ecosystem.
* Neutral, because **D3 Supply-chain safety**: Cargo resolves from crates.io unless told otherwise and verifies checksums from the lock file, which covers what source mapping did; there is no policy on licences, sources or advisories.
* Bad, because **D5 Low friction**: a new dependency is two edits, the workspace entry and the member's reference, as under Central Package Management.

### Versions in each crate's `Cargo.toml`, with the committed lock file

* Good, because **D5 Low friction**: `cargo add` in a crate is the whole change.
* Good, because **D2 Reproducible builds**: the same lock file and toolchain pin apply.
* Good, because **D4 Tooling support**: the default layout that every tool understands.
* Neutral, because **D3 Supply-chain safety**: the same as the chosen option.
* Bad, because **D1 Single source of versions**: two crates can ask for different versions of one dependency, and Cargo then builds both.

### The workspace setup plus cargo-deny in CI

* Good, because **D1 Single source of versions** and **D2 Reproducible builds**: the same as the chosen option.
* Good, because **D3 Supply-chain safety**: one configured tool checks advisories, licences, allowed sources and duplicate versions on every build.
* Bad, because **D4 Tooling support**: an extra tool to install and pin in CI and locally, outside the toolchain file.
* Bad, because **D5 Low friction**: a policy file to write and maintain, and new failures to triage on unrelated pull requests when an advisory is published.

## More Information

* **Not verified:** Dependabot's handling of `[workspace.dependencies]` and of `rust-toolchain.toml` in this repository; that GitHub's dependency review reads `backend/Cargo.lock`. Each is checked on the code pull request.
* **State of the code branch on 2026-11-11:** `backend/Cargo.toml` has the workspace, the lints and the internal crates in `[workspace.dependencies]`; third-party versions are still declared per crate. Moving them to the workspace table is part of delivering this record.
* **Revisit when** a Dependabot alert shows a vulnerable crate that the build did not flag, or a licence question comes up: add cargo-deny then.
* **Open questions for the reviewer:**
  1. Is the workspace table required, as proposed, or are per-crate versions acceptable while the workspace has five crates?
  2. Where do the repo tools' package versions come from once `backend/Directory.Packages.props` is deleted?
