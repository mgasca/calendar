---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# .NET 10 file-based apps, kept inside the skill folder, for repo tooling scripts

## Context and Problem Statement

The `adr-draft` skill ships a validator, `check_adr.py`. It runs in `make lint` and in the CI `Docs` job ([ADR-0000](0000-use-markdown-architectural-decision-records.md)). It was written in Python without a recorded decision, so it adds a third language to a repo deliberately limited to C# and TypeScript ([ADR-0001](0001-monorepo-layout.md)). It also isn't held to the lint and test standards that apply to all other code ([ADR-0009](0009-static-analysis-and-formatting.md)). More checkers and generators will follow.

Which language and layout should repo tooling scripts use? In particular, can a .NET script still live inside its skill's folder, as is usual for skills?

## Decision Drivers

* **D1 Self-contained skills**: a skill folder, including its scripts and tests, can be copied into another repo or shared as a plugin and still work, with no dependency on this repo's build files. Rated important in review.
* **D2 Same quality bar as product code**: analyzers/lint, formatting checks and automated tests run locally and in CI. Required in review.
* **D3 No new toolchain**: use only tools contributors already need (.NET SDK, Node/pnpm, Docker, Make; see [ADR-0011](0011-make-as-top-level-task-runner.md)).
* **D4 Stack consistency**: stay within the repo's two languages ([ADR-0001](0001-monorepo-layout.md)).
* **D5 Fast feedback**: quick enough to stay in `make lint`, agent loops and CI.
* **D6 Text-processing ergonomics & AI-agent proficiency**: concise to write for Markdown and regex work, and reliably written and fixed by agents.

## Considered Options

* .NET 10 file-based app in the skill folder, with quality settings carried by the skill folder
* Python standard-library script in the skill folder, with `unittest`, ruff and mypy (status quo, plus a linter and type checker)
* TypeScript run directly by Node 24 in the skill folder, with `node:test`, `tsc` and ESLint
* .NET 10 file-based app in the skill folder that imports `backend/` build settings
* .NET console project and test project in the backend solution, invoked by the skill
* Bash, with shellcheck and bats

## Decision Outcome

Chosen option: ".NET 10 file-based app in the skill folder, with quality settings carried by the skill folder". It is the only option that meets the full quality bar (D2) with the repo's existing toolchain (D3) and language (D4) **and** keeps the skill self-contained (D1). It gives up a little speed (D5) and some regex terseness (D6) compared with Python and TypeScript.

**Location:** tools **stay in their skill folder**. Skills normally bundle their scripts, and .NET 10 can run a single `.cs` file with `dotnet run <file>.cs`, with no project file. The quality settings travel with the skill in a `Directory.Build.props` *inside the skill folder*, so they apply wherever the folder is copied.

| Driver | **.NET file-based, skill-local settings (chosen)** | Python stdlib + ruff/mypy | TypeScript on Node 24 | .NET file-based, imports backend settings | .NET projects in backend | Bash |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| D1 Self-contained skills | ★★☆ | ★★☆ | ★★☆ | ☆☆☆ | ☆☆☆ | ★★★ |
| D2 Same quality bar | ★★★ | ★★☆ | ★★☆ | ★★★ | ★★★ | ★☆☆ |
| D3 No new toolchain | ★★★ | ★☆☆ | ★★☆ | ★★★ | ★★★ | ★☆☆ |
| D4 Stack consistency | ★★★ | ☆☆☆ | ★★☆ | ★★★ | ★★★ | ★☆☆ |
| D5 Fast feedback | ★★☆ | ★★★ | ★★★ | ★★☆ | ★☆☆ | ★★★ |
| D6 Ergonomics & AI proficiency | ★★☆ | ★★★ | ★★★ | ★★☆ | ★★☆ | ★☆☆ |

### Evidence gathered for this ADR

Measured on 2026-10-26 with .NET SDK 10.0.403, Node 24.22.1 and Python 3.12.3 on WSL2:

| Check | Result |
| --- | --- |
| `#:property TreatWarningsAsErrors=true`, `AnalysisLevel`, `#:package SonarAnalyzer.CSharp@…` in a lone `.cs` file | Analyzer and Sonar diagnostics fail the build, with no repo build files |
| `Directory.Build.props` placed in the skill folder | Applied to file-based apps below it; it also stops MSBuild from picking up a host repo's own props |
| File-based xUnit v3 test app (`#:package xunit.v3.mtp-v2`) | Runs with `dotnet run`; exits non-zero when a test fails |
| `#:include ../path/Lib.cs` from a test app | Works, so tests can unit-test the validator's logic directly. It raises CA2266 unless the entry file starts with `#!` |
| `dotnet format whitespace --folder --verify-no-changes` | Works on file-based apps. Full `dotnet format` needs a project, but code-style rules are already enforced at build (`EnforceCodeStyleInBuild`) |
| Run time, file-based | First ever on a machine ~36 s (one-time SDK setup); after an edit ~5 s; cached 0.6–0.7 s |
| Run time, console project `dotnet run` | 2.2 s with `--no-build`, 4.2 s with the up-to-date check |
| Run time, current Python validator | 0.16 s |
| Node 24 running `.ts` directly, plus `node --test` | Works (0.37 s), but types are stripped, not checked; `tsc` is needed for type checking |
| Dependabot updating `#:package` versions | **Not confirmed.** No documentation found; see open questions |

