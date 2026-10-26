---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Pin TypeScript 6.0 and ESLint 9 for ecosystem compatibility

## Context and Problem Statement

When the project was created, the latest TypeScript (7.0, the native Go port) and ESLint (10) were not supported by key tools: `typescript-eslint` 8.72 supports `typescript >=4.8.4 <6.1.0`, and `eslint-plugin-jsx-a11y` 6.10 supports ESLint ≤ 9. Which versions should we use?

## Decision Drivers

* **D1 Keep type-aware and a11y linting**: preserve the lint depth chosen in [ADR-0009](0009-static-analysis-and-formatting.md).
* **D2 Supported combinations**: all tools run within their declared peer ranges; no unsupported configurations.
* **D3 Compiler performance**: faster type checking and builds.
* **D4 Low churn**: avoid tool swaps and config rewrites now that would be undone later.

## Considered Options

* Pin TypeScript `~6.0` and ESLint `^9`
* Use TypeScript 7 and ESLint 10, dropping typescript-eslint type-aware rules and jsx-a11y
* Switch linting to oxlint (which supports newer versions)

## Decision Outcome

Chosen option: "Pin TypeScript `~6.0` and ESLint `^9`", because it is the only option that keeps full lint depth (D1) on supported combinations (D2) without reworking tooling (D4). This matches the official Vite React template, which pins `typescript ~6.0`.

| Driver | **Pin TS ~6.0 + ESLint ^9 (chosen)** | TS 7 + ESLint 10, drop plugins | Switch to oxlint |
| --- | :---: | :---: | :---: |
| D1 Keep linting depth | ★★★ | ☆☆☆ | ★★☆ |
| D2 Supported combinations | ★★☆ | ★★★ | ★★★ |
| D3 Compiler performance | ★★☆ | ★★★ | ★★★ |
| D4 Low churn | ★★★ | ★★☆ | ★☆☆ |

### Consequences

* Good, because every unmet peer dependency is resolved except a benign `openapi-typescript` warning (it wants TS ^5); generation works with TS 6.
* Bad, because we miss TS 7's much faster compiler for now.
* Revisit when typescript-eslint supports TS 7 and jsx-a11y supports ESLint 10. Dependabot major-version PRs will surface this, and they will fail `pnpm install` peer checks or lint until then.

### Confirmation

`pnpm peers check` shows only the known openapi-typescript warning. CI lint and typecheck pass.

## Pros and Cons of the Options

### Pin TS ~6.0 + ESLint ^9

* Good, because **D1 Keep linting depth**: typescript-eslint `strictTypeChecked` and jsx-a11y keep working.
* Good, because **D4 Low churn**: no tool or config changes.
* Bad, because **D2 Supported combinations**: openapi-typescript still declares TS ^5 (works in practice).
* Bad, because **D3 Compiler performance**: the JS-based `tsc` is slower than TS 7's native compiler.

### TS 7 + ESLint 10, drop plugins

* Good, because **D3 Compiler performance**: the native compiler is roughly 10× faster.
* Good, because **D2 Supported combinations**: only tools that support the new versions remain.
* Bad, because **D1 Keep linting depth**: loses type-aware rules and a11y linting, the main bug-finding layer for agent-written code.

### Switch to oxlint

* Good, because **D3 Compiler performance**: fast linting, and the latest TS can be used.
* Good, because **D2 Supported combinations**: no peer-range coupling to TypeScript.
* Bad, because **D4 Low churn**: replaces the ESLint config chosen in [ADR-0009](0009-static-analysis-and-formatting.md).
* Bad, because **D1 Keep linting depth**: type-aware coverage is less complete today ([ADR-0009](0009-static-analysis-and-formatting.md)).
