---
status: implemented
date: 2026-11-03
issue: https://github.com/mgasca/calendar/issues/213
pr:
  - https://github.com/mgasca/calendar/pull/214
  - https://github.com/mgasca/calendar/pull/215
  - https://github.com/mgasca/calendar/pull/225
  - https://github.com/mgasca/calendar/pull/227
adrs: ["0001", "0015", "0016", "0017", "0038", "0039", "0042"]
---

# 0019 Split the justfile into modules

## Story

> As a contributor, whether a person or another agent, I need the task runner's recipes grouped into modules by stack and by concern, so that I find, name and run a task by what it works on instead of by a prefix in one flat list.

Tracked in issue #213. Card PR: [#214](https://github.com/mgasca/calendar/pull/214).

## Background

[ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md) chose `just` as the top-level task runner and recorded a thin layer over native tools as a driver. The `justfile` was ported from the Makefile at parity, so it was still one flat list.

* **Size:** 37 recipes in 238 lines (measured on `main` at `ca8ce46e`).
* **Prefix families:** the structure was already in the names: `db-*` (6 recipes), `infra-*` (8, counting `infra-integration`), `dev-*` and the `*-docs` recipes (`dev-docs`, `build-docs`, `preview-docs`, `bench-docs`), and `image`, `run-image` and `smoke-image`.
* **Stacks hidden in variables:** the stacks were reached through `dotnet := "cd backend && dotnet"` and `pnpm := "pnpm --dir frontend"`. A recipe that had to run `dotnet ef` or call a different pnpm package repeated the `cd` or the `--filter`.
* **Reach:** 59 tracked files named a recipe (measured with a search for the actual recipe names, so an upper bound for the files a rename touches). CI had 6 call sites: 5 in `ci.yml` and 1 in `migrate.yml`.

`just` has had stable modules (`mod`) since 1.31.0 (2024-07-14), the `working-directory` setting since 1.33.0 and the `[default]` recipe attribute since 1.43.0 (from the release notes), and `.just-version` pins 1.59.0. The behaviours below were checked on 1.59.0 in a scratch directory before the design was agreed, and are the facts it relies on:

* A module recipe runs with the module file's directory as its working directory. `set working-directory := '..'` changes that, and `[no-cd]` keeps the caller's directory.
* Module settings are not inherited: a module without `set shell` ran its recipes under `sh`, not bash. The root's `.env` values were visible to module recipes.
* A module is called as `just db up` or `just db::up`. Chaining needs the `::` form: `just db up migrate` fails with "does not contain recipe `migrate`", and `just db::up db::migrate` works.
* Bare `just db` runs the module's first recipe unless one is marked `[default]`.
* Plain `just --list` shows a module as `db ...`. `just --list --list-submodules` shows every recipe, and `just --list db` shows one module.
* A root recipe may depend on a module recipe (`check: backend::lint`). A module recipe cannot depend on a root recipe.
* Run from a subdirectory such as `frontend/`, `just` finds the root `justfile`, and a module recipe still runs in its own directory.
* `just --fmt --check` run at the root checks only the root file: with a badly formatted module file beside it, the command exited 0. The same command with `--justfile <module file>` found the difference and exited 1. `--fmt` also ran without `--unstable`, so the "still unstable in 1.59.0" notes in ADR-0038 and story 0011 are out of date.
* ADR-0038's Confirmation said a CI step runs `just --list` and the `justfile` format check. No workflow under `.github/` did (checked with a search of `.github/` for `--fmt` and `--list`).

### Agreed scope

Decided with the maintainer on 2026-11-03, and delivered as agreed except where marked:

