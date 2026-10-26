---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Static analysis and formatting enforced at build time

## Context and Problem Statement

How do we enforce code quality and a consistent style in both languages, locally and in CI? Most code will be written by AI agents, so automated checks are the main quality gate before human review.

## Decision Drivers

* **D1 Bug-finding depth**: catches real defect classes (nullability, async misuse, unsafe `any`, a11y violations), not just style.
* **D2 Local/CI parity**: the same checks, with the same results, run in the build or editor and in CI.
* **D3 Fast feedback**: checks run quickly enough to stay on in every build or save.
* **D4 No style debate**: formatting is automatic and deterministic.
* **D5 Low setup & maintenance**: few tools, little configuration, mainstream defaults.

## Considered Options

### .NET

* Roslyn analyzers (`latest-recommended`) + SonarAnalyzer.CSharp + `dotnet format`, warnings as errors
* Roslyn analyzers only + `dotnet format`
* Roslyn analyzers + StyleCop.Analyzers + `dotnet format`
* Roslyn analyzers + CSharpier (formatter)

### TypeScript

* ESLint (typescript-eslint type-checked, react-hooks, jsx-a11y) + Prettier
* oxlint + Prettier
* Biome (linter and formatter)

## Decision Outcome

**.NET:** "Roslyn + SonarAnalyzer + `dotnet format`, warnings as errors", because Sonar adds substantial bug-finding depth (D1) to analyzers that already run in every build (D2, D3).

| Driver | **Roslyn + Sonar + dotnet format (chosen)** | Roslyn only + dotnet format | Roslyn + StyleCop + dotnet format | Roslyn + CSharpier |
| --- | :---: | :---: | :---: | :---: |
| D1 Bug-finding depth | ★★★ | ★★☆ | ★★☆ | ★★☆ |
| D2 Local/CI parity | ★★★ | ★★★ | ★★★ | ★★★ |
| D3 Fast feedback | ★★☆ | ★★★ | ★★☆ | ★★★ |
| D4 No style debate | ★★☆ | ★★☆ | ★★★ | ★★★ |
| D5 Low setup | ★★★ | ★★★ | ★☆☆ | ★★☆ |

**TypeScript:** "ESLint (type-checked) + Prettier", because type-aware rules and jsx-a11y give the deepest bug finding (D1), and Prettier settles formatting (D4).

| Driver | **ESLint type-checked + Prettier (chosen)** | oxlint + Prettier | Biome |
| --- | :---: | :---: | :---: |
| D1 Bug-finding depth | ★★★ | ★★☆ | ★☆☆ |
| D2 Local/CI parity | ★★★ | ★★★ | ★★★ |
| D3 Fast feedback | ★★☆ | ★★★ | ★★★ |
| D4 No style debate | ★★★ | ★★★ | ★★★ |
| D5 Low setup | ★★☆ | ★★★ | ★★★ |

Implementation:

* **.NET:** `Nullable` enabled, `TreatWarningsAsErrors`, `AnalysisLevel=latest-recommended` and `EnforceCodeStyleInBuild`, all in `Directory.Build.props`. Style lives in `.editorconfig`, checked with `dotnet format --verify-no-changes`. `GenerateDocumentationFile` is on (needed for IDE0005 unused-usings), with CS1591 suppressed.
* **TypeScript:** `tsconfig.base.json` uses `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. ESLint uses a flat config (`strictTypeChecked` + `stylisticTypeChecked` via `projectService`, react-hooks, react-refresh, jsx-a11y) with `--max-warnings=0`. `eslint-config-prettier` turns off conflicting rules.

### Consequences

* Good, because whole bug classes (null derefs, floating promises, a11y violations) fail the build before review.
* Bad, because strict rules occasionally need targeted suppressions, which must include a reason.
* Bad, because type-aware ESLint is the slowest step in `make lint`. Revisit oxlint's type-aware mode as it matures.

### Confirmation

`make lint` runs locally. CI runs the same checks as separate steps ([ADR-0012](0012-ci-and-dependency-updates.md)). The .NET analyzers run on every `dotnet build`.

## Pros and Cons of the Options

### Roslyn + SonarAnalyzer + dotnet format

* Good, because **D1 Bug-finding depth**: Sonar adds hundreds of bug and code-smell rules (e.g. S1118 caught an unnecessary `Program` class).
* Good, because **D2 Local/CI parity**: analyzers are NuGet packages that run inside `dotnet build`, identically everywhere.
* Good, because **D5 Low setup**: one package reference in `Directory.Build.props`.
* Bad, because **D3 Fast feedback**: Sonar adds some build time.
* Neutral, because **D4 No style debate**: `dotnet format` follows `.editorconfig`, but whitespace style is less opinionated than CSharpier.

### Roslyn only + dotnet format

* Good, because **D3 Fast feedback** and **D5 Low setup**: built into the SDK.
* Bad, because **D1 Bug-finding depth**: the `latest-recommended` set misses many bug patterns that Sonar catches.

### Roslyn + StyleCop + dotnet format

* Good, because **D4 No style debate**: very prescriptive about layout and documentation.
* Bad, because **D1 Bug-finding depth**: StyleCop is style-only and adds no bug detection.
* Bad, because **D5 Low setup**: many rules conflict with modern C# defaults and need tuning; noisy.

### Roslyn + CSharpier

* Good, because **D4 No style debate**: opinionated, Prettier-like, deterministic formatting.
* Good, because **D3 Fast feedback**: very fast.
* Bad, because **D5 Low setup**: an extra local tool, and it can conflict with `dotnet format` whitespace rules.
* Bad, because **D1 Bug-finding depth**: a formatter only, so it must still be paired with analyzers.

### ESLint type-checked + Prettier

* Good, because **D1 Bug-finding depth**: type-aware rules (`no-floating-promises`, `no-unsafe-*`, `no-unnecessary-condition`) and jsx-a11y; for example, it caught an always-false error check.
* Good, because **D4 No style debate**: Prettier formats deterministically.
* Good, because **D2 Local/CI parity**: the same CLI and config in the editor, `make lint` and CI.
* Bad, because **D3 Fast feedback**: type-aware linting is slow on large codebases.
* Bad, because **D5 Low setup**: several plugins whose peer ranges must align (see [ADR-0010](0010-toolchain-version-pins.md)).

### oxlint + Prettier

* Good, because **D3 Fast feedback**: 50–100× faster than ESLint; the Vite template's default.
* Good, because **D5 Low setup**: a single binary with built-in React/TS/a11y rules.
* Bad, because **D1 Bug-finding depth**: type-aware rules are newer and less complete than typescript-eslint's.

### Biome

* Good, because **D3**, **D4**, **D5**: one fast tool for both linting and formatting.
* Bad, because **D1 Bug-finding depth**: limited type-aware analysis, and a11y coverage is narrower than jsx-a11y.
