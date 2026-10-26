---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# OpenAPI document as the API contract, with generated TypeScript client

## Context and Problem Statement

Several UIs, possibly in different languages, will call the backend. How do we keep clients in sync with the API?

## Decision Drivers

* Compile-time detection of breaking API changes in clients
* A single language-neutral source of truth
* No hand-maintained DTO duplication

## Considered Options

* Code-first OpenAPI generated at build time and committed to `contracts/`, plus generated TS types
* Contract-first (hand-written OpenAPI, server stubs generated)
* Hand-written TypeScript types and fetch calls
* GraphQL / gRPC

## Decision Outcome

Chosen option: "Code-first OpenAPI generated at build time", using:

* `Microsoft.AspNetCore.OpenApi` + `Microsoft.Extensions.ApiDescription.Server`, which write `contracts/openapi.json` on every API build.
* `@calendar/api-client` (`frontend/packages/api-client`): `openapi-typescript` generates `schema.gen.ts`, and `openapi-fetch` provides a tiny, fully typed fetch wrapper.
* The generated files are **committed**. `make contracts` regenerates both.

### Consequences

* Good, because API changes show up as diffs to `contracts/openapi.json` in code review.
* Good, because any future client (Swift, Kotlin, C#) can generate from the same file.
* Bad, because the generated files can go stale. CI fails if the backend build changes `contracts/` (`git diff --exit-code`).
* Note: `openapi-fetch` captures `globalThis.fetch` when the client is created, so the web app passes a late-bound `fetch` to let MSW intercept requests in tests.
* Note: `openapi-typescript` 7.x declares a TypeScript ^5 peer. It works with TS 6, and the peer warning is accepted (see ADR-0010).

### Confirmation

The CI backend job checks that `contracts/` is unchanged after the build, and frontend typechecking fails on contract-breaking changes.
