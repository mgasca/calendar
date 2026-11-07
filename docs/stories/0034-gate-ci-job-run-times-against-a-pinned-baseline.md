---
status: planned
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/380
pr:
  - https://github.com/mgasca/calendar/pull/391
  - https://github.com/mgasca/calendar/pull/394
  - https://github.com/mgasca/calendar/pull/399
adrs: ["0012", "0017", "0039", "0045"]
---

# 0034 Gate CI job run times against a pinned baseline

## Story

> As a maintainer, I need each CI job to fail a pull request when it becomes clearly slower than its pinned baseline, and a check on `main` to tell me when smaller slowdowns add up, so that the time epics #272 and #347 won back is not lost again one change at a time, without a stream of false failures.

Tracked in epic #380; this card is PR 0 of child #383.

## Background

Epics #272 and #347 cut the time an author waits for a pull request run from a median of 2:05 to 1:29, and the Frontend job from 4:28 to 0:53 (records [0002](../benchmarks/0002-frontend-ci-job.md)–[0012](../benchmarks/0012-ci-after-epic-347.md)). Each fix has a benchmark record, but nothing checks that the gain lasts. Until now that was deliberate: `docs/benchmarks/README.md` said a record is evidence and never a gate, and story [0033](0033-review-how-long-delivery-automation-makes-us-wait.md) kept "Gating CI on timings" out of scope, because shared runners make a fixed wall-clock limit flaky.

The first version of epic #380 kept that rule and proposed only mechanism guards: checks that fail when the cause of a fixed slowdown comes back. The maintainer revised it the same day, in a Claude Code session, with the answers recorded on the epic: first and foremost, no CI job may regress beyond roughly its current run time, and a gate that fails CI must use sound statistics so it does not fail falsely. The mechanism guards stay, as secondary scope. [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) sets the method; this card is the durable record of the epic.

The building blocks exist. `tools/ci-timings` samples job and step durations from the runs GitHub keeps, with nearest-rank statistics. `CI result` is the single required check ([ADR-0012](../decisions/0012-ci-and-dependency-updates.md)) and already reads this run's jobs from the API (#368). The CALM model ([ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md)) attaches requirements to elements as controls, such as `client-performance` and `quality-gates`.

### Agreed scope

Agreed with the maintainer on epic #380 (in a Claude Code session, recorded on the epic's first comment).

