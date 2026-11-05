---
status: in-progress
date: 2026-11-05
issue: https://github.com/mgasca/calendar/issues/247
pr:
  - https://github.com/mgasca/calendar/pull/248
  - https://github.com/mgasca/calendar/pull/249
adrs: ["0017", "0038", "0042"]
---

# 0023 Chain a module's recipes in one command

## Story

> As a contributor, whether a person or another agent, I need to run several recipes of one module in order with one command, stopping at the first failure, so that "build, then test if the build passed" is one short command that runs only that module's recipes.

Tracked in issue #247. Delivery PR: [#248](https://github.com/mgasca/calendar/pull/248), opened before this card; card PR: [#249](https://github.com/mgasca/calendar/pull/249), written afterwards at the maintainer's request.

## Background

[Story 0019](0019-split-the-justfile-into-modules.md) moved the recipes into seven modules (`backend`, `frontend`, `docs`, `db`, `image`, `infra`, `tools`), called as `just <module> <recipe>`. To chain recipes it recorded the `::` form: `just db::up db::migrate` works and `just db up migrate` fails. That form has two costs, measured on `just` 1.59.0 on 2026-11-05:

* **The natural spelling does something else.** `just backend build test` does not fail: only the first word after a module is looked up in the module, and every later word in the root `justfile`. `just -n backend build test` printed `dotnet build --no-restore`, `dotnet test` and `pnpm test`, so `test` meant the root `test`, which runs the frontend suite too.
* **Arguments swallow names.** In the `::` form, a recipe that takes `*args` receives every word after it. `just backend::restore backend::build backend::test --project …` passed `backend::build backend::test --project …` to `dotnet restore`, which stopped with "Only one project can be specified". `AGENTS.md` therefore says to run such recipes separately.

`just` has no setting that makes later words resolve in the module. Three ways were weighed with the maintainer: named combination recipes per module (`verify: build test`), a runner recipe that takes recipe names, and wrapping `just` itself. The maintainer chose the runner.

[Story 0011](0011-review-the-top-level-task-runner.md) chose `just` and [story 0020](0020-restructure-agent-guidance.md) added the agent hooks. This story reuses both and changes neither decision.

### Agreed scope

* **One command per module:** `just <module> do <recipe>...` runs the named recipes of that module in the order given. It exists in all seven modules and is listed by `just --list <module>` with a usage comment.
* **Stop at the first failure:** when a recipe fails, the recipes after it do not run, and the command exits non-zero.
* **Check names first:** a name that is not a recipe of the module stops the command before any recipe runs, and the error names it.
* **Arguments go to the last recipe:** from the first word after the names that starts with `-`, the words are passed unchanged to the last recipe only (`just backend do restore build test --project tests/Calendar.Domain.Tests`).
* **Options for every call:** words that start with `-` right after `do` are `just` options for each recipe's call. `-n` previews each recipe's commands without running them (`just db do -n up migrate`). An option that takes a value is written with `=`.
* **No name, no run:** `do` with no recipe name prints its usage and exits with an error.
* **The shared-database hook still asks:** an agent in a linked worktree that runs a `db do` chain naming `up`, `down`, `reset`, `migrate` or `psql` is asked first, as for `just db up` today. `db do seed …` and other modules' chains pass.
* **Guidance:** `AGENTS.md` ("Commands") and `README.md` ("Common tasks") show `do` and explain why `just backend build test` runs the root `test`. ADR-0038 is amended with the design and evidence, and ADR-0042 lists the new hook form.

### Not in this story

* **Chaining root recipes.** The root already chains natively (`just build test`), because its words resolve at the root.
* **Recipes from more than one module in one chain.** Use the `::` form (`just backend::build frontend::build`) or separate commands.
* **Positional arguments that do not start with `-`** for the last recipe, such as `just image do build run Development` or `just infra do what-if staging`. The word is read as a recipe name and the command stops before anything runs. See open question 1 in the card PR.
* **Previewing with `-n` before the module** (`just -n backend do build test`). A recipe cannot tell that `just` was started with `--dry-run`, so that previews only the runner. Write `-n` after `do`.
* **Running a shared dependency once.** Each recipe runs in its own `just` call, so a dependency two chained recipes share runs twice. Only `db reset` declares one today (`&& up`).
* **Nested modules** (`just infra db stop`), still a possible follow-up of story 0019.
* **Removing the `::` form.** It keeps working and stays documented.

### Acceptance criteria

