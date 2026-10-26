---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# .NET 10 file-based apps for all repo tooling scripts, in their skill folder or `tools/<name>/`

## Context and Problem Statement

The repo has two kinds of tooling scripts:

* **Skill-bundled tools**, such as the `adr-draft` skill's validator `check_adr.py`, which runs in `make lint` and in the CI `Docs` job ([ADR-0000](0000-use-markdown-architectural-decision-records.md)).
* **Repo-wide tools**, such as `scripts/doctor.sh`, the toolchain check that `make setup` runs ([ADR-0011](0011-make-as-top-level-task-runner.md)).

Both were written without a recorded decision, in Python and Bash. That adds languages to a repo deliberately limited to C# and TypeScript ([ADR-0001](0001-monorepo-layout.md)), and neither script meets the lint and test standards that apply to all other code ([ADR-0009](0009-static-analysis-and-formatting.md)). More checkers and generators will follow.

Which language and layout should **all** repo tooling scripts use, and where should they live, both inside skills and outside them?

## Decision Drivers

* **D1 Self-contained tool folders**: each tool's folder carries its own code, tests and quality settings. A skill folder in particular can be copied into another repo or shared as a plugin and still work, without this repo's build files. Rated important in review.
* **D2 Same quality bar as product code**: analyzers/lint, formatting checks and automated tests run locally and in CI. Required in review.
* **D3 No new toolchain**: use only tools contributors already need (.NET SDK, Node/pnpm, Docker, Make; see [ADR-0011](0011-make-as-top-level-task-runner.md)).
* **D4 Stack consistency**: stay within the repo's two languages ([ADR-0001](0001-monorepo-layout.md)).
* **D5 Fast feedback**: quick enough to stay in `make lint`, agent loops and CI.
* **D6 Text-processing ergonomics & AI-agent proficiency**: concise to write for Markdown, regex and file work, and reliably written and fixed by agents.

## Considered Options

* .NET 10 file-based app in the tool's folder, with quality settings carried by that folder
* Python standard-library script in the tool's folder, with `unittest`, ruff and mypy (status quo for the validator, plus a linter and type checker)
* TypeScript run directly by Node 24 in the tool's folder, with `node:test`, `tsc` and ESLint
* .NET 10 file-based app in the tool's folder that imports `backend/` build settings
* .NET console project and test project in the backend solution, invoked by skills and `make`
* Bash, with shellcheck and bats (status quo for `doctor.sh`)

## Decision Outcome

Chosen option: ".NET 10 file-based app in the tool's folder, with quality settings carried by that folder". It is the only option that meets the full quality bar (D2) with the repo's existing toolchain (D3) and language (D4) **and** keeps each tool's folder self-contained (D1). It gives up a little speed (D5) and some regex terseness (D6) compared with Python and TypeScript.

The rule covers **every** tooling script, with one narrow exception for bootstrap checks (below).

* **Skill-bundled tools** stay **in their skill folder** (`.claude/skills/<skill>/`), as is usual for skills. .NET 10 runs a single `.cs` file with `dotnet run <file>.cs`, with no project file. The skill's own `Directory.Build.props` carries the quality settings, so they apply wherever the folder is copied.
* **Repo-wide tools** live in **`tools/<name>/`** at the repo root, sharing one `tools/Directory.Build.props` and `tools/.editorconfig` with the same settings.

| Driver | **.NET file-based, folder-local settings (chosen)** | Python stdlib + ruff/mypy | TypeScript on Node 24 | .NET file-based, imports backend settings | .NET projects in backend | Bash |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| D1 Self-contained tool folders | ★★☆ | ★★☆ | ★★☆ | ☆☆☆ | ☆☆☆ | ★★★ |
| D2 Same quality bar | ★★★ | ★★☆ | ★★☆ | ★★★ | ★★★ | ★☆☆ |
| D3 No new toolchain | ★★★ | ★☆☆ | ★★☆ | ★★★ | ★★★ | ★☆☆ |
| D4 Stack consistency | ★★★ | ☆☆☆ | ★★☆ | ★★★ | ★★★ | ★☆☆ |
| D5 Fast feedback | ★★☆ | ★★★ | ★★★ | ★★☆ | ★☆☆ | ★★★ |
| D6 Ergonomics & AI proficiency | ★★☆ | ★★★ | ★★★ | ★★☆ | ★★☆ | ★☆☆ |

