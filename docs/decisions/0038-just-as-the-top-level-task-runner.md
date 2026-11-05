---
status: accepted
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

1. Add a `justfile` with every Makefile target at parity. Keep the Makefile until step 3 has landed.
2. Add a `.just-version` file at the repo root, like `frontend/.node-version`. Make `tools/doctor/doctor.sh` check for `just` at that version or newer, and install `just` in CI at that version, so the number lives in one place. `just doctor` cannot run when `just` is missing, so the README's first step runs `./tools/doctor/doctor.sh` directly.
3. Switch the 6 CI call sites to `just`, and update `README.md`, `AGENTS.md`, `CLAUDE.md`, the runbooks, the `adr-draft` and `story-draft` skills and the story cards.
4. Remove the Makefile as soon as step 3 has landed. There is no shim: the only people and agents who work in this repo are the maintainer's, and a shim could not forward the `VAR=value` arguments of the 10 targets that take them without its own translation.

Every `make <target>` command is rewritten to `just`, in all of these files and in the other ADRs. [ADR-0011](0011-make-as-top-level-task-runner.md) is left as written, because it is the superseded record. Passages that talk about GNU Make as a tool, such as the comparison of the options above, stay.

### Amendment, 2026-11-04: recipes live in modules

The decision above is unchanged: `just` stays the runner, every recipe stays a thin wrapper over native commands, and the ratings of D1 to D4 stand. What changes is the layout. The `justfile` was ported from the Makefile as one flat list (37 recipes in 238 lines, grouped only by name prefix such as `db-*` and `infra-*`). It becomes a root `justfile` plus `just` modules (`mod`). Story [0019](../stories/0019-split-the-justfile-into-modules.md) holds the scope, the recipe table and the acceptance criteria. This section records the conventions that the layout relies on.

**Layout**

* The root keeps the recipes that span stacks or bootstrap the repo: `default`, `doctor`, `setup`, `build`, `test`, `lint`, `format`, `check`, `clean` and `contracts`. They keep their names and call the module recipes.
* Seven modules hold the rest: `backend`, `frontend`, `docs`, `db`, `image`, `infra` and `tools`.
* Each module file sits where `just`'s default lookup finds it: beside the code it runs (`backend/mod.just`, `frontend/mod.just`, `frontend/apps/docs/mod.just`, `infra/mod.just`, `tools/mod.just`), or, when it has no directory of its own, beside the root file as `<name>.just` (`db.just` next to `compose.yaml`, `image.just` next to `Dockerfile`).
* The old flat names are removed with no aliases, as the Makefile was (step 4 of the implementation plan above). Every reference changes in the one PR that renames the recipes.

**Conventions**

* **Settings are per module.** Each module file sets its own shell (`set shell := ["bash", "-euo", "pipefail", "-c"]`), because a module does not inherit it. The root's `set dotenv-load` is enough for `.env` values to reach module recipes, so modules do not repeat it.
* **Working directory.** A module recipe runs in the directory of its module file. A module whose file is not in the directory it works in sets `set working-directory`. A stack module therefore needs no `cd backend &&` or `--dir frontend`.
* **Chaining uses `::`.** Several recipes of one module run as `just db::up db::migrate`. `just db up migrate` is an error. The rule in `AGENTS.md` that chained recipes must take no arguments still applies. *Amended 2026-11-05:* the `do` recipe below chains them without repeating the module, and takes arguments for the last one.
* **A bare module name runs nothing.** Each module marks a `[default]` recipe that only lists the module, so `just db` cannot start or delete anything.
* **Dependencies point one way.** A root recipe may depend on a module recipe (`check: backend::lint`). A module recipe cannot depend on a root recipe, so a step that two modules share lives in the module that owns it.

**Evidence**

* **Measured on `just` 1.59.0, 2026-11-03 and 2026-11-04, in scratch directories (not the repository):** a module recipe runs in its module file's directory, and `set working-directory := '..'` and `[no-cd]` change that; a module without `set shell` ran under `sh`; `.env` values loaded by the root were visible in module recipes; `just db::up db::migrate` runs both and `just db up migrate` fails with "does not contain recipe `migrate`"; bare `just db` ran the module's first recipe; plain `just --list` shows a module as `db ...` and `--list-submodules` shows its recipes; an alias to a module recipe works; run from `frontend/`, `just` finds the root `justfile` and the module recipe still runs in its own directory.
* **Measured, same setup:** `just --fmt --check` at the root does not check module files. With a badly formatted module beside a clean root it exited 0, and `just --fmt --check --justfile <module file>` found the difference and exited 1. `--fmt` ran without `--unstable`, so "still marked unstable in 1.59.0" in the Confirmation below is out of date.
* **Checked in the release notes:** modules were stabilised in 1.31.0 (2024-07-14), the `working-directory` setting arrived in 1.33.0 and the `[default]` attribute in 1.43.0. The pinned 1.59.0 has all three.
* **Untested:** the repository's own recipes under the new layout, and the CI step below. Both are covered by the acceptance criteria of story 0019.

