---
subject: "The pinned run-time baseline of each CI job per path, and its back-test on held-out pull request runs (ADR-0045)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0014 The pinned CI job baseline and its back-test

- **Date:** 2026-11-07
- **Issue:** [#384](https://github.com/mgasca/calendar/issues/384), part of epic [#380](https://github.com/mgasca/calendar/issues/380); method in [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md); PR [#392](https://github.com/mgasca/calendar/pull/392)
- **Harness:** `tools/ci-timings/ci-timings.cs`, run directly because the recipe does not quote its arguments (#345):

  ```bash
  dotnet run tools/ci-timings/ci-timings.cs -- --baseline --created "2026-11-06T20:04:00Z..2026-11-07T12:51:00Z" --holdout "2026-11-06T20:04:00Z..2026-11-07T12:51:00Z"
  ```

  It writes `.github/ci-baseline.json` and prints the tables below. The hold-out window equals the baseline window on purpose: the back-test leaves out every run the baseline was measured from, so what it tests is the pull request runs of the same hours.
- **Window:** every successful run of `ci.yml` on `main` from `209f497f` (2026-11-06 20:04Z, the first commit with every fix of #347) to 2026-11-07 12:51Z. The baseline holds 56 runs: 30 dispatches and 26 pushes, over 26 distinct commits.
- **Machine:** GitHub-hosted `ubuntu-latest` runners, as for every CI record.
- **Constants:** the provisional ones of ADR-0045 (`α = 1 %`, `J = 5`, so `z = 2.878`; floor 15 s; margin 10 %). This record does not change them; see "Reading".

## Question

What does each gated job (Backend, Frontend, Docs site, Tooling, Container image) take on each path once all of #347's fixes are on `main`? Which threshold does ADR-0045's formula give? Would those thresholds have failed pull request runs that had no regression, and how often?

## Method

- **Quantity:** each job's `started_at` to `completed_at` from the jobs API, successful jobs only. `CI result` and `Cancel superseded runs` are not gated, and skipped jobs are left out.
- **Paths:** a run is on the **publication** path when the Docs site step "Build and verify publication artifact" succeeded, otherwise on the **check** path. Every job of the run counts on that path (ADR-0045).
- **Sample:** pushes to `main` fill the publication path. The check path is filled by `workflow_dispatch` runs on `main`, approved by the maintainer on #384. Dispatches ran strictly one at a time; each waited until no CI run on `main` was in progress. The spacing changed twice, each time by a maintainer change relayed on #384:

  | Runs | Spacing | When |
  | --- | --- | --- |
  | 4 dispatches before this work | started by hand for record 0012 | 2026-11-06 20:14Z–20:21Z |
  | dispatch 1 | 30–60 min random wait after the previous run | 22:21Z |
  | dispatch 2 | 15–30 min | 23:13Z |
  | dispatch 3 | 10 min, start to start | 23:23Z |
  | dispatches 4–26 | 10 min, start to start | 2026-11-07 09:07Z–12:48Z |

  The machine that ran the loop was suspended overnight. That froze the loop's wait after dispatch 3, so the check path has **no run between 23:25Z and 09:07Z**.
- **Threshold:** `ceil(max(exp(m + z·1.4826·MAD), M + max(15 s, 10 % · M)))`. Here `m` and MAD are the median and the median absolute deviation of `ln(seconds)`, `M` is the median in seconds, and `z = Φ⁻¹(1 − α/J)`. The statistics are nearest-rank.
- **Back-test:** each held-out run's gated jobs are compared with its path's thresholds. A run "fails" when any job is above its threshold. The rate is reported per job and per run, with its one-sided 95 % Clopper–Pearson upper bound. Held-out runs: the 67 successful `pull_request` runs in the window. They carry each PR's own change, so they are never in the baseline (ADR-0045). Only the check path gates now, because the publication path is provisional; its back-test is reported for information.

## Results

### Window

| Path | status | runs | events | from | to | span | commits |
| --- | --- | --: | --- | --- | --- | --: | --- |
| check | **pinned** | 30 | workflow_dispatch | 2026-11-06 20:14Z | 2026-11-07 12:48Z | 16.6 h | 14 |
| publication | provisional | 26 | push | 2026-11-06 20:04Z | 2026-11-07 12:39Z | 16.6 h | 26 |

### Baseline and thresholds

| Path | Job | n | median | log-MAD | p90 | p95 | max | threshold | status |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |
| check | Backend | 30 | 1:22 | 0.076 | 1:32 | 1:38 | 1:52 | 1:54 | pinned |
| check | Container image | 30 | 1:04 | 0.116 | 1:22 | 1:25 | 1:55 | 1:45 | pinned |
| check | Docs site | 30 | 1:09 | 0.123 | 1:22 | 4:37 | 5:03 | 1:57 | pinned |
| check | Frontend | 30 | 0:46 | 0.140 | 0:55 | 0:59 | 0:59 | 1:24 | pinned |
| check | Tooling | 30 | 1:12 | 0.072 | 1:19 | 1:25 | 1:26 | 1:38 | pinned |
| publication | Backend | 26 | 1:23 | 0.070 | 1:32 | 1:33 | 1:39 | 1:52 | provisional |
| publication | Container image | 26 | 1:12 | 0.057 | 1:28 | 1:34 | 1:40 | 1:32 | provisional |
| publication | Docs site | 26 | 1:35 | 0.071 | 1:42 | 1:45 | 1:49 | 2:09 | provisional |
| publication | Frontend | 26 | 0:50 | 0.077 | 0:57 | 0:57 | 1:00 | 1:10 | provisional |
| publication | Tooling | 26 | 1:17 | 0.095 | 1:34 | 1:36 | 1:40 | 1:56 | provisional |

Every check-path threshold comes from the log-normal term. The floor term (median + 15 s, or + 10 %) is lower for every job.

### Back-test on held-out pull request runs

| Path | Job | held-out runs | exceeded | observed rate | 95 % upper bound |
| --- | --- | --: | --: | --: | --: |
| check | Backend | 43 | 1 | 2.3 % | 10.6 % |
| check | Container image | 43 | 0 | 0.0 % | 6.7 % |
| check | Docs site | 43 | 0 | 0.0 % | 6.7 % |
| check | Frontend | 43 | 0 | 0.0 % | 6.7 % |
| check | Tooling | 43 | 1 | 2.3 % | 10.6 % |
| publication | Backend | 24 | 1 | 4.2 % | 18.3 % |
| publication | Container image | 24 | 1 | 4.2 % | 18.3 % |
| publication | Docs site | 24 | 0 | 0.0 % | 11.7 % |
| publication | Frontend | 24 | 0 | 0.0 % | 11.7 % |
| publication | Tooling | 24 | 0 | 0.0 % | 11.7 % |

- **Check path, the one that gates now:** **1 of 43** runs would have failed (2.3 %; one-sided 95 % upper bound 10.6 %). The run is [42286830778](https://github.com/mgasca/calendar/actions/runs/42286830778) (`claude/issue-374-unreadable-source`, 2026-11-06 20:15Z). Its Backend job took 2:13 against a threshold of 1:54, and its Tooling job 1:40 against 1:38.
- **Publication path, report only:** 2 of 24 runs exceeded. Run [42292694344](https://github.com/mgasca/calendar/actions/runs/42292694344) had Backend at 1:58 against 1:52, and run [42307660732](https://github.com/mgasca/calendar/actions/runs/42307660732) had Container image at 1:35 against 1:32.
- **Both paths, as the tool counts them:** 3 of 67 (4.5 %; upper bound 11.2 %).

**The one check-path failure is a false failure.** That PR changed only `tools/agent-hooks`, yet every Backend and Tooling step of the run was slower than usual. Against dispatch [42311588100](https://github.com/mgasca/calendar/actions/runs/42311588100):

| Step | that run | typical dispatch |
| --- | --: | --: |
| `actions/setup-dotnet` (both jobs) | 17–18 s | about 4 s |
| `dotnet restore` | 12 s | about 3 s |
| `dotnet build` | 41 s | 20 s |

That pattern is a slow runner or a cold cache, not code. At the budget, a false failure rate of 1 % across jobs, about 0.4 false failures are expected in 43 runs. One is a plausible outcome (P(≥ 1) ≈ 35 %).

### Outliers kept in the baseline

Two dispatches had a slow Docs site job. Both are successful runs, so they stay in the sample. The median and MAD barely move for them, which is why ADR-0045 chose those statistics:

- Dispatch 5, [42359109435](https://github.com/mgasca/calendar/actions/runs/42359109435) (09:17Z), took **5:03**. Every step ran three to four times slower than usual, for example the docs tests at 73 s against about 17 s. That is a slow runner.
- Dispatch 6, [42359817664](https://github.com/mgasca/calendar/actions/runs/42359817664) (09:27Z), was slow because `pnpm install` took 191 s against about 3 s. That points to the package registry or the cache.

These two runs are the check-path Docs site p95 (4:37) and maximum (5:03). The threshold, 1:57, does not move with them.

### Coverage of the hours pull requests run in

| | UTC hours covered |
| --- | --- |
| Check-path baseline (30 runs) | 09 (6), 10 (6), 11 (6), 12 (5), 20 (4), 22 (1), 23 (2) |
| Publication-path baseline (26 runs) | 09 (3), 10 (4), 11 (4), 12 (1), 20 (6), 21 (2), 22 (5), 23 (1) |
| Held-out pull request runs (67) | 20–23 on 2026-11-06 and 09–12 on 2026-11-07: **none outside the baseline's hours** |

How pull request runs spread over the day, from the 733 of the last 1000 PR runs of `ci.yml` (back to 2026-10-24):

| Hours (UTC) | PR runs | share |
| --- | --: | --: |
| 09–12 and 20–23, the baseline's hours | 306 | 42 % |
| 13–19 | 330 | 45 % |
| 00–08 | 97 | 13 % |

**The baseline does not represent the hours most pull requests run in.** 58 % of recent PR runs started outside its hours, including the busiest stretch, 16–19Z (222 runs, 30 %). The back-test cannot speak for those hours either, because every held-out run falls inside the baseline's hours. A low false-failure rate here is not evidence that the gate is quiet at 16–19Z.

### Exceedances within the baseline itself, and the pooled rate

The baseline's own runs exceed their thresholds too, because the robust bound deliberately ignores the slow tail. Counted from `.github/ci-baseline.json` at `6de27767`:

| Path | Run | Job | took | threshold |
| --- | --- | --- | --: | --: |
| check | [42359109435](https://github.com/mgasca/calendar/actions/runs/42359109435) (dispatch 5) | Docs site | 5:03 | 1:57 |
| check | [42359817664](https://github.com/mgasca/calendar/actions/runs/42359817664) (dispatch 6) | Docs site | 4:37 | 1:57 |
| check | [42361215930](https://github.com/mgasca/calendar/actions/runs/42361215930) (dispatch 8) | Container image | 1:55 | 1:45 |
| publication (report only) | 2 push runs | Container image | 1:34 and 1:40 | 1:32 |

| Check path, runs with no regression | runs | above a threshold | rate | one-sided 95 % upper bound |
| --- | --: | --: | --: | --: |
| Baseline runs (in sample) | 30 | 3 | 10.0 % | 23.9 % |
| Held-out pull request runs | 43 | 1 | 2.3 % | 10.6 % |
| **Pooled** | **73** | **4** | **5.5 %** | **12.1 %** |

**The observed false-failure rate, about 5 % of runs, is above ADR-0045's budget of 1 %.** The pattern in all four runs is a "slow runner" event: a whole VM, or one dependency fetch, is about two to four times slower. The log-normal bound is built from the median and MAD, so it ignores that tail by design. **The maintainer accepted this rate on 2026-11-07** (relayed on #384), and chose to gate now with "Re-run all jobs" as the remedy. The method and the constants stay as they are, to be revisited with the first week of gated PR runs and the trend check.

### The gate's cost

Measured on #395 (jobs API, whole seconds), `CI result` takes a median of **6 s** with the gate (4–7 s, n = 11) against **3 s** without it (2–6 s, n = 23). That is **+3 s** at the median, about 3 % of a 1:29 PR run. It is more than ADR-0045's "about a second". The gate step itself takes 0 s; the sparse checkout of `.github/` and its post step take the rest. The maintainer accepted the cost on 2026-11-07.

## Reading

- **Measured: the thresholds sit 26–48 s above the medians.** The check-path thresholds run from 1:24 (Frontend) to 1:57 (Docs site). A Backend run fails above 1:54, a little above its pre-#347 median (1:53, record 0012). So the gate catches a regression the size of the one #347 removed, about +30 s, but not much less. Smaller creep is the trend check's job (#386).
- **Measured: the false-failure rate is above budget.** The held-out back-test alone (1 in 43) looks compatible with the 1 % budget. With the baseline's own exceedances, though, 4 of 73 runs with no regression would fail (5.5 %; upper bound 12.1 %). The cause is a slow-runner tail that the robust bound does not model.
- **Not measured: 16–19Z and 00–08Z.** The dispatch schedule compressed the check-path sample into 8 hours of two days. If runners are slower at peak hours, the real rate is higher still.
- **Decided on 2026-11-07 (the maintainer, relayed on #384):** pin now from the 30 runs, with no further dispatches. The gate (#385) fails on the check path as pinned, the observed rate is accepted, and "Re-run all jobs" is the remedy. The method and constants of ADR-0045 are unchanged, and the first week of gated PR runs decides what comes next.
- **The publication path stays provisional** at 26 runs and only reports. A follow-up PR with a short record pins it once 30 organic pushes exist, as the maintainer decided on #384.
- **CI runs used for this record:** 26 dispatches, approved on #384. The 4 earlier dispatches were record 0012's.

## Reconsider when

- The first week of gated PR runs shows false failures above the 1 % budget, or false failures clustered at 16–19Z (or in other hours this baseline did not cover). The remedies to weigh then:
  - a re-pin that includes peak-hour runs, with a new record;
  - a recalibrated `z`, which is a change of constants and needs a new record;
  - a slow-runner rule, which changes the method and needs an amendment to ADR-0045.
- A job's steps change, a job is added or split, or GitHub changes the `ubuntu-latest` image, which is migrating to Ubuntu 26 (runner notice: from 2026-10-19). Re-pin in the same PR as the change, with a new record.
- The publication path reaches 30 pushes: pin it in a follow-up PR with a short record.
- The trend check (#386) reports a job significantly faster than its baseline: a deliberate re-pin tightens its threshold.

Re-run the harness command above with a new window and compare; never edit this record.