### Exception: bootstrap checks stay in POSIX shell

A tool whose job is to diagnose a missing or broken toolchain can't depend on that toolchain. `make doctor` must report "no .NET SDK", and a .NET program can't run to say so. Therefore:

* **What qualifies:** checks that run *before* the toolchain is guaranteed. Today that's only `doctor`.
* **Language:** POSIX/Bash, kept minimal, with no parsing logic beyond version comparison.
* **Location:** `tools/<name>/<name>.sh`. `scripts/doctor.sh` moves to `tools/doctor/doctor.sh`.
* **Quality:** linted with **shellcheck** in CI.
* **Hand-off:** anything that can assume the toolchain exists, including richer checks the doctor might want later, is written in .NET.

### Evidence gathered for this ADR

Measured on 2026-10-26 with .NET SDK 10.0.403, Node 24.22.1 and Python 3.12.3 on WSL2:

| Check | Result |
| --- | --- |
| `#:property TreatWarningsAsErrors=true`, `AnalysisLevel`, `#:package SonarAnalyzer.CSharp@…` in a lone `.cs` file | Analyzer and Sonar diagnostics fail the build, with no repo build files |
| `Directory.Build.props` placed in a tool's folder | Applied to file-based apps below it; it also stops MSBuild from picking up a host repo's own props |
| File-based xUnit v3 test app (`#:package xunit.v3.mtp-v2`) | Runs with `dotnet run`; exits non-zero when a test fails |
| `#:include ../path/Lib.cs` from a test app | Works, so tests can unit-test a tool's logic directly. It raises CA2266 unless the entry file starts with `#!` |
| `dotnet format whitespace --folder --verify-no-changes` | Works on file-based apps. Full `dotnet format` needs a project, but code-style rules are already enforced at build (`EnforceCodeStyleInBuild`) |
| Run time, file-based | First ever on a machine ~36 s (one-time SDK setup); after an edit ~5 s; cached 0.6–0.7 s |
| Run time, console project `dotnet run` | 2.2 s with `--no-build`, 4.2 s with the up-to-date check |
| Run time, current Python validator | 0.16 s |
| Node 24 running `.ts` directly, plus `node --test` | Works (0.37 s), but types are stripped, not checked; `tsc` is needed for type checking |
| Dependabot updating `#:package` versions | **Not confirmed.** No documentation found; handled below |

### Layout and conventions

```text
.claude/skills/<skill>/            # skill-bundled tools (portable)
  SKILL.md
  Directory.Build.props            # quality settings for the skill's .cs files (travels with the skill)
  .editorconfig                    # analyzer severities and style (travels with the skill)
  scripts/<tool>/<tool>.cs         # entry point, starting "#!/usr/bin/env -S dotnet run"
  scripts/<tool>/<Logic>.cs        # pulled in with #:include, so it's testable
  tests/<tool>.tests.cs            # xUnit v3 file-based test app; #:include ../scripts/<tool>/<Logic>.cs
  tests/fixtures/                  # sample inputs

tools/                             # repo-wide tools
  Directory.Build.props            # same settings as the skill copy, shared by all tools
  .editorconfig
  <name>/<name>.cs
  <name>/<Logic>.cs
  <name>/tests/<name>.tests.cs
  <name>/tests/fixtures/
  doctor/doctor.sh                 # bootstrap exception (shell + shellcheck)
```

* **`Directory.Build.props`** (one per skill, one for `tools/`):
  * `TargetFramework net10.0`, `Nullable`, `TreatWarningsAsErrors`, `AnalysisLevel=latest-recommended`, `EnforceCodeStyleInBuild`
  * `ManagePackageVersionsCentrally=false`, so a host repo's Central Package Management doesn't interfere
  * a versioned `SonarAnalyzer.CSharp` reference
* **Package versions:** `#:package` directives pin exact versions. Each file-based app sits in its own directory, because restore writes `packages.lock.json` next to it.
* **Dependency updates, for now:** whether Dependabot updates `#:package` and folder-local `Directory.Build.props` versions is unconfirmed. Until it is, these versions are **bumped manually**, matched to `backend/Directory.Packages.props` whenever Dependabot updates the backend. The implementation PR tests Dependabot's behaviour. If Dependabot handles them, the manual step is dropped and this ADR is updated.
* **Minimum SDK:** .NET **10**. A host repo whose `global.json` pins an older SDK can't run a skill's tools; each `SKILL.md` that bundles tools states this.
* **Invocation:**
  * `dotnet run <path>/<tool>.cs -- <args>`, or `./<tool>.cs` thanks to the `#!` line.
  * `make` targets wrap each tool (e.g. `make adr-check`), and `make lint` runs every tool's tests and the whitespace format checks.
