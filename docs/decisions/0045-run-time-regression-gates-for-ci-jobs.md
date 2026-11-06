---
status: proposed
date: 2026-11-06
decision-makers: mgasca, Claude (AI assistant)
---

# Gate each CI job's run time against a pinned baseline with a robust log-normal bound

## Context and Problem Statement

Epics #272 and #347 cut what an author waits for on a pull request run from a median of 2:05 to 1:29 (records [0002](../benchmarks/0002-frontend-ci-job.md)–[0012](../benchmarks/0012-ci-after-epic-347.md)). Nothing stops a later change from quietly undoing that. Until now, timings were evidence and never a gate: `docs/benchmarks/README.md` said so, and story [0033](../stories/0033-review-how-long-delivery-automation-makes-us-wait.md) kept "Gating CI on timings" out of scope, because shared runners make a fixed wall-clock threshold flaky. The maintainer reversed that on epic #380: first and foremost, no CI job may regress beyond roughly its current run time, and a gate that fails CI must rest on sound statistics so that it does not produce a stream of false failures. The maintainer also chose a PR gate that fails only on a clear outlier plus a scheduled trend check on `main`, and a baseline pinned per job and path, changed only by a deliberate PR. Which threshold should a job's run time be compared with, so that a clear regression fails a pull request while a run with no regression fails at most about 1 % of the time across all gated jobs?

## Decision Drivers

* **D1 Bounded false failures**: at most about 1 % of pull request runs with no regression fail on time, across all gated jobs together, and the bound can be calibrated and back-tested on held-out runs. A gate that cries wolf gets re-run until green and stops meaning anything.
* **D2 Catches a clear regression in one run**: a slowdown of the size the epics removed (tens of seconds on a job of about 1:20) fails the pull request that adds it, not some later one. Smaller creep is the trend check's job.
* **D3 Estimable from a 30-run baseline**: the epic requires at least 30 successful runs per job and path. Each extra baseline run on the PR path is a dispatched CI run, so the method must work at that size rather than need hundreds.
* **D4 Robust to skew and outliers**: job durations are right-skewed, a slow runner now and then lands in the baseline, and timestamps have one-second resolution. One odd run must not move the threshold much.
* **D5 Explainable failure**: the failure names the job, its time, the threshold and the baseline median, so an author can tell a regression from noise without reading statistics.
* **D6 Cheap and stateless on the critical path**: the gate runs inside the run it judges, adds about a second to the 1:29 it protects, and needs nothing from earlier runs.

## Considered Options

* Robust log-normal bound with a practical floor
* Nearest-rank percentile times a margin
* Baseline maximum plus a margin
* Two consecutive exceedances
* No timing gate (records and mechanism guards only)

## Decision Outcome

Chosen option: "Robust log-normal bound with a practical floor", because it is the only option whose false-failure rate follows from a stated budget and can be estimated from 30 runs (D1, D3), it ignores the odd slow baseline run (D4), it fails a clear regression in the run that adds it (D2), and it reduces to one precomputed number per job and path, so the gate is a comparison that costs about a second (D6). Its cost is a formula an author has not met before, which the failure message and this record explain (D5).

| Driver | **Robust log-normal bound with a practical floor (chosen)** | Nearest-rank percentile times a margin | Baseline maximum plus a margin | Two consecutive exceedances | No timing gate (records and mechanism guards only) |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Bounded false failures | ★★★ | ★☆☆ | ★☆☆ | ★★☆ | ★★★ |
| D2 Catches a clear regression in one run | ★★☆ | ★★☆ | ★☆☆ | ★☆☆ | ☆☆☆ |
| D3 Estimable from a 30-run baseline | ★★★ | ☆☆☆ | ★★☆ | ★★☆ | ★★★ |
| D4 Robust to skew and outliers | ★★★ | ★★☆ | ☆☆☆ | ★★☆ | ★★★ |
| D5 Explainable failure | ★★☆ | ★★★ | ★★★ | ★☆☆ | ☆☆☆ |
| D6 Cheap and stateless on the critical path | ★★★ | ★★★ | ★★★ | ★☆☆ | ★★★ |

### The threshold

For each gated job `j` and path `p`, from the pinned baseline sample of `n ≥ 30` successful runs:

```text
x_i       = ln(duration_i in seconds)
m         = median(x)
s         = 1.4826 × median(|x_i − m|)          (MAD of log time, scaled to a normal σ)
z         = Φ⁻¹(1 − α / J)
threshold = max( exp(m + z × s),  M + max(floor, r × M) )   where M = exp(m), the baseline median
```