### Layout and conventions

```text
.claude/skills/<skill>/
  SKILL.md
  Directory.Build.props        # quality settings for every .cs file in the skill (travels with it)
  .editorconfig                # analyzer severities and style, so they travel too
  scripts/
    <tool>/
      <tool>.cs                # entry point: starts with "#!/usr/bin/env -S dotnet run"
      <Logic>.cs               # pulled in with #:include, so it's testable
  tests/
    <tool>.tests.cs            # xUnit v3 file-based test app; #:include ../scripts/<tool>/<Logic>.cs
    fixtures/                  # sample inputs (e.g. valid and broken ADRs)
```

* **`Directory.Build.props` in the skill folder:**
  * `TargetFramework net10.0`, `Nullable`, `TreatWarningsAsErrors`, `AnalysisLevel=latest-recommended`, `EnforceCodeStyleInBuild`
  * `ManagePackageVersionsCentrally=false`, so a host repo's Central Package Management doesn't break the skill
  * a versioned `SonarAnalyzer.CSharp` reference
* **Package versions:** `#:package` directives pin exact versions. Each file-based app sits in its own directory, because restore writes `packages.lock.json` next to it.
* **Minimum SDK:** .NET **10**. A host repo whose `global.json` pins an older SDK can't run the skill's tools; `SKILL.md` states this.
* **Tooling not tied to a skill:** repo-wide tools go in `tools/<name>/` at the repo root, with the same layout and settings.
* **Invocation:**
  * `dotnet run .claude/skills/adr-draft/scripts/check-adr/check-adr.cs -- <args>` from anywhere, or `./check-adr.cs` thanks to the `#!` line.
  * `make adr-check` wraps it, and `make lint` runs the tool's tests and the whitespace format check.
