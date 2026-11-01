---
status: proposed
date: 2026-11-01
decision-makers: mgasca, Claude (AI assistant)
---

# just as the top-level task runner, replacing GNU Make

## Context and Problem Statement

[ADR-0011](0011-make-as-top-level-task-runner.md) chose GNU Make as the single entry point to set up, build, test, lint and format both stacks. It was decided while the project was being started, when getting up and running quickly mattered most. The Makefile has since grown from 13 to 35 targets, five of its recipes carry real shell logic with `$$` escapes and `\` continuations, and the maintainer now values using, and so learning, a modern tool that is fit for purpose (issue #153, story [0011](../stories/0011-review-the-top-level-task-runner.md)). Which tool should be the top-level task runner for contributors, AI agents and CI?

## Decision Drivers

* **D1 Modern and fit for purpose**: the tool is built to run project tasks, is actively maintained, and is worth learning. A build system used only through phony targets does not meet this.
* **D2 Thin over native tools**: all real configuration stays in `dotnet` / pnpm, so native commands keep working directly.
* **D3 Discoverability**: one obvious place lists the tasks, their arguments and their purpose, easy for agents to find and run, without a custom script.
* **D4 Expressiveness**: handles arguments, multi-step recipes, working directories, environment files and dependencies between tasks cleanly.

These replace the five drivers of [ADR-0011](0011-make-as-top-level-task-runner.md). The maintainer removed "Linux/WSL support" and "zero extra install", which were about getting started quickly. Linux and WSL stay the supported platforms in `AGENTS.md`, as a constraint that every option below meets.

## Considered Options

* `just`
* GNU Make as it is today
* Task
* GNU Make plus file-based apps for the logic-heavy recipes
* Root npm/pnpm scripts
* Shell scripts in `scripts/`
* Only native commands

## Decision Outcome

Chosen option: "`just`", because it is a task runner built for exactly this job (D1), it keeps the thin layer over native commands that Make gave (D2), it lists every recipe with its comment and parameters without a custom script (D3), and in a prototype it removed the `$$` escapes and line continuations and gave named arguments, early errors and `.env` loading (D4).

Evidence is marked as **measured** (run in the prototype), **inferred** (reasoned from documented behaviour) or **untested**.

| Driver | **`just` (chosen)** | GNU Make | Task | Make + file-based apps | Root pnpm scripts | `scripts/` shell | Native only |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| D1 Modern and fit for purpose | ★★★ | ★☆☆ | ★★★ | ★★☆ | ★☆☆ | ☆☆☆ | ☆☆☆ |
| D2 Thin over native tools | ★★★ | ★★★ | ★★★ | ★★☆ | ★★☆ | ★★★ | ★★★ |
| D3 Discoverability | ★★★ | ★★☆ | ★★★ | ★★☆ | ★★☆ | ★☆☆ | ★☆☆ |
| D4 Expressiveness | ★★★ | ★★☆ | ★★☆ | ★★☆ | ★☆☆ | ★★★ | ☆☆☆ |

### What was measured

A throwaway `justfile` with 11 recipes (the 6 targets CI calls and the logic-heavy recipes) was built on a scratch branch with `just` 1.59.0, using the official release with a verified checksum. `dotnet` and Docker were not available in that sandbox, so only `smoke-image` (shell and `curl`) ran end to end; the other recipes were checked with `--dry-run`.

* **Measured:** `smoke-image` gives the same output and the same pass or fail result under `just` and `make` against a mock server, including two broken-page cases.
* **Measured:** the `justfile` has no `$$` and no `\` continuations.
* **Measured:** arguments pass through (`just adr-check --fix-links`), a recipe can take a named parameter with a default (`just run-image Staging`), and a missing required argument stops with a usage message, where `make infra-migrate` without `ENV=` runs the tool with an empty value.
* **Measured:** `just --list` shows each recipe's comment and parameters, and `set dotenv-load` exposes `.env` values to recipes.
* **Measured:** a shebang recipe runs as one script, so `cd` persists across lines. This is what `.ONESHELL:` could not give the Makefile: it broke the `DOTNET := cd backend && dotnet` pattern in a scratch test.
* **Inferred:** inside a shebang recipe with `set -e`, `grep ... && cp ...` does not stop the script when `grep` fails, so the Makefile's `|| exit 1` must be kept when porting.
* **Untested:** every recipe that needs `dotnet` or Docker, `lint` as recipe dependencies, behaviour in CI, and `Task` (no prototype was built for it).

### Facts checked at the time of writing

* `just` 1.59.0, released 2026-10-15, CC0-1.0 licence, repository active and not archived.
* The Ubuntu 24.04 GitHub runner image does not list `just`, so CI needs an install step. The `extractions/setup-just` action exists (tag `v4`, commit `53165ef7e734`).
* Ubuntu's `apt` offers `just` 1.45.0, well behind 1.59.0, so contributors install the release binary, `cargo`, or another route.
* `Task` v3.54.0, released 2026-10-01, MIT licence, repository active.

### Implementation plan

Delivered in separate PRs after this ADR is accepted, tracked in story [0011](../stories/0011-review-the-top-level-task-runner.md):

1. Add a `justfile` with every Makefile target at parity. Keep the Makefile.
2. Make `tools/doctor/doctor.sh` check for `just` at a minimum version, and install `just` in CI at a pinned version. `just doctor` cannot run when `just` is missing, so the README's first step runs `./tools/doctor/doctor.sh` directly.
3. Switch the 6 CI call sites to `just`, and update `README.md`, `AGENTS.md`, `CLAUDE.md`, the runbooks, the `adr-draft` and `story-draft` skills and the user-guide parts of the story cards.
4. Remove the Makefile, or keep a thin shim for a transition period (open question below).

Existing ADR text that mentions `make` is a historical record and is not rewritten.

### Consequences

* Good, because **D1 Modern and fit for purpose**: the repo uses a runner built for tasks, and the maintainer learns it.
* Good, because **D4 Expressiveness**: recipes with real logic become plain scripts, and arguments are named and checked.
* Good, because **D3 Discoverability**: `just --list` replaces the `grep | awk` help target.
* Bad, because there is **a new tool to install and keep current**: `apt` lags, CI needs an install step in every job that calls it, and `make doctor` needs a version check.
* Bad, because **about 50 files name `make <target>`** and need updating, and contributors and agents lose the command they know best.
* Bad, because the **bootstrap check cannot run through `just` when `just` is missing**, so the README has a different first step.
* Neutral: native Windows is still not a supported developer platform. `just` runs there, but the repo does not rely on it.
* Neutral: [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)'s driver "no new toolchain" lists Make among the tools contributors already need. This ADR adds `just` to that list. It does not change that ADR's choice of language for tool scripts.

### Confirmation

* CI runs the same checks through `just` as it ran through `make`, and `just check` passes locally and in CI.
* `tools/doctor/doctor.sh` fails when `just` is missing or older than the minimum version.
* A CI step runs `just --list` and the `justfile` format check (`just --fmt --check`, which is still marked unstable in 1.59.0), so a recipe with a syntax error or a missing comment is caught.

## Pros and Cons of the Options

### `just`

* Good, because **D1 Modern and fit for purpose**: it is purpose-built for running project tasks and is actively maintained (checked).
* Good, because **D2 Thin over native tools**: each recipe is still a few native commands, and the native commands work without it.
* Good, because **D3 Discoverability**: `just --list` shows comments and parameters (measured).
* Good, because **D4 Expressiveness**: named parameters with defaults, early argument errors, `.env` loading and shebang recipes (measured).
* Bad, because **D2 Thin over native tools**: it is a separate binary that must be installed, version-checked and kept current (apt is behind).
* Bad, because **D4 Expressiveness**: it has no file-dependency model, which the repo does not use today.

### GNU Make as it is today

* Good, because **D2 Thin over native tools**: every target forwards to a native command, and nothing needs installing.
* Good, because **D3 Discoverability**: `make help` works today, and agents know `make test`.
* Bad, because **D1 Modern and fit for purpose**: it is a build tool used through phony targets, with tab and `$$` quirks.
* Bad, because **D3 Discoverability**: the help text comes from a custom `grep | awk` script.
* Bad, because **D4 Expressiveness**: five recipes carry shell logic with `$$` and continuations, 10 targets pass strings through `ARGS=` and `ENV=`, and a missing `ENV=` is not an error (measured).

### Task

* Good, because **D1 Modern and fit for purpose**: it is a purpose-built, maintained runner (checked).
* Good, because **D3 Discoverability**: it has a built-in task list (documented, untested).
* Neutral, because **D4 Expressiveness**: tasks are written in YAML with shell inside strings, which is a different shape from the Makefile and was not prototyped, so the rating is cautious.
* Bad, because **D2 Thin over native tools**: it is another binary to install, with no apt route checked here.

### GNU Make plus file-based apps for the logic-heavy recipes

* Good, because **D1 Modern and fit for purpose**: the logic moves into modern C# tools under [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md).
* Good, because **D3 Discoverability**: Make's help stays as it is, and CI and the docs do not change.
* Bad, because **D2 Thin over native tools**: five new tools each need their own analyzers, `.editorconfig` and tests under [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md).
* Bad, because **D4 Expressiveness**: `ARGS=` string passing and the other Make quirks stay.

### Root npm/pnpm scripts

* Good, because **D2 Thin over native tools**: Node is already required, so nothing is added.
* Bad, because **D1 Modern and fit for purpose**: it puts .NET orchestration inside a Node `package.json`, blurring the stack boundary in [ADR-0001](0001-monorepo-layout.md).
* Bad, because **D4 Expressiveness**: long one-line JSON strings are hard to read for multi-step tasks.

### Shell scripts in `scripts/`

* Good, because **D4 Expressiveness**: full bash.
* Bad, because **D1 Modern and fit for purpose**: [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) limits shell to bootstrap checks.
* Bad, because **D3 Discoverability**: no built-in listing, and many small files.

### Only native commands

* Good, because **D2 Thin over native tools**: nothing is added.
* Bad, because **D1 Modern and fit for purpose**, **D3 Discoverability** and **D4 Expressiveness**: every contributor or agent must learn the per-stack command sequences, including `cd` requirements.

## More Information

* Related: [ADR-0011](0011-make-as-top-level-task-runner.md) (superseded by this ADR once accepted), [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) (the tool-script language; the bootstrap exception in it still applies to `tools/doctor/doctor.sh`), [ADR-0001](0001-monorepo-layout.md) (stack boundary), issue #153 and story [0011](../stories/0011-review-the-top-level-task-runner.md).
* "Task" in the options is the `go-task` runner. "File-based apps" are the ones defined in [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md).
* An earlier analysis recommended keeping Make. It was written under the previous drivers and did not test `just`, so it was used as historical input only.
* Revisit if `just` stops being maintained or its install friction in CI turns out to cost more than the prototype suggested. This trigger is recorded in this ADR only. The implementation PR adds it to the `AGENTS.md` notes.
* Open questions for the reviewer:
  1. Should `Task` get a prototype before this is accepted, or is the `just` evidence enough?
  2. After the migration, should the Makefile be removed at once or kept as a thin shim for a transition period?
  3. Where should the minimum `just` version live, in `tools/doctor/doctor.sh` or in a version file read by both doctor and CI?
  4. Should the user-guide parts of old story cards be updated to `just`, or left as written?