* **CI:** the `Docs` job becomes a **Tooling** job:
  * `actions/setup-dotnet` with `dotnet-version: 10.0.x`, because there's no repo-root `global.json`
  * every tool's tests, the format checks, shellcheck for bootstrap scripts, and the ADR validator
  * it runs in parallel with the backend job, so total CI time barely changes

### Implementation plan (separate PR after acceptance)

Steps 1–4 are implemented. Step 5's result will be recorded here once Dependabot has run against the new `nuget` entry for the tool folders.

1. Port `check_adr.py` to `.claude/skills/adr-draft/scripts/check-adr/check-adr.cs` and `AdrValidator.cs`, keeping its behaviour and CLI flags (`--fix-links`, `--next-number`, `--dir`).
2. Turn the manual negative test from #5 into `tests/check-adr.tests.cs`, with fixtures: one valid ADR and one ADR per rule violation.
3. Add the `Directory.Build.props` and `.editorconfig` files for the skill and for `tools/`. Move `scripts/doctor.sh` to `tools/doctor/doctor.sh`.
4. Update `SKILL.md`, the `Makefile`, the CI job, [ADR-0000](0000-use-markdown-architectural-decision-records.md)'s Confirmation, [ADR-0011](0011-make-as-top-level-task-runner.md) and the decisions README. Delete `check_adr.py`.
5. Test whether Dependabot proposes updates for the tool folders' pinned versions, and record the result here.

### Consequences

* Good, because all tooling code apart from bootstrap shell is C# and passes the same analyzers and tests as product code, including the tools that enforce the conventions.
* Good, because skill folders stay portable: copy one into any repo with the .NET 10 SDK and `dotnet run` works, with its own quality settings.
* Good, because tests can unit-test tool logic (`#:include`), not just run tools as black boxes.
* Bad, because the first run on a fresh machine takes ~36 s and runs after an edit ~5 s, against 0.16 s for Python. Cached runs (0.7 s) are fine for `make lint` and agent loops.
* Bad, because the quality settings are duplicated: one `Directory.Build.props` per skill plus one for `tools/`. This is the price of portability.
* Bad, because pinned tool versions need manual bumps until Dependabot support is confirmed.
* Bad, because the CI tooling job gets slower once it has to install .NET; it still runs in parallel with the backend job.
* Neutral: regex-heavy parsing is wordier in C# than in Python, but the logic is small and the analyzers catch agent mistakes.

### Confirmation

* The CI tooling job runs every tool's xUnit tests, `dotnet format whitespace --folder --verify-no-changes` on `tools/` and each skill folder, shellcheck on bootstrap scripts, and the ADR validator.
* Code review rejects new `.py`, `.sh` or other non-.NET tooling, unless it falls under the bootstrap exception or a new ADR supersedes this one.
* A portability smoke test in the implementation PR: copy the skill folder to an empty temp directory and run the validator and its tests there.

## Pros and Cons of the Options

### .NET 10 file-based app in the tool's folder, with folder-local quality settings

* Good, because **D1 Self-contained tool folders**: scripts, tests, `Directory.Build.props` and `.editorconfig` all live in the tool's folder; measured working with no repo build files.
* Good, because **D2 Same quality bar**: Roslyn and Sonar analyzers with warnings as errors, xUnit tests, and a whitespace format check, all verified on file-based apps.
* Good, because **D3 No new toolchain**: needs only the .NET SDK, which contributors already have.
* Good, because **D4 Stack consistency**: C#, like the backend.
* Bad, because **D1 Self-contained tool folders**: requires the .NET 10 SDK, packages restore from NuGet on first run, and it can't diagnose a missing SDK (hence the bootstrap exception).
* Bad, because **D5 Fast feedback**: ~36 s on the very first run per machine, ~5 s after edits, 0.7 s cached.
* Bad, because **D6 Ergonomics & AI proficiency**: file-based apps are new (since .NET 10), so there are fewer examples. Regex code is wordier than Python's.

### Python standard-library script with `unittest`, ruff and mypy