* **CI:** the `Docs` job gains `actions/setup-dotnet` (`dotnet-version: 10.0.x`, because there's no repo-root `global.json`) and runs the tests, the format check and the validator. It runs in parallel with the backend job, so total CI time barely changes even though the job itself gets longer.

### Implementation plan (separate PR after acceptance)

1. Port `check_adr.py` to `scripts/check-adr/check-adr.cs` and `AdrValidator.cs`, keeping its behaviour and CLI flags (`--fix-links`, `--next-number`, `--dir`).
2. Turn the manual negative test from #5 into `tests/check-adr.tests.cs`, with fixtures: one valid ADR and one ADR per rule violation.
3. Add the skill-local `Directory.Build.props` and `.editorconfig`. Update `SKILL.md`, the `Makefile`, the CI `Docs` job, [ADR-0000](0000-use-markdown-architectural-decision-records.md)'s Confirmation and the decisions README.
4. Delete `check_adr.py`.
5. Test whether Dependabot picks up the `#:package` and `Directory.Build.props` versions in the skill folder (see open questions).

### Consequences

* Good, because every line of code in the repo is C# or TypeScript and passes the same analyzers and tests, including the tools that enforce the conventions.
* Good, because the skill folder stays portable: copy it into any repo with the .NET 10 SDK and `dotnet run` works, with its own quality settings.
* Good, because tests can unit-test the validator's logic (`#:include`), not just run it as a black box.
* Bad, because the first run on a fresh machine takes ~36 s and runs after an edit ~5 s, against 0.16 s for Python. Cached runs (0.7 s) are fine for `make lint` and agent loops.
* Bad, because the skill now needs the .NET 10 SDK. That's acceptable here, but it limits sharing the skill with non-.NET repos.
* Bad, because the CI `Docs` job gets slower once it has to install .NET; it still runs in parallel with the backend job.
* Neutral: regex-heavy Markdown parsing is wordier in C# than in Python, but the logic is small and the analyzers catch agent mistakes.

### Confirmation

* CI `Docs` job: runs the tool's xUnit tests, `dotnet format whitespace --folder --verify-no-changes` on the skill folder, and the validator itself.
* Code review rejects new `.py`/`.sh` tooling unless a new ADR supersedes this one.
* A portability smoke test in the implementation PR: copy the skill folder to an empty temp directory and run the validator and its tests there.

## Pros and Cons of the Options

### .NET 10 file-based app in the skill folder, with skill-local quality settings

* Good, because **D1 Self-contained skills**: the scripts, tests, `Directory.Build.props` and `.editorconfig` all live in the skill folder; measured working with no repo build files.
* Good, because **D2 Same quality bar**: Roslyn and Sonar analyzers with warnings as errors, xUnit tests, and a whitespace format check, all verified on file-based apps.
* Good, because **D3 No new toolchain**: needs only the .NET SDK, which contributors already have.
* Good, because **D4 Stack consistency**: C#, like the backend.
* Bad, because **D1 Self-contained skills**: requires the .NET 10 SDK in the host repo or machine, and packages restore from NuGet on first run.
* Bad, because **D5 Fast feedback**: ~36 s on the very first run per machine, ~5 s after edits, 0.7 s cached.
* Bad, because **D6 Ergonomics & AI proficiency**: file-based apps are new (since .NET 10), so there are fewer examples. Regex code is wordier than Python's.

### Python standard-library script with `unittest`, ruff and mypy

* Good, because **D1 Self-contained skills**: the script and `unittest` tests need only `python3`, which is preinstalled on Ubuntu, macOS and GitHub runners.
* Good, because **D5 Fast feedback**: 0.16 s per run.
* Good, because **D6 Ergonomics & AI proficiency**: concise text processing, and agents write Python fluently.
* Bad, because **D2 Same quality bar**: linting and type checking need ruff and mypy, which aren't in the standard library and don't travel with the skill.
* Bad, because **D3 No new toolchain**: adds Python tooling (e.g. uv, ruff, mypy) to the required setup and to `make doctor`.
* Bad, because **D4 Stack consistency**: a third language.

### TypeScript run directly by Node 24, with `node:test`, `tsc` and ESLint

* Good, because **D5 Fast feedback**: 0.37 s; Node runs `.ts` without a build step.
* Good, because **D6 Ergonomics & AI proficiency**: concise, widely known, and TypeScript is already a repo language.
* Good, because **D3 No new toolchain**: Node is already required.
* Bad, because **D2 Same quality bar**: Node strips types without checking them, so `tsc` and ESLint packages are needed, from a `package.json` either in the skill folder (a new workspace) or borrowed from `frontend/`.
* Bad, because **D1 Self-contained skills**: the tests run anywhere with Node ≥ 22.18, but lint and type checking need `npm install` in the skill folder.
* Neutral, because **D4 Stack consistency**: a repo language, but one scoped to the UI ([ADR-0001](0001-monorepo-layout.md)).

### .NET 10 file-based app in the skill folder that imports backend settings

* Good, because **D2 Same quality bar**: measured to inherit Sonar and warnings-as-errors through a `.claude/Directory.Build.props` that imports `backend/Directory.Build.props`.
* Good, because **D3**, **D4**: same as the chosen option.
* Bad, because **D1 Self-contained skills**: copied to another repo, the import fails (or silently drops the rules if made conditional).
* Neutral, because **D5**, **D6**: same as the chosen option.

### .NET console project and test project in the backend solution

* Good, because **D2 Same quality bar**: full solution integration (Central Package Management, lock files, `dotnet format`, the existing test setup).
* Good, because **D3**, **D4**: the existing toolchain and language.
* Bad, because **D1 Self-contained skills**: the skill depends on `backend/`, so it can't be copied elsewhere.
* Bad, because **D5 Fast feedback**: 2.2–4.2 s per `dotnet run --project`, slower than a cached file-based app.
* Neutral, because **D6 Ergonomics & AI proficiency**: conventional .NET, but more ceremony (two `.csproj` files) for a small tool.

### Bash with shellcheck and bats

* Good, because **D1 Self-contained skills** and **D5 Fast feedback**: runs anywhere with bash, instantly.
* Bad, because **D2 Same quality bar**: shellcheck and bats are extra installs, and shell has no type checking.
* Bad, because **D6 Ergonomics & AI proficiency**: fragile for parsing Markdown tables and front matter; quoting bugs are common.
* Bad, because **D3 No new toolchain** and **D4 Stack consistency**: new tools, and a third language.

## More Information

* Related: [ADR-0000](0000-use-markdown-architectural-decision-records.md) (the validator's role), [ADR-0001](0001-monorepo-layout.md) (stack boundaries), [ADR-0009](0009-static-analysis-and-formatting.md) (quality bar), [ADR-0012](0012-ci-and-dependency-updates.md) (CI `Docs` job, Dependabot).
* Sources: [.NET file-based apps documentation](https://learn.microsoft.com/dotnet/core/sdk/file-based-apps) (`#:package`, `#:property`, `#:include`, `#:project`, `#:sdk`), [Announcing `dotnet run app.cs`](https://devblogs.microsoft.com/dotnet/announcing-dotnet-run-app/).
* Versions at the time of writing: .NET SDK 10.0.403, `SonarAnalyzer.CSharp` 10.35.0.4138, `xunit.v3.mtp-v2` 4.0.2.
* Open questions for the reviewer:
  * **Dependabot and `#:package`:** no documentation found on whether Dependabot updates versions pinned in `#:package` directives or in a skill-local `Directory.Build.props`. If it doesn't, versions would be bumped manually or by a small scheduled check. Is that acceptable?
  * **Scope:** should this also govern tooling that isn't tied to a skill (proposed: yes, under `tools/<name>/` with the same layout)?
  * **Revisit:** if skills must be shared with non-.NET repos, reconsider Python or TypeScript for those specific skills.