A job fails the gate when its duration is **greater than** the threshold, rounded up to a whole second.

* **Logs:** durations are skewed and their noise is multiplicative (a slow runner slows every step by a similar factor), so a bound on log time is closer to how they vary than a bound on seconds.
* **Median and MAD:** they ignore up to half the sample, so one slow runner in the baseline does not widen the band (D4). `1.4826` makes the MAD estimate σ for normally distributed log times.
* **z from α/J:** with a budget of `α = 1 %` of PR runs and `J = 5` gated jobs, each job is allowed `0.2 %`, so `z = Φ⁻¹(0.998) ≈ 2.88`. The Bonferroni split holds whatever the correlation between jobs; jobs that slow down together (a slow runner pool) make the true rate lower, not higher.
* **Floor and margin:** the second term keeps the threshold at least `floor` seconds and `r` of the median above the median, so runner jitter on a short, stable job never fails a PR. Provisional constants: `floor = 15 s`, `r = 10 %`.
* **Provisional constants:** `α`, `floor` and `r` are set here as starting values. Record 0014 (#384) measures the baseline, back-tests the threshold and may change them; the baseline file states the constants it used. Changing the method, not the constants, needs a new ADR.

An illustration, **inferred** rather than measured: if Backend's median is 79 s (record 0012) and its log-MAD is 0.08, then `s ≈ 0.12`, the first term is `79 × e^(2.88 × 0.12) ≈ 112 s`, and the floor term is 94 s. A run of 1:53 or more fails; that is the Backend median before #349 and #350.

### What is gated, and on which path

* **Quantity:** each job's execution time, `started_at` to `completed_at` from `GET /actions/runs/{id}/attempts/{attempt}/jobs`. Queue time is not gated. Skipped jobs are ignored.
* **Gated jobs:** Backend, Frontend, Docs site, Tooling and Container image (`J = 5`). Not `CI result` itself, and not `Cancel superseded runs`, which only pull requests run and which `CI result` does not wait for. A job with no baseline entry (new or renamed) passes with a warning that names it, until the next baseline update adds it, and `J` counts the jobs the baseline holds.
* **Paths:** a run takes the **PR path** (`pull_request`, `merge_group`, `workflow_dispatch`) or the **push path** (`push` to `main`). The Docs site job takes the push path whenever its publication steps ran, which includes docs-only pull requests, because those steps add about 20 s (record 0012). So a bimodal job never widens one band with two clusters.
* **Fails or annotates:** the gate fails `CI result` on `pull_request` and `merge_group` runs. On pushes and dispatches it only writes the comparison to the step summary, because those runs measure `main` and feed the trend check.

### Where the gate runs

A step in `CI result`, the single required check of [ADR-0012](0012-ci-and-dependency-updates.md), after "All needed jobs succeeded" and reading the same jobs API response. The thresholds are precomputed in the baseline file, so the step compares numbers and adds about a second; the derivation, the statistics and the back-test live in `tools/ci-timings` with xUnit tests ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)).

* **Not a job of its own:** a separate job only gates if `CI result` needs it, so it would add a job start and a runner to the end of every run. It can only start once every gated job has ended, exactly like `CI result`.
* **Not the .NET tool inside `CI result`:** that would add `setup-dotnet` (3–12 s on Backend, record 0012) and a compile to the critical path, 5–20 % of the 1:29 the gate protects. Revisit if the comparison grows beyond comparing numbers.
* **Measured cost:** #385 reports the step's added time on the critical path, on the same basis as record 0012.

### The baseline file

* **Location:** `.github/ci-baseline.json`, beside the workflow it describes, read from the commit under test (the merge commit of a pull request).
* **Content:** a schema version, the method and constants (`α`, `J`, `z`, `floor`, `r`), the benchmark record it came from, and per job and path: `n`, the window, the first and last commit, the run IDs, the median, the log-MAD, p90, the maximum and the threshold in seconds.
* **Source:** measured from runs on `main`: push runs for the push path, and `workflow_dispatch` runs on `main` for the PR path, which take the same steps as a pull request run (record 0012). Record 0014 states which runs and whether pull request runs can join the PR-path sample. Dispatches run one at a time, with the maintainer's approval on the issue, as in #347.
* **Written by** `ci-timings baseline`, never by hand, so the thresholds always follow from the stated sample and constants.

### Updating the baseline deliberately

A pull request that adds necessary time (a new check, a slower but required step) regenerates `.github/ci-baseline.json` with `ci-timings baseline` and adds a benchmark record in the same PR. Because the gate reads the file from the commit under test, the new threshold applies to that PR's own run, and the change to the file is in the diff the reviewer approves. Nothing else moves the baseline: runs on `main` never update it, so it cannot creep upward.