* **Modules by stack and by concern.** The root keeps the cross-stack aggregates and the bootstrap recipes; everything else moves into a module. The delivered layout:

  | Module | File | Recipes |
  | --- | --- | --- |
  | root | `justfile` | `default`, `doctor`, `setup`, `build`, `test`, `lint`, `format`, `check`, `clean`, `contracts` |
  | `backend` | `backend/mod.just` | `restore`, `build`, `test`, `lint`, `format`, `dev`, `contract`, `clean` |
  | `frontend` | `frontend/mod.just` | `install`, `build`, `test`, `test-web`, `lint`, `typecheck`, `format`, `dev`, `generate`, `clean` |
  | `docs` | `frontend/apps/docs/mod.just` | `dev`, `build`, `preview`, `bench`, `test`, `architecture` |
  | `db` | `db.just` | `up`, `down`, `reset`, `migrate`, `seed`, `psql` |
  | `image` | `image.just` | `build`, `run`, `smoke` |
  | `infra` | `infra/mod.just` | `what-if`, `deploy`, `secret-init`, `init-roles`, `migrate`, `db-stop`, `db-start`, `integration` |
  | `tools` | `tools/mod.just` | `test`, `versions`, `adr`, `format` |

  *Added during delivery:* `backend clean` and `frontend clean`, so the root `clean` fans out like the other aggregates, and `tools format`, because module variables are not shared and the list of tool folders (`tool_dirs`) now lives in the `tools` module.
* **File placement follows `just`'s default lookup.** `mod backend` finds `backend/mod.just`, so a module sits beside the code it runs and its working directory is that code's directory. A module with no directory of its own sits beside the root `justfile` as `<name>.just`, next to the file it wraps (`db.just` beside `compose.yaml`, `image.just` beside `Dockerfile`). `docs` is the one `mod` line with a path, because `docs/` at the root holds the documents, not the site.
* **The root aggregates fan out.** `just build`, `test`, `lint`, `format`, `setup`, `clean` and `contracts` keep their names and meaning and call the module recipes. `just lint` still runs the stack checks first and the repo-tooling checks after them (`tools test`, `tools versions`, `tools adr`, `docs architecture`). `just check` is unchanged.
* **Hard cut.** The old recipe names stop working, with no aliases, as when Make was replaced ([0011](0011-review-the-top-level-task-runner.md)). Every reference changed in the same PR as the recipes.
* **Dev recipes live in the modules.** `just backend dev`, `just frontend dev` and `just docs dev` replace `dev-api`, `dev-web` and `dev-docs`. There are no root shortcuts.
* **`adr-check` becomes `just tools adr`**, beside `tools test` and `tools versions`, because it is a .NET file-based repo tool under [ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md).
* **Pass-through arguments on `test`.** `just backend test` forwards its arguments to `dotnet test`, so a single test is `just backend test --project tests/Calendar.Domain.Tests --filter-method "*X*"`. The root `just test` takes no arguments. *Added during delivery:* `just backend restore` forwards its arguments to `dotnet restore` the same way, so the offline restore in `AGENTS.md` is `just backend restore -p:NuGetAudit=false`. On the frontend, `just frontend test` runs the whole workspace and takes no arguments, `just frontend test-web *args` runs a pattern in `@calendar/web`, and `just docs test *args` does the same for the docs app (decided with the maintainer on the PR for this card), so no argument changes what a recipe means. The docs app's own test script filters on `src`, and Vitest combines filters, so `just docs test` passes its arguments to Vitest in place of `src` rather than beside it.
* **Behaviour parity.** A recipe does what it did, with the same commands in the same order. The new `restore`, `install`, `typecheck` and `clean` recipes expose steps that `setup`, `lint` and `clean` already ran.
* **Each module is self-contained.** It sets its own shell (`bash -euo pipefail`, as the root does) and, where its file does not sit in the directory it works in, its working directory. Each marks a private `[default]` recipe that lists the module, so a bare `just <module>` runs nothing.
* **ADR-0038 is amended, not superseded.** The tool choice and its drivers do not change, only the layout. The amendment records the module facts above, the chaining rule, and the CI step that lists the recipes and format-checks each file. The maintainer approved it in its own PR, as in [0011](0011-review-the-top-level-task-runner.md).
* **Every consumer changes in the implementation PR**, as `AGENTS.md` asks for breaking changes: `ci.yml`, `migrate.yml`, `tools/doctor/doctor.sh` and its hint text, `README.md`, `AGENTS.md` and the nested `backend/AGENTS.md` and `frontend/AGENTS.md` (which also now give the recipe instead of a native command wherever one exists: `just frontend install`, `lint`, `typecheck` and `test`, `just backend restore`; `format:check` stays native, because no recipe only checks formatting), the runbooks, the skills, the benchmark README, the architecture model, the story cards and the ADRs. Statements in ADR-0038 and story 0011 that quote the commands run in the prototype stay, because they record what was measured.
* *Added during delivery:* **the agent-hooks shared-database guard follows the new names.** [ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md)'s hook, merged while this story was open, asks before a linked worktree runs a `db` recipe on the shared database. It matched only the flat `db-*` names, so the rename would have switched it off silently. It now matches `db up` and `db::up`; `db seed` still passes, as before.

