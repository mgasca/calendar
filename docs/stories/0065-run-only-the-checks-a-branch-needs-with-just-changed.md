---
status: implemented
date: 2026-11-15
issue: https://github.com/mgasca/calendar/issues/937
pr:
  - https://github.com/mgasca/calendar/pull/939
  - https://github.com/mgasca/calendar/pull/941
adrs: ["0038", "0046", "0058"]
---

# 0065 Run only the checks a branch needs with just changed

## Story

> As a maintainer, I need one local command that runs only the checks my branch's changes need, chosen by the same rules CI uses, so that I get CI's verdict before I push without waiting for suites my change cannot affect.

Tracked in issue #937.

## Background

`just check` runs `lint` and `test` for every stack: clippy, rustfmt and the Rust tests, ESLint, tsc and the frontend tests, the repo tooling tests, and the ADR, narrative and architecture checks. It runs all of them for every branch, so a branch that edits one story card waits for the backend suite.

CI already avoids that. Since [0038](0038-run-ci-jobs-only-for-the-paths-they-check.md), the Changes job in `.github/workflows/ci.yml` lists a pull request's files, passes them to `.github/ci-changes.jq` and runs only the jobs whose inputs changed ([ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md)). The `delivery-guards` tests run those rules on canned file lists. Nothing local uses them, so before pushing a contributor can either run everything or guess what CI will run.

This story adds `just changed`. It applies the CI rules to the local branch and runs the local recipes for the jobs they select. `just check` stays the full run.

### Agreed scope

* **Changed files**: every path that differs from the merge base of `HEAD` and `origin/main`: committed changes, staged and unstaged edits, and untracked files that git does not ignore. A rename contributes both its old and new path, as in CI. A deleted file counts as changed.
* **Same rules as CI**: the file list goes to `.github/ci-changes.jq` as a complete `pull_request` listing. The command never copies or reimplements a path rule, so it selects the same jobs CI would select for that file list. A change to `ci.yml` or `ci-changes.jq` selects every job, as it does in CI. The pull-request exceptions also apply: ADR conventions and Narratives do not run alongside Tooling, and Flow binding does not run alongside Frontend.
* **Job to recipe map**: each CI job maps to the local recipes that check what the job checks:
  * Backend: `just backend lint`, `just backend test`.
  * Frontend: `just frontend format-check`, `just frontend lint`, `just frontend typecheck`, `just frontend test`.
  * Docs site: `just docs architecture`, `just docs test`, `just docs slides-test`, `just docs build`.
  * Tooling: the justfile parse and format check, `just tools test`, `just infra integration`, `just tools versions`, `just tools adr`, `just tools narratives --check`.
  * ADR conventions: `just tools adr`.
  * Narratives: `just tools narratives --check`.
  * Flow binding: the e2e package's unit tests (`pnpm --filter @calendar/e2e test`).
  * Container image: `just image build`, only with `--image`, as agreed on PR 0. It takes minutes and needs Docker, so by default the job is reported as `selected, not run (--image to run)` rather than run or skipped silently.
* **No silent gaps**: if the rules name a job the map does not cover, the command fails before it runs anything, and a test fails in `just tools test`. A new CI job therefore cannot be skipped locally by accident.
* **Report**: before running anything, the command prints the base it compared with, how many files changed, and each CI job as `runs` or `skipped`. It then runs the selected recipes, each under a heading that names it. It finishes with a summary of passed and failed recipes and exits non-zero if any recipe failed.
* **Runs every selected recipe**: a failing recipe does not stop the rest, because CI reports every job too. `--fail-fast` stops at the first failure.
* **Options**: `--dry-run` prints the plan and the commands without running them. `--base REF` compares with a ref other than `origin/main`. `--image` also runs the Container image job's recipe when it is selected.
* **Nothing changed**: with no changed files, it prints that no CI job would run and exits 0.

### Not in this story