A suspected false failure is retried with **Re-run all jobs**. "Re-run failed jobs" re-runs only `CI result`, which reads the same durations again. A second failure is evidence of a regression.

### The trend check on `main`

A scheduled workflow (daily, and on demand) compares the last `N = 20` successful push runs per job with the push-path baseline:

* **Test:** a one-sided Mann–Whitney U test that the recent durations are stochastically larger than the baseline's, at `p < 0.01` per job. It needs no assumption about the shape of the distribution, which suits skewed durations, and it is exact and deterministic at these sizes (a bootstrap would be neither at `n = 20` without a fixed seed).
* **Effect:** the Hodges–Lehmann estimate of the shift (the median of all pairwise differences, recent minus baseline), the estimator that goes with the Mann–Whitney test. It reports only when the test is significant **and** the shift is at least `max(10 s, 5 %)` of the baseline median, so a significant but negligible shift raises nothing.
* **Output:** it opens one issue labelled `performance`, or comments on the open one, naming the job, the shift and its interval, both samples and the commits in the recent window. It never fails a run. Its constants are provisional like the gate's, and #386 proves it on a constructed history.
* Runs on `main` on one day share runner conditions, so the p-value is optimistic. The minimum effect is the guard against that.

### Consequences

* Good, because a regression of the size #347 removed fails the pull request that adds it, with the job, its time, the threshold and the baseline in the message.
* Good, because the false-failure rate is a stated budget that record 0014 back-tests and every later baseline record reports.
* Good, because the gate adds about a second and no job to the critical path, and needs no state across runs.
* Good, because the trend check catches creep below the per-run threshold without failing anyone's PR.
* Bad, because a regression smaller than the band (a few seconds per PR) passes every PR gate; only the trend check, days later, sees the sum.
* Bad, because the PR-path baseline costs about 30 dispatched runs each time it is re-measured.
* Bad, because a runner incident (a slow image, a degraded region) can fail several PRs on one day; the remedy is re-running all jobs, and a pattern of them is a reason to recalibrate.
* Neutral: timing records stay evidence. The pinned baseline is the one timing artefact a check asserts, and it changes only with a record.

### Confirmation

