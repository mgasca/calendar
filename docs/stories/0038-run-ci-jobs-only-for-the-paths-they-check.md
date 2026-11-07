---
status: implemented
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/418
pr:
  - https://github.com/mgasca/calendar/pull/419
  - https://github.com/mgasca/calendar/pull/422
  - https://github.com/mgasca/calendar/pull/430
adrs: ["0012", "0025", "0045", "0046"]
---

# 0038 Run each CI job only when a pull request changes what it checks

## Story

> As a maintainer, I need each CI job to run only when a pull request changes something that job checks, and a docs preview for every pull request that changes the docs, so that runners and my wait go to checks that can find something, and documentation that arrives with code can still be reviewed online.

Tracked in issue #418.

## Background

`ci.yml` runs five jobs on every pull request: Backend, Frontend, Docs site, Tooling and Container image, followed by `CI result`, the one required check ([ADR-0012](../decisions/0012-ci-and-dependency-updates.md)). `CI result` passes only when every job succeeded (#368). So a story card runs the backend tests with Testcontainers and builds the container image, and a backend fix builds the docs site three times.

Story [0030](0030-docs-only-pr-previews.md) limited the hosted docs preview to pull requests that change nothing but documentation ([ADR-0025](../decisions/0025-github-pages-pr-previews.md), amendment of 2026-11-06). A pull request that changes code and documentation together got no preview. The maintainer now wants a preview whenever the docs change.

[ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) chooses the mechanism: a Changes job inside the workflow, with the path rules in one tested jq file, so that `CI result` keeps reporting on every run and can tell an intended skip from a missing job. The maintainer's answers to the design questions are on issue #418.

### Agreed scope

* **Which runs filter:** pull requests (same repository and forks) and the merge queue. A push to `main` and a `workflow_dispatch` run every job, because production publication needs the docs artifact and [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) takes its baselines from those runs.
* **Docs site** runs for changes under `docs/`, `frontend/apps/docs/` or the frontend root configuration, or to `.github/workflows/pages.yml`, whose tests are in the docs suite.
* **Backend** runs for changes under `backend/` or `contracts/`.
* **Frontend** runs for changes under `frontend/apps/web/`, `frontend/packages/` or `contracts/`, or to the frontend root configuration.
* **Tooling** runs for changes under `tools/`, `.claude/`, `infra/`, `docker/`, `just/` or `docs/decisions/` (ADR validation), to `justfile`, any `*.just` file or `.just-version`, or to a backend MSBuild file (`*.props`, `*.targets`, `*.csproj`), because the tool pins and the delivery guards read them, or to a file under `.github/` that the tooling tests read (`ci-gate.jq`, `ci-baseline.json`, `workflows/ci-trend.yml`, `pull_request_template.md`).
* **Container image** runs for changes under `backend/`, `frontend/apps/web/`, `frontend/packages/`, `contracts/` or `docker/`, to the frontend root configuration, or to `Dockerfile`, `.dockerignore` or `image.just`.
* **Frontend root configuration** is every file directly under `frontend/` except its Markdown guidance: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `eslint.config.js`, `tsconfig.base.json`, `.node-version`, the prettier files and `mod.just`.
* **Everything runs** when a pull request changes `.github/workflows/ci.yml` or the rules file, or when the changed-file list is truncated.
* **A file in no set** (the root `README.md`, `.github/dependabot.yml`) runs only Changes and `CI result`.
* **`CI result`** passes only when every job succeeded, or was skipped because Changes said the change did not need it. If Changes fails, `CI result` fails.
* **Docs preview** is published for any same-repository pull request for which Docs site runs, even if it also changes code. The docs-only rule of story 0030 goes away; the publisher is unchanged.
* **Docs-site lint:** the Docs site job runs prettier and eslint on `frontend/apps/docs` when Frontend does not run, because Frontend lints the whole workspace but no longer runs for a docs-site change.
* **Evidence:** runner minutes and wall time for a docs-only and a backend-only pull request, before and after, in benchmark record 0016. "Before" comes from existing CI history (`just tools ci-timings`), "after" from the throwaway pull requests the delivery needs anyway, with no extra dispatches (answered on #419). The issue carries the `performance` label.

### Not in this story

* **CodeQL, dependency review and the other workflows:** unchanged; they keep their own triggers.
* **Splitting a job by path inside the job** (for example, running only the docs tests a change touches): out of scope; a job runs whole or not at all.
* **Removing a stale preview** when a pull request stops changing the docs: it stays until the pull request closes, as today.
* **Re-measuring the ADR-0045 baselines:** pushes and dispatches still run every job, so the baselines stay valid. The gate stack (epic #380) merged first, and this story merged it in.

### Acceptance criteria

1. **Given** a pull request that changes only files under `docs/stories/`, **when** CI runs, **then** Changes and Docs site run, Backend, Frontend, Tooling and Container image are skipped, and `CI result` passes. A change under `docs/decisions/` runs Tooling as well. Rules: [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`AFile_RunsTheJobsItIsAnInputOf`, `docs/stories/…` and `docs/decisions/…`). Live: #423 changed one file under `docs/runbooks/` and ran exactly these jobs (record [0016](../benchmarks/0016-ci-jobs-by-changed-paths.md)).
2. **Given** a pull request that changes only a file under `backend/`, **when** CI runs, **then** Backend and Container image run, Frontend, Docs site and Tooling are skipped, and `CI result` passes. Rules: [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`backend/src/…`). Live: #424 (`backend/AGENTS.md`).
3. **Given** a pull request that changes only `contracts/openapi.json`, **when** CI runs, **then** Backend, Frontend and Container image run and Docs site does not. Rules: [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`contracts/openapi.json`); not run live.
4. **Given** a pull request that changes only the root `README.md`, **when** CI runs, **then** only Changes and `CI result` run, and `CI result` passes. Rules: [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`README.md`). Live: #425, 0:16 wall clock.
5. **Given** a pull request that changes `.github/workflows/ci.yml`, **when** CI runs, **then** every job runs. Rules: [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`AChangeToTheRules_RunsEverything`). Live: #422 ran all five.
6. **Given** a push to `main` or a dispatch, **when** CI runs, **then** every job runs and the push builds the publication artifact. Rules: [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`APushOrDispatch_RunsEverything`). Live: the push of bcc655fe1 (run 42380914911) ran every job and built and uploaded the publication artifact, and ADR-0046 is live on the production site.
7. **Given** a needed job fails or is cancelled, or Changes itself fails, **when** `CI result` runs, **then** it fails. Guard: [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`CiResultNeedsAllTests`, `ChangesJobTests.AConditionalChangesJob_Fails`). Live: run 42379749204 on #424 added a file that does not compile. Backend and Container image failed, the other three were skipped by Changes, and CI result failed with "A needed job did not succeed, and Changes did not skip it". A failed or cancelled Changes was not run live.
8. **Given** a same-repository pull request that changes a file under `docs/` and a file under `backend/`, **when** CI succeeds, **then** the docs preview is published and linked on the pull request. Live: #427 (one docs file and `backend/AGENTS.md`, based on `main`) ran Changes, Backend, Container image and Docs site, skipped Frontend and Tooling, and got the **ADR preview** check and comment (https://mgasca.github.io/calendar/pr-preview/pr-427/). Its deploy first hit the Pages lock of #429 and succeeded on **Re-run failed jobs**.
9. **Given** a pull request that changes no docs path, **when** CI succeeds, **then** no preview is published. Live: #424 and #425 skipped Docs site, so no artifact was built.
10. **Given** a file list for each path set, a file in several sets, an unmatched file, a rules change and a truncated list, **when** the tooling tests run the rules file with `jq`, **then** each returns the jobs above. [delivery-guards tests](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`ChangesRulesTests`; negative controls: dropping `contracts/` from Frontend or `pages.yml` from Docs site fails them).
11. **Given** the change is complete, **when** CI runs on the delivery PR, **then** every job passes. #422 ran every job, green at `31e35eaa8`; locally `just tools test`, the docs tests and actionlint passed, and the full `just check` was not run locally (no backend or frontend source changed).

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0012](../decisions/0012-ci-and-dependency-updates.md) | GitHub Actions, one required `CI result` check | Filtering must keep that one check reporting on every run |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Pages previews from a retained snapshot; amended on 2026-11-07 for any PR that changes docs | Defines preview eligibility, which this story widens |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | Run-time gate per job and path | Ignores skipped jobs; baselines come from runs that still run everything |
| [0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) | A Changes job with a committed jq rules file decides which jobs run | The mechanism this story delivers (accepted on #419, 2026-11-07) |

### Other decisions (not ADR-worthy)

* **Prefix rules, not globs:** each set is a list of path prefixes and exact names, which a jq test can enumerate; the only pattern is `*.just` and the MSBuild extensions.
* **Truncation runs everything:** the pull request's listed files are compared with its `changed_files`, and the merge-group comparison stops at 300 files; when the list may be incomplete, running every job is the safe answer.
* **Branch from `main`, not from the epic #380 stack:** the maintainer chose to keep the `CI result` edit small and let the stack merge `main`.

## Implementation notes

Delivered in #422, stacked on the card and ADR PR #419. Measurements are in record [0016](../benchmarks/0016-ci-jobs-by-changed-paths.md).

### Where things live

| Area | Location |
| --- | --- |
| Changes job, each job's `needs`/`if`, `CI result` skip exception, docs-site lint | `.github/workflows/ci.yml` |
| Path rules (job id → job name, path sets, when everything runs) | `.github/ci-changes.jq` |
| Rules tests (jq on canned inputs) | `tools/delivery-guards/tests/delivery-guards.tests.cs` (`ChangesRulesTests`) |
| Guards | `tools/delivery-guards/DeliveryGuards.cs`: `changes-job` (new) and `ci-result-needs-all` (accepts only the two exact skip forms) |
| Publisher | `.github/workflows/pages.yml` (unchanged) |

### How it works

* **Changes** checks out `.github/` only. For a pull request it lists the files with `GET /pulls/{n}/files`, including the old path of a rename, and marks the listing complete when its count equals `changed_files`. For a merge group it uses `GET /compare/{base}...{head}`, complete under 300 files. It pipes the input into `jq -c -f .github/ci-changes.jq` and writes one `true`/`false` output per job, plus `skipped`, the names of the skipped jobs.
* **CI result** keeps #368's two checks and the ADR-0045 gate step. In `needs` it accepts `skipped` only when the Changes output for that job is `"false"`. In the jobs API it accepts `skipped` only for a name in `skipped`. Changes has no output for itself, so a failed Changes fails CI result.
* **Docs site** builds the publication artifact on `main` pushes and on every same-repository pull request that runs it. The docs-only step is gone. It lints `apps/docs` only when Frontend does not run (review finding 1 on #422).

### API

No changes.

### Testing

* `ChangesRulesTests` run the committed rules with `/usr/bin/jq`. A missing jq fails them, it does not skip them. They also check that the skipped names match the job names in `ci.yml` and that exactly the five filtered jobs need Changes.
* `ChangesJobTests` and `CiResultNeedsAllTests` break a fixture workflow in each way the guards catch.
* Live runs: #422 (rules changed, every job), #423 (docs), #424 (backend), #425 (README). Results are in record 0016.

### Lessons learned, known issues and follow-ups

* **The #380 gate stack merged mid-delivery** (#392, #395, #398). Merging `main` resolved `CI result` by keeping the gate's checkout and saved jobs response and adding the skip exception. The tooling tests read the gate's files under `.github/`, so those now run Tooling.
* **The review** (review-before-merge workflow) found three low issues, posted on #422. Docs lint ran twice when Frontend also ran: fixed. `pages.yml` skipped the docs suite that tests it: fixed. The Changes job's own cost: measured in record 0016, about 5 s.
* **Changes has no ADR-0045 baseline entry:** the gate reports it on every run without gating it, until the next baseline update.
* **Path sets are a second description of each job's inputs.** A new shared input that no rule names lets a breaking change through a pull request; pushes to `main` still run everything. Widen the set when that happens (ADR-0046, revisit triggers).
* **Pages lock after merge** (#429): the four Publish runs right after the merge failed in deploy on an in-progress deployment of #404's push, the symptom of #285. Re-running the newest failed deploy job published production and the #427 preview. This story publishes previews for more pull requests, which makes such collisions more likely.
* **Not run live:** a failed or cancelled Changes job (criterion 7), and a contract-only pull request (criterion 3); both are covered by the guard and rules tests.

## User guide

### What runs on your pull request

CI looks at the files your pull request changes and runs only the checks those files can affect. The **Changes** job lists which checks it chose in its summary. A job it did not need shows as skipped, and **CI result** still turns green. A change to the CI workflow or its rules runs every check, and so does every push to `main`.

### Getting a docs preview

Change anything under the docs and push. When CI succeeds, an **ADR preview** check and a comment on the pull request link the hosted preview, also when the pull request changes code too. It is replaced on every successful run and removed when the pull request closes.
