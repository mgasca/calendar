---
status: accepted
date: 2026-11-11
decision-makers: mgasca, Codex (AI assistant)
---

# TypeScript on Deno for repository tooling, replacing .NET file-based apps

## Context and Problem Statement

The backend is now Rust ([ADR-0051](0051-rust-backend-on-axum-and-tokio.md)), leaving C# and its SDK only for repository tooling. On 2026-11-11 the maintainer approved migrating those tools to TypeScript on Deno so application and tooling code use Rust and TypeScript. This changes the language and toolchain constraints behind [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md): which tooling arrangement preserves behavior, standalone skills and reliable checks while removing .NET?

This record supersedes [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md), the C# layout stack of [ADR-0036](0036-csharp-layout-rules-with-stylecop-and-sonar.md), and the .NET SDK upgrade policy of [ADR-0050](0050-adopt-dotnet-11-once-the-providers-support-it.md). Acceptance records the decision; the staged implementation is tracked by [epic #679](https://github.com/mgasca/calendar/issues/679) and story [0059](../stories/0059-run-repository-tooling-on-typescript-and-deno.md).

## Decision Drivers

* **D1 Given requirement**: remove C# and the .NET SDK from application and tooling code; run the replacement tooling on Deno. This is an approved requirement, not a weighted preference.
* **D2 Behavior continuity**: keep command arguments, exit codes, machine-readable output, statistical results, persisted state and hook decisions while switching their callers in working increments.
* **D3 Standalone skills**: a copied skill must carry the configuration and dependency lock needed to run outside this repository.
* **D4 Quality and feedback**: strict checks, lint, formatting and meaningful automated tests must run locally and in CI without a second tooling lint stack.
* **D5 Reproducibility and maintenance**: pin the runtime and dependencies, avoid duplicate product stacks, and make updates and tool discovery explicit.

## Considered Options

* TypeScript on Deno, with independent skill configurations
* TypeScript on Deno, with one repository-wide workspace
* Keep .NET file-based apps

## Decision Outcome

Chosen option: "TypeScript on Deno, with independent skill configurations", because it meets the language/runtime requirement (D1), preserves copied skills (D3), and supplies the approved built-in quality stack (D4). Staged parity checks address the rewrite risk (D2), while exact pins and frozen lockfiles address reproducibility (D5).

| Driver | **Deno with independent skill configurations (chosen)** | Deno with one root workspace | Keep .NET |
| --- | :---: | :---: | :---: |
| D1 Given requirement | ★★★ | ★★★ | ☆☆☆ |
| D2 Behavior continuity | ★★☆ | ★★☆ | ★★★ |
| D3 Standalone skills | ★★★ | ★☆☆ | ★★★ |
| D4 Quality and feedback | ★★★ | ★★★ | ★★☆ |
| D5 Reproducibility and maintenance | ★★☆ | ★★★ | ★★☆ |

### Tooling conventions

* Repo-wide tools stay under `tools/<name>/`, sharing `tools/deno.json` and `tools/deno.lock`. Each scripted skill carries its own configuration and lockfile. Skills do not import repository-only helpers that would break copying.
* The foundation PR selects and verifies an exact stable Deno release in `.deno-version`. Doctor and every workflow read that pin. Commit generated dependency locks and enforce frozen locks in ordinary checks and CI; intentional dependency updates regenerate them through Deno.
* Use strict type checking, `deno lint`, `deno fmt` and `deno test`, with standard assertions. Do not add tooling ESLint. The frontend keeps its Node/pnpm, TypeScript and ESLint choices under [ADR-0010](0010-toolchain-version-pins.md).
* Keep CLI entry points thin and parsing/decision logic importable. Resolve bundled resources from module URLs; preserve the existing interpretation of caller-supplied paths.
* Specify permissions in tasks, disable permission prompts in automation, pass subprocess arguments as arrays, and preserve timeout and cleanup behavior. A subprocess permission permits that subprocess's own capabilities; it is not a sandbox around the child process.
* Use pinned standard-library packages for assertions and YAML parsing, and npm Playwright for the browser driver. The foundation slice must prove browser installation and the command protocol on the selected Deno release before the runtime-tool cutover.
* Preserve `just` command names and arguments, exit codes, JSON protocols, watch IDs/state, snapshot formats and statistical behavior. Direct `.cs` invocations change to documented `.ts` invocations. Keep `just tools versions`, including `--fix`, as a shared dependency-pin consistency check across the independent Deno configurations.
* Port hook protections and switch registrations together. Replace C# layout notices with Deno formatting guidance for tooling TypeScript; replace SDK compilation warmup with Deno session-start reporting. Generated-file protection, public-post checks and other repository rules remain enforced.

