---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Single repository with per-stack top-level directories

## Context and Problem Statement

The project starts with a .NET backend and a web UI, and other UIs (e.g. mobile or desktop) may follow. How should the source be organized?

## Decision Drivers

* The backend API and its clients change together, so API changes should be atomic.
* Each stack should keep its native conventions and tooling.
* Adding a new UI should not require restructuring.

## Considered Options

* Monorepo with top-level `backend/`, `frontend/` and `contracts/` directories
* Monorepo with a flat `src/` mixing all languages
* Separate repositories per component

## Decision Outcome

Chosen option: "Monorepo with top-level `backend/`, `frontend/` and `contracts/`", because it keeps cross-cutting changes in one commit while letting each stack own its directory and native tooling (`dotnet` in `backend/`, `pnpm` in `frontend/`).

* `backend/` holds the .NET solution, with `src/` and `tests/` mirrored one-to-one (`Calendar.X` → `Calendar.X.Tests`).
* `frontend/` is a pnpm workspace: `apps/` for deployable UIs and `packages/` for shared libraries.
* `contracts/` holds language-neutral artifacts shared across stacks (see ADR-0004).
* Repo-wide settings (`.editorconfig`, `.gitattributes`, `.gitignore`, CI) live at the root.

### Consequences

* Good, because a new TypeScript UI is just `frontend/apps/<name>`. A non-TS UI (e.g. .NET MAUI, Swift) gets its own top-level directory and uses `contracts/`.
* Good, because CI can run per-stack jobs in parallel.
* Bad, because root-level commands must `cd` into each stack. `dotnet` resolves `global.json` from the working directory, so running from the root misses the SDK pin and test-runner setting. The root `Makefile` (ADR-0011) handles this.

## Pros and Cons of the Options

### Flat `src/` with all languages

* Bad, because .NET and Node tooling would both have to be configured to ignore each other's files.

### Separate repositories

* Good, because each component has independent access control and release cadence.
* Bad, because API changes need coordinated multi-repo PRs and version pinning of the contract.
