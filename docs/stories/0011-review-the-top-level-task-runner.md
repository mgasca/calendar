---
status: implemented
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

* **Migrating the repo to a new runner in the same PR as the decision.** The migration (the new task file, CI, the doctor check, the docs and the skills) was delivered as its own PRs after the ADR was accepted. See the delivery list under Implementation notes.
* **The configuration of the native tools** (`dotnet`, `pnpm`, `docker compose`). The issue puts this out of scope.
* **Native Windows support.** Linux and WSL remain the supported platforms.
* **Rewriting the logic-heavy recipes,** unless the decision is to keep Make and move them into file-based apps. That work is then a follow-up PR, not part of this card.

### Acceptance criteria

1. **Given** the five questions on the issue, **when** the decision is recorded, **then** each question has an answer in the issue thread or in the ADR, and every number comes from the repo on the day it was measured.
   *Met, checked by reading.* The drivers (question 1) are in [ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md). The re-rating against the current Makefile (question 2) is in the [step 2 comment](https://github.com/mgasca/calendar/issues/153#issuecomment-6550533504). The cost of a change (question 3) is in the ADR's implementation plan and consequences. The other options and the prototype (questions 4 and 5) are in the ADR and the [prototype results comment](https://github.com/mgasca/calendar/issues/153#issuecomment-6550846071). No automated test covers this.
2. **Given** the new drivers (Modern and fit for purpose, Thin over native tools, Discoverability, Expressiveness), **when** the options are compared, **then** each option is rated per driver with a short reason, and any claim about `just` that was not tested is marked as untested.
   *Met, checked by reading.* The rating table, the pros and cons, and the "What was measured" list (measured, inferred, untested) are in [ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md).
3. **Given** the cost of a change, **when** the ADR is read, **then** it counts the CI call sites and the files that name a `make` target, and says how a migration would keep CI and the docs working while it runs.
   *Met.* The ADR's consequences and implementation plan give the counts (6 CI call sites, about 50 files). The migration then ran in the order the plan described, and CI stayed green at each step: the `justfile` and the `make` targets existed side by side until CI and the docs called `just`, and a temporary CI check kept the two in parity ([#169](https://github.com/mgasca/calendar/pull/169)).
4. **Given** the outcome is a change of runner, **when** the ADR is drafted, **then** it supersedes ADR-0011 through the `adr-draft` skill and passes `just adr-check`. If the outcome is to keep Make, the reason is recorded on the issue and in this card.
   *Met, tested in CI.* The ADR PR ([#164](https://github.com/mgasca/calendar/pull/164)) passed the ADR validator in the CI `Tooling` job, and `just adr-check` runs in that job on every later PR ([#170](https://github.com/mgasca/calendar/pull/170) onward). ADR-0011 is `superseded by` ADR-0038 in its front matter and in the index.
5. **Given** the ADR PR, **when** the maintainer approves the decision, **then** the ADR is `accepted` in that same PR before it merges, and not earlier.
   *Met, checked on the PR.* The maintainer approved with "approved as stands" on [#164](https://github.com/mgasca/calendar/pull/164). The status change to `accepted` and the supersession of ADR-0011 are in that PR's commit "ADR-0038 accepted; ADR-0011 superseded". It was `proposed` until then. No automated test checks the order.
6. **Given** the story is delivered, **when** I read this card, **then** its status is `implemented`, its `pr` list holds every PR, and each criterion above is linked to its evidence or says it was checked by hand.
   *Met, by this card.* The docs tests check the front matter and the index row.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes.
   *Not directly tested.* `just check` as one command was not run end to end, because the agent's sandbox has neither the .NET SDK nor Docker. Its parts run in CI on every PR: Backend, Frontend, Tooling (`just tooling`, `just infra-integration`, `just tool-versions`, `just adr-check`) and Container image (`just smoke-image`). All were green on [#170](https://github.com/mgasca/calendar/pull/170) and later. The recipes `lint`, `check`, `format`, `contracts` and the local-only ones (`dev-api`, `db-migrate`, `db-up`, `run-image`) were checked only by `just --dry-run`, which shows the commands they would run.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0011](../decisions/0011-make-as-top-level-task-runner.md) | GNU Make as a thin top-level task runner | The decision under review. Its drivers D1 and D2 no longer apply. Now superseded by ADR-0038. |
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

### Delivery

The decision and the migration were delivered as a stack of PRs, each branched from the one before it until its base merged:

1. **Card (PR 0):** [#159](https://github.com/mgasca/calendar/pull/159).
2. **ADR and card updates:** [#164](https://github.com/mgasca/calendar/pull/164). ADR-0038 `accepted`, ADR-0011 `superseded`.
3. **The `justfile`:** [#169](https://github.com/mgasca/calendar/pull/169). All 35 Makefile targets, `.just-version`, the doctor check and its tests, and the CI steps that install `just`.
4. **CI call sites:** [#170](https://github.com/mgasca/calendar/pull/170). The 6 `make` calls in `ci.yml` and `migrate.yml` became `just`.
5. **Docs rewrite:** [#171](https://github.com/mgasca/calendar/pull/171). Every `make <target>` command became `just`, except in ADR-0011.
6. **Makefile removal and this card update:** the PR listed last in `pr` above. It deletes the Makefile and the temporary parity check, adds `just` to the README prerequisites, and carries `Closes #153`.

### Where things live

| Area | Location |
| --- | --- |
| The decision | `docs/decisions/0038-just-as-the-top-level-task-runner.md`; ADR-0011 is superseded |
| The task runner | `justfile` (35 recipes plus a default that lists them) |
| The minimum `just` version | `.just-version`, read by `tools/doctor/doctor.sh` and by CI |
| Toolchain check | `tools/doctor/doctor.sh`, with tests in `tools/doctor/tests/doctor.tests.cs` |
| CI | `.github/workflows/ci.yml` and `.github/workflows/migrate.yml` install `just` with `extractions/setup-just`, pinned by commit |
| Contributor and agent guidance | `README.md` (prerequisites, common tasks), `AGENTS.md` (commands) |

### API

No changes.

### Testing

* **Docs tests** (`frontend/apps/docs`): this card's front matter and its index row, and every ADR and story file. 62 tests.
* **ADR validator:** `just adr-check` in the CI `Tooling` job.
* **Doctor tests:** two new tests in `tools/doctor/tests/doctor.tests.cs`: a missing `just` fails with an install hint, and a `just` older than `.just-version` fails. The harness runs `doctor.sh` with a restricted `PATH`, so it now provides a fake `just` and links `sort` and `head`.
* **Recipes run for real in CI** on [#170](https://github.com/mgasca/calendar/pull/170): `just tooling`, `just infra-integration`, `just tool-versions`, `just adr-check` and `just smoke-image` (against the built image with a PostgreSQL service).
* **Checked only with `--dry-run`:** the other recipes, as listed under criterion 7.
* **Not exercised before merge:** the `just infra-migrate` step in `migrate.yml`, which runs only from `main` by manual dispatch against Azure.

### Lessons learned, known issues and follow-ups

* **Measured in the prototype:** no `$$` and no `\` continuations in the `justfile`; arguments pass through; a missing required argument stops with a usage message, where `make infra-migrate` without `ENV=` ran the tool with an empty value.
* **`.ONESHELL:` is not a cheap fix for Make** (measured on a scratch Makefile): it allows multi-line recipes, but it breaks the `DOTNET := cd backend && dotnet` pattern and applies to the whole file.
* **Porting trap (inferred from shell semantics):** in a shebang recipe with `set -e`, `grep ... && cp ...` does not stop the script when `grep` fails. The Makefile's `|| exit 1` was kept.
* **Several recipes in one command:** `just db-up db-migrate` runs both, but `just tool-versions adr-check` passes `adr-check` to `tool-versions` as an argument, because that recipe takes variable arguments (measured with `--dry-run`). `AGENTS.md` says so.
* **The doctor tests' restricted `PATH`** failed on the first push of the `justfile` PR, because the new `just` check needed a `just`, `sort` and `head`. Found by CI, not locally.
* **Output:** `just` prints recipe lines to stderr, where `make` printed them to stdout. The `migrate.yml` step summary therefore holds only the tool's own output.
* **Installing `just`:** Ubuntu's `apt` package (1.45.0 at the time of writing) is older than the pinned 1.59.0. Contributors download the release binary; CI uses `extractions/setup-just`.
* **`just --fmt --check` is still marked unstable in 1.59.0.** Revisit when it is stable.
* **Left as written on purpose:** statements in ADR-0001, ADR-0017, ADR-0023, ADR-0033 and story 0008 that cite ADR-0011's own decision, because rewriting them would misattribute the history. The maintainer can rule on them in [#171](https://github.com/mgasca/calendar/pull/171).
* **Open follow-ups:** the first run of `migrate.yml` from `main` with `just`; a `Task` prototype if anyone wants one (ADR-0038 rates it from documentation only); the revisit trigger in ADR-0038 (`just` no longer maintained, or its CI install cost turns out higher than measured).

## User guide

### Running a task as a contributor

1. Install `just` at the version in `.just-version`: download the release for your platform from <https://github.com/casey/just/releases> and put `just` on your `PATH`. Ubuntu's `apt` package is too old.
2. Check your toolchain with `./tools/doctor/doctor.sh`. After `just` is installed, `just doctor` runs the same script.
3. Run `just` with no arguments to list the recipes and what they do.
4. Common recipes: `just setup` (first time), `just dev-api` and `just dev-web` (run the app), `just test`, `just lint`, `just check` (everything CI runs) and `just format`.
5. Arguments follow the recipe name: for example `just infra-migrate staging --client-ip <ipv4>` or `just run-image Development`. The recipe's comment in the list shows what it takes.
6. To run several recipes in one command, use it only for recipes that take no arguments (`just db-up db-migrate`). Otherwise run them separately.

The old `make` commands no longer exist.
