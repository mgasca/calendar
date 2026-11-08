---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/380
pr:
  - https://github.com/mgasca/calendar/pull/391
  - https://github.com/mgasca/calendar/pull/394
  - https://github.com/mgasca/calendar/pull/393
  - https://github.com/mgasca/calendar/pull/397
  - https://github.com/mgasca/calendar/pull/399
  - https://github.com/mgasca/calendar/pull/392
  - https://github.com/mgasca/calendar/pull/395
  - https://github.com/mgasca/calendar/pull/398
  - https://github.com/mgasca/calendar/pull/404
  - https://github.com/mgasca/calendar/pull/541
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
* **Fails only on a clear outlier:** the threshold is the robust log-normal bound of ADR-0045 (median and MAD of log time, with `z` from a budget of about 1 % of PR runs across all gated jobs), and never less than an absolute floor and a relative margin above the median. Record 0014 kept ADR-0045's provisional constants (α = 1 %); record 0017 recalibrated α to 0.1 % after the six-job re-pin would have failed 3.7 % of held-out runs, and the first gated week decides whether to adjust further (#421).
* **A pinned, committed baseline:** `.github/ci-baseline.json`, measured from at least 30 successful runs per job and path on `main`, with n, window, commits and robust statistics (median, MAD, nearest-rank percentiles), written by `ci-timings --baseline` and backed by benchmark records 0014 (#384) and 0017 (#420, six jobs, both paths). Runs on `main` never move it.
* **A back-test:** the threshold is evaluated on runs held out of the baseline, and records 0014 and 0017 report the observed false-failure rate per job and across jobs.
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
* **Reviewing the false-failure rate after the first gated week:** the maintainer accepted the rate measured at the first pin and will revisit it with a week of gated pull request runs (#421).

### Dependencies

ADR-0045 must be accepted before any gate merges. Delivery order: #383 (this card and the ADR) → #384 (baseline, record 0014) → #385 (PR gate) → #386 (trend check); #387 (guards) runs alongside; #388 (CALM control, guard map, this card) follows the gate and trend check. #420 re-pins both paths with `Changes` gated (record 0017) and completes the card.

### Acceptance criteria

1. **Given** the baseline record, **when** I read `.github/ci-baseline.json`, **then** every gated job has an entry per path measured from at least 30 successful runs, with n, window, commits, median, MAD, percentiles, constants and threshold, and it names a record. *Met by record [0017](../benchmarks/0017-ci-baseline-with-changes.md):* both paths are `pinned` for all six jobs (30 dispatches on the check path, 48 pushes on the publication path, after #422). Record 0014 first pinned the check path only. Tests: [BaselineTests.cs](../../tools/ci-timings/tests/BaselineTests.cs) (`Build_SplitsPathsMarksThinPathsProvisionalAndSetsJFromTheJobs`, `Write_IsDeterministicAndStatesTheWindowAndConstants`, `Derive_UsesNearestRankStatistics`) and [GateTests.cs](../../tools/ci-timings/tests/GateTests.cs) (`TheCommittedBaseline_IsReadableByTheTool_AndHoldsBothPaths`); the file itself is record [0017](../benchmarks/0017-ci-baseline-with-changes.md)'s output.
2. **Given** the held-out runs of record 0014, **when** the threshold is back-tested, **then** the record reports the observed false-failure rate per job and across jobs, and the rate across jobs is within the ADR's budget of about 1 % of PR runs. *Met as observed, not proven:* record [0014](../benchmarks/0014-ci-job-baseline.md) had a pooled rate of 5.5 % (4 of 73 runs), accepted by the maintainer on 2026-11-07. Record [0017](../benchmarks/0017-ci-baseline-with-changes.md) recalibrated α to 0.1 % and observes 0 of 136 held-out runs (one-sided 95 % upper bound 2.2 %, still above 1 %); #421 reviews it after the first gated week. Tests for the back-test: [BaselineTests.cs](../../tools/ci-timings/tests/BaselineTests.cs) (`Evaluate_CountsOnlyDurationsAboveTheThreshold_AndSkipsJobsWithoutABaseline`, `Evaluate_LeavesOutTheBaselinesOwnRuns`, `BackTestTable_ReportsTheRateAndItsUpperBound`, `UpperBound_WithOneFailureInThirty_MatchesClopperPearson`).
3. **Given** a pull request run in which one gated job takes longer than its threshold (for example a `sleep` injected on a scratch branch), **when** `CI result` runs, **then** it fails and names the job, its time, the threshold and the baseline median. [GateTests.cs](../../tools/ci-timings/tests/GateTests.cs) (`ASlowJobOnAGatingEvent_FailsAndNamesTheJobTimeThresholdAndMedian`, `OneSecondAboveTheThreshold_Fails`); on CI, scratch PR #417 added `sleep 60` to Backend and `CI result` failed with "Backend took 2:16 on the check path, above its threshold of 1:54" (#395).
4. **Given** a pull request run in which every gated job is within its threshold, **when** `CI result` runs, **then** the gate passes. [GateTests.cs](../../tools/ci-timings/tests/GateTests.cs) (`AnOrdinaryPullRequestRun_Passes`, `ExactlyAtTheThreshold_Passes`); on CI, the runs of #395 and #398 passed against the pinned baseline.
5. **Given** a job that is only a few seconds slower than its median, **when** the gate compares it, **then** it passes, because the threshold is never less than the floor and margin above the median. [BaselineTests.cs](../../tools/ci-timings/tests/BaselineTests.cs) (`Threshold_OfAStableJob_IsTheFloorAboveTheMedian`, `Threshold_OfALongStableJob_IsTheRelativeMarginAboveTheMedian`).
6. **Given** a docs-only pull request, **when** the gate judges the Docs site job, **then** it uses the publication-path baseline for every gated job, because the publication steps ran. [GateTests.cs](../../tools/ci-timings/tests/GateTests.cs) (`APublishedRun_IsComparedWithThePublicationPath`, `AnUnpublishedRun_IsComparedWithTheCheckPath`) and [BaselineTests.cs](../../tools/ci-timings/tests/BaselineTests.cs) (`PathOf_IsPublicationWheneverTheDocsSitePublicationStepSucceeded`). A path the file marks provisional would only report (`ASlowJobOnAProvisionalPath_OnlyWarns`); both are pinned now.
7. **Given** a push to `main` or a dispatch run, **when** a job exceeds its threshold, **then** `CI result` reports it in the step summary and does not fail. [GateTests.cs](../../tools/ci-timings/tests/GateTests.cs) (`ASlowJobOnAMainRun_OnlyWarns`, `TheSummary_IsAMarkdownTableAndNeverFails`).
8. **Given** a PR that regenerates the baseline with a new benchmark record, **when** its CI runs, **then** the gate uses the PR's own baseline file. [GateTests.cs](../../tools/ci-timings/tests/GateTests.cs) (`TheWorkflow_RunsThisGateFileInCiResult_OnTheSavedJobsResponse`) checks that `CI result` checks out `.github` from the commit under test and runs the gate on that file. No baseline-changing PR has run yet, so this has not been exercised end to end.
9. **Given** the gate, **when** its time on the critical path is measured on the same basis as record 0012, **then** the delivery PR reports it. Measured in #395 and recorded in record [0014](../benchmarks/0014-ci-job-baseline.md): `CI result` +3 s at the median (no automated test; a measurement).
10. **Given** a constructed history of `main` with a slowdown above the minimum effect, **when** the trend check runs, **then** it opens one issue naming the job and the shift; **given** a slowdown below the minimum effect, or one that is not significant, **then** it opens none; **given** an open trend issue, **then** a later finding comments on it rather than opening another. [TrendTests.cs](../../tools/ci-timings/tests/TrendTests.cs) (`AHistoryShiftedByTwentySeconds_IsReportedSlower`, `AnUnshiftedHistory_IsNotReported`, `ASignificantShiftBelowTheMinimumEffect_IsNotReported`, `IssueAction_CreatesWhenNoneIsOpen_CommentsOnTheOpenOne_AndDoesNothingWithoutARegression`, `Report_NamesTheJobTheShiftTheWindowAndTheRuns`, `TheTrendWorkflow_RunsOnScheduleAndDispatchOnly_NeverForAPullRequest`). The scheduled workflow itself had not run on `main` when this card was completed.
11. **Given** each mechanism guard of #387, **when** its fix is reverted locally, **then** the guard fails, and the guards run in `just check` and CI. [delivery-guards.tests.cs](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`Guard_PassesOnThisCheckout`, `Guard_PassesOnTheFixture` and one broken fixture per mechanism), [ApiTestParallelismTests.cs](../../backend/tests/Calendar.Api.Tests/ApiTestParallelismTests.cs), [vitestConfig.test.ts](../../frontend/apps/web/dev/vitestConfig.test.ts) (`runs without per-file isolation`) and [docs-loader.test.ts](../../frontend/apps/docs/src/lib/docs-loader.test.ts) (`reads the corpus once per sync…`). The reverts were run by hand and are listed in #393 and #397.
12. **Given** the CALM model, **when** the Docs site job validates it, **then** it has the `delivery-performance` control on `github-actions` with its requirement schema and passes. `validate:architecture` (`calm validate --strict`, run by the Docs site job) on [the model](../architecture/calendar.architecture.json) and [the requirement schema](../architecture/controls/delivery-performance.requirement.json). A config key that the schema doesn't allow fails it; that was checked by hand (#404).
13. **Given** `docs/benchmarks/README.md` and story 0033, **when** I read them, **then** neither says timings are never gates, and the README documents the baseline update path and which gate or guard protects each record. Checked by hand. The README documents the update path and the rules, and points to the control as the map of guards (see Lessons learned).
14. **Given** the change is complete, **when** I run `just check`, **then** it passes. Run by CI on each delivery PR (`CI result`).

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

Delivered in three stacks, one per session. PR 0, #391, carried the card and ADR-0045. #394 recorded the maintainer's answers and #399 set the ADR to `accepted`. The mechanism guards came in #393 and #397, then the baseline (#392), the gate (#395) and the trend check (#398), stacked and merged together on 2026-11-07. #404 added the CALM control, the README rules and this card. #420 re-pinned both paths with `Changes` gated (record 0017, α recalibrated to 0.1 %) and completed the card.

### Where things live

| Area | Location |
| --- | --- |
| Decision | `docs/decisions/0045-run-time-regression-gates-for-ci-jobs.md` |
| Sampling, threshold, baseline file and back-test | `tools/ci-timings/Baseline.cs` (`--baseline`, `--holdout`) |
| Trend test, issue decision | `tools/ci-timings/Trend.cs` (`--trend`, `--issue`) |
| Pinned baseline | `.github/ci-baseline.json`: check path `pinned` (n = 30 dispatches), publication path `pinned` (n = 48 pushes), six jobs each, from the window after #422 (#420) |
| Baseline records | [0014](../benchmarks/0014-ci-job-baseline.md) (first pin, check path), [0017](../benchmarks/0017-ci-baseline-with-changes.md) (six jobs, both paths) |
| PR gate | step "Job run times are within the baseline (ADR 0045)" of `CI result` in `.github/workflows/ci.yml`, running `.github/ci-gate.jq` on the saved jobs API response |
| Trend check | `.github/workflows/ci-trend.yml`, daily at 06:23 UTC and on demand |
| Mechanism guards | `tools/delivery-guards/` (six guards over the workflow, recipes and MSBuild files), `backend/tests/Calendar.Api.Tests/ApiTestParallelismTests.cs`, `frontend/apps/web/dev/vitestConfig.test.ts`, and the existing `frontend/apps/docs/src/lib/docs-loader.test.ts` |
| CALM control | `controls.delivery-performance` on `github-actions` in `docs/architecture/calendar.architecture.json`, schema `docs/architecture/controls/delivery-performance.requirement.json` |
| Conventions | `docs/benchmarks/README.md`, "The pinned CI baseline" and "What protects a record" |

### API

No changes.

### Testing

* **`tools/ci-timings`** (`just tools test`): xUnit tests for the normal quantile, the Clopper–Pearson bound, each threshold term, nearest-rank statistics, the path rule, the baseline file round trip and the back-test (`BaselineTests.cs`). The trend tests check exact Mann–Whitney p-values by hand, the Hodges–Lehmann shift and constructed histories (`TrendTests.cs`). The gate tests run the committed `.github/ci-gate.jq` with `jq` on canned jobs API responses, and check that `ci.yml` runs that file (`GateTests.cs`). #395 lists a mutation of the jq program for each rule, each of which fails a test.
* **The gate on CI:** scratch PR #417 (closed, never merged) failed `CI result` with an injected `sleep 60`. The runs of #395 and #398 passed.
* **Mechanism guards:** each fix's commit was reverse-applied, or reverted by hand, and only its own guard failed (#393, rerun on the YAML reader in #397).
* **CALM:** `calm validate --strict` in the Docs site job, with the requirement schema mapped locally in `docs/architecture/url-mapping.json`.

### Lessons learned, known issues and follow-ups

* **The gate costs 3 s, not about a second.** `CI result` takes a median of 6 s with the gate (n = 11) against 3 s without it (n = 23), measured in #395. The comparison itself takes 0 s; the rest is the sparse checkout of the baseline file and the gate program, and its post step. ADR-0045 expected about a second. The maintainer accepted the measured cost on 2026-11-07.
* **The observed false-failure rate is above the budget.** At the first pin, 3 of the baseline's own 30 runs are above their job's threshold (Container image 115 s against 105 s; Docs site 277 s and 303 s against 117 s), and so is 1 of the 43 held-out PR runs: 4 of 73 distinct runs, 5.5 % (one-sided 95 % upper bound 12.1 %, record [0014](../benchmarks/0014-ci-job-baseline.md)), would fail with no regression, against the 1 % budget, so acceptance criterion 2 is not met. The cause looks like slow-runner events, where a whole runner is about twice as slow, a tail the robust log-normal bound deliberately ignores. The maintainer accepted gating at this rate on 2026-11-07, with **Re-run all jobs** as the remedy ([#384](https://github.com/mgasca/calendar/issues/384#issuecomment-6707646144)). **Record 0017 then recalibrated α from 1 % to 0.1 %** (maintainer's answer on #420): the six-job re-pin at α = 1 % would have failed 5 of 136 held-out runs (3.7 %), four of them Container image on the check path, and neither a wider floor nor a wider margin changed that, because the log-normal term sets every threshold. At α = 0.1 % none of the 136 fails (upper bound 2.2 %). #421 still reviews the first gated week. The remedies to weigh then are a re-pin that includes peak-hour runs, a recalibrated `z` (a benchmark record), or a slow-runner rule (an amendment to ADR-0045).
* **A baseline from one short window is too tight.** In #392, four dispatches from one 7-minute window would have failed 6 of 18 ordinary PR runs. The 30 check-path dispatches were therefore spread over the day, one at a time, with the maintainer's approval. They still miss 16–19Z, about 30 % of PR runs, and record 0014 says so.
* **The trend check first compared the wrong runs.** Its first live run compared pushes from before #347 with the new baseline, and reported Backend +23 s slower: #347's own saving, seen backwards. Recent runs now start after the baseline's last run, with a test that failed without the fix (#398).
* **ADR-0045 merged while still `proposed`.** #391 and #394 merged before the maintainer had approved the decision, which the `adr-draft` skill warns against. The maintainer approved it on #383 afterwards, and #399 set it to `accepted`. A PR can merge at its first head, so the approval has to land before the PR is ready, not after.
* **A guard PR merged before its review.** #393 merged three minutes after it opened, so the review findings (a YAML library instead of the hand-written reader, and the cancel job's safety checks) went into #397 and #396.
* **The guard map is the CALM control, not a README table.** The docs build forbids tables and numbered lists in a folder's conventions README, so `docs/benchmarks/README.md` states the rules, and the control lists each guard with the issue it protects, its record and its test (#404).
* **The control points to the thresholds; it doesn't copy them.** It holds the baseline file, the record and each path's status and `n`. The thresholds and medians stay only in `.github/ci-baseline.json`, which the gate reads (maintainer, #388).
* **Follow-ups:** #421 reviews the first gated week, including the overnight hours (01–13Z) that neither baseline covers. #418 (run each job only when the PR changes what it checks) will change which jobs a run has. A skipped job is not gated, so that needs no change to the gate.

## User guide

When a pull request makes a CI job clearly slower than usual, the **CI result** check fails. Its message names the job, how long it took, the limit and the usual time, for example: "Backend took 2:16 on the check path, above its threshold of 1:54". The step summary of **CI result** shows a table of every gated job with its time and limit.

* **You think it was a slow runner:** use **Re-run all jobs**. **Re-run failed jobs** only repeats the check on the same times. A second failure is evidence that the change made the job slower. About one run in twenty fails on a slow runner, so one failure on its own is weak evidence.
* **The extra time is necessary:** regenerate the baseline in the same pull request and add a benchmark record that explains it. `docs/benchmarks/README.md` gives the command. The check uses the pull request's own baseline file, and the reviewer sees each new limit in the diff.
* **A docs-only pull request:** its jobs are compared with the publication baseline, which is pinned, so a clearly slow job fails the pull request.
* **Pushes to `main` and dispatched runs:** a slow job only produces a warning. They never fail on time.
* **Smaller slowdowns:** they pass every pull request. A daily check on `main` compares the last 20 pushes with the baseline. When a job is both significantly and noticeably slower (at least 10 s or 5 %), it opens or comments on one issue labelled `performance`.
* **A guard fails in `just check` or the Tooling job:** the cause of an earlier fixed slowdown has come back. The message names the fix it protects.