**Consequences of the amendment**

* Good, because **D3 Discoverability**: a recipe is named by what it works on, and `just --list <module>` shows one family.
* Good, because **D2 Thin over native tools**: a stack module runs in its own directory, so the `cd` and `--dir` plumbing in the root variables goes away.
* Bad, because **D3 Discoverability**: plain `just --list` shows a module as a bare name, so the `default` recipe has to list with `--list-submodules`.
* Bad, because **D4 Expressiveness**: chaining needs the `::` form, and each of the seven module files repeats the `set shell` line.
* Bad, because the rename reaches up to 59 tracked files and the 6 CI call sites (an upper bound, counted by searching for the real recipe names), and contributors and agents relearn the names.
* Neutral: [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)'s choice of language for tool scripts, and the minimum `just` version in `.just-version`, do not change.

### Amendment, 2026-11-05: chaining a module's recipes with `do`

`just backend build test` runs `backend::build`, then the **root** `test`, because only the first word after a module name is looked up in the module (issue #247). The `::` form works, but it repeats the module, and a recipe that takes `*args` swallows the names after it: `just backend::restore backend::build` passes `backend::build` to `dotnet restore`.

* **One recipe, imported by every module.** `just/do.just` defines `do`, and each module file pulls it in with `import`. An imported recipe belongs to the importing module, and `module_path()` names that module, so the root `justfile` does not change.
* **Words.** `just <module> do [options] <recipe>... [arguments]`: leading words that start with `-` are `just` options for every call (`-n`, `--yes`; an option with a value uses the `=` form), then come the recipe names, and from the next word that starts with `-` the words are arguments of the last recipe (`just backend do restore build test --project tests/Calendar.Domain.Tests`).
* **Fail fast.** Every name is checked with `just --show` before anything runs. The recipes run in order, each in its own `just` call, and the first failure stops the chain with its exit code.
* **Named `do`,** because `image run` already exists.
* **Preview with `do -n`.** `just -n backend do …` previews only the runner, because a recipe cannot tell that `just` was started with `--dry-run`.
* **The shared-database hook** of [ADR-0042](0042-layered-agent-guidance-and-hooks.md) also asks before a `db do` chain that names `up`, `down`, `reset`, `migrate` or `psql`.

**Evidence**

* **Measured on `just` 1.59.0, 2026-11-05, in scratch directories and then in the repository:** a recipe from a file that a module imports is listed under that module (`just --list backend`); `module_path()` returns the module's name; `just backend do build test` in an unrestored checkout stopped at the failing build without running the tests, exit 1; `just backend do restore build test --project tests/Calendar.Domain.Tests` ran all three and passed 180 domain tests, with the arguments reaching only `dotnet test`; `just backend do clean nope test` stopped on `nope` before `clean` ran; `just db do -n up migrate`, `just docs do -n build test` and `just tools do -n versions adr` printed each recipe's commands; `just --fmt --check --justfile` passed on every module file and on `just/do.just`.

**Consequences of this amendment**

* Good, because **D4 Expressiveness**: a module's recipes chain without the module prefix, and arguments reach the last recipe instead of being swallowed by the first.
* Good, because **D3 Discoverability**: `do` is listed in every module, with its usage in the comment.
* Bad, because **D2 Thin over native tools**: about 20 lines of bash logic sit in a recipe, and `just -n` before the module name does not preview the chain.
* Bad, because a dependency that two chained recipes share runs twice. Only `db reset` declares a dependency today (`&& up`).

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
* `tools/doctor/doctor.sh` fails when `just` is missing or older than the version in `.just-version`.
* A CI step runs `just --list` and the `justfile` format check (`just --fmt --check`, which is still marked unstable in 1.59.0), so a recipe with a syntax error or a missing comment is caught. *Amended 2026-11-04:* no workflow runs this step today (checked in `.github/`). With modules, the step runs `just --list --list-submodules` and `just --fmt --check` on the root `justfile` and on every module file separately with `--justfile`, because the root check does not reach module files.

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
* **Amendment, 2026-11-04:** the layout moved from one flat `justfile` to a root file plus seven modules, in issue #213 and story [0019](../stories/0019-split-the-justfile-into-modules.md). The decision itself is unchanged, so this ADR was amended, not superseded, as [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) was for its minimum SDK. The commands quoted under "What was measured" are the ones run in the prototype and are left as they were.
* **Amendment, 2026-11-05:** the `do` recipe that chains a module's recipes, in issue #247. The decision is unchanged, so this ADR was amended again.
* Revisit if `just` stops being maintained or its install friction in CI turns out to cost more than the prototype suggested. This trigger is recorded in this ADR only. The implementation PR adds it to the `AGENTS.md` notes.