### Not in this story

* **Aliases for the old names**, temporary or permanent. The maintainer chose a hard cut.
* **Nested modules**, such as `just infra db stop`. `infra db-stop` and `infra db-start` keep the flat names. A follow-up can nest them if the family keeps growing.
* **New behaviour in a recipe.** Besides `restore`, `install`, `typecheck`, the module `clean` recipes and the argument pass-through, no recipe gains a feature, and the native commands and their configuration do not change.
* **Changing the isolation rules** for concurrent worktrees in `AGENTS.md` (the Compose project name, volume key and PostgreSQL host port stay as [ADR-0016](../decisions/0016-local-database-provisioning.md) set them), or the rule that migrations are applied only by the `db migrate` recipe ([ADR-0015](../decisions/0015-ef-core-data-access.md)).
* **Replacing `just`** or revisiting the other options in [ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md).
* **Other new checks.** The list-and-format step that ADR-0038 describes is part of this story (criterion 8), because it did not exist. No other formatter or linter is added; in particular nothing checks that every recipe has a comment (see the follow-ups).

### Acceptance criteria

Evidence is marked **CI** (run on the PR head), **local** (run by the implementing agent on WSL2 with `just` 1.59.0, pnpm 12.15.0 and .NET SDK 10.0.403, because the system SDK is below the 10.0.300 minimum for the repo tools), or **by reading**. The parity harness was a throwaway script and is not committed, so its results are reported evidence, not a repeatable test.

1. **Given** the modules, **when** I run `just` with no arguments, **then** it lists the root recipes and, for every module, its recipes with their comments, and the list matches the layout table above.
   *Met, local and CI.* The output was compared with the table by reading. CI's Tooling job runs `just --list --list-submodules` on every PR ([`ci.yml`](../../.github/workflows/ci.yml), step "justfile and its modules parse and are formatted"). The comments above the `mod` lines are not shown by `just --list` in 1.59.0.
2. **Given** I run `just <module>` for any module with no recipe name, **when** the command ends, **then** it has listed that module's recipes and has run none of them.
   *Met, local.* Each module marks a private `list` recipe `[default]` that runs `just --list <module>`; `just backend`, `frontend`, `docs`, `db`, `image`, `infra` and `tools` each printed their module's list. No automated test.
3. **Given** I run `just setup`, `build`, `test`, `lint`, `format`, `clean`, `contracts` or `check`, **when** the command ends, **then** it ran the same native commands, in the same order, as the `justfile` on `main` at `ca8ce46e`.
   *Met, local, stronger than the `--dry-run` comparison planned.* All 29 old recipes and their new forms ran against stub `dotnet`, `pnpm`, `docker`, `git`, `curl`, `find` and `shellcheck` executables that logged working directory, command and arguments. Every `dotnet`, `docker`, `git` and `curl` call was identical, with the same exit codes and printed output. The `pnpm` and `find` calls differ only as intended: `pnpm --dir frontend X` became `pnpm X` in `frontend/`, the docs app's `pnpm --dir frontend --filter @calendar/docs X` became `pnpm X` in `frontend/apps/docs`, and `find frontend …` became `find . …` in `frontend/`. `setup` and the five `infra` recipes that call `doctor.sh` were compared with `--dry-run` only.
4. **Given** I run any module recipe from the repository root or from a subdirectory such as `frontend/`, **when** it starts, **then** it runs in the directory its module works in (`backend/`, `frontend/` or the repo root) and sees the values in `.env`.
   *Met, local.* `backend dev`, `frontend dev`, `docs dev`, `db psql`, `tools versions` and `infra integration` were run with logging stubs from the root, `frontend/`, `frontend/apps/docs` and `backend/src`, with a temporary `.env` and the variables unset in the shell. Each ran in its module's directory, `db psql` received the database name and password from `.env`, and `backend dev` found the Google credentials there.
