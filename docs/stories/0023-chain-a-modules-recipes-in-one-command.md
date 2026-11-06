---
status: implemented
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

Tracked in issue #247. Delivery PR: [#248](https://github.com/mgasca/calendar/pull/248), opened before this card; card PR: [#249](https://github.com/mgasca/calendar/pull/249), written afterwards at the maintainer's request. #248 also completes the card.

**Naming update:** [story 0026](0026-read-module-recipe-chains-with-run.md) renames the shared recipe to `run` and container startup to `image start`. The scope, design and measured commands below record the original delivery using `do`; the user guide uses the current spelling. The shared recipe now lives in `just/run.just`.

## Background

[Story 0019](0019-split-the-justfile-into-modules.md) moved the recipes into seven modules (`backend`, `frontend`, `docs`, `db`, `image`, `infra`, `tools`), called as `just <module> <recipe>`. To chain recipes it recorded the `::` form: `just db::up db::migrate` works and `just db up migrate` fails. That form has two costs, measured on `just` 1.59.0 on 2026-11-05:

* **The natural spelling does something else.** `just backend build test` does not fail: only the first word after a module is looked up in the module, and every later word in the root `justfile`. `just -n backend build test` printed `dotnet build --no-restore`, `dotnet test` and `pnpm test`, so `test` meant the root `test`, which runs the frontend suite too.
* **Arguments swallow names.** In the `::` form, a recipe that takes `*args` receives every word after it. `just backend::restore backend::build backend::test --project …` passed `backend::build backend::test --project …` to `dotnet restore`, which stopped with "Only one project can be specified". `AGENTS.md` therefore said to run such recipes separately.

`just` has no setting that makes later words resolve in the module. Three ways were weighed with the maintainer: named combination recipes per module (`verify: build test`), a runner recipe that takes recipe names, and wrapping `just` itself. The maintainer chose the runner.

[Story 0011](0011-review-the-top-level-task-runner.md) chose `just` and [story 0020](0020-restructure-agent-guidance.md) added the agent hooks. This story reuses both and changes neither decision.

### Agreed scope

* **One command per module:** `just <module> do <recipe>...` runs the named recipes of that module in the order given. It exists in all seven modules and is listed by `just --list <module>` with a usage comment.
* **Stop at the first failure:** when a recipe fails, the recipes after it do not run, and the command exits non-zero.
* **Check names first:** a name that is not a recipe of the module stops the command before any recipe runs. The error names it and suggests `--` for an argument.
* **Arguments go to the last recipe:** from the first word after the names that starts with `-`, the words are passed unchanged to the last recipe only (`just backend do restore build test --project tests/Calendar.Domain.Tests`).
* **`--` for other arguments:** a `--` after the names ends them and is dropped, so an argument that does not start with `-` can follow (`just image do build run -- Development`, `just infra do what-if -- staging`). A second `--` reaches the recipe. *Added in review: the answer to open question 1 on the card PR.*
* **Options for every call:** words that start with `-` right after `do` are `just` options for each recipe's call. `-n` previews each recipe's commands without running them (`just db do -n up migrate`). An option that takes a value is written with `=`.
* **No name, no run:** `do` with no recipe name prints its usage and exits with an error.
* **The shared-database hook still asks:** an agent in a linked worktree that runs a `db do` chain naming `up`, `down`, `reset`, `migrate` or `psql` is asked first, as for `just db up`. `db do seed …` and other modules' chains pass.
* **Guidance:** `AGENTS.md` ("Commands") and `README.md` ("Common tasks") show `do` and explain why `just backend build test` runs the root `test`. ADR-0038 is amended with the design and evidence, and ADR-0042 lists the new hook form.

### Not in this story

* **Chaining root recipes.** The root already chains natively (`just build test`), because its words resolve at the root.
* **Recipes from more than one module in one chain.** Use the `::` form (`just backend::build frontend::build`) or separate commands.
* **Previewing with `-n` before the module** (`just -n backend do build test`). A recipe cannot tell that `just` was started with `--dry-run`, so that previews only the runner. Write `-n` after `do`.
* **Running a shared dependency once.** Each recipe runs in its own `just` call, so a dependency two chained recipes share runs twice. Only `db reset` declares one today (`&& up`).
* **Nested modules** (`just infra db stop`), still a possible follow-up of story 0019.
* **Removing the `::` form.** It keeps working and stays documented.

### Acceptance criteria

`just` recipes have no test harness in this repo, so criteria 1 to 8 were checked by hand with `just` 1.59.0 on 2026-11-05, as recorded under each one. The commands are repeatable from the repo root.

