---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Static analysis and formatting enforced at build time

## Context and Problem Statement

How do we enforce code quality and a consistent style in both languages, locally and in CI?

## Decision Drivers

* Failures should be the same locally and in CI.
* Problems should be caught at compile or lint time rather than in review.
* There should be minimal style debate.

## Decision Outcome

**Backend (.NET)**

* `Nullable` enabled, `TreatWarningsAsErrors`, `AnalysisLevel=latest-recommended`, `EnforceCodeStyleInBuild`
* **SonarAnalyzer.CSharp** for additional bug and code-smell rules, running in every build
* Style lives in `.editorconfig`, checked with `dotnet format --verify-no-changes`
* `GenerateDocumentationFile` is on (needed for IDE0005 unused-usings detection), with CS1591 suppressed so XML docs are encouraged but not mandatory

**Frontend (TypeScript)**

* `tsconfig.base.json` uses `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`.
* **ESLint** (flat config at `frontend/eslint.config.js`) uses typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` (type-aware, via `projectService`), react-hooks, react-refresh, and **jsx-a11y**, with `--max-warnings=0`.
* **Prettier** handles formatting, and `eslint-config-prettier` turns off conflicting lint rules.
* The Vite template's default linter, **oxlint**, was replaced. It's much faster, but ESLint's type-aware typescript-eslint rules and jsx-a11y are more complete today.

### Consequences

* Good, because whole bug classes (null derefs, floating promises, a11y violations) fail the build.
* Bad, because strict rules occasionally need targeted suppressions, which should include a reason.

### Confirmation

`make lint` locally. CI runs the same checks as separate steps.
