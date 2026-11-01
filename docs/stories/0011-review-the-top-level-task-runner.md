---
status: in-progress
date: 2026-10-31
issue: https://github.com/mgasca/calendar/issues/153
pr:
  - https://github.com/mgasca/calendar/pull/159
  - https://github.com/mgasca/calendar/pull/164
  - https://github.com/mgasca/calendar/pull/169
  - https://github.com/mgasca/calendar/pull/170
  - https://github.com/mgasca/calendar/pull/171
adrs: ["0011", "0017", "0038"]
---

# 0011 Review the top-level task runner

## Story

> As a contributor, whether a person or another agent, I need a top-level task runner that is modern and fit for purpose, so that I learn and use a tool that suits the job instead of one I only put up with.

Tracked in issue #153. Card PR: [#159](https://github.com/mgasca/calendar/pull/159).

## Background

[ADR-0011](../decisions/0011-make-as-top-level-task-runner.md) chose GNU Make as the single entry point to set up, build, test, lint and format both stacks. It was accepted on 2026-10-26 with five drivers: Linux/WSL support (D1), zero extra install (D2), thin over native tools (D3), discoverability (D4) and expressiveness (D5). `just` and Make tied on D1, D3 and D4. Make won D2 and `just` won D5.

The issue reopens that choice for discussion. It does not propose an answer. Two things have changed since the ADR.

**The Makefile grew.** ADR-0011 lists 13 targets. At the time of writing the Makefile has 35 targets in 168 lines (measured on `main`).

* Most recipes are short: 32 of the 36 are one to three lines (measured, counting the `help` target). Five carry real shell logic with `$$` escapes and `\` line continuations: `smoke-image` (9 lines), `tooling` and `dev-api` (5 lines each), and `run-image` and `db-migrate` (3 lines each). The ADR's own consequence ("Targets are kept to short command lists") said to avoid this.
* 10 targets take values on the command line (`ARGS=`, `ENV=`, `PHASE=`, `IMAGE_ENV=`): `doctor`, `tool-versions`, `adr-check`, `db-seed`, `run-image`, `infra-what-if`, `infra-deploy`, `infra-secret-init`, `infra-init-roles` and `infra-migrate`.
* CI calls 6 targets: five in `ci.yml` (`tooling`, `infra-integration`, `tool-versions`, `adr-check`, `smoke-image`) and `infra-migrate` in `migrate.yml`.
* `make <target>` appears in about 50 files, mostly `README.md`, `AGENTS.md`, the story cards, the runbooks and the two drafting skills. The count is approximate because a text search also finds prose such as "make sure".

**The drivers changed.** The maintainer said so on the issue on 2026-10-31. The original drivers were about getting up and running quickly. The maintainer is now familiar with the repo, and values using, and so learning, a more modern tool that is fit for purpose. Therefore:

* **D1 Linux/WSL support** and **D2 Zero extra install** are removed as drivers. Linux and WSL remain the supported platforms (`AGENTS.md`), but that is now a constraint, not something that separates the options.
* A new driver is added: **Modern and fit for purpose**.
* The other three remain. The new numbering is D1 Modern and fit for purpose, D2 Thin over native tools (was D3), D3 Discoverability (was D4) and D4 Expressiveness (was D5). Whether to keep the old numbers in the new ADR is a choice for the ADR.

An earlier analysis (a previous agent session, recorded in a comment on the issue) leaned towards keeping Make. It did not test `just`, and it was written under the old drivers, so this story does not take it as a starting point.

### Agreed scope

* **Re-evaluate the options under the new drivers.** The options are at least GNU Make as it is, `just`, and Make with the logic-heavy recipes moved into [ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) file-based apps. Further options that turn up are added. Each is rated per driver with evidence, and unverified claims are marked as such.
* **Answer the five questions on the issue:** whether the drivers still apply and are weighted correctly, whether the current Makefile changes any rating, what a change costs (CI call sites, `make doctor`, `AGENTS.md`, `CLAUDE.md`, the runbooks and the story cards), what other options exist, and whether a prototype is needed before a decision.
* **A prototype if it is needed (proposed, to be confirmed by the maintainer on the issue):** a `justfile` on a scratch branch that covers the 6 targets CI calls and the 5 logic-heavy recipes, to compare with the Makefile. It is for comparison only and is not merged.
* **The outcome is a decision, recorded in the repo.** Either a new ADR drafted with the `adr-draft` skill that supersedes ADR-0011, or a recorded decision to keep ADR-0011 with the reason. The ADR becomes `accepted` when the maintainer approves it, in the same PR before it merges.
* **The decision trail stays on the issue,** with answered questions and deferrals posted there, and the durable record in the ADR and this card.

### Not in this story

* **Migrating the repo to a new runner.** If the ADR chooses to change, the migration (the new task file, CI, `make doctor`, `AGENTS.md`, `README.md`, the runbooks, the skills and the story cards) is planned in this card's follow-ups and delivered in its own PRs, after the ADR is accepted.
* **The configuration of the native tools** (`dotnet`, `pnpm`, `docker compose`). The issue puts this out of scope.
* **Native Windows support.** Linux and WSL remain the supported platforms.
* **Rewriting the logic-heavy recipes,** unless the decision is to keep Make and move them into file-based apps. That work is then a follow-up PR, not part of this card.

### Acceptance criteria

1. **Given** the five questions on the issue, **when** the decision is recorded, **then** each question has an answer in the issue thread or in the ADR, and every number comes from the repo on the day it was measured.
2. **Given** the new drivers (Modern and fit for purpose, Thin over native tools, Discoverability, Expressiveness), **when** the options are compared, **then** each option is rated per driver with a short reason, and any claim about `just` that was not tested is marked as untested.
3. **Given** the cost of a change, **when** the ADR is read, **then** it counts the CI call sites and the files that name a `make` target, and says how a migration would keep CI and the docs working while it runs.
4. **Given** the outcome is a change of runner, **when** the ADR is drafted, **then** it supersedes ADR-0011 through the `adr-draft` skill and passes `make adr-check`. If the outcome is to keep Make, the reason is recorded on the issue and in this card.
5. **Given** the ADR PR, **when** the maintainer approves the decision, **then** the ADR is `accepted` in that same PR before it merges, and not earlier.
6. **Given** the story is delivered, **when** I read this card, **then** its status is `implemented`, its `pr` list holds every PR, and each criterion above is linked to its evidence or says it was checked by hand.
7. **Given** the change is complete, **when** I run `make check`, **then** it passes.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0011](../decisions/0011-make-as-top-level-task-runner.md) | GNU Make as a thin top-level task runner | The decision under review. Its drivers D1 and D2 no longer apply. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for all repo tooling | Offers a way to keep Make and move logic out of it. Its own driver "no new toolchain" argues against adding `just`, so a new ADR has to address it. |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` as the top-level task runner, replacing GNU Make | The decision this story produces. Accepted by the maintainer on its PR, it supersedes ADR-0011. |

