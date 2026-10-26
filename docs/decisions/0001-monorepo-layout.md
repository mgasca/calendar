---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Single repository with per-stack top-level directories

## Context and Problem Statement

The project starts with a .NET backend and a web UI. Mobile apps, a desktop app, and CLI / third-party integrations are expected later. How should the source be organized?

## Decision Drivers

* **D1 Atomic cross-stack changes**: an API change and its client updates should land in one reviewed commit.
* **D2 Native per-stack tooling**: each stack keeps its standard conventions (`dotnet` solution, pnpm workspace), so IDEs, docs and Dependabot work unmodified.
* **D3 Room for new UIs**: adding a mobile, desktop or CLI client should not require restructuring.
* **D4 Agent context**: code is mostly written by AI agents, so a single checkout should expose the whole system (API, contract, clients, decisions).
* **D5 CI simplicity**: per-stack jobs that can run in parallel without bespoke orchestration.

## Considered Options

* Monorepo with top-level `backend/`, `frontend/` and `contracts/` directories
* Monorepo with a flat `src/` mixing all languages
* Separate repositories per component (polyrepo)
* Monorepo managed by Nx (all stacks as Nx projects, including .NET via plugin)

## Decision Outcome

Chosen option: "Monorepo with top-level `backend/`, `frontend/` and `contracts/`", because it gives atomic changes (D1) and full agent context (D4) while letting each stack keep its native tooling (D2).

| Driver | **Per-stack top-level dirs (chosen)** | Flat `src/` | Polyrepo | Nx-managed monorepo |
| --- | :---: | :---: | :---: | :---: |
| D1 Atomic changes | ★★★ | ★★★ | ☆☆☆ | ★★★ |
| D2 Native tooling | ★★★ | ★☆☆ | ★★★ | ★☆☆ |
| D3 Room for new UIs | ★★★ | ★★☆ | ★★☆ | ★★★ |
| D4 Agent context | ★★★ | ★★★ | ★☆☆ | ★★★ |
| D5 CI simplicity | ★★★ | ★☆☆ | ★★☆ | ★★☆ |

Layout:

* `backend/` holds the .NET solution, with `src/` and `tests/` mirrored one-to-one (`Calendar.X` → `Calendar.X.Tests`).
* `frontend/` is a pnpm workspace: `apps/` for deployable TS UIs, `packages/` for shared libraries.
* `contracts/` holds language-neutral artifacts shared across stacks ([ADR-0004](0004-openapi-contract-and-generated-client.md)).
* Repo-wide settings (`.editorconfig`, `.gitattributes`, `.gitignore`, `.github/`) live at the root.
* Future non-TypeScript clients (e.g. native mobile or a .NET desktop/CLI app) get their own top-level directory, or go under `backend/src` for .NET tools, and consume `contracts/`.

### Consequences

* Good, because a new TS UI (e.g. React Native or Electron) is just `frontend/apps/<name>` and reuses `@calendar/api-client`.
* Bad, because `dotnet` resolves `global.json` from the working directory, so root-level commands must `cd backend`. The root `Makefile` ([ADR-0011](0011-make-as-top-level-task-runner.md)) handles this.
* Neutral: Nx or Turborepo caching can be added inside `frontend/` later without changing the layout.

### Confirmation

The directory structure is visible in the README layout section. Reviewers reject PRs that put one stack's files inside another stack's directory.

## Pros and Cons of the Options

### Per-stack top-level directories

* Good, because **D1 Atomic changes**: backend, contract and clients change in one PR.
* Good, because **D2 Native tooling**: `backend/` is a standard .NET solution and `frontend/` a standard pnpm workspace.
* Good, because **D3 Room for new UIs**: new clients slot into `frontend/apps/` or a new top-level directory, and all consume `contracts/`.
* Good, because **D4 Agent context**: one checkout contains API, contract, clients and ADRs.
* Good, because **D5 CI simplicity**: one job per directory, run in parallel.
* Bad, because **D2 Native tooling**: root-level commands must `cd` into each stack (mitigated by the Makefile).

### Flat `src/` mixing languages

* Good, because **D1 Atomic changes** and **D4 Agent context**: same as above.
* Bad, because **D2 Native tooling**: .NET and Node tooling would each have to be configured to ignore the other's files (globs, `node_modules` under .NET folders, `bin/obj` under TS folders).
* Bad, because **D5 CI simplicity**: path filters per stack are harder to express.
* Neutral, because **D3 Room for new UIs**: possible but the folder becomes crowded.

### Polyrepo

* Good, because **D2 Native tooling**: each repo is a pure single-stack project.
* Bad, because **D1 Atomic changes**: API changes need coordinated multi-repo PRs and versioned contract publishing.
* Bad, because **D4 Agent context**: an agent working on a client cannot see the server code or ADRs.
* Neutral, because **D3 Room for new UIs** and **D5 CI simplicity**: a new repo per UI is easy, but cross-repo integration testing is harder.

### Nx-managed monorepo

* Good, because **D1**, **D3**, **D4**: same as the chosen option, plus a project graph and task caching.
* Bad, because **D2 Native tooling**: .NET support is via a community plugin; developers and agents must learn Nx conventions on top of `dotnet` and pnpm.
* Bad, because **D5 CI simplicity**: Nx affected/caching setup is powerful but more to configure and debug for two projects.

## More Information

* Revisit if the number of frontend apps makes Turborepo/Nx task caching worthwhile (can be added within `frontend/` only).