1. **Given** the backend module, **when** I run `just backend do build test`, **then** `backend::build` runs and then `backend::test`, and no root or frontend recipe runs.
2. **Given** a chain whose first recipe fails, **when** I run `just backend do build test` and the build fails, **then** the tests do not run and the command exits non-zero.
3. **Given** a chain with a name that is not a recipe of the module, **when** I run `just backend do clean nope test`, **then** no recipe runs, not even `clean`, and the error names `nope`.
4. **Given** a chain with arguments, **when** I run `just backend do restore build test --project tests/Calendar.Domain.Tests`, **then** all three run in order and only `dotnet test` receives `--project tests/Calendar.Domain.Tests`.
5. **Given** `-n` right after `do`, **when** I run `just db do -n up migrate`, **then** the commands of `db up` and `db migrate` are printed and none runs.
6. **Given** any of the seven modules, **when** I run `just --list <module>`, **then** `do` is listed with its usage, and `just <module> do <recipe>` runs that module's recipe.
7. **Given** no recipe name, **when** I run `just backend do --x`, **then** nothing runs, a usage message is printed and the command exits non-zero.
8. **Given** an agent in a linked worktree, **when** it runs `just db do up migrate`, `just db do -n reset` or `just db::do seed psql`, **then** the hook asks first; `just db do seed --api-url http://localhost:55041` and `just backend do build test` pass.
9. **Given** a contributor reads `AGENTS.md` or `README.md`, **when** they look up how to run several recipes of a module, **then** both show `do`, say that arguments go to the last recipe, and explain that `just backend build test` runs the root `test`.
10. **Given** the change is complete, **when** I run `just check` and the CI format check on every `justfile` and `*.just` file, **then** both pass.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` as the top-level task runner, with recipes in modules | The decision this story amends again, as story 0019 did. Its drivers (D2 thin over native tools, D3 discoverability, D4 expressiveness) rate the runner. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layered agent guidance and hooks as a .NET tool | Its shared-database hook matches recipe names, so a new way to name `db` recipes must not get past it. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling, never Python, Node or shell | Why the runner stays a short recipe body and is not grown into a shell tool. |

No new ADR is expected. The ADR-0038 amendment records the recipe, as the 2026-11-04 amendment recorded the modules.

### Other decisions (not ADR-worthy)

* **A runner, not combination recipes:** the maintainer chose one runner that takes any names over a named recipe for each combination (`verify: build test`), so a new combination needs no edit.
* **Written once, imported by each module:** an imported recipe belongs to the importing module, and `module_path()` names that module, so one definition serves all seven and the root `justfile` does not change.
* **Named `do`:** `run` was the first idea, but `image run` already exists.
* **One `just` call per recipe:** a single call with `module::` names would let a recipe that takes `*args` swallow the names after it, the problem in the background. Separate calls cost a shared dependency running twice, which affects no chain today.
* **A recipe body, not a tool:** about 20 lines of bash in a recipe, like the shebang recipes that already exist (`backend dev`). A .NET file-based app (ADR-0017) would add a `dotnet` start-up to every chain for no gain. If the logic grows, it moves to a tool.
* **Amend, not supersede:** the runner and its drivers are unchanged; the amendment adds a recipe.

## Implementation notes

*In progress. The delivery is in [PR #248](https://github.com/mgasca/calendar/pull/248); this section is completed when it merges.*

### Where things live

| Area | Location |
| --- | --- |
| The `do` recipe | `just/do.just` |
| The import in each module | `backend/mod.just`, `frontend/mod.just`, `frontend/apps/docs/mod.just`, `db.just`, `image.just`, `infra/mod.just`, `tools/mod.just` |
| Shared-database hook | `tools/agent-hooks/BashGuard.cs` (`DbRecipeRegex`), tests in `tools/agent-hooks/tests/BashGuardTests.cs` |
| Guidance | `AGENTS.md` ("Commands"), `README.md` ("Common tasks"), the ADR-0038 amendment of 2026-11-05, ADR-0042's hook forms |

### API

No changes.

### Testing

* **Hook:** `BashGuardTests` theory cases for the `db do` forms that ask and the chains that pass, each confirmed to fail against the old pattern.
* **The recipe:** checked by hand on `just` 1.59.0 for criteria 1 to 7; `just` recipes have no test harness in this repo. The CI step "justfile and its modules parse and are formatted" covers parsing and formatting for every module file and `just/do.just`.

### Lessons learned, known issues and follow-ups

* To be written on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Running several recipes of one module

1. Write the module, then `do`, then the recipes in the order you want: `just backend do build test`. The tests run only if the build passed.
2. To pass arguments, put them after the last recipe. They go to that recipe only: `just backend do restore build test --filter-method "*Overdue*"`.
3. To see what would run without running it, put `-n` right after `do`: `just db do -n up migrate`.
4. A mistyped name stops the command before anything runs.

Without `do`, only the first recipe comes from the module: `just backend build test` builds the backend and then runs the **whole** test suite, frontend included. The older form `just backend::build backend::test` still works when only the last recipe takes arguments.

Current limitations: the last recipe's arguments must start with `-` (so `just image do build run Development` does not work yet), and `-n` must come after `do`, not before the module.
