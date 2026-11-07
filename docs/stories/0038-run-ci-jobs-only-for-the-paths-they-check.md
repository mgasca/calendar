---
status: planned
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/418
pr:
  - https://github.com/mgasca/calendar/pull/419
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
* **Docs site** runs for changes under `docs/`, `frontend/apps/docs/` or the frontend root configuration.
* **Backend** runs for changes under `backend/` or `contracts/`.
* **Frontend** runs for changes under `frontend/apps/web/`, `frontend/packages/` or `contracts/`, or to the frontend root configuration.
* **Tooling** runs for changes under `tools/`, `.claude/`, `infra/`, `docker/`, `just/` or `docs/decisions/` (ADR validation), to `justfile`, any `*.just` file or `.just-version`, or to a backend MSBuild file (`*.props`, `*.targets`, `*.csproj`), because the tool pins and the delivery guards read them.
* **Container image** runs for changes under `backend/`, `frontend/apps/web/`, `frontend/packages/`, `contracts/` or `docker/`, to the frontend root configuration, or to `Dockerfile`, `.dockerignore` or `image.just`.
* **Frontend root configuration** is the files directly under `frontend/`: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `eslint.config.js`, `tsconfig.base.json`, `.node-version`, the prettier files and `mod.just`.
* **Everything runs** when a pull request changes `.github/workflows/ci.yml` or the rules file, or when the changed-file list is truncated.
* **A file in no set** (the root `README.md`, `.github/dependabot.yml`) runs only Changes and `CI result`.
* **`CI result`** passes only when every job succeeded, or was skipped because Changes said the change did not need it. If Changes fails, `CI result` fails.
* **Docs preview** is published for any same-repository pull request for which Docs site runs, even if it also changes code. The docs-only rule of story 0030 goes away; the publisher is unchanged.
* **Docs-site lint:** the Docs site job runs prettier and eslint on `frontend/apps/docs`, because Frontend, which linted the whole workspace, no longer runs for a docs-site change.
* **Evidence:** runner minutes and wall time for a docs-only and a backend-only pull request, before and after, in benchmark record 0016. The issue carries the `performance` label.

### Not in this story

* **CodeQL, dependency review and the other workflows:** unchanged; they keep their own triggers.
* **Splitting a job by path inside the job** (for example, running only the docs tests a change touches): out of scope; a job runs whole or not at all.
* **Removing a stale preview** when a pull request stops changing the docs: it stays until the pull request closes, as today.
* **Re-measuring the ADR-0045 baselines:** pushes and dispatches still run every job, so the baselines stay valid; the gate stack (epic #380) resolves its conflict in `CI result` when it merges `main`.

### Acceptance criteria

1. **Given** a pull request that changes only files under `docs/stories/`, **when** CI runs, **then** Changes and Docs site run, Backend, Frontend, Tooling and Container image are skipped, and `CI result` passes. A change under `docs/decisions/` runs Tooling as well.
2. **Given** a pull request that changes only a file under `backend/src/`, **when** CI runs, **then** Backend and Container image run, Frontend, Docs site and Tooling are skipped, and `CI result` passes.
3. **Given** a pull request that changes only `contracts/openapi.json`, **when** CI runs, **then** Backend, Frontend and Container image run and Docs site does not.
4. **Given** a pull request that changes only the root `README.md`, **when** CI runs, **then** only Changes and `CI result` run, and `CI result` passes.
5. **Given** a pull request that changes `.github/workflows/ci.yml`, **when** CI runs, **then** every job runs.
6. **Given** a push to `main` or a dispatch, **when** CI runs, **then** every job runs and the push builds the publication artifact.
7. **Given** a needed job fails or is cancelled, or Changes itself fails, **when** `CI result` runs, **then** it fails.
8. **Given** a same-repository pull request that changes a file under `docs/` and a file under `backend/`, **when** CI succeeds, **then** the docs preview is published and linked on the pull request.
9. **Given** a pull request that changes no docs path, **when** CI succeeds, **then** no preview is published.
10. **Given** a file list for each path set, a file in several sets, an unmatched file, a rules change and a truncated list, **when** the tooling tests run the rules file with `jq`, **then** each returns the jobs above.
11. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0012](../decisions/0012-ci-and-dependency-updates.md) | GitHub Actions, one required `CI result` check | Filtering must keep that one check reporting on every run |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Pages previews from a retained snapshot; amended on 2026-11-07 for any PR that changes docs | Defines preview eligibility, which this story widens |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | Run-time gate per job and path | Ignores skipped jobs; baselines come from runs that still run everything |
| [0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) | A Changes job with a committed jq rules file decides which jobs run | The mechanism this story delivers (proposed in PR 0) |

### Other decisions (not ADR-worthy)

* **Prefix rules, not globs:** each set is a list of path prefixes and exact names, which a jq test can enumerate; the only pattern is `*.just` and the MSBuild extensions.
* **Truncation runs everything:** the pull request's listed files are compared with its `changed_files`, and the merge-group comparison stops at 300 files; when the list may be incomplete, running every job is the safe answer.
* **Branch from `main`, not from the epic #380 stack:** the maintainer chose to keep the `CI result` edit small and let the stack merge `main`.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Changes job, job conditions, `CI result` | `.github/workflows/ci.yml` |
| Path rules | `.github/ci-changes.jq` |
| Rules tests | repo tooling, run by `just tools test` |
| Guard for `CI result` | `tools/delivery-guards/DeliveryGuards.cs` (`ci-result-needs-all`) |
| Publisher | `.github/workflows/pages.yml` (unchanged) |

### API

No changes.

### Testing

* jq rules tested on canned file lists, and a test that `ci.yml` runs the rules file and each job reads its own output.
* The `ci-result-needs-all` guard and its tests, changed to accept only skips that Changes intended.
* Throwaway pull requests (docs only, backend only, README only, `ci.yml`) to show which jobs ran, and one mixed docs + backend pull request for the preview.

### Lessons learned, known issues and follow-ups

* To be written on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### What runs on your pull request

CI looks at the files your pull request changes and runs only the checks those files can affect. The **Changes** job lists which checks it chose. A job it did not need shows as skipped, and **CI result** still turns green. A change to the CI workflow runs every check.

### Getting a docs preview

Change anything under the docs and push. When CI succeeds, an **ADR preview** check and a comment on the pull request link the hosted preview, also when the pull request changes code too. It is replaced on every successful run and removed when the pull request closes.