1. **Given** the backend module, **when** I run `just backend do build test`, **then** `backend::build` runs and then `backend::test`, and no root or frontend recipe runs.
   *Met, checked by hand.* `just backend do build test --project tests/Calendar.Domain.Tests` ran `dotnet build` and then `dotnet test` (180 tests passed); `just backend do -n build test` printed only `dotnet build --no-restore` and `dotnet test`, no `pnpm test`.
2. **Given** a chain whose first recipe fails, **when** I run `just backend do build test` and the build fails, **then** the tests do not run and the command exits non-zero.
   *Met, checked by hand.* In a checkout without restored packages the build failed with NETSDK1004, no tests ran, and the exit code was 1.
3. **Given** a chain with a name that is not a recipe of the module, **when** I run `just backend do clean nope test`, **then** no recipe runs, not even `clean`, and the error names `nope`.
   *Met, checked by hand.* The error was "justfile does not contain recipe `nope`" with the `--` hint, and `dotnet clean` printed nothing.
4. **Given** a chain with arguments, **when** I run `just backend do restore build test --project tests/Calendar.Domain.Tests`, **then** all three run in order and only `dotnet test` receives `--project tests/Calendar.Domain.Tests`.
   *Met, checked by hand.* Restore, build and the 180 domain tests ran in order, exit 0. Before the switch to one `just` call per recipe, the same command failed in `dotnet restore` with "Only one project can be specified".
5. **Given** a last recipe whose argument does not start with `-`, **when** I run `just infra do -n what-if -- staging` or `just image do -n build run -- Development`, **then** the word reaches that recipe; without the `--`, nothing runs and the error suggests `--`.
   *Met, checked by hand.* The previews showed `infra.cs -- what-if staging --phase full` and `ASPNETCORE_ENVIRONMENT="Development"`; `just infra do -n what-if staging` stopped on `staging` with the hint, exit 1. In a scratch module, `do build show -- -- x` passed `--` and `x` to the recipe.
6. **Given** `-n` right after `do`, **when** I run `just db do -n up migrate`, **then** the commands of `db up` and `db migrate` are printed and none runs.
   *Met, checked by hand,* also for `just docs do -n build test`, `just tools do -n versions adr` and `just frontend do -n lint typecheck`.
7. **Given** any of the seven modules, **when** I run `just --list <module>`, **then** `do` is listed with its usage, and `just <module> do <recipe>` runs that module's recipe.
   *Met, checked by hand.* `just --show <module>::do` succeeded for all seven. `just docs do architecture build test` ran the docs checks (7 + 141 tests passed).
8. **Given** no recipe name, **when** I run `just backend do --x`, **then** nothing runs, a usage message is printed and the command exits non-zero.
   *Met, checked by hand.* It printed "name at least one recipe: just backend do [options] <recipe>... [--] [arguments]", exit 2. `do -- build` gives the same error.
9. **Given** an agent in a linked worktree, **when** it runs `just db do up migrate`, `just db do -n reset` or `just db::do seed psql`, **then** the hook asks first; `just db do seed --api-url http://localhost:55041` and `just backend do build test` pass.
   *Met, tested.* [`BashGuardTests`](../../tools/agent-hooks/tests/BashGuardTests.cs) (`Shared_database_from_a_linked_worktree_asks` and `Shared_database_passes_from_the_main_checkout_and_isolated_commands_pass_anywhere`, the `do` cases). The three "asks" cases failed against the old pattern and pass with the new one; all 83 agent-hooks tests pass.
10. **Given** a contributor reads `AGENTS.md` or `README.md`, **when** they look up how to run several recipes of a module, **then** both show `do`, say where arguments go (including `--`), and explain that `just backend build test` runs the root `test`.
    *Met, by reading.* `AGENTS.md` ("Commands") and `README.md` ("Common tasks").
11. **Given** the change is complete, **when** I run `just check` and the CI format check on every `justfile` and `*.just` file, **then** both pass.
    *Met in CI* on #248 (the "justfile and its modules parse and are formatted" step covers `just/do.just`). Locally, `just tools test`, `just tools adr`, the docs checks and the format check passed; the backend suites that need Docker and the frontend web suites ran only in CI.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` as the top-level task runner, with recipes in modules | The decision this story amends again, as story 0019 did. Its drivers (D2 thin over native tools, D3 discoverability, D4 expressiveness) rate the runner. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layered agent guidance and hooks as a .NET tool | Its shared-database hook matches recipe names, so a new way to name `db` recipes must not get past it. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling, never Python, Node or shell | Why the runner stays a short recipe body and is not grown into a shell tool. |

No new ADR was needed. The ADR-0038 amendment of 2026-11-05 records the recipe, as the 2026-11-04 amendment recorded the modules.

### Other decisions (not ADR-worthy)