* **A run-time gate per job and path:** Backend, Frontend, Docs site, Tooling and Container image each have a threshold per path: the **publication** path, when the run built the docs publication artifact (pushes to `main` and docs-only pull requests), and the **check** path otherwise (dispatches and every other pull request). A run is classified by what it did, not by its event. The quantity is the job's start-to-end time; queue time and skipped jobs are not gated.
* **Fails only on a clear outlier:** the threshold is the robust log-normal bound of ADR-0045 (median and MAD of log time, with `z` from a budget of about 1 % of PR runs across all gated jobs), and never less than an absolute floor and a relative margin above the median. Its constants are provisional until record 0014 calibrates them.
* **A pinned, committed baseline:** `.github/ci-baseline.json`, measured from at least 30 successful runs per job and path on `main`, with n, window, commits and robust statistics (median, MAD, nearest-rank percentiles), written by `ci-timings --baseline` and backed by benchmark record 0014 (#384). Runs on `main` never move it.
* **A back-test:** the threshold is evaluated on runs held out of the baseline, and record 0014 reports the observed false-failure rate per job and across jobs.
* **The gate in `CI result`:** a step in the single required check (#385). It fails pull request and merge-group runs and only reports on pushes and dispatches. Its message names the job, its time, the threshold and the baseline median. Its added time on the critical path is measured and reported.
* **A deliberate update path:** a PR that adds necessary time regenerates the baseline and adds a benchmark record in the same PR, so the new threshold applies to its own run and shows in review. `docs/benchmarks/README.md` documents it.
* **A trend check on `main`:** a scheduled workflow compares recent push runs with the baseline (one-sided Mann–Whitney test with the Hodges–Lehmann shift, ADR-0045). It opens or updates one issue when a slowdown is both significant and above a minimum effect, and never fails a run (#386).
* **Secondary, mechanism guards:** deterministic checks that fail when the mechanism of a fix from #347 (or #368, #272) comes back, run in `just check` and CI (#387). They say why a job got slower; the gate says that it did.
* **The architecture model:** a `delivery-performance` control on `github-actions` with its requirement schema, naming the gated jobs, the baseline file and record, the thresholds and budget, the trend check, every guard and its test, and the ADRs (#388).

### Not in this story

* **New performance work on the jobs:** this story keeps today's run times; it does not shorten them.
* **Gating queue time or a run's wall clock as a whole:** the trend check may report them, but no check fails on them.
* **Updating the baseline automatically:** it moves only with a deliberate PR and a record.
* **Gating CodeQL, dependency review, Pages or the infrastructure workflows:** only the jobs of `ci.yml` that `CI result` needs.
* **A skip switch for runner incidents:** the maintainer chose none for now (#391); re-running all jobs is the only remedy.

### Dependencies

ADR-0045 must be accepted before any gate merges. Delivery order: #383 (this card and the ADR) → #384 (baseline, record 0014) → #385 (PR gate) → #386 (trend check); #387 (guards) runs alongside; #388 (CALM control, guard map, this card implemented) comes last.

### Acceptance criteria

1. **Given** the baseline record, **when** I read `.github/ci-baseline.json`, **then** every gated job has an entry per path measured from at least 30 successful runs, with n, window, commits, median, MAD, percentiles, constants and threshold, and it names record 0014.
2. **Given** the held-out runs of record 0014, **when** the threshold is back-tested, **then** the record reports the observed false-failure rate per job and across jobs, and the rate across jobs is within the ADR's budget of about 1 % of PR runs.
3. **Given** a pull request run in which one gated job takes longer than its threshold (for example a `sleep` injected on a scratch branch), **when** `CI result` runs, **then** it fails and names the job, its time, the threshold and the baseline median.
4. **Given** a pull request run in which every gated job is within its threshold, **when** `CI result` runs, **then** the gate passes.
5. **Given** a job that is only a few seconds slower than its median, **when** the gate compares it, **then** it passes, because the threshold is never less than the floor and margin above the median.
6. **Given** a docs-only pull request, **when** the gate judges the Docs site job, **then** it uses the publication-path baseline for every gated job, because the publication steps ran.
7. **Given** a push to `main` or a dispatch run, **when** a job exceeds its threshold, **then** `CI result` reports it in the step summary and does not fail.
8. **Given** a PR that regenerates the baseline with a new benchmark record, **when** its CI runs, **then** the gate uses the PR's own baseline file.
9. **Given** the gate, **when** its time on the critical path is measured on the same basis as record 0012, **then** the delivery PR reports it.
10. **Given** a constructed history of `main` with a slowdown above the minimum effect, **when** the trend check runs, **then** it opens one issue naming the job and the shift; **given** a slowdown below the minimum effect, or one that is not significant, **then** it opens none; **given** an open trend issue, **then** a later finding comments on it rather than opening another.
11. **Given** each mechanism guard of #387, **when** its fix is reverted locally, **then** the guard fails, and the guards run in `just check` and CI.
12. **Given** the CALM model, **when** the Docs site job validates it, **then** it has the `delivery-performance` control on `github-actions` with its requirement schema and passes.
13. **Given** `docs/benchmarks/README.md` and story 0033, **when** I read them, **then** neither says timings are never gates, and the README documents the baseline update path and which gate or guard protects each record.
14. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | Gate each CI job's run time against a pinned baseline with a robust log-normal bound | Sets the threshold, the paths, where the gate runs, the baseline file, the update path and the trend test. |
| [0012](../decisions/0012-ci-and-dependency-updates.md) | GitHub Actions CI with `CI result` as the single required check | The gate is a step in `CI result`, so it needs no ruleset change. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling as .NET file-based apps | The baseline, back-test and trend logic live in `tools/ci-timings` with xUnit tests. |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | FINOS CALM architecture model | The gates and guards are recorded as a `delivery-performance` control. |

ADR-0045 is new in this story.

### Other decisions (not ADR-worthy)

* **The gate before the guards:** the maintainer ranked "no job gets slower" first; a guard covers only a regression whose cause someone foresaw.
* **One session per stack of work:** session A owns the decision, the card, the README and the model; session B the baseline, gate and trend check, which share `tools/ci-timings` and `ci.yml`; session C the guards. Numbers ADR 0045, story 0034 and record 0014 were allocated on the epic.
* **Dispatched runs need approval:** the check-path baseline needs about 30 dispatch runs on `main`; they run one at a time, spread over the day, and only with the maintainer's approval on #384, as in #347.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Decision | `docs/decisions/0045-run-time-regression-gates-for-ci-jobs.md` |
| Baseline, back-test and trend logic | `tools/ci-timings/` |
| Pinned baseline | `.github/ci-baseline.json` |
| Baseline record | `docs/benchmarks/0014-*.md` |
| PR gate | `CI result` in `.github/workflows/ci.yml`, running `.github/ci-gate.jq` |
| Trend check | a scheduled workflow in `.github/workflows/` |
| Mechanism guards | a structure-test tool under `tools/`, and guards inside existing suites |
| CALM control | `docs/architecture/calendar.architecture.json`, `docs/architecture/controls/delivery-performance.requirement.json` |

### API

No changes.

### Testing

* xUnit tests in `tools/ci-timings` for the threshold formula, the path rules, the baseline file and the back-test; the trend test on a constructed history.
* `tools/ci-timings` tests that run `.github/ci-gate.jq` with `jq` against canned jobs API responses (a slow job fails, an ordinary run passes, both paths, a missing baseline entry, a report-only push run), and a test that the `CI result` step runs that file.
* The PR gate proved both ways on CI: an injected slowdown on a scratch branch fails it, an ordinary run passes.
* Each mechanism guard proved by reverting its fix locally (a negative control).
* The CALM model validated by the Docs site job.

### Lessons learned, known issues and follow-ups

To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

When a pull request makes a CI job clearly slower than usual, the **CI result** check fails with a message that names the job, how long it took, the limit and the usual time. If you think it was a slow runner, use **Re-run all jobs** (not **Re-run failed jobs**, which only repeats the check on the same times). If the extra time is necessary, regenerate the baseline in the same pull request and add a benchmark record that explains it; the reviewer sees the new limit in the diff. Smaller slowdowns that pass every pull request are caught later by a daily check on `main`, which opens an issue labelled `performance`.
