---
status: accepted
date: 2026-11-07
decision-makers: mgasca, Claude (AI assistant)
---

# Run each CI job only for the paths it checks, decided by a Changes job inside the workflow

## Context and Problem Statement

Every pull request runs every job of `ci.yml` ([ADR-0012](0012-ci-and-dependency-updates.md)): Backend, Frontend, Docs site, Tooling and Container image. A story card runs the backend tests and builds the container image; a backend fix builds the docs site three times. Branch protection requires one check, `CI result`, which needs every job and passes only when all of them succeeded (#368). The maintainer asked, in issue #418, that each job run only when the pull request changes something that job checks, and that the docs preview be published for any pull request that changes the docs. How should CI decide which jobs a pull request needs, without leaving the required check pending or letting a needed job be skipped?

## Decision Drivers

* **D1 Required check stays sound**: `CI result` must still reach a verdict on every run, and must fail when a job that was needed did not succeed. A skip may never be mistaken for a pass of a job the change needed.
* **D2 Fewer unneeded jobs**: a pull request runs only the jobs whose inputs it changes, so runners and the author's wait are spent on checks that can find something.
* **D3 One rule, testable**: which paths run which job is written down once, in a form repo tooling can test with canned file lists, as [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) does for its gate.
* **D4 Supply chain**: no new third-party action on the critical path without a reason, in line with the pinning policy of [ADR-0012](0012-ci-and-dependency-updates.md).
* **D5 Works for every CI event**: pull requests (same repository and forks), the merge queue, pushes to `main` and dispatches; pushes and dispatches keep running every job, because production publication and the [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) baselines depend on them.

## Considered Options

* Changes job with a committed jq rules file
* `paths` filters on the workflow trigger
* Changes job with `dorny/paths-filter`
* Run every job on every run (status quo)

## Decision Outcome

Chosen option: "Changes job with a committed jq rules file", because it keeps `CI result` running on every event and lets it tell a skip-by-design from a missing job (D1), it skips every job a change cannot affect (D2), its rules are one file that tooling tests (D3), it uses only `gh` and `jq`, which the runners already have (D4), and the same job handles pull requests, the merge queue, pushes and dispatches (D5).

| Driver | **Changes job + jq rules (chosen)** | Trigger `paths` filters | Changes job + `dorny/paths-filter` | Every job always |
| --- | :---: | :---: | :---: | :---: |
| D1 Required check stays sound | ★★★ | ☆☆☆ | ★★★ | ★★★ |
| D2 Fewer unneeded jobs | ★★★ | ★★★ | ★★★ | ☆☆☆ |
| D3 One rule, testable | ★★★ | ★☆☆ | ★★☆ | ★★★ |
| D4 Supply chain | ★★★ | ★★★ | ★★☆ | ★★★ |
| D5 Works for every CI event | ★★★ | ★☆☆ | ★★★ | ★★★ |

### How it works

* **Changes job.** It checks nothing out. For a pull request it lists the files with `GET /pulls/{n}/files` and compares the count with the pull request's `changed_files`; for a merge group it reads `GET /compare/{base}...{head}`, whose file list stops at 300. It passes the list to `.github/ci-changes.jq`, which returns one boolean per job, written as job outputs.
* **Everything runs** on a push, a dispatch, a file list that is shorter than the change (a truncated listing), and any change to `.github/workflows/ci.yml` or `.github/ci-changes.jq`.
* **Each filtered job** has `needs: changes` and `if: needs.changes.outputs.<job> == 'true'`. A job's `if` reads only its own output.
* **`CI result`** still needs every job and still passes only when each one succeeded, with one exception: a job may be `skipped` when the Changes output for it is `false`. If Changes fails, the filtered jobs are skipped and `CI result` fails. The jobs-API cross-check applies the same exception.
* **Path sets** are listed in the rules file and in issue #418. A file may match several sets; a file that matches none (the root `README.md`, `.github/dependabot.yml`) runs only Changes and `CI result`. CodeQL, dependency review and the other workflows are unchanged.
* **Docs preview.** The Docs site job builds the publication artifact on a push to `main` and on any same-repository pull request whose Docs site output is `true` ([ADR-0025](0025-github-pages-pr-previews.md), amendment of 2026-11-07).

### Consequences

* Good, because a docs-only pull request no longer runs Backend, Frontend or the image build, and a backend-only one no longer builds the docs site.
* Good, because skipping is decided in one place, with tests, and `CI result` checks that each skip was intended.
* Bad, because the path sets are a second description of what each job reads. A new input that the rules miss (a new shared config file, a new directory) lets a breaking change through on a pull request. Pushes to `main` run everything and catch it after merge.
* Bad, because the critical path gains the Changes job (one API call and a jq run, expected a few seconds, measured in record 0016) in front of every filtered job.
* Neutral: the guard `ci-result-needs-all` (#387) changes from "every job succeeded" to "every job succeeded or was skipped by Changes".

### Confirmation

* Repo tooling tests run `.github/ci-changes.jq` with `jq` on canned file lists: each path set, a file in several sets, an unmatched file, a rules change, a truncated list and a push. A test reads `ci.yml` and fails unless Changes runs that file and each filtered job's `if` reads its own output.
* The `ci-result-needs-all` delivery guard checks that `CI result` still needs every job and accepts a skip only together with a `false` Changes output.
* Throwaway pull requests in the delivery PR show which jobs ran: docs only, backend only, README only, and one that changes `ci.yml`.

## Pros and Cons of the Options

### Changes job with a committed jq rules file

* Good, because **D1 Required check stays sound**: the workflow always runs, so `CI result` always reports, and it can compare each skip with the Changes output.
* Good, because **D2 Fewer unneeded jobs**: each job runs only for its own paths.
* Good, because **D3 One rule, testable**: the rules are one jq program with tests on canned inputs, the pattern [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) uses for its gate.
* Good, because **D4 Supply chain**: `gh` and `jq` are preinstalled on the runners; no new action.
* Good, because **D5 Works for every CI event**: the job picks the file source per event, and pushes and dispatches run everything.
* Bad, because **D3 One rule, testable**: the team maintains its own glob-to-prefix logic instead of a library's.

### `paths` filters on the workflow trigger

* Bad, because **D1 Required check stays sound**: a skipped workflow reports no `CI result` at all, so the required check stays pending and the pull request cannot merge. Splitting CI into one workflow per area would need a required check per workflow and a ruleset change for each new job, which [ADR-0012](0012-ci-and-dependency-updates.md) avoided.
* Good, because **D2 Fewer unneeded jobs**: an unaffected workflow does not start.
* Bad, because **D3 One rule, testable**: the filters live in each workflow's `on:` block, and nothing in the repo can run them on a file list.
* Good, because **D4 Supply chain**: built in.
* Bad, because **D5 Works for every CI event**: the same filters apply to every event in `on:` that uses them, so keeping pushes to `main` unfiltered (production publication needs the artifact) means a second set of trigger blocks to keep in step.

### Changes job with `dorny/paths-filter`

* Good, because **D1 Required check stays sound**: the same Changes-job shape as the chosen option.
* Good, because **D2 Fewer unneeded jobs**: the same job-level skips.
* Neutral, because **D3 One rule, testable**: the filters are a readable YAML block, but they can be tested only by running the action, not with canned inputs in repo tooling.
* Bad, because **D4 Supply chain**: a third-party action (v4.0.3 at the time of writing) runs with the job's token on every run, pinned by SHA and updated by Dependabot.
* Good, because **D5 Works for every CI event**: it supports pull requests, pushes and `merge_group`.

### Run every job on every run (status quo)

* Good, because **D1 Required check stays sound**: nothing is skipped, so nothing can be skipped wrongly.
* Bad, because **D2 Fewer unneeded jobs**: every pull request pays for all five jobs, whatever it changes.
* Good, because **D3 One rule, testable**: there is no rule to maintain.
* Good, because **D4 Supply chain**: nothing new.
* Good, because **D5 Works for every CI event**: every event already runs everything.

## More Information

* Issue #418 records the request and the maintainer's answers. Story [0038](../stories/0038-run-ci-jobs-only-for-the-paths-they-check.md) records delivery.
* [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) ignores skipped jobs and classifies a run's path by whether the publication step ran, so a pull request that changes docs and code is on the publication path, the path it takes. Its baselines come from pushes and dispatches on `main`, which still run every job.
* Verified on 2026-11-07: the compare endpoint lists at most 300 changed files ([GitHub REST docs](https://docs.github.com/en/rest/commits/commits#compare-two-commits)); `dorny/paths-filter` latest tag `v4.0.3`, with `merge_group` support. The pull-request file listing is checked against the pull request's own `changed_files` rather than against a documented cap.
* **Revisit when:** a change that a skipped job would have caught reaches `main` (widen the path set, or reconsider the option); a job is added or split (add its path set and output); or the Changes job's cost on the critical path exceeds what record 0016 measured by a margin that matters.
* **Amendment, 2026-11-07 (shared theme package):** the Docs site path set in `.github/ci-changes.jq` gains `frontend/packages/theme/`, because the docs site builds from that package (story [0046](../stories/0046-apply-the-calendar-themes-to-the-docs-site.md), issue #518, epic #513). The Frontend and Container image sets already cover `frontend/packages/`. The mechanism is unchanged, so this ADR is amended, not superseded.
* **Amendment, 2026-11-08 (ADR conventions job):** `check-adr` also reads the story cards and the architecture model (story [0051](../stories/0051-sweep-only-what-changed-and-check-each-finding.md), #562), and #569 made those paths start the whole Tooling job for a check that takes about a second. A new filtered job, ADR conventions (`adr`), runs only that check, for `docs/decisions/`, `docs/stories/` and the model; Tooling's path set is again what story 0038 delivered (issue #572, epic #559). On a pull request or merge group, the rules file sets `adr` to false whenever `tooling` is true, because Tooling runs the same check. A push or dispatch still runs every job, this one included, so [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) can baseline and gate it from `main`; the maintainer accepted the cost, about 30 s of runner time per push. The mechanism is unchanged, so this ADR is amended, not superseded.
* **Amendment, 2026-11-14 (end-to-end package and the model):** the flow binding check of [ADR-0061](0061-end-to-end-ui-tests-with-playwright-test-bound-to-the-architecture-flows.md) reads the e2e package and the architecture model, and the web app's dev proxy test reads `.env.example`; a pull request that changed only those paths skipped every job that runs them (issue #902, epic #728). The Frontend path set gains `frontend/apps/e2e/` and `.env.example`. The model does not join it: a whole Frontend run (about a minute) for a few seconds of tests is the trade-off that split out ADR conventions, so the maintainer chose a new filtered job, Flow binding (`binding`), which installs only the e2e package and runs its tests. Its path set is the model, the e2e package and the files directly under `frontend/`. On a pull request or merge group, the rules file sets `binding` to false whenever `frontend` is true, because Frontend runs the same tests; a push or dispatch runs both, so [ADR-0045](0045-run-time-regression-gates-for-ci-jobs.md) can baseline it from `main`. The model still runs ADR conventions and the Docs site, and the rest of `docs/` stays out of both Frontend and Flow binding. The mechanism is unchanged, so this ADR is amended, not superseded.