* **A runner, not combination recipes:** the maintainer chose one runner that takes any names over a named recipe for each combination (`verify: build test`), so a new combination needs no edit.
* **Written once, imported by each module:** an imported recipe belongs to the importing module, and `module_path()` names that module, so one definition serves all seven and the root `justfile` does not change.
* **Named `do`:** `run` was the first idea, but `image run` already exists.
* **One `just` call per recipe:** a single call with `module::` names would let a recipe that takes `*args` swallow the names after it, the problem in the background. Separate calls cost a shared dependency running twice, which affects no chain today.
* **`--` rather than a quoting rule:** the maintainer chose the separator (open question 1 on #249) because `image run` and five `infra` recipes take a plain-word environment name. `--` is the usual end-of-options marker, and it is dropped so recipes need no change.
* **A recipe body, not a tool:** about 30 lines of bash in a recipe, like the shebang recipes that already exist (`backend dev`). A .NET file-based app (ADR-0017) would add a `dotnet` start-up to every chain for no gain. If the logic grows, it moves to a tool.
* **Amend, not supersede:** the runner and its drivers are unchanged; the amendment adds a recipe.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| The `do` recipe | `just/do.just` |
| The import in each module | `backend/mod.just`, `frontend/mod.just`, `frontend/apps/docs/mod.just`, `db.just`, `image.just`, `infra/mod.just`, `tools/mod.just` (`import`, after the module's `set` lines) |
| Shared-database hook | `tools/agent-hooks/BashGuard.cs` (`DbRecipeRegex`), tests in `tools/agent-hooks/tests/BashGuardTests.cs` |
| Guidance | `AGENTS.md` ("Commands"), `README.md` ("Common tasks"), the ADR-0038 amendment of 2026-11-05, ADR-0042's hook forms |

`do` is a `[positional-arguments]` shebang recipe. It splits its words into options, recipe names and arguments, checks each name with `just --show <module>::<name>`, and then runs `just --justfile <root justfile> [options] <module>::<name>` once per recipe, with the arguments on the last call only. `just_executable()` and `justfile()` make the inner calls use the same `just` and the same root file, whatever the working directory.

### API

No changes.

### Testing

* **Hook:** `BashGuardTests` theory cases for the `db do` forms that ask and the chains that pass, the "asks" cases confirmed to fail against the old pattern.
* **The recipe:** checked by hand (criteria 1 to 8). The CI step "justfile and its modules parse and are formatted" covers parsing and formatting for every module file and `just/do.just`.

### Lessons learned, known issues and follow-ups

* **The natural spelling was a silent trap.** `just backend build test` did not fail; it ran the root `test`. Only `just -n` showed it. A dry run is worth doing whenever a `just` command could resolve in two places.
* **The first version swallowed names.** A single `just` call with `backend::` prefixes reproduced the `::` form's problem as soon as a recipe with `*args` came first (`restore`). One call per recipe fixed it; the cost is a shared dependency running twice, which affects no chain today.
* **New ways to name a recipe need the hook too.** Without the change, `just db do reset` would have passed the shared-database hook, which matched only `db reset` and `db::reset`. Any future alias or runner for `db` recipes needs the same check.
* **The card came after the delivery.** #248 was opened, then the maintainer asked for a card of its own, so the card PR (#249) merged as `in-progress` and #248 completed it. Writing the card first would have surfaced open question 1 before the code.
* **Known issue: `-n` before the module** previews only the runner, not the chain. Write `-n` after `do`.
* **Known issue: options with a value** must use the `=` form (`--set=name=value`), because a separate value word would be read as a recipe name.
* **Known gap: no automated test of the recipe itself.** A CI step that runs a few `just <module> do -n …` previews and compares their output would catch a regression; not done, because no other recipe has such a test. Open an issue if the recipe changes again.

## User guide

### Running several recipes of one module

1. Write the module, then `run`, then the recipes in the order you want: `just backend run build test`. The tests run only if the build passed.
2. To pass arguments, put them after the last recipe. They go to that recipe only: `just backend run restore build test --filter-method "*Overdue*"`.
3. If the argument does not start with `-`, such as an environment name, put `--` before it: `just image run build start -- Development` or `just infra run what-if -- staging`.
4. To see what would run without running it, put `-n` right after `run`: `just db run -n up migrate`.
5. A mistyped name stops the command before anything runs, and the error says which name it did not find.

Without `run`, only the first recipe comes from the module: `just backend build test` builds the backend and then runs the **whole** test suite, frontend included. The older form `just backend::build backend::test` still works when only the last recipe takes arguments.

Current limitations: `-n` must come after `run`, not before the module, and a `just` option that takes a value is written with `=`.