* **Changing CI**: the Changes job and `ci-changes.jq` stay as they are. This story only reads the rules.
* **Replacing `just check`**: it remains the full local run and keeps its role in the PR template.
* **Caching or skipping unchanged work across runs**: no stamps, hashes or remote cache. Cargo and Vite keep their own incremental builds. A build system such as Turborepo would be a separate ADR.
* **Selecting tests within a job**: when Backend runs, all its tests run, as in CI.
* **Fetching**: the command compares with the local `origin/main` and does not run `git fetch`, so it never touches the network. It prints the ref it compared with, so a stale base is visible.
* **Watch mode**: re-running on file changes (`watchexec` and similar) is out of scope.
* **Coverage and CI-only steps**: coverage reports, the Pages publication artifact, the image smoke test against a running container and the run-time gates stay CI-only.

### Acceptance criteria

1. **Given** a branch that changes only a story card, **when** I run `just changed`, **then** it reports ADR conventions and Docs site as `runs` and every other job as `skipped`, as CI does for that file, and runs only the recipes of those two jobs. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`a story card alone runs ADR conventions and Docs site`, `main exits non-zero when a selected recipe fails, and --dry-run runs nothing`).
2. **Given** an uncommitted edit to a file under `backend/`, **when** I run `just changed`, **then** Backend is selected, although nothing is committed. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`an uncommitted backend edit selects Backend`).
3. **Given** a new untracked file under `tools/` and an ignored file under `.plan/`, **when** I run `just changed --dry-run`, **then** the untracked file counts as changed and the ignored one does not. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`changed files cover commits, staged, unstaged, untracked, renames and deletions, not ignored files`).
4. **Given** a branch that renames a file out of `frontend/apps/web/`, **when** I run `just changed --dry-run`, **then** Frontend is selected because of the old path. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`a rename out of the web app selects Frontend through the old path`).
5. **Given** a branch that changes `.github/ci-changes.jq`, **when** I run `just changed --dry-run`, **then** every CI job is selected except ADR conventions, Narratives and Flow binding, which CI then runs inside Tooling and Frontend. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`a change to the rules selects every job but those CI runs inside Tooling and Frontend`).
6. **Given** any file list, **when** the command selects jobs, **then** the selection equals the output of `.github/ci-changes.jq` for that list as a complete `pull_request` event. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`the selection is ci-changes.jq's for …`, nine file lists, one per CI job plus no files and an unmatched file).
7. **Given** a CI rule for a job the recipe map lacks, **when** I run `just changed` or `just tools test`, **then** it fails and names the unmapped job, and no recipe runs. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`a job the recipe map lacks fails before anything runs, naming the job`, with a fixture rules file; `every CI job in the rules has local recipes, and every mapping has a job` fails `just tools test` against the real rules).
8. **Given** two selected recipes where the first fails, **when** I run `just changed`, **then** the second still runs, the summary lists the failure, and the exit code is non-zero; **with** `--fail-fast`, the second does not run. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`every selected step runs after a failure, and the summary lists the failure`, `--fail-fast stops at the first failure and lists what did not run`, `main exits non-zero when a selected recipe fails, and --dry-run runs nothing`).
9. **Given** no changed files, **when** I run `just changed`, **then** it prints that no CI job would run and exits 0. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`main exits 0 and runs nothing when nothing changed`).
10. **Given** `--base REF`, **when** I run `just changed --dry-run --base REF`, **then** it compares with the merge base of `HEAD` and `REF` and prints that ref. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`--base compares with the merge base of HEAD and that ref`). That the ref is printed is checked by hand, not by a test.
11. **Given** a branch that changes `Dockerfile`, **when** I run `just changed --dry-run`, **then** Container image is reported as selected but not run; **with** `--image`, the plan includes `just image build`. Tested in [changed_test.ts](../../tools/changed/tests/changed_test.ts) (`the container image job is held without --image and planned with it`).
12. **Given** the change is complete, **when** I run `just check`, **then** it passes. Checked by running `just changed` on the delivery branch (Docs site and Tooling, 10 of 10 recipes passed) and by CI on the delivery PR.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` is the top-level task runner over native tooling | `changed` is a root recipe because it spans stacks, and it calls the existing module recipes |
| [0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) | CI runs a job only when a pull request changes its inputs | The command reuses that decision's rules file instead of defining its own |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | Repository tooling is TypeScript on Deno | The file listing, selection and recipe map are a Deno tool. The recipe only calls it |

No new ADR is expected: the command adds a local entry point and changes no decision.

### Other decisions (not ADR-worthy)

* **Run the jq file rather than port it**: one rules file means local and CI selection cannot drift, and the `delivery-guards` tests already cover it. `jq` is already a toolchain requirement that `just doctor` checks.
* **Map jobs to recipes, not to CI steps**: CI steps install toolchains and caches. The local recipes are what a contributor already runs, so a local failure reads the same way as running the recipe by hand.
* **Compare with the merge base**: changes that reached `main` after the branch started are not the branch's changes, which is the same set a pull request lists.
* **Treat local edits as changed**: the point is checking work before it is pushed, so uncommitted and untracked files count.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Tool: file listing (`changedFiles`), selection (`selectJobs`), recipe map (`recipeMap`), plan and runner | `tools/changed/changed.ts` |
| Tests | `tools/changed/tests/changed_test.ts`, discovered by the shared `tools/deno.json` |
| Recipe | `changed` in the root `justfile`, run with `--allow-read --allow-run=git,jq,just,pnpm` |
| Rules (read, unchanged) | `.github/ci-changes.jq` |
| Tool documentation | [tools/README.md](../../tools/README.md), "changed" |

`changedFiles` runs `git merge-base HEAD <ref>`, then `git diff --name-status -z -M <merge base>`, which compares the merge base with the working tree and so covers commits, staged and unstaged edits and deletions, with both paths of a rename. It adds `git ls-files --others --exclude-standard` for untracked files. `selectJobs` runs `jq -c -f .github/ci-changes.jq` twice: once on a probe listing that selects nothing, whose `skipped` array names every job in the rules' order, and once on the real listing. The tool therefore keeps neither the path rules nor the job names. `mappingGaps` compares the rules' job ids with `recipeMap` in both directions. The Tooling job's justfile check lists `git ls-files justfile '*.just'` and runs `just --fmt --check --justfile` on each, as CI does.

### API

No changes.

### Testing

* Selection agreement: nine file lists run through both `selectJobs` and `jq` directly, compared job by job.
* Mapping: the real rules against `recipeMap` in both directions, plus a fixture rules file with an extra job that `main` must reject before running anything.
* File listing: a throwaway git repository with committed, staged, unstaged, untracked, ignored, renamed and deleted files, and a two-layer branch for `--base`.
* Plan and runner: stub runners for run-all, `--fail-fast`, a multi-command step, the summary, `--dry-run` and the exit code.

### Lessons learned, known issues and follow-ups

* **Not every job runs on a rules change**: a change to `ci-changes.jq` turns every job on, but in a `pull_request` run the rules then turn off ADR conventions, Narratives and Flow binding again, because Tooling and Frontend run the same checks. The card first said "every job". The tool follows the rules, and criterion 5 now says so.
* **Recipes are not CI steps**: `just frontend test` and `just frontend typecheck` cover every workspace package, while CI's Frontend job leaves the docs site and the decks to the Docs site job. Locally the overlap costs a little time but misses nothing. Coverage, the Pages artifact and the image smoke test stay CI-only.
* **Stale base**: the command does not fetch, so an old `origin/main` widens the changed set (it never narrows it). The plan prints the ref and merge base it used.
* **Not measured**: no timing comparison with `just check` was recorded. On the delivery branch `just changed` ran the Docs site and Tooling recipes and skipped Backend and Frontend.

## User guide

### Check only what your branch changed

1. Commit or keep your edits in the working tree. Both count, and so do new files that git does not ignore.
2. Run **`just changed`**. It prints the branch it compared with, how many files changed, and each CI job as `runs` or `skipped`. It then runs the matching local checks, each under a `==>` heading, and ends with a **Summary** of passed and failed checks.
3. To see the plan and its commands without running anything, run **`just changed --dry-run`**.
4. To stop at the first failure, add **`--fail-fast`**.
5. To compare with another branch, for example the branch a stacked change sits on, add **`--base <branch>`**.
6. The container image build takes minutes and needs Docker, so it is shown as `selected, not run (--image to run)`. Add **`--image`** to run it.

Run `git fetch` first if `origin/main` may be old: the command compares with the copy of `main` you already have. Before asking for a merge, `just check` remains the full run.
