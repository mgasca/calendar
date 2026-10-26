---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# pnpm workspaces for frontend packages

## Context and Problem Statement

The frontend already has two packages (the web app and the API client) and will gain more UIs and shared libraries. Which package manager and workspace tool should we use?

## Considered Options

* pnpm workspaces
* npm workspaces
* Yarn (Berry)
* Nx / Turborepo on top of a package manager

## Decision Outcome

Chosen option: "pnpm workspaces". pnpm is pinned via the `packageManager` field (`pnpm@12.15.0`) and provisioned by Corepack. The Node version is pinned in `frontend/.node-version` (24 LTS).

* Workspace packages are scoped `@calendar/*` and linked with `workspace:*`.
* Internal packages export TypeScript source directly (`"exports": "./src/index.ts"`), with no build step, because consumers bundle with Vite.
* `pnpm-lock.yaml` is committed. CI uses `--frozen-lockfile`.

### Consequences

* Good, because pnpm's strict `node_modules` prevents phantom dependencies, and it's fast with a disk-efficient store.
* Good, because Corepack makes everyone use the exact same pnpm version.
* Bad, because contributors must run `corepack enable` (or install pnpm) once.
* Neutral: Nx or Turborepo can be layered on later if task caching becomes valuable.
