---
status: planned
date: 2026-11-11
issue: https://github.com/mgasca/calendar/issues/679
pr: []
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

The migration follows the Rust backend delivery in story [0058](0058-move-the-backend-from-dotnet-to-rust.md). Coordinate infrastructure-tool files with [PR #128](https://github.com/mgasca/calendar/pull/128) before porting them. The superseded .NET upgrade story [0056](0056-bump-dotnet-sdk-to-11.md) and [issue #657](https://github.com/mgasca/calendar/issues/657) are reconciled in final removal, without claiming that upgrade shipped.

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

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Repo-wide tools and configuration | `tools/` |
| Self-contained scripted skills | `.claude/skills/adr-draft/`, `.claude/skills/run-calendar/` |
| Workflow callers and hook registration | `.github/workflows/`, `.claude/settings.json` |
| Runtime pin and command entry points | `.deno-version`, `justfile`, module recipes |

### Delivery slices

| Slice | Child issue | Result |
| --- | --- | --- |
| Foundation | [#680](https://github.com/mgasca/calendar/issues/680) | Exact runtime pin, configs/locks, coexisting checks, doctor and npm Playwright feasibility proof. |
| Validation | [#681](https://github.com/mgasca/calendar/issues/681) | ADR validator/sweep rules, delivery guards and dependency consistency checker, with callers. |
| Reporting | [#682](https://github.com/mgasca/calendar/issues/682) | CI timings/baseline/trend, handover watch and delivery dashboard, with scheduled workflows. |
| Runtime tools | [#683](https://github.com/mgasca/calendar/issues/683) | Development seed, infrastructure/database commands and skill browser driver, with callers. |
| Agent hooks | [#684](https://github.com/mgasca/calendar/issues/684) | Port protections and atomically switch registrations; replace C# notices and warmup. |
| Removal | [#685](https://github.com/mgasca/calendar/issues/685) | Remove .NET infrastructure and verify the no-.NET environment and delivery on main. |

Foundation precedes ports; final removal follows all ports. Reporting and hooks touch shared documentation/callers and must coordinate ownership. The epic holds the current dependency map and PR state.

### API

No product API changes. Tool CLI arguments, output schemas, persisted state and hook protocols remain compatible except the documented runtime-specific replacements.

### Testing

Port every case and fixture to Deno tests. Check rounding/statistics, YAML interpretation, pagination and IDs, privacy rules, hook decisions, subprocess failure/timeout cleanup and browser parsing. Run scripted skills from an external temporary directory. Test doctor with absent, wrong and correct runtimes. Check every affected workflow and run final checks without .NET. Record exact revisions and distinguish local, CI and skipped integration coverage.

### Lessons learned, known issues and follow-ups

No implementation or performance improvement is claimed by this card PR. Capture the pre-migration timing baseline before replacing tools and the post-migration measurements at completion. Runtime browser compatibility is a foundation feasibility check rather than an assumed result.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Running repository tools

Install the pinned Deno release alongside the Rust and frontend prerequisites, then use the existing setup, doctor and tool commands. During staged delivery, tools that have not migrated still require .NET. After final removal, contributors can run repository checks without installing .NET.
