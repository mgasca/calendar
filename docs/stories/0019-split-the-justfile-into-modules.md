---
status: planned
date: 2026-11-03
issue: https://github.com/mgasca/calendar/issues/213
pr:
  - https://github.com/mgasca/calendar/pull/214
adrs: ["0001", "0015", "0016", "0017", "0038", "0039"]
---

# 0019 Split the justfile into modules

## Story

> As a contributor, whether a person or another agent, I need the task runner's recipes grouped into modules by stack and by concern, so that I find, name and run a task by what it works on instead of by a prefix in one flat list.

Tracked in issue #213. Card PR: [#214](https://github.com/mgasca/calendar/pull/214).

## Background

[ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md) chose `just` as the top-level task runner and recorded a thin layer over native tools as a driver. The `justfile` was ported from the Makefile at parity, so it is still one flat list.

* **Size:** 37 recipes in 238 lines (measured on `main` at `ca8ce46e`).
* **Prefix families:** the structure is already in the names: `db-*` (6 recipes), `infra-*` (8, counting `infra-integration`), `dev-*` and the `*-docs` recipes (`dev-docs`, `build-docs`, `preview-docs`, `bench-docs`), and `image`, `run-image` and `smoke-image`.
* **Stacks hidden in variables:** the stacks are reached through `dotnet := "cd backend && dotnet"` and `pnpm := "pnpm --dir frontend"`. A recipe that must run `dotnet ef` or call a different pnpm package repeats the `cd` or the `--filter`.
* **Reach:** 59 tracked files name a recipe (measured with a search for the actual recipe names, so an upper bound for the files a rename touches). CI has 6 call sites: 5 in `ci.yml` and 1 in `migrate.yml`.

`just` has had stable modules (`mod`) since 1.31, and `.just-version` pins 1.59.0. The behaviours below were checked on 1.59.0 in a scratch directory, not in the repo, and are the facts the design relies on:

* A module recipe runs with the module file's directory as its working directory. `set working-directory := '..'` changes that, and `[no-cd]` keeps the caller's directory.
* Module settings are not inherited: a module without `set shell` ran its recipes under `sh`, not bash. The root's `.env` values were visible to module recipes.
* A module is called as `just db up` or `just db::up`. Chaining needs the `::` form: `just db up migrate` fails with "does not contain recipe `migrate`", and `just db::up db::migrate` works.
* Bare `just db` runs the module's first recipe unless one is marked `[default]`.
* Plain `just --list` shows a module as `db ...`. `just --list --list-submodules` shows every recipe, and `just --list db` shows one module.
* A root recipe may depend on a module recipe (`check: backend::lint`). A module recipe cannot depend on a root recipe.
* Run from a subdirectory such as `frontend/`, `just` finds the root `justfile`, and a module recipe still runs in its own directory.

### Agreed scope

Decided with the maintainer on 2026-11-03:

* **Modules by stack and by concern.** The root keeps the cross-stack aggregates and the bootstrap recipes; everything else moves into a module. The layout is:

  | Module | File | Recipes |
  | --- | --- | --- |
  | root | `justfile` | `default`, `doctor`, `setup`, `build`, `test`, `lint`, `format`, `check`, `clean`, `contracts` |
  | `backend` | `backend/mod.just` | `restore`, `build`, `test`, `lint`, `format`, `dev`, `contract` |
  | `frontend` | `frontend/mod.just` | `install`, `build`, `test`, `lint`, `typecheck`, `format`, `dev`, `generate` |
  | `docs` | `frontend/apps/docs/mod.just` | `dev`, `build`, `preview`, `bench`, `architecture` |
  | `db` | `db.just` | `up`, `down`, `reset`, `migrate`, `seed`, `psql` |
  | `image` | `image.just` | `build`, `run`, `smoke` |
  | `infra` | `infra/mod.just` | `what-if`, `deploy`, `secret-init`, `init-roles`, `migrate`, `db-stop`, `db-start`, `integration` |
  | `tools` | `tools/mod.just` | `test`, `versions`, `adr` |

