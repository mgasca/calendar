---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Pin TypeScript 6.0 and ESLint 9 for ecosystem compatibility

## Context and Problem Statement

The latest TypeScript (7.0, the native Go port) and ESLint (10) were not supported by key tools when the project was created. Which versions should we use?

## Decision Drivers

* `typescript-eslint` 8.72 supports `typescript >=4.8.4 <6.1.0`.
* `eslint-plugin-jsx-a11y` 6.10 supports ESLint up to 9.

## Considered Options

* Pin TypeScript `~6.0` and ESLint `^9`
* Use the latest versions and drop type-aware linting and a11y linting
* Switch to oxlint

## Decision Outcome

Chosen option: "Pin TypeScript `~6.0` and ESLint `^9`", which keeps the type-aware linting and a11y linting from ADR-0009. It matches what the official Vite React template pins (`typescript ~6.0`).

### Consequences

* Good, because there are no unmet peer dependencies except a benign `openapi-typescript` (wants TS ^5) warning. It works fine with TS 6.
* Bad, because we miss TS 7's faster compiler for now.
* Revisit when typescript-eslint supports TS 7 and jsx-a11y supports ESLint 10. Dependabot PRs will surface this.