* `tools/ci-timings` tests cover the threshold formula, the path rules and the back-test (#384), and the trend test on a constructed history (#386).
* Record 0014 reports the observed false-failure rate on held-out runs, per job and across jobs, with its one-sided 95 % upper bound.
* #385 proves the gate both ways: a scratch branch with an injected `sleep` fails it, and an ordinary run passes. It reports the step's added time.
* Review: a change to `.github/ci-baseline.json` comes with a benchmark record in the same PR.

## Pros and Cons of the Options

### Robust log-normal bound with a practical floor

* Good, because **D1 Bounded false failures**: the per-job tail probability is `α/J` by construction under a log-normal fit, and the back-test checks the fit on held-out runs.
* Good, because **D2 Catches a clear regression in one run**: on a job with a log-MAD near 0.08, a slowdown of about 40 % fails in one run (inferred above).
* Neutral, because **D2 Catches a clear regression in one run**: on a noisy job the band is wider, so a smaller slowdown passes the PR gate and is left to the trend check.
* Good, because **D3 Estimable from a 30-run baseline**: a median and a MAD are stable at `n = 30`, unlike a tail quantile.
* Good, because **D4 Robust to skew and outliers**: logs absorb the skew, and the median and MAD ignore a few slow runs.
* Bad, because **D4 Robust to skew and outliers**: if the true tail is heavier than log-normal, the real false-failure rate is above `α/J`; the back-test is what finds that.
* Bad, because **D5 Explainable failure**: the formula needs this record to explain; the message gives the threshold and the median, not the derivation.
* Good, because **D6 Cheap and stateless on the critical path**: one precomputed number per job and path, compared in the existing step.

### Nearest-rank percentile times a margin

* Bad, because **D1 Bounded false failures**: the margin, not the percentile, sets the false-failure rate, and nothing in a 30-run sample says how large it must be.
* Bad, because **D3 Estimable from a 30-run baseline**: a per-job tail of 0.2 % needs about 500 runs to estimate by rank; at `n = 30` the highest rank is about p97.
* Neutral, because **D2 Catches a clear regression in one run**: with a p90 and a margin of 20–30 %, a clear regression fails, but so does an ordinary tail run.
* Neutral, because **D4 Robust to skew and outliers**: a p90 tolerates a few slow runs, but not as many as the median.
* Good, because **D5 Explainable failure**: "more than 1.25 × this job's p90" needs no explanation.
* Good, because **D6 Cheap and stateless on the critical path**: one precomputed number, like the chosen option.

### Baseline maximum plus a margin

* Bad, because **D1 Bounded false failures**: a new run beats the maximum of 30 runs with probability 1/31 per job, about 15 % of runs across five jobs before the margin, and the margin needed to bring that to 1 % is unknown.
* Bad, because **D2 Catches a clear regression in one run**: to keep false failures down, the margin must be large, so a real regression of 20–30 % often passes.
* Neutral, because **D3 Estimable from a 30-run baseline**: the maximum is easy to read from any sample, but it grows with `n`, so a bigger baseline loosens the gate.
* Bad, because **D4 Robust to skew and outliers**: one slow runner in the baseline sets the threshold for every later PR.
* Good, because **D5 Explainable failure**: "slower than any baseline run plus 10 %" is plain.
* Good, because **D6 Cheap and stateless on the critical path**: one precomputed number.

### Two consecutive exceedances

* Neutral, because **D1 Bounded false failures**: if runs were independent, needing two exceedances would square the per-run rate, but consecutive runs of one branch share runner conditions, so the saving is smaller and cannot be calibrated.
* Bad, because **D2 Catches a clear regression in one run**: it can never fail the first slow run, and most pull requests are judged on one run of their last commit.
* Neutral, because **D3 Estimable from a 30-run baseline**: it still needs a per-run threshold from one of the other methods.
* Neutral, because **D4 Robust to skew and outliers**: one slow run never fails, but the threshold underneath is only as robust as its method.
* Bad, because **D5 Explainable failure**: whether a run fails depends on another run, which the author may not have looked at.
* Bad, because **D6 Cheap and stateless on the critical path**: the gate must find and read the previous run of the branch, and decide what counts as previous after a force-push.

### No timing gate (records and mechanism guards only)

* Good, because **D1 Bounded false failures**: nothing fails on time, so there are no false failures.
* Bad, because **D2 Catches a clear regression in one run**: a slower job merges unnoticed unless a mechanism guard happens to cover its cause; this is the outcome the maintainer ruled out on #380.
* Good, because **D3 Estimable from a 30-run baseline**: no baseline to measure.
* Good, because **D4 Robust to skew and outliers**: no statistic to disturb.
* Bad, because **D5 Explainable failure**: there is no failure to explain; an author learns about a regression only from a later review.
* Good, because **D6 Cheap and stateless on the critical path**: nothing runs.

## More Information

* **Related:** [ADR-0012](0012-ci-and-dependency-updates.md) (`CI result` is the single required check), [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) (the baseline and trend logic is a .NET file-based app), [ADR-0039](0039-architecture-model-and-visualization-tooling.md) (the `delivery-performance` control in the CALM model will carry the baseline and thresholds, #388).
* **Supersedes in part:** the rule in `docs/benchmarks/README.md` that no timing is asserted in CI, and story 0033's out-of-scope line "Gating CI on timings". Both are amended in the PR that adds this record. No earlier ADR decided either, so no ADR is superseded.
* **Delivery:** epic #380 and story [0034](../stories/0034-gate-ci-job-run-times-against-a-pinned-baseline.md): #384 (baseline and back-test, record 0014), #385 (the PR gate), #386 (the trend check), #387 (mechanism guards), #388 (CALM control and guard map). Nothing that gates CI merges before this record is accepted.
* **Open questions for the reviewer:**
  1. Should a maintainer be able to skip the gate for one run (for example a label such as `runtime-gate-skip`) during a known runner incident, or is "Re-run all jobs" the only remedy?
  2. Is `.github/ci-baseline.json` the right place, or should the baseline live with the records in `docs/benchmarks/` (the docs site would then need to ignore it)?
  3. Are the provisional constants (`α = 1 %`, `floor = 15 s`, `r = 10 %`; trend `N = 20`, `p < 0.01`, minimum effect `max(10 s, 5 %)`) acceptable as starting values for record 0014 to calibrate?
* **Revisit when:** the back-test or a month of PR runs shows a false-failure rate above the budget (recalibrate, then reconsider the log-normal fit); a job is added or split (re-measure, and `J` changes); the comparison in `CI result` needs more than comparing numbers (move it into the tool and measure its cost); or GitHub changes runner hardware for `ubuntu-latest` (re-measure the baseline). Record 0014 and the baseline file carry the same conditions.