* **File placement follows `just`'s default lookup.** `mod backend` finds `backend/mod.just`, so a module sits beside the code it runs and its working directory is that code's directory. A module with no directory of its own sits beside the root `justfile` as `<name>.just`, next to the file it wraps (`db.just` beside `compose.yaml`, `image.just` beside `Dockerfile`).
* **The root aggregates fan out.** `just build`, `test`, `lint`, `format`, `setup`, `clean` and `contracts` keep their names and meaning and call the module recipes. `just lint` still runs the stack checks first and the repo-tooling checks after them (`tools test`, `tools versions`, `tools adr`, `docs architecture`), as it does today. `just check` is unchanged.
* **Hard cut.** The old recipe names stop working, with no aliases, as when Make was replaced ([0011](0011-review-the-top-level-task-runner.md)). Every reference changes in the same PR as the recipes.
* **Dev recipes live in the modules.** `just backend dev`, `just frontend dev` and `just docs dev` replace `dev-api`, `dev-web` and `dev-docs`. There are no root shortcuts.
* **`adr-check` becomes `just tools adr`**, beside `tools test` and `tools versions`, because it is a .NET file-based repo tool under [ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md).
* **Pass-through arguments on `test`.** `just backend test` forwards its arguments to `dotnet test`, so a single test is `just backend test --project tests/Calendar.Domain.Tests --filter-method "*X*"`. The root `just test` takes no arguments. The frontend counterpart is an open question (see the PR for this card).
* **Behaviour parity.** A recipe does what it did, with the same commands in the same order. The new `restore`, `install` and `typecheck` recipes expose steps that `setup` and `lint` already ran.
* **Each module is self-contained.** It sets its own shell (`bash -euo pipefail`, as the root does) and, where its file does not sit in the directory it works in, its working directory.
* **ADR-0038 is amended, not superseded.** The tool choice and its drivers do not change, only the layout. The amendment records the module facts above, the chaining rule and the changed CI list and format check. The maintainer approves it in its own PR, as in [0011](0011-review-the-top-level-task-runner.md).
* **Every consumer changes in the implementation PR**, as `AGENTS.md` asks for breaking changes: `ci.yml`, `migrate.yml`, `tools/doctor/doctor.sh` and its hint text, `README.md`, `AGENTS.md`, `CLAUDE.md`, the runbooks, the skills, the benchmark README, the architecture model, the story cards and the ADRs. Statements in ADR-0038 and story 0011 that quote the commands run in the prototype stay, because they record what was measured.

### Not in this story

* **Aliases for the old names**, temporary or permanent. The maintainer chose a hard cut.
* **Nested modules**, such as `just infra db stop`. `infra db-stop` and `infra db-start` keep the flat names. A follow-up can nest them if the family keeps growing.
* **New behaviour in a recipe.** Besides `restore`, `install`, `typecheck` and the argument pass-through, no recipe gains a feature, and the native commands and their configuration do not change.
* **Changing the isolation rules** for concurrent worktrees in `AGENTS.md` (the Compose project name, volume key and PostgreSQL host port stay as [ADR-0016](../decisions/0016-local-database-provisioning.md) set them), or the rule that migrations are applied only by the `db migrate` recipe ([ADR-0015](../decisions/0015-ef-core-data-access.md)).
* **Replacing `just`** or revisiting the other options in [ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md).
* **A new `justfile` formatter or linter.** The existing `just --fmt --check` step stays, extended to the module files.

### Acceptance criteria