The new ADR was drafted with the `adr-draft` skill, using the measured and inferred results of the prototype from the issue.

### Other decisions (not ADR-worthy)

* **The old drivers are dropped, not reweighted:** the maintainer said that getting up and running quickly no longer matters most, so keeping them as lower-weight drivers would only hide the choice.
* **Renumbering the drivers is left to the ADR:** this card uses the new numbering D1–D4 to keep the text short.
* **The earlier analysis is input, not a conclusion:** its recommendation was made under the old drivers and without testing `just`.
* **The prototype is throwaway:** it is not merged, so it does not need the analyzers and tests that ADR-0017 requires of repo tooling.
* **No `Task` prototype for now:** decided by the maintainer on the ADR PR. ADR-0038 says `Task` is rated from documentation alone and is untested.
* **No Makefile shim:** decided by the maintainer on the ADR PR. The Makefile is removed as soon as CI and the docs call `just`, because the only people and agents working in the repo are the maintainer's.
* **One version file for `just`:** decided by the maintainer on the ADR PR. A `.just-version` file at the repo root is read by `tools/doctor/doctor.sh` and by CI, like `frontend/.node-version`.
* **Every `make <target>` command is rewritten, except in ADR-0011:** decided by the maintainer on the ADR PR. The docs PR changes the commands in the README, `AGENTS.md`, the runbooks, the skills, the story cards (all sections) and the other ADRs. ADR-0011 is left as written because it is the superseded record. Passages that talk about GNU Make as a tool, such as ADR-0038's comparison of the options, stay.

## Implementation notes

*In progress. This section is completed as the story is built.*

### Delivery plan

Each PR branches from fresh `origin/main`. The migration PRs start only after ADR-0038 is accepted.

1. **Card (PR 0):** [#159](https://github.com/mgasca/calendar/pull/159), merged.
2. **ADR:** [#164](https://github.com/mgasca/calendar/pull/164). The maintainer approved it as it stands, so ADR-0038 is `accepted` and ADR-0011 is `superseded` in that PR, before it merges.
3. **Migration, now that the ADR is accepted (proposed split):**
   * a `justfile` with every Makefile target at parity, the `.just-version` file and the doctor check;
   * CI switched to `just` (the 6 call sites, with `just` installed at the pinned version);
   * every `make <target>` command in the docs rewritten to `just` (README, `AGENTS.md`, `CLAUDE.md`, runbooks, skills, story cards, ADRs other than ADR-0011);
   * the Makefile removed;
   * the card update with test links and lessons learned, carrying `Closes #153`.

### Where things live

| Area | Location |
| --- | --- |
| The decision under review | `docs/decisions/0011-make-as-top-level-task-runner.md` |
| The new decision, if any | `docs/decisions/` (next free number) |
| The current task runner | `Makefile` |
| CI entry points | `.github/workflows/ci.yml`, `.github/workflows/migrate.yml` |
| Toolchain check | `tools/doctor/doctor.sh` |
| Contributor and agent guidance | `AGENTS.md`, `CLAUDE.md`, `README.md` |
| Runbooks | `docs/runbooks/` |

### API

No changes.

### Testing

* The docs tests check this card's front matter and its index row (`frontend/apps/docs`).
* `make adr-check` validates the ADR and its index row.
* A migration, if there is one, needs its own tests plan: at least that every target CI calls still runs, and that `make check` or its replacement reproduces CI locally.

### Lessons learned, known issues and follow-ups

* Filled in on delivery. Measurements are marked measured or inferred.
* Findings so far, from the issue thread: `.ONESHELL:` was tested on a scratch Makefile. It allows multi-line recipes without `\`, but it breaks the `DOTNET := cd backend && dotnet` pattern (the second `cd backend` fails) and it applies to the whole Makefile. It is not a cheap fix.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Running a task as a contributor

Until a decision is taken, nothing changes: run `make help` to list the tasks and `make check` to run everything CI runs. If the decision changes the tool, this section will name the new command and say how to install it.
