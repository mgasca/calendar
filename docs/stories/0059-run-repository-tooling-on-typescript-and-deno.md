---
status: in-progress
date: 2026-11-11
issue: https://github.com/mgasca/calendar/issues/679
pr:
  - https://github.com/mgasca/calendar/pull/686
  - https://github.com/mgasca/calendar/pull/687
  - https://github.com/mgasca/calendar/pull/697
  - https://github.com/mgasca/calendar/pull/699
  - https://github.com/mgasca/calendar/pull/701
  - https://github.com/mgasca/calendar/pull/742
  - https://github.com/mgasca/calendar/pull/743
  - https://github.com/mgasca/calendar/pull/700
  - https://github.com/mgasca/calendar/pull/889
adrs: ["0058", "0038", "0042", "0044", "0045"]
---

# 0059 Run repository tooling on TypeScript and Deno

## Story

> As a repository maintainer, I need repository tools and their tests to run on TypeScript and Deno, so that application and tooling code use Rust and TypeScript and contributors no longer need the .NET SDK.

Tracked in epic [#679](https://github.com/mgasca/calendar/issues/679). Scope and delivery choices approved by the maintainer on 2026-11-11.

## Background

Story [0058](0058-move-the-backend-from-dotnet-to-rust.md) moved the backend to Rust while leaving repository tooling on .NET. The remaining C# includes validators, statistics and reporting, infrastructure and development tools, Claude hooks, and skill-bundled scripts. Their tests, workflow callers, dependency locks and documentation must move together.

[0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) records the accepted tooling decision. Acceptance does not mean the port is delivered: both runtimes remain temporarily required until each tool and its callers switch.

### Agreed scope

* **Language and runtime:** port every C# repository tool, skill script and test to TypeScript on an exactly pinned stable Deno release. Remove .NET requirements once all replacements pass.
* **Quality:** strict type checking, Deno lint, formatting and tests, with meaningful fixtures and automatic discovery of repo-wide and skill tests.
* **Portable skills:** each scripted skill carries its own configuration and dependency lock and works when copied outside this repository; repo-wide tools share theirs.
* **Compatibility:** preserve command arguments, exit codes, structured output, snapshots, watch state, statistical results and hook protocols. Document direct script-extension changes and toolchain-specific hook replacements.
* **Callers:** switch recipes, workflows, hook registrations, setup, doctor, dependency updates and active guidance with their replacements.
* **Evidence:** preserve existing tests and compare deterministic old/new behavior before deleting implementations; measure tooling before and after, keeping CI runtime gates unchanged.

### Not in this story

* The frontend remains on Node/pnpm. No product feature, HTTP contract or database schema change is planned.
* Shell bootstrap/glue, jq, SQL, Bicep, configuration and platform-required JavaScript remain.
* Infrastructure verification does not authorize a resource deployment; use fixtures/dry runs and task-owned database resources.

### Dependencies

The migration follows the Rust backend delivery in story [0058](0058-move-the-backend-from-dotnet-to-rust.md). The maintainer deferred [PR #128](https://github.com/mgasca/calendar/pull/128): runtime tooling ports current-main behavior and excludes that PR's diagnostics/retry scope. The superseded .NET upgrade story [0056](0056-bump-dotnet-sdk-to-11.md) and [issue #657](https://github.com/mgasca/calendar/issues/657) are reconciled in final removal, without claiming that upgrade shipped.

### Acceptance criteria

1. **Given** the pinned Deno release, **when** I run setup and doctor, **then** the runtime is checked consistently and missing or incorrect versions produce actionable diagnostics.
2. **Given** repo tools and scripted skills, **when** I run `just tools test`, **then** every migrated suite is discovered and strict checking, lint, formatting and tests pass.
3. **Given** existing fixtures and deterministic inputs, **when** old and replacement tools run, **then** their command behavior, state and structured outputs agree apart from documented runtime-specific diagnostics.
4. **Given** a scripted skill copied outside the repository, **when** its documented checks and commands run with its bundled configuration and lockfile, **then** it does not depend on repository-only configuration or helpers.
5. **Given** each affected workflow, recipe and hook, **when** its replacement runs, **then** it uses the pinned runtime and frozen dependencies and preserves its existing protocol or explicitly documented toolchain-specific replacement.
6. **Given** the browser driver and task-owned database stack, **when** their integration checks run, **then** browser behavior, development seeding and database commands behave as before; infrastructure command behavior is covered with fixtures/dry runs.
7. **Given** an environment without .NET, **when** setup, doctor, tooling checks, ADR validation and affected build/check paths run, **then** no .NET SDK or NuGet infrastructure is needed.
8. **Given** final delivery, **when** tracked sources and active automation are inspected, **then** no executable C#, active .NET requirement or obsolete analyzer/lock/setup configuration remains; historical records remain readable.
9. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | TypeScript on Deno with independent scripted skills | Language, quality stack, reproducible dependencies and staged cutover. |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | Thin just recipes | Existing command names remain stable. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Agent guardrails | Hook protections and JSON behavior must survive the port. |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Claude-first automation | Migration does not extend harness scope. |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | CI runtime gates | Migration does not weaken performance checks. |

### Other decisions (not ADR-worthy)

* **Compatibility oracle:** keep old implementations until fixture comparisons and the replacement suite pass; normalize only unavoidable runtime-specific diagnostic text.
* **Review ownership:** each slice is a child issue with its own PR; the maintainer performs merges. Stack shared-file work and update the story through the designated owner to avoid competing card edits.

## Implementation notes

*In progress. Every slice has its PR. Foundation, validation, hooks (with the #741 correction) and reporting are delivered on `main`; runtime tools ([#700](https://github.com/mgasca/calendar/pull/700)) and the .NET removal ([#889](https://github.com/mgasca/calendar/pull/889), stacked on #700) await merge. The maintainer decided on 2026-11-14 that a separate close-out PR marks this card `implemented` once both are on `main` and main CI passes on the delivered revision.*

### Where things live

| Area | Location |
| --- | --- |
| Repo-wide tools and configuration | `tools/` |
| Self-contained scripted skills | `.claude/skills/adr-draft/`, `.claude/skills/run-calendar/`, and the later `.claude/skills/architecture-narrative-builder/` addition from story [0063](0063-build-architecture-narratives-with-an-expert-panel.md) |
| Workflow callers and hook registration | `.github/workflows/`, `.claude/settings.json` |
| Runtime pin and command entry points | `.deno-version`, `justfile`, module recipes |

### Delivery slices

| Slice | Child issue | Result |
| --- | --- | --- |
| Foundation | [#680](https://github.com/mgasca/calendar/issues/680) | Delivered in [#687](https://github.com/mgasca/calendar/pull/687): exact Deno 2.9.8 pin, independent configs/locks, coexisting checks, doctor and npm Playwright feasibility proof. Cold-cache correction delivered in [#697](https://github.com/mgasca/calendar/pull/697). |
| Validation | [#681](https://github.com/mgasca/calendar/issues/681) | Delivered in [#699](https://github.com/mgasca/calendar/pull/699): ADR validator/sweep rules, delivery guards and dependency consistency checker, with callers. |
| Reporting | [#682](https://github.com/mgasca/calendar/issues/682) | Delivered in [#743](https://github.com/mgasca/calendar/pull/743) (`3a00779b7`): CI timings/baseline/trend, handover watch and delivery dashboard, with scheduled workflows. |
| Runtime tools | [#683](https://github.com/mgasca/calendar/issues/683) | [#700](https://github.com/mgasca/calendar/pull/700) ports development seed, infrastructure/database commands and the standalone browser driver with their callers; review, delivery and verification on main remain pending. |
| Agent hooks | [#684](https://github.com/mgasca/calendar/issues/684) | Port and registrations delivered in [#701](https://github.com/mgasca/calendar/pull/701), including Deno formatting guidance/session reporting. Prototype-named command correction [#741](https://github.com/mgasca/calendar/issues/741) delivered in [#742](https://github.com/mgasca/calendar/pull/742) (`c0b09fa93`). |
| Removal | [#685](https://github.com/mgasca/calendar/issues/685) | [#889](https://github.com/mgasca/calendar/pull/889), stacked on #700: removes the last C# test app, NuGet lock/config, analyzer, SonarLint and C# editor settings, `global.json`, setup-dotnet, the C# CodeQL entry and the `dotnet-sdk` Dependabot entry; the doctor requires only Deno, Rust and the frontend runtimes. Awaiting merge. |

Foundation precedes ports; final removal follows all ports. Reporting and hooks touch shared documentation/callers and must coordinate ownership. The epic holds the current dependency map and PR state.

### API

No product API changes. Tool CLI arguments, output schemas, persisted state and hook protocols remain compatible except the documented runtime-specific replacements.

### Testing

Migration verification retains existing cases and fixtures, compares deterministic old/new outputs, checks copied scripted skills, and records exact revisions and local versus CI coverage. Delivery on `main` of #700 and #889 is still to be verified at close-out.

* **Foundation:** local checks before delivery passed 1,076 C# and five Deno cases. The runtime diagnostics are in [doctor_test.ts](../../tools/doctor/tests/doctor_test.ts); the real and copied-skill [Playwright fixture test](../../.claude/skills/run-calendar/integration/playwright_test.ts) passed. That browser test uses a disposable fixture API, not the actual Calendar application. The native-stack merge `363c64844` passed Tooling/Docs but failed an ADR cache post-step; [#696](https://github.com/mgasca/calendar/issues/696) was corrected by #697. At `cfcc989a1`, Tooling/ADR conventions passed initially and [CI attempt 2](https://github.com/mgasca/calendar/actions/runs/43311330115) passed after retrying a separate frontend timeout tracked in [#698](https://github.com/mgasca/calendar/issues/698); [publication](https://github.com/mgasca/calendar/actions/runs/43397047598) succeeded on the same revision.
* **Validation:** the original 54 ADR, 125 guard and 10 dependency-check cases passed before retirement. On reviewed head `504c383c5`, full tooling checks passed 202 Deno and 887 remaining C# cases, strict types, lint and formatting; shellcheck was unavailable locally and ran in CI. Full-repository validator output matched the old tool; inventory added Deno command tokens, and guard descriptions now name a dependency cache. The [copied-skill CLI test](../../.claude/skills/adr-draft/tests/cli_test.ts) and [dependency lock-refresh tests](../../tools/tool-versions/tests/tool-versions_test.ts) passed. The local docs corpus passed 296 tests; default five-second publication-link verification timed out even with one worker, while a 30-second diagnostic override passed all 18 artifact checks. Delivered revision `59b35598f` passed [main CI](https://github.com/mgasca/calendar/actions/runs/43398454583), including the normal Docs site, Tooling, ADR conventions and CI result checks.
* **Hooks:** before removal, the original suite passed 318 cases. The [coverage map](../../tools/agent-hooks/tests/fixtures/README.md) records 558 captured calls/probe states and the two approved runtime-specific output replacements. Reviewed head `d95b7dbf8` passed full tooling checks with 735 Deno cases and remaining C# suites; shellcheck was unavailable locally. The dirty-worktree timeout regression found in review was corrected with a slow-process test. Delivered revision `8adf38f4f` passed [main CI](https://github.com/mgasca/calendar/actions/runs/43410784745), including Tooling, Docs site and CI result. Subsequently identified #741 is still open; this evidence does not claim that correction or final hook acceptance is complete.
* **Removal (#889):**
  * **Doctor parity.** Before deletion, the C# doctor suite passed 35 of 35 cases against the unchanged doctor. The preserved Deno regressions (27 cases) predated the curl and Compose checks, so the five missing cases were added. [environment_test.ts](../../tools/doctor/tests/environment_test.ts) now carries every C# case except the three .NET SDK cases. Two no-.NET cases replace those: doctor passes with no `dotnet`, and doctor ignores a broken one. The recipe argument-forwarding cases put a failing `dotnet` stub on `PATH`, so a recipe that still calls `dotnet` fails.
  * **Doctor negative control.** The new tests run against the old doctor failed 8 cases, every case expecting success, because it still required the .NET SDK. They pass after the change (44 cases in `tools/doctor/tests`, with [doctor_test.ts](../../tools/doctor/tests/doctor_test.ts) covering a missing, wrong, correct and broken Deno).
  * **Azure CLI guard.** The [Azure CLI install guard](../../tools/azure-cli-install/azure-cli-install.ts) still matched the retired `tools/infra/infra.cs`, so a workflow running `tools/infra/infra.ts` directly, as `infra-whatif.yml` does, escaped it. Three new cases failed on the old pattern and pass with the fix.
  * **Delivery guard.** The `parallel-tool-tests` guard now requires a Deno cache keyed on `deno.lock`; the NuGet cache it used to require is gone. Its cases include a cache key that leaves out `deno.lock`.
  * **Local checks.** At `41b0c2d3e` (#700 head `d31d494bf` merged), `just tools test` passed 1,188 Deno cases with strict checks, lint and formatting: repo tools 1,075, ADR skill 55, browser skill 28, narrative skill 30. Shellcheck was not installed on the host and ran in CI. `just tools adr`, `just tools versions`, `just tools narratives --check` and the whole `just check` passed on the host: Rust clippy, fmt and tests with Testcontainers, frontend lint, typecheck and tests, docs 333 tests, architecture. The host has .NET installed but no recipe calls it.
  * **Copied skills.** Each scripted skill copied to a directory outside the checkout passed `deno install --frozen`, `fmt --check`, `check`, `lint` and its tests: 55, 28 and 30 cases.
* **Environment without .NET.** The task-owned image `calendar-deno-no-dotnet:verification-685` adds two prerequisites, neither .NET, that the prepared base image lacked: the Compose plugin and `procps`. It has no `dotnet` executable and no .NET install directory. The run used Rust 1.99.1, Deno 2.9.8, Node 24.22.2, Corepack 0.36.0, just 1.59.0 and shellcheck 0.10.0. Against a fresh clone of `41b0c2d3e`, with no credentials and the host Docker socket for the doctor's daemon check, these passed:
    * `just doctor` and `just setup` (cargo fetch, frozen pnpm install);
    * `just tools test`: 1,188 Deno cases, with shellcheck;
    * `just tools adr`, `versions` and `narratives --check`;
    * `just docs test` (333) and `just docs architecture`;
    * `just backend build`, `just backend lint`, `just frontend lint` and `just frontend typecheck`.
  * **Gaps in that environment.**
    * `just infra integration` failed there only because the container could not reach the port that its sibling PostgreSQL container published on the host daemon (ECONNREFUSED on 127.0.0.1). The same recipe passed on the host and in CI's Tooling job.
    * The base image's first run also exposed the missing Compose plugin and `ps`; neither is .NET-related.
    * Backend and frontend tests, Testcontainers suites included, were not run in the image. They passed on the host (`just check`) and in CI.
  * **CI.** All checks on #889 at `41b0c2d3e` passed, including CI result, Tooling, Backend, Frontend, Docs site, Container image, Dependency review and CodeQL (actions, javascript-typescript, rust); ADR conventions and Narratives were skipped by design.
* **Runtime draft:** on the #700 cutover tree, the Deno role-grants integration matched the local initialization script in disposable PostgreSQL, and the former C# agreement test passed separately. Synthetic old/new infrastructure previews, migration calls, failure cleanup and connection-string examples matched; secret-derived output is intentionally removed. A task-owned TLS database verified a trusted hostname, rejected an untrusted certificate and a mismatched hostname; regression controls failed with either safeguard removed. Seed and browser outputs matched their saved C# oracles against a throwaway Calendar stack, and the copied browser skill passed its Deno and Chromium fixture tests outside the repository. These are local results; no live Azure operation was run. Final CI and review for #700 remain pending.

### Acceptance criteria evidence

1. Doctor checks the exact Deno pin, with missing, wrong, broken and correct cases, beside Rust and the frontend runtimes: see the Foundation and Removal evidence above.
2. `just tools test` discovers all four Deno configurations (repo tools, ADR, browser and narrative skills) and runs strict check, lint, format and tests: 1,188 cases at `41b0c2d3e`.
3. Each slice compared old and new outputs before retiring its C# (legacy fixtures and oracles per slice above; doctor 35 to 32 ported plus 2 no-.NET replacements).
4. The three copied skills pass outside the repository with their own configuration and lock.
5. Callers run the pinned Deno with `--frozen`. The hook protocol and the two runtime-specific output replacements are recorded in the hooks fixture map.
6. Browser and database integrations ran against task-owned stacks in #700. Infrastructure behaviour is covered with fixtures and dry runs only.
7. The no-.NET image results are recorded under Removal above.
8. A tracked-file scan for `dotnet`, `.NET`, `NuGet`, `csharp` and `.cs` on #889 finds no executable C#, `global.json`, NuGet or analyzer configuration, and no setup-dotnet. The remaining matches are historical records (ADRs, stories, benchmarks, sweeps, porting fixtures), backend compatibility names (`DOTNET_ENVIRONMENT`, .NET wire formats), and test inputs.
9. `just check` passed locally at `41b0c2d3e`. Main CI on the delivered revision is checked at close-out.

### Lessons learned, known issues and follow-ups

The foundation recorded single local samples of 14.90 seconds before migration and 20.49 seconds during coexistence (#687); these are measured observations, not a reliable performance comparison or schedule estimate.

CI Tooling job, from `just tools ci-timings --job Tooling` (all measured; successful runs only):

| Sample | Runs | Job median | Job p90 | .NET setup step median | Test and lint median |
| --- | --: | --: | --: | --: | --: |
| `main` before the migration (push runs, 2026-11-09 to 2026-11-11, before #687) | 40 | 1:27 | 1:38 | 6 s | 51 s |
| `main` during coexistence (push runs, 2026-11-13 21:06Z to 2026-11-14 09:53Z) | 20 | 1:33 | 1:40 | 10 s | 50 s |
| #889 head `41b0c2d3e` (pull request run) | 1 | 0:36 | | none | 21 s |

The after sample is one run, so the drop from about 1:30 to 0:36 is an observation, not an established median. My inference is that it comes from removing the setup-dotnet step, the C# test apps and the `dotnet format` passes, plus running the four Deno configurations in parallel. Locally, serial Deno checks took 30.5 s and the parallel `just tools test` 22.6 s (single samples, same host). The role-grants step was also faster in that run (6 s against a median of 16 s), which is runner variance, not this change. A post-merge sample on `main` is owed at close-out. The ADR-0045 gates are unchanged. Cold-cache behavior needed a dedicated correction (#696/#697), and green cache-hit runs alone did not prove it. Final verification must include the actual application browser/database flow, #741's correction, all Deno skill configurations (including later additions), and an environment without .NET before marking the story implemented.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Running repository tools

Install the pinned Deno release alongside the Rust and frontend prerequisites, then use the existing setup, doctor and tool commands. `just doctor` checks Deno, Rust and the frontend runtimes; the .NET SDK is not needed. `just tools test` checks every Deno configuration (set `TOOLS_TEST_JOBS` to change how many run at once), and `just tools deno-test <dir>` checks one.