5. **Given** I run `just backend test --project tests/Calendar.Domain.Tests --filter-…`, **when** the run ends, **then** only matching tests ran. The same recipe with no arguments runs the whole backend suite, and the root `just test` still takes no arguments. The frontend equivalents are `just frontend test-web <pattern>` and `just docs test <pattern>`, and `just frontend test` runs the whole workspace.
   *Met, local.* `--filter-class "*CalendarEventTests"` ran 27 of the 180 Domain tests; `--project tests/Calendar.Domain.Tests` alone ran 180. `just frontend test-web src/App.test.tsx` ran 1 file (22 tests), `just docs test src/lib/adr.test.ts` 1 file (73 tests) and `just docs test` 3 files (139 tests at the time). `just frontend test` ran every package. The first version of `docs test` passed the pattern beside the script's `src` filter and still ran every file; that was found by this check and fixed before the PR left draft.
6. **Given** I chain two recipes of one module, **when** I write `just db::up db::migrate`, **then** both run in that order, and the guidance shows this form and explains why `just db up migrate` is not valid.
   *Met, local and by reading.* `just --dry-run db::up db::migrate` showed both, in order; `just db up migrate` stopped with "does not contain recipe `migrate`". `README.md` ("Common tasks"), `AGENTS.md` ("Commands") and story 0011's user guide show the `::` form. The runbooks chain no recipes, so they had nothing to change.
7. **Given** a recipe name from before this story, such as `db-up` or `build-docs`, **when** I run it, **then** `just` stops with its "does not contain recipe" error, and no file in the repository names a removed recipe as a command to run.
   *Met, local.* `just db-up` stops with the error. A search of the tree for every old name finds them only where they are history: the recorded measurements in ADR-0038 and story [0011](0011-review-the-top-level-task-runner.md), ADR-0016's "Make targets" line, which describes the Makefile of that time (story 0011 left it the same way), and this card, the ADR-0038 amendment and story 0020, which name the old recipes as the thing that changed.