* Good, because **D1 Self-contained tool folders**: the script and `unittest` tests need only `python3`, which is preinstalled on Ubuntu, macOS and GitHub runners.
* Good, because **D5 Fast feedback**: 0.16 s per run.
* Good, because **D6 Ergonomics & AI proficiency**: concise text processing, and agents write Python fluently.
* Bad, because **D2 Same quality bar**: linting and type checking need ruff and mypy, which aren't in the standard library and don't travel with the folder.
* Bad, because **D3 No new toolchain**: adds Python tooling (e.g. uv, ruff, mypy) to the required setup and to `make doctor`.
* Bad, because **D4 Stack consistency**: a third language.

### TypeScript run directly by Node 24, with `node:test`, `tsc` and ESLint

* Good, because **D5 Fast feedback**: 0.37 s; Node runs `.ts` without a build step.
* Good, because **D6 Ergonomics & AI proficiency**: concise, widely known, and TypeScript is already a repo language.
* Good, because **D3 No new toolchain**: Node is already required.
* Bad, because **D2 Same quality bar**: Node strips types without checking them, so `tsc` and ESLint packages are needed, from a `package.json` either in each tool folder or borrowed from `frontend/`.
* Bad, because **D1 Self-contained tool folders**: the tests run anywhere with Node ≥ 22.18, but lint and type checking need `npm install` in the folder.
* Neutral, because **D4 Stack consistency**: a repo language, but one scoped to the UI ([ADR-0001](0001-monorepo-layout.md)).

### .NET 10 file-based app in the tool's folder that imports backend settings

* Good, because **D2 Same quality bar**: measured to inherit Sonar and warnings-as-errors through a `Directory.Build.props` that imports `backend/Directory.Build.props`.
* Good, because **D3**, **D4**: same as the chosen option.
* Bad, because **D1 Self-contained tool folders**: copied to another repo, the import fails (or silently drops the rules if made conditional).
* Neutral, because **D5**, **D6**: same as the chosen option.

### .NET console project and test project in the backend solution

* Good, because **D2 Same quality bar**: full solution integration (Central Package Management, lock files, `dotnet format`, the existing test setup).
* Good, because **D3**, **D4**: the existing toolchain and language.
* Bad, because **D1 Self-contained tool folders**: tools and skills depend on `backend/`, so they can't be copied elsewhere.
* Bad, because **D5 Fast feedback**: 2.2–4.2 s per `dotnet run --project`, slower than a cached file-based app.
* Neutral, because **D6 Ergonomics & AI proficiency**: conventional .NET, but more ceremony (two `.csproj` files per tool).

### Bash with shellcheck and bats

* Good, because **D1 Self-contained tool folders** and **D5 Fast feedback**: runs anywhere with bash, instantly, even before any SDK is installed. That's why bootstrap checks keep it.
* Bad, because **D2 Same quality bar**: shellcheck and bats are extra installs, and shell has no type checking.
* Bad, because **D6 Ergonomics & AI proficiency**: fragile for parsing Markdown tables and front matter; quoting bugs are common.
* Bad, because **D3 No new toolchain** and **D4 Stack consistency**: new tools, and a third language.

## More Information

* Related: [ADR-0000](0000-use-markdown-architectural-decision-records.md) (the validator's role), [ADR-0001](0001-monorepo-layout.md) (stack boundaries), [ADR-0009](0009-static-analysis-and-formatting.md) (quality bar), [ADR-0011](0011-make-as-top-level-task-runner.md) (`make` targets, `doctor`), [ADR-0012](0012-ci-and-dependency-updates.md) (CI, Dependabot).
* Sources: [.NET file-based apps documentation](https://learn.microsoft.com/dotnet/core/sdk/file-based-apps) (`#:package`, `#:property`, `#:include`, `#:project`, `#:sdk`), [Announcing `dotnet run app.cs`](https://devblogs.microsoft.com/dotnet/announcing-dotnet-run-app/).
* Versions at the time of writing: .NET SDK 10.0.403, `SonarAnalyzer.CSharp` 10.35.0.4138, `xunit.v3.mtp-v2` 4.0.2.
* Review decisions:
  * Manual version bumps are acceptable for now, until Dependabot support is confirmed.
  * The ADR covers all tooling scripts, with non-skill tools in `tools/<name>/`.
  * Sharing skills with non-.NET repos is deferred.
* **Deferred:** if a skill must be shared with non-.NET repos, reconsider the language for that skill only, in a new ADR.
