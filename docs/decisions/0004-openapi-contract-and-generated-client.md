---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# OpenAPI document as the API contract, with a generated TypeScript client

## Context and Problem Statement

Several clients will call the backend: the web UI now, and later mobile, desktop and CLI / third-party integrations, possibly in different languages. How do we define the API contract and keep clients in sync? Which TypeScript client generator should the TS UIs use?

## Decision Drivers

* **D1 Breaking-change detection**: client builds fail at compile time when the API changes incompatibly.
* **D2 Language-neutral contract**: one source of truth usable by any client language and by third-party integrators.
* **D3 Low maintenance**: no hand-maintained DTOs or request code that can drift.
* **D4 Reviewable API changes**: API changes are visible as diffs in code review.
* **D5 Backend simplicity**: the server stays idiomatic ASP.NET Core with no extra codegen or runtime.
* **D6 Client footprint**: a small runtime and bundle in the browser and on mobile.

## Considered Options

### Contract approach

* Code-first OpenAPI generated at build time and committed to `contracts/`
* Contract-first: a hand-written OpenAPI document, with server stubs generated
* No contract: hand-written TypeScript types and fetch calls
* gRPC (+ gRPC-Web)
* GraphQL

### TypeScript client generator

* openapi-typescript + openapi-fetch
* orval (generates TanStack Query hooks)
* NSwag / openapi-generator (generate full client classes)

## Decision Outcome

**Contract:** "Code-first OpenAPI generated at build time and committed", because it gives a language-neutral, reviewable contract (D2, D4) with the least backend effort (D5).

| Driver | **Code-first OpenAPI, committed (chosen)** | Contract-first OpenAPI | Hand-written TS types | gRPC (+ gRPC-Web) | GraphQL |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Breaking-change detection | ★★★ | ★★★ | ☆☆☆ | ★★★ | ★★★ |
| D2 Language-neutral | ★★★ | ★★★ | ☆☆☆ | ★★☆ | ★★☆ |
| D3 Low maintenance | ★★★ | ★★☆ | ☆☆☆ | ★★★ | ★★☆ |
| D4 Reviewable | ★★★ | ★★★ | ★☆☆ | ★★★ | ★★★ |
| D5 Backend simplicity | ★★★ | ★☆☆ | ★★★ | ★☆☆ | ★☆☆ |

**Generator:** "openapi-typescript + openapi-fetch", because types-only generation is the smallest client (D6) and keeps generated code trivial to maintain (D3).

| Driver | **openapi-typescript + openapi-fetch (chosen)** | orval | NSwag / openapi-generator |
| --- | :---: | :---: | :---: |
| D1 Breaking-change detection | ★★★ | ★★★ | ★★☆ |
| D3 Low maintenance | ★★★ | ★★☆ | ★☆☆ |
| D6 Client footprint | ★★★ | ★★☆ | ★☆☆ |

Implementation:

* `Microsoft.AspNetCore.OpenApi` + `Microsoft.Extensions.ApiDescription.Server` write `contracts/openapi.json` on every API build.
* `@calendar/api-client` (`frontend/packages/api-client`) generates `schema.gen.ts` with openapi-typescript, and `openapi-fetch` provides a typed `fetch` wrapper (~6 kB).
* Generated files are **committed**. `just contracts` regenerates both.

### Consequences

* Good, because any future client (Swift, Kotlin, C#, CLI) can generate from `contracts/openapi.json`, and third parties can consume it directly.
* Bad, because the generated files can go stale. CI fails if the backend build changes `contracts/` (`git diff --exit-code`).
* Note: `openapi-fetch` captures `globalThis.fetch` when the client is created, so the web app passes a late-bound `fetch` to let MSW intercept requests in tests.
* Note: openapi-typescript 7.x declares a TypeScript ^5 peer. It works with TS 6, and the peer warning is accepted ([ADR-0010](0010-toolchain-version-pins.md)).

### Confirmation

The CI backend job checks that `contracts/` is unchanged after the build, and frontend `typecheck` fails on contract-breaking changes.

## Pros and Cons of the Options

### Code-first OpenAPI, committed

* Good, because **D1 Breaking-change detection**: regenerated types make client compilation fail on incompatible changes.
* Good, because **D2 Language-neutral**: OpenAPI 3.1 has generators for virtually every language.
* Good, because **D3 Low maintenance**: the contract is derived from code, so it can't drift.
* Good, because **D4 Reviewable**: `contracts/openapi.json` diffs appear in PRs.
* Good, because **D5 Backend simplicity**: built into ASP.NET Core 10; one MSBuild package.
* Bad, because **D2 Language-neutral**: the contract's quality depends on endpoint annotations (`TypedResults`, `WithName`, `Produces`), so sloppy endpoints produce vague schemas.

### Contract-first OpenAPI

* Good, because **D1**, **D2**, **D4**: same contract benefits; the API is designed before it's implemented.
* Bad, because **D5 Backend simplicity**: needs server stub generation (e.g. NSwag) or manual conformance testing; fights minimal-API idioms.
* Bad, because **D3 Low maintenance**: two artifacts (spec and code) to keep aligned.

### Hand-written TypeScript types

* Good, because **D5 Backend simplicity**: nothing to set up on the server.
* Bad, because **D1 Breaking-change detection**: drift is only found at runtime.
* Bad, because **D2 Language-neutral**: each client re-declares the API by hand.
* Bad, because **D3 Low maintenance**: every API change must be mirrored manually in every client.

### gRPC (+ gRPC-Web)

* Good, because **D1**, **D3**, **D4**: `.proto` files are a strict, reviewable contract with codegen.
* Bad, because **D5 Backend simplicity**: browsers need gRPC-Web or JSON transcoding, and a proxy or extra middleware.
* Bad, because **D2 Language-neutral**: fine for first-party clients, but third-party integrators expect REST/JSON.

### GraphQL

* Good, because **D1**, **D4**: a typed schema with codegen.
* Bad, because **D5 Backend simplicity**: needs a GraphQL server (e.g. Hot Chocolate), resolvers, and N+1/complexity controls.
* Bad, because **D3 Low maintenance**: caching and authorization per field add ongoing work.
* Neutral, because **D2 Language-neutral**: widely supported, but less universal than REST for integrations.

### openapi-typescript + openapi-fetch

* Good, because **D6 Client footprint**: types only, with a ~6 kB runtime.
* Good, because **D3 Low maintenance**: the generated file is pure types with no custom templates.
* Good, because **D1 Breaking-change detection**: paths, params and bodies are all type-checked.
* Bad, because **D3 Low maintenance**: TanStack Query hooks are written by hand (thin wrappers).

### orval

* Good, because **D3 Low maintenance**: generates TanStack Query hooks and MSW mocks.
* Bad, because **D6 Client footprint**: generates per-endpoint functions and hooks, so more code is shipped.
* Bad, because **D3 Low maintenance**: more generated code to review, plus config and templates to maintain.

### NSwag / openapi-generator

* Good, because **D1 Breaking-change detection**: full typed client classes.
* Bad, because **D6 Client footprint**: large generated classes, sometimes with axios or other runtime dependencies.
* Bad, because **D3 Low maintenance**: generated code is verbose, and templates or config often need tuning.