### Delivery and language boundaries

The docs-only decision/story PR precedes implementation PRs. Foundation, validation tooling, reporting tooling, runtime tooling, hooks and final .NET removal are separate child issues of the epic. Stack dependent PRs and keep both toolchains available only while unmigrated tools need .NET. Each tool switches with all its callers and tests.

The final removal includes C# sources/tests, NuGet locks/configuration, analyzer files, SDK pins/install/cache/update entries and active instructions. Preserve historical records. Verify setup and affected checks in an environment without .NET before closing the epic.

Rust and TypeScript are the application and tooling languages, not a ban on configuration or platform-owned languages. Shell bootstrap/glue, jq, SQL, Bicep and required JavaScript remain. The frontend stays on Node/pnpm. No product API, database schema, infrastructure resource or deployment is added by this migration.

### Consequences

* Good, because .NET is removed from contributor prerequisites and tooling uses the repository's TypeScript language.
* Good, because scripts, tests, lint and formatting share Deno's command-line tooling.
* Bad, because this is a rewrite with compatibility risk; existing tests and old/new output comparisons are required before retiring implementations.
* Bad, because independent skill configurations duplicate some pins and need the consistency checker.
* Neutral, because Node remains required for the frontend and Deno becomes an additional runtime; fewer languages does not mean one JavaScript runtime.

### Confirmation

`just tools test` discovers and checks repo-wide tools and scripted skills using strict type checks, lint, formatting and tests. CI uses the same tasks and frozen locks. Port every existing case and fixture, compare deterministic old/new outputs, test copied skills outside the checkout, and verify a clean no-.NET environment. Record timing measurements without weakening the gates of [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md). Report skipped integrations separately from passing checks.

## Pros and Cons of the Options

### TypeScript on Deno, with independent skill configurations

* Good, because **D1 Given requirement**: all tooling moves to the requested language and runtime, allowing .NET removal.
* Bad, because **D2 Behavior continuity**: every tool is rewritten; fixtures and differential comparisons reduce but cannot eliminate risk.
* Good, because **D3 Standalone skills**: each skill carries its own configuration and lockfile.
* Good, because **D4 Quality and feedback**: strict checking and built-in lint, formatter and tests form the approved quality stack with no added ESLint configuration.
* Bad, because **D5 Reproducibility and maintenance**: frozen locks reproduce each unit but duplicated dependency pins need explicit consistency checks.

### TypeScript on Deno, with one repository-wide workspace

* Good, because **D1 Given requirement**: the requested language and runtime replace .NET.
* Bad, because **D2 Behavior continuity**: the same rewrite risks remain, with additional root-workspace coupling for skill execution.
* Bad, because **D3 Standalone skills**: copying a skill without workspace metadata or packaging does not preserve its complete execution environment.
* Good, because **D4 Quality and feedback**: built-in checks can run across a workspace with shared configuration.
* Good, because **D5 Reproducibility and maintenance**: one resolver and lockfile centralize dependencies.

### Keep .NET file-based apps

* Bad, because **D1 Given requirement**: retaining C# and the SDK contradicts the approved outcome.
* Good, because **D2 Behavior continuity**: existing implementations and callers remain intact.
* Good, because **D3 Standalone skills**: folder-local settings already support copied skills when their SDK prerequisite is met.
* Bad, because **D4 Quality and feedback**: existing analyzers and tests are substantial but do not provide the approved Deno checks and retain compilation/formatting complexity.
* Bad, because **D5 Reproducibility and maintenance**: locks and an exact SDK reproduce builds, but retain a toolchain used only by repository tooling.

## More Information

* Approved in conversation on 2026-11-11: staged PRs, Deno built-ins, standalone skills, and removal of .NET while preserving platform/configuration languages. Drivers changed because the backend is Rust and the maintainer now requires Rust and TypeScript for application/tooling code.
* [Deno testing](https://docs.deno.com/runtime/test/), [configuration and frozen locks](https://docs.deno.com/runtime/reference/deno_json/), [permissions and subprocess scope](https://docs.deno.com/runtime/fundamentals/security/). Consulted 2026-11-11; exact runtime and dependency versions are verified and recorded by the foundation PR rather than guessed here.
* Existing infrastructure-tool work in [PR #128](https://github.com/mgasca/calendar/pull/128) must be coordinated before porting overlapping files. [Issue #657](https://github.com/mgasca/calendar/issues/657) remains open for explicit reconciliation in [#685](https://github.com/mgasca/calendar/issues/685); the .NET upgrade is displaced, not delivered. Existing .NET pins and checks remain valid transition machinery while old tools run.