8. **Given** the CI workflows, **when** they run on the implementation PR, **then** each of the 6 call sites uses a new name, the Tooling job still runs the same four checks, and a new step runs `just --list --list-submodules` and `just --fmt --check` on the root `justfile` and on each module file separately with `--justfile`.
   *Met, CI.* All checks passed on [#227](https://github.com/mgasca/calendar/pull/227), including Tooling (`just tools test`, `just infra integration`, `just tools versions`, `just tools adr` and the new step) and Container image (`just image smoke`). The new step reads every tracked `justfile` and `*.just` file with `git ls-files`, so a new module is covered without editing CI. Locally it passed on the 8 files and exited 123 with a badly formatted module.
9. **Given** `tools/doctor/doctor.sh` and the architecture model, **when** they name a recipe, **then** they name its new form, and the docs-site build and `just docs architecture` pass.
   *Met, local and CI.* The doctor hint now lists `just tools adr, tools test, tools versions, db seed and lint` ([`doctor.sh`](../../tools/doctor/doctor.sh)); the 12 doctor tests pass. The model's repository-checks entry, which said `just --fmt --check` although nothing ran it, now describes the new step. `calm validate` reports no errors or warnings.
10. **Given** the `docs/` content loader, **when** `frontend/apps/docs/mod.just` and the other module files exist, **then** the docs site builds and `just docs build` passes.
    *Met, local and CI.* `just docs build` built 105 pages and passed its 7 build checks. ESLint, Prettier and `dotnet format whitespace --folder tools` all ignore the `.just` files.
11. **Given** the ADR-0038 amendment, **when** `just tools adr` runs, **then** it passes, and the maintainer approved the amendment in its PR before it merged.
    *Met.* The maintainer approved it "as is" on [#215](https://github.com/mgasca/calendar/pull/215) before it merged. `just tools adr` reports all 43 ADRs `OK`, locally and in CI.
12. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract if `just contracts` produces a diff.
    *Met in parts.* Locally, `just lint` passed end to end through the new fan-out, and `just frontend test` and the Domain tests passed. The backend API and infrastructure tests need Docker and did not run locally (only rootless podman was available); CI's Backend job runs them and the stale-contract check, and passed. `just check` as one command was not run in one place.
13. **Given** an agent in a linked worktree, **when** it runs a `db` recipe that uses the shared database, as `just db migrate` or `just db::up db::migrate`, **then** the hook asks first; `just db seed`, bare `just db` and other modules pass. *(Added during delivery.)*
    *Met, tested.* [`BashGuardTests`](../../tools/agent-hooks/tests/BashGuardTests.cs) (`Shared_database_from_a_linked_worktree_asks`, `Shared_database_passes_from_the_main_checkout_and_isolated_commands_pass_anywhere`) and [`HookRunnerTests`](../../tools/agent-hooks/tests/HookRunnerTests.cs) (`Pre_bash_ask_and_pass`). With the renamed commands, the old guard failed 5 of 63 tests; with the fix all 66 pass.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0001](../decisions/0001-monorepo-layout.md) | Monorepo with `backend/` and `frontend/` stacks | The stack boundary the `backend` and `frontend` modules follow. |
| [0015](../decisions/0015-ef-core-data-access.md) | EF Core migrations applied only by the migration recipe, as `calendar_migrator` | The `db migrate` recipe keeps that rule; moving it does not let the app apply migrations. |
| [0016](../decisions/0016-local-database-provisioning.md) | Local PostgreSQL through Docker Compose | The `db` module wraps it, and the shared defaults (project name, volume key, host port) stay as they are. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling, in a skill folder or `tools/<name>/` | Why `adr-check` sits in `tools`, and why the module files add no tooling in another language. |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` as the top-level task runner | The decision this story amends. Its drivers (D2 thin over native tools, D3 discoverability) still hold. |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | A CALM architecture model kept in step with the repo | The model names recipes such as `just contracts` and `just check`; it changed in the same PR. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layered agent guidance and hooks as a .NET tool | Its shared-database hook matches recipe names, so the rename had to change it. |

No new ADR was needed. The amendment to ADR-0038 records the layout change, in the way ADR-0017 was amended for the SDK minimum.

### Other decisions (not ADR-worthy)

* **Amend, not supersede:** the maintainer chose an amendment. The runner, its version pin and its drivers are unchanged, and a new ADR with a rating table would only restate them.
* **Stack modules included:** the maintainer chose per-stack modules over only splitting `db` and `infra`. They remove the `cd backend &&` and `--dir frontend` plumbing, because a module's working directory is its own folder.
* **Hard cut over aliases:** one name per recipe, as with the Make-to-`just` change. Only the maintainer and the maintainer's agents work in the repository, and an alias would leave two names for each task.
* **Modules beside the code:** the maintainer asked for the more typical layout. `just`'s default lookup (`<name>/mod.just`, or `<name>.just` beside the root file) is what its manual shows, so only `docs` needs a path on its `mod` line.
* **One PR for the rename and its consumers:** a hard cut cannot run old and new names side by side, and CI would fail between a rename and its call-site change. This follows the `AGENTS.md` rule for breaking changes: one PR with every consumer updated. It was kept a draft until #222 and #223, which touched the same files, merged, and then rebased once.
* **Module settings repeated, not shared:** `just` does not inherit them, so each module file starts with the same `set shell` line. A one-line repetition in 7 files is cheaper than a mechanism to generate it.
* **Old names in records stay:** a command quoted as what was run (ADR-0038's measurements, story 0011's results, ADR-0016's Make targets) keeps its name; a command someone would copy and run uses the new name. This is the rule story 0011 applied to `make`.

## Implementation notes

### Delivery

1. **Card (PR 0):** [#214](https://github.com/mgasca/calendar/pull/214), with a correction of the format-check facts.
2. **ADR-0038 amendment:** [#215](https://github.com/mgasca/calendar/pull/215), approved by the maintainer and merged.
3. **Frontend test arguments:** [#225](https://github.com/mgasca/calendar/pull/225), recording the answer to the card's open question.
4. **Modules, every consumer and this card update:** [#227](https://github.com/mgasca/calendar/pull/227), which carries `Closes #213`. It was rebased once onto #222, #223, #220 and #226; the second commit fixes the hook guard and renames the references those PRs added.

### Where things live

| Area | Location |
| --- | --- |
| Root recipes and `mod` lines | `justfile` |
| Stack modules | `backend/mod.just`, `frontend/mod.just`, `frontend/apps/docs/mod.just` |
| Concern modules | `db.just`, `image.just`, `infra/mod.just`, `tools/mod.just` (which holds `tool_dirs`) |
| CI | `.github/workflows/ci.yml` (Tooling job: the list and format step, then `tools test`, `infra integration`, `tools versions`, `tools adr`; Container image: `image smoke`), `.github/workflows/migrate.yml` (`infra migrate`) |
| Shared-database hook | `tools/agent-hooks/BashGuard.cs` (`DbRecipeRegex`), tests in `tools/agent-hooks/tests/` |
| Toolchain check and hints | `tools/doctor/doctor.sh`, with tests in `tools/doctor/tests/doctor.tests.cs` |
| Architecture model | `docs/architecture/calendar.architecture.json` |
| Guidance | `README.md` ("Common tasks"), `AGENTS.md` ("Commands"), `backend/AGENTS.md`, `frontend/AGENTS.md`, `tools/README.md`, `docs/runbooks/`, `.claude/skills/`, `docs/benchmarks/README.md` |

### API

No changes. The contract does not change, and `just contracts` keeps its name.

### Testing

* **Parity (local, throwaway harness):** see criterion 3.
* **Working directory and `.env` (local):** see criterion 4.
* **Recipes run for real in CI:** `tools test`, `infra integration`, `tools versions`, `tools adr`, `image smoke`, and the list and format step.
* **Hook guard:** `BashGuardTests` and `HookRunnerTests` in `tools/agent-hooks/tests/`, run by `just tools test`.
* **Docs tests and build:** the docs-site tests, `just docs build`, and `just docs architecture` for the model.
* **Not exercised before merge:** the `just infra migrate` step in `migrate.yml`, which runs only from `main` by manual dispatch against Azure, and the other `infra` recipes, which need Azure (checked by `--dry-run`).

### Lessons learned, known issues and follow-ups

* **A rename reaches code, not only documents.** The hook guard matched recipe names in a regex. A search for command strings found its tests, and the tests then showed the guard had stopped working. Search code and tests for recipe names, not only the docs.
* **Check what a pass-through argument actually does.** `just docs test <file>` looked right and ran every file, because Vitest combines filters. Only counting the files that ran showed it.
* **A confirmation step can be written and never built.** ADR-0038 and the architecture model both said CI runs `just --fmt --check`; no workflow did. Check that a described step exists before relying on it.
* **`just --fmt --check` covers one file.** At the root it does not reach module files, so CI checks each file with `--justfile`.
* **A partly installed `node_modules`** (from a filtered install) made ESLint report hundreds of `no-unsafe-*` errors in a file nobody had changed. `just frontend install` fixed it with no code change, as `frontend/AGENTS.md` says.
* **Known issue:** `just --list` does not show the comments above the `mod` lines, so a module's purpose appears only in its recipes' comments.
* **Known gap:** ADR-0038's Confirmation also says a missing recipe comment is caught. Neither `just --list` nor `just --fmt --check` fails on one, so nothing enforces it. A follow-up could add a check over `just --dump --dump-format json`.
* **Open PRs to update:** #128, #150 and #120 name old recipes in CI, runbooks and `tools/infra/README.md`; they need the new names when next rebased.
* **Possible follow-up:** nested modules (`just infra db stop`), if wanted.

## User guide

### Running a task as a contributor

1. Run `just` with no arguments to list every recipe, grouped by module.
2. The everyday commands keep their names: `just setup`, `just test`, `just lint`, `just format` and `just check`.
3. Everything else is `just <module> <recipe>`: for example `just db up`, `just backend dev`, `just frontend dev`, `just docs build` and `just infra what-if staging full --allow-ip <ipv4>`. `just <module>` on its own, or `just --list <module>`, shows one module's recipes.
4. Arguments follow the recipe name, for example `just db seed --date 2026-01-01` or `just backend test --filter-method "*X*"`. To run one frontend test, use `just frontend test-web <pattern>`; for the docs app, `just docs test <pattern>`.
5. To run several recipes of one module in one command, write each with `::`: `just db::up db::migrate`. Run recipes that take arguments as separate commands.

The old flat names, such as `just db-up`, no longer exist: `just` stops with "does not contain recipe".
