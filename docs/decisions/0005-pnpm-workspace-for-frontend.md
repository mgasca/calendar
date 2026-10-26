---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# pnpm workspaces for frontend packages

## Context and Problem Statement

The frontend already has two packages (the web app and the API client) and will gain more TS UIs (e.g. React Native, Electron) and shared libraries. Which package manager and workspace tool should we use?

## Decision Drivers

* **D1 Dependency correctness**: a package can only import what it declares; no phantom dependencies.
* **D2 Reproducibility**: the exact package-manager version and a lockfile are enforced locally and in CI.
* **D3 Workspace support**: first-class local package linking and filtered or recursive commands.
* **D4 Speed and disk use**: fast installs and CI caching.
* **D5 Ecosystem compatibility**: works with Vite, Vitest, ESLint, Dependabot, GitHub Actions, and future React Native/Expo apps.

## Considered Options

* pnpm workspaces
* npm workspaces
* Yarn Berry (Plug'n'Play)
* Bun workspaces

## Decision Outcome

Chosen option: "pnpm workspaces", because its strict `node_modules` layout guarantees dependency correctness (D1), and Corepack pinning makes installs reproducible (D2). It also matches or beats the alternatives on workspaces and speed (D3, D4).

| Driver | **pnpm (chosen)** | npm workspaces | Yarn Berry (PnP) | Bun workspaces |
| --- | :---: | :---: | :---: | :---: |
| D1 Dependency correctness | ★★★ | ★☆☆ | ★★★ | ★☆☆ |
| D2 Reproducibility | ★★★ | ★★☆ | ★★★ | ★★☆ |
| D3 Workspace support | ★★★ | ★★☆ | ★★★ | ★★☆ |
| D4 Speed & disk | ★★★ | ★☆☆ | ★★★ | ★★★ |
| D5 Ecosystem compatibility | ★★☆ | ★★★ | ★☆☆ | ★☆☆ |

Implementation:

* pnpm is pinned via `packageManager` (`pnpm@12.15.0`) and provisioned by Corepack. Node is pinned in `frontend/.node-version` (24 LTS).
* Workspace packages are scoped `@calendar/*` and linked with `workspace:*`.
* Internal packages export TypeScript source (`"exports": "./src/index.ts"`) with no build step, because consumers bundle with Vite.
* `pnpm-lock.yaml` is committed. CI uses `--frozen-lockfile`.

### Consequences

* Good, because undeclared imports fail immediately instead of breaking in production or another package.
* Bad, because contributors must run `corepack enable` (or install pnpm) once.
* Bad, because React Native tooling may need `node-linker=hoisted` for the mobile app's workspace. Decide when the mobile app is added.

### Confirmation

CI's `pnpm install --frozen-lockfile` fails if the lockfile is out of date. `pnpm/action-setup` reads the pinned version from `package.json`.

## Pros and Cons of the Options

### pnpm workspaces

* Good, because **D1 Dependency correctness**: symlinked, non-flat `node_modules` blocks phantom dependencies.
* Good, because **D2 Reproducibility**: `packageManager` plus Corepack give everyone the same pnpm version.
* Good, because **D3 Workspace support**: `--filter`, `-r` and the `workspace:` protocol are first-class.
* Good, because **D4 Speed & disk**: a content-addressed global store with hard links.
* Bad, because **D5 Ecosystem compatibility**: some tools (historically React Native's Metro) assume a flat `node_modules`; this is mitigated by `node-linker=hoisted` per need.

### npm workspaces

* Good, because **D5 Ecosystem compatibility**: ships with Node, and every tool supports it.
* Bad, because **D1 Dependency correctness**: hoisted, flat `node_modules` allows phantom dependencies.
* Bad, because **D4 Speed & disk**: slower installs and no shared store.
* Neutral, because **D2**, **D3**: has a lockfile and basic workspaces, but weaker filtering.

### Yarn Berry (Plug'n'Play)

* Good, because **D1 Dependency correctness**: PnP is strict.
* Good, because **D2**, **D3**, **D4**: Corepack-pinned, strong workspaces, zero-install possible.
* Bad, because **D5 Ecosystem compatibility**: PnP breaks tools that resolve from `node_modules` and needs editor SDKs; React Native requires falling back to `nodeLinker: node-modules`.

### Bun workspaces

* Good, because **D4 Speed & disk**: very fast installs.
* Bad, because **D1 Dependency correctness**: hoisted layout by default.
* Bad, because **D5 Ecosystem compatibility**: less mature with Dependabot and some Node tooling; also a second runtime alongside Node.
* Neutral, because **D2**, **D3**: has a lockfile and workspaces, with less filtering than pnpm.

## More Information

* Nx or Turborepo can be layered on top for task caching if the number of packages grows (see [ADR-0001](0001-monorepo-layout.md)).
