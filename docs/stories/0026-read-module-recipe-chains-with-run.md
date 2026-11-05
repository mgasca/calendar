---
status: implemented
date: 2026-11-05
issue: https://github.com/mgasca/calendar/issues/315
pr:
  - https://github.com/mgasca/calendar/pull/316
adrs: ["0017", "0038", "0042"]
---

# 0026 Read module recipe chains with run

## Story

> As a contributor, I need to write `run` when chaining a module's recipes, so that the command reads better across all recipes.

Tracked in issue #315.

## Background

[Story 0019](0019-split-the-justfile-into-modules.md) organised recipes into seven modules. [Story 0023](0023-chain-a-modules-recipes-in-one-command.md) added the shared variadic `do` recipe. The maintainer prefers `run` for readability and has agreed to rename the existing container recipe to `start`, resolving the collision with `image run`.

This is a naming change to the existing runner. Its argument rules and execution behaviour remain the basis for the renamed command.

### Agreed scope

* **One name across modules:** replace `do` with `run` in all seven modules, including imports and usage messages, without a compatibility alias.
* **Container startup:** rename `just image run [environment]` to `just image start [environment]`, retaining the Production default and the existing container behaviour.
* **Preserved chaining:** keep execution order, name validation before execution, stopping at the first failure with its exit code, leading options for every call, and arguments for the last recipe, including the `--` separator.
* **Database guard:** recognise guarded operations in `db run` and `db::run` chains as the existing guard recognises `do` chains.
* **Consistent guidance:** update current command instructions and examples. Keep historical measurements identifiable as evidence of the old spelling, with a pointer to the rename where needed.

### Not in this story

* Changes to the root task runner, module layout, dependencies or application API.
* New chaining semantics, cross-module chains, or deduplication of shared dependencies.
* A new ADR; the maintainer explicitly requested none.

### Acceptance criteria

1. **Given** any of the seven modules, **when** I list its recipes, **then** `run` is available with usage guidance and `do` is absent.
2. **Given** a valid chain, **when** I invoke it through `run`, **then** recipes run in order with arguments reaching only the final recipe and leading options reaching every call.
3. **Given** an unknown recipe or no recipe name, **when** I invoke `run`, **then** the command fails before executing any recipe and prints guidance using the new name.
4. **Given** a failing recipe, **when** I invoke a chain through `run`, **then** later recipes do not run and its exit code is returned.
5. **Given** a linked worktree, **when** the database guard receives a `db run` or `db::run` chain containing a guarded operation, **then** it asks as it does for the direct operation, while safe chains still pass.
6. **Given** the image module, **when** I preview `just image run -n build start -- Development` and `just -n image start`, **then** the former forwards Development to container startup and the latter retains the Production default.
7. **Given** current command guidance, **when** I look up module chaining or container startup, **then** it uses `run` and `image start` respectively.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes.

Criteria 1–4 and 6 were checked by hand with `just` 1.59.0 on the delivery tree: all seven modules expose `run` and reject `do`; safe scratch recipes verified order, quoted arguments, a second `--`, leading `-n`, validation before execution, and preservation of exit code 23 without running a later recipe. Repository dry runs covered backend restore/build/test arguments, database up/migrate, and image build/start with Development and the Production default. These checks did not start containers or touch the shared database.

Criterion 5 is covered by [BashGuardTests](../../tools/agent-hooks/tests/BashGuardTests.cs), including both command forms, a guarded recipe after a safe one, leading options, safe chains and the main checkout. Five new guarded cases failed against the old code; all 98 hook tests pass with the update. Criterion 7 was checked by reading the updated guidance and searching for obsolete current commands. Criterion 8's local and CI results are recorded in the delivery PR; it is not claimed from the targeted checks alone.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based repository tools | The existing guard and any automated runner checks follow the tooling convention. |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` with module recipes | The runner's design remains; current naming references must stay accurate. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layered guidance and hooks | The shared-database guard must recognise the renamed chain. |

No new ADR is needed, as requested by the maintainer.

### Other decisions (not ADR-worthy)

* **`run` for chaining:** the maintainer chose it because it reads better across all recipes.
* **`start` for the container:** agreed in conversation before work began, freeing `run` for the shared recipe in the image module too.
* **No aliases:** one current spelling keeps recipe discovery and instructions consistent.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Shared runner | `just/run.just` |
| Module imports | `backend/mod.just`, `frontend/mod.just`, `frontend/apps/docs/mod.just`, `db.just`, `image.just`, `infra/mod.just`, `tools/mod.just` |
| Container startup | `image.just` |
| Database guard and tests | `tools/agent-hooks/BashGuard.cs`, `tools/agent-hooks/tests/BashGuardTests.cs` |
| Command guidance | Root and area READMEs, `AGENTS.md`, relevant stories and existing ADR references |

### API

No changes.

### Testing

* Parsing, formatting and discovery checks cover every module and the shared recipe.
* Manual scratch checks exercise ordering, argument forwarding, separators, missing names, failure exit codes and dry-run previews without touching the shared database or starting a container. There is no committed automated runner harness.
* Guard cases for the new spelling were confirmed to fail against the old guard before updating it. `just tools test` discovers the hook test app and passes the tooling test apps and whitespace checks; shellcheck is unavailable locally and is left to CI.
* Docs corpus tests and publication checks validate the card and command references. The delivery PR records the commands and results for its final revision.

### Lessons learned, known issues and follow-ups

* The old shared recipe was imported by every module, so renaming the image command first avoids a duplicate recipe name.
* The guard retains recognition of `do` chains as well as the new `run` chains. That is protection for old command text, not a recipe alias.
* Existing preview placement and option-value limitations remain as described in story 0023. Use `run -n`, and write options with values using `=`.
* Historical evidence in story 0023 and ADR-0038 keeps the original commands, explicitly labelled as the old spelling; current user guides use the new names.

## User guide

Write `just backend run build test` to build and then test the backend. Arguments go to the last recipe; use `--` before a plain-word argument, for example `just image run build start -- Development`. Put preview options after `run`: `just db run -n up migrate`.

To start the container directly, use `just image start`, optionally followed by its environment name. The default is Production.