1. **Given** the modules, **when** I run `just` with no arguments, **then** it lists the root recipes and, for every module, its recipes with their comments, and the list matches the layout table above.
2. **Given** I run `just <module>` for any module with no recipe name, **when** the command ends, **then** it has listed that module's recipes and has run none of them. *(The mechanism is to be confirmed in the implementation.)*
3. **Given** I run `just setup`, `build`, `test`, `lint`, `format`, `clean`, `contracts` or `check`, **when** the command ends, **then** it ran the same native commands, in the same order, as the `justfile` on `main` at `ca8ce46e`. Compare with `just --dry-run` on both revisions.
4. **Given** I run any module recipe from the repository root or from a subdirectory such as `frontend/`, **when** it starts, **then** it runs in the directory its module works in (`backend/`, `frontend/` or the repo root) and sees the values in `.env`.
5. **Given** I run `just backend test --project tests/Calendar.Domain.Tests --filter-method "*X*"`, **when** the run ends, **then** only matching tests ran. The same recipe with no arguments runs the whole backend suite, and the root `just test` still takes no arguments.
6. **Given** I chain two recipes of one module, **when** I write `just db::up db::migrate`, **then** both run in that order. The README, `AGENTS.md` and the runbooks show this form and explain why `just db up migrate` is not valid.
7. **Given** a recipe name from before this story, such as `db-up` or `build-docs`, **when** I run it, **then** `just` stops with its "does not contain recipe" error, and no file in the repository names a removed recipe, except the recorded measurements in ADR-0038 and story [0011](0011-review-the-top-level-task-runner.md), which quote the commands that were run.
8. **Given** the CI workflows, **when** they run on the implementation PR, **then** each of the 6 call sites uses a new name, the Tooling job still runs the same four checks, and the check that lists recipes and formats the `justfile` covers the module files too.
9. **Given** `tools/doctor/doctor.sh` and the architecture model, **when** they name a recipe, **then** they name its new form, and the docs-site build and `just docs architecture` pass.
10. **Given** the `docs/` content loader, **when** `frontend/apps/docs/mod.just` and the other module files exist, **then** the docs site builds and `just docs build` passes.
11. **Given** the ADR-0038 amendment, **when** `just tools adr` runs, **then** it passes, and the maintainer approved the amendment in its PR before it merged.
12. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract if `just contracts` produces a diff.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0001](../decisions/0001-monorepo-layout.md) | Monorepo with `backend/` and `frontend/` stacks | The stack boundary the `backend` and `frontend` modules follow. |
| [0015](../decisions/0015-ef-core-data-access.md) | EF Core migrations applied only by the migration recipe, as `calendar_migrator` | The `db migrate` recipe keeps that rule; moving it must not let the app apply migrations. |
| [0016](../decisions/0016-local-database-provisioning.md) | Local PostgreSQL through Docker Compose | The `db` module wraps it, and the shared defaults (project name, volume key, host port) stay as they are. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling, in a skill folder or `tools/<name>/` | Why `adr-check` sits in `tools`, and why new module files add no tooling in another language. |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` as the top-level task runner | The decision this story amends. Its drivers (D2 thin over native tools, D3 discoverability) must still hold. |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | A CALM architecture model kept in step with the repo | The model names recipes such as `just contracts` and `just check`; it changes in the same PR. |

No new ADR is expected. The amendment to ADR-0038 records the layout change, in the way ADR-0017 was amended for the SDK minimum.

### Other decisions (not ADR-worthy)

* **Amend, not supersede:** the maintainer chose an amendment. The runner, its version pin and its drivers are unchanged, and a new ADR with a rating table would only restate them.
* **Stack modules included:** the maintainer chose per-stack modules over only splitting `db` and `infra`. They remove the `cd backend &&` and `--dir frontend` plumbing, because a module's working directory is its own folder.
* **Hard cut over aliases:** one name per recipe, as with the Make-to-`just` change. Only the maintainer and the maintainer's agents work in the repository, and an alias would leave two names for each task.
* **Modules beside the code:** the maintainer asked for the more typical layout. `just`'s default lookup (`<name>/mod.just`, or `<name>.just` beside the root file) is what its manual shows, so it needs no path argument on the `mod` line.
* **One PR for the rename and its consumers:** a hard cut cannot run old and new names side by side, and CI would fail between a rename and its call-site change. This follows the `AGENTS.md` rule for breaking changes: one PR with every consumer updated.
* **Module settings repeated, not shared:** `just` does not inherit them, so each module file starts with the same `set shell` line. A one-line repetition in 7 files is cheaper than a mechanism to generate it.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Delivery

Proposed order, each branch based on fresh `origin/main`:

1. **Card (PR 0):** this card and its index row.
2. **ADR-0038 amendment:** docs-only; accepted by the maintainer in its own PR, then merged.
3. **Modules and every consumer:** the module files, the root aggregates, CI, the doctor script, and every document and skill that names a recipe, in one PR with the check from criterion 8.
4. **Card update:** status, `pr` list, test links, measurements and the user guide. It can be part of PR 3.

### Where things live

| Area | Location |
| --- | --- |
| Root recipes and `mod` lines | `justfile` |
| Stack modules | `backend/mod.just`, `frontend/mod.just`, `frontend/apps/docs/mod.just` |
| Concern modules | `db.just`, `image.just`, `infra/mod.just`, `tools/mod.just` |
| CI call sites | `.github/workflows/ci.yml`, `.github/workflows/migrate.yml` |
| Toolchain check and hints | `tools/doctor/doctor.sh`, with tests in `tools/doctor/tests/doctor.tests.cs` |
| Architecture model | `docs/architecture/calendar.architecture.json` |
| Guidance | `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/runbooks/`, `.claude/skills/`, `docs/benchmarks/README.md`, the ADRs and story cards that name a recipe |

### API

No changes. The contract does not change, and `just contracts` keeps its name.

### Testing

* **Parity:** compare `just --dry-run` of every root aggregate and every renamed recipe against the same command on `main` at `ca8ce46e` (criterion 3). A recipe that needs `dotnet` or Docker and cannot run in a sandbox is checked this way only, and the PR says so.
* **Recipes run for real in CI:** `tools test`, `infra integration`, `tools versions`, `tools adr` and `image smoke`, in the same jobs as today.
* **Doctor tests:** the hint texts that name recipes, if they are asserted.
* **Docs tests and build:** the docs-site tests, `just docs build`, and `just docs architecture` for the model.
* **Not exercisable before merge:** the `just infra migrate` step in `migrate.yml`, which runs only from `main` by manual dispatch against Azure.

### Lessons learned, known issues and follow-ups

* **Measured, scratch directory:** the module behaviours listed under Background. Nothing has been run in the repository yet.
* **To verify during delivery:** how a module's `[default]` recipe can list its module (criterion 2); that `dotnet format whitespace --folder tools` and the ESLint and Prettier checks ignore the new `.just` files; and that `just --fmt --check`, still unstable in 1.59.0, accepts module files.
* **Possible follow-up:** nested modules (`just infra db stop`) and a `just docs test` recipe, if wanted after the first release of the layout.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Running a task as a contributor

1. Run `just` with no arguments to list every recipe, grouped by module.
2. The everyday commands keep their names: `just setup`, `just test`, `just lint`, `just format` and `just check`.
3. Everything else is `just <module> <recipe>`: for example `just db up`, `just backend dev`, `just frontend dev`, `just docs build` and `just infra what-if staging full --allow-ip <ipv4>`. `just --list <module>` shows one module's recipes.
4. Arguments follow the recipe name, for example `just db seed --date 2026-01-01` or `just backend test --filter-method "*X*"`.
5. To run several recipes of one module in one command, write each with `::`: `just db::up db::migrate`. Run recipes that take arguments as separate commands.

The old flat names, such as `just db-up`, no longer exist.
