---
subject: "The pinned run-time baseline re-measured with the Changes job gated (J = 6), both paths pinned, and the false-failure budget recalibrated (ADR-0045)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0017 The CI job baseline with `Changes`, both paths pinned

- **Date:** 2026-11-08
- **Issue:** [#420](https://github.com/mgasca/calendar/issues/420), part of epic [#380](https://github.com/mgasca/calendar/issues/380); method in [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md). It follows record [0014](0014-ci-job-baseline.md) and never edits it.
- **Harness:** `tools/ci-timings/ci-timings.cs`, run directly because the recipe does not quote its arguments (#345):

  ```bash
  dotnet run tools/ci-timings/ci-timings.cs -- --baseline --created "2026-11-07T14:17:00Z..2026-11-08T00:14:30Z" --holdout "2026-11-07T14:17:00Z..2026-11-08T00:14:30Z"
  ```

  It writes `.github/ci-baseline.json` and prints the tables below. As in record 0014, the hold-out window equals the baseline window: the back-test leaves out every run the baseline was measured from, so it tests the pull request runs of the same hours.
- **Window:** every successful run of `ci.yml` on `main` created from `bcc655fe` (#422, 2026-11-07 14:17Z, the first commit with the `Changes` job) to 2026-11-08 00:14Z. Record 0014's 30 dispatches and the 28 earlier pushes are outside it, because they have no `Changes` job (maintainer's answer on #420, 2026-11-07).
- **Machine:** GitHub-hosted `ubuntu-latest` runners, as for every CI record.
- **Constants:** `J = 6` (the baseline now holds six jobs), floor 15 s and margin 10 % as before, and **`α = 0.1 %` instead of 1 %**, so `z = 3.588`. See "Recalibration".

## Question

What does each gated job take on each path once `Changes` is gated? Does ADR-0045's formula, with the provisional constants of record 0014, keep the false-failure rate within budget on the runs held out of the baseline, and if not, which constant fixes it?

## Method

- **Quantity, paths and threshold:** as in record 0014: each job's `started_at` to `completed_at` from the jobs API, successful jobs only; the publication path when the Docs site step "Build and verify publication artifact" succeeded, otherwise the check path; threshold `ceil(max(exp(m + z·1.4826·MAD), M + max(15 s, 10 % · M)))`.
- **Gated jobs:** Backend, Changes, Container image, Docs site, Frontend and Tooling. `Changes` was not in record 0014. ADR-0045's rule for a job with no baseline entry ("passes with a warning that names it, until the next baseline update adds it, and `J` counts the jobs the baseline holds") covers it, so no amendment was needed (agreed by the maintainer on #420). `CI result` and `Cancel superseded runs` are still not gated.
- **Sample:**
  - **Check path:** `workflow_dispatch` runs on `main`, one at a time, each waiting until no CI run on `main` was in progress, approved by the maintainer on #420. 31 dispatches ran from 2026-11-07 15:03Z to 2026-11-08 00:12Z; one failed on an unrelated flaky test ([#528](https://github.com/mgasca/calendar/issues/528), run [42426416650](https://github.com/mgasca/calendar/actions/runs/42426416650), 23:41Z) and a 31st replaced it, so the baseline holds the 30 successful ones.
  - **Publication path:** the organic pushes to `main` since #422. The tool takes all 48 successful ones in the window, not only 30.
- **Spacing was not a steady 10 minutes, and this record says so.** Of the 30 gaps between the 31 dispatches, 22 are 10–11 minutes, 3 are 12–14 minutes and 5 are longer: 16 min, 17 min, 22 min, 53 min and **181 min**. The 181 minute gap is a stop of the first delivery session between dispatches 2 and 3. The others come from waiting for pushes to `main` and from GitHub API timeouts in the dispatch loop. One dispatch (run [42412461769](https://github.com/mgasca/calendar/actions/runs/42412461769), 20:44Z) has no run ID in the loop's log, probably because the lookup after dispatching hung on a timeout; the run itself is in the sample.

## Results

### Window

| Path | status | runs | events | from | to | span | commits |
| --- | --- | --: | --- | --- | --- | --: | --: |
| check | **pinned** | 30 | workflow_dispatch | 2026-11-07 15:02Z | 2026-11-08 00:12Z | 9.2 h | 23 |
| publication | **pinned** | 48 | push | 2026-11-07 14:17Z | 2026-11-08 00:09Z | 9.9 h | 48 |

### Baseline and thresholds

| Path | Job | n | median | log-MAD | p90 | p95 | max | threshold | status |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |
| check | Backend | 30 | 1:21 | 0.083 | 1:31 | 1:33 | 1:34 | 2:06 | pinned |
| check | Changes | 30 | 0:05 | 0.182 | 0:06 | 0:06 | 0:07 | 0:20 | pinned |
| check | Container image | 30 | 1:06 | 0.059 | 1:14 | 1:18 | 1:22 | 1:31 | pinned |
| check | Docs site | 30 | 1:16 | 0.112 | 1:30 | 1:32 | 1:34 | 2:18 | pinned |
| check | Frontend | 30 | 0:52 | 0.101 | 0:59 | 1:03 | 1:09 | 1:30 | pinned |
| check | Tooling | 30 | 1:19 | 0.049 | 1:24 | 1:29 | 1:30 | 1:43 | pinned |
| publication | Backend | 48 | 1:24 | 0.058 | 1:33 | 1:34 | 1:34 | 1:55 | pinned |
| publication | Changes | 48 | 0:04 | 0.000 | 0:06 | 0:06 | 0:06 | 0:19 | pinned |
| publication | Container image | 48 | 1:13 | 0.086 | 1:32 | 1:37 | 1:40 | 1:56 | pinned |
| publication | Docs site | 48 | 1:37 | 0.117 | 1:54 | 2:00 | 2:02 | 3:01 | pinned |
| publication | Frontend | 48 | 0:52 | 0.101 | 1:02 | 1:04 | 1:06 | 1:30 | pinned |
| publication | Tooling | 48 | 1:19 | 0.061 | 1:28 | 1:32 | 1:33 | 1:50 | pinned |

Every threshold comes from the log-normal term, not from the floor or the margin. `Changes` takes 4–7 s, so its threshold, 19–20 s, sits at the 15 s floor above its median.

### Back-test on held-out pull request runs

The 136 successful `pull_request` runs in the window are held out. No push or dispatch is held out, because all of them are in the baseline.

| Path | Job | held-out runs | exceeded | observed rate | 95 % upper bound |
| --- | --- | --: | --: | --: | --: |
| check | Changes | 19 | 0 | 0.0 % | 14.6 % |
| check | Container image | 18 | 0 | 0.0 % | 15.3 % |
| check | Frontend | 18 | 0 | 0.0 % | 15.3 % |
| check | Tooling | 1 | 0 | 0.0 % | 95.0 % |
| publication | Backend | 7 | 0 | 0.0 % | 34.8 % |
| publication | Changes | 117 | 0 | 0.0 % | 2.5 % |
| publication | Container image | 24 | 0 | 0.0 % | 11.7 % |
| publication | Docs site | 117 | 0 | 0.0 % | 2.5 % |
| publication | Frontend | 23 | 0 | 0.0 % | 12.2 % |
| publication | Tooling | 56 | 0 | 0.0 % | 5.2 % |

- **Runs the gate would have failed: 0 of 136** (0.0 %; one-sided 95 % upper bound 2.2 %).
- **Exceedances inside the baseline itself: none.** No job's sample has a run above its threshold (largest margin: Container image on the publication path, 1:40 against 1:56).
- **Thin cells.** Most pull requests now change files that make `Changes` skip jobs (ADR-0046), so a job runs in only some of them: Tooling on the check path has 1 held-out run, and Backend on the publication path 7. Their upper bounds (95 % and 35 %) say nothing about those cells. The pooled 136-run figure is the one to read.
- **The pooled rate is within the 1 % budget as observed (0 %), but the upper bound, 2.2 %, is above it.** With 136 runs, a bound of 1 % is only reachable with none exceeding and about 300 runs.

### Recalibration

With record 0014's constants (`α = 1 %`, so `z = 2.935` for J = 6) the same window gives:

| | α = 1 % | α = 0.1 % (this record) |
| --- | --: | --: |
| Held-out runs the gate would fail | **5 of 136 (3.7 %; bound 7.6 %)** | **0 of 136 (0.0 %; bound 2.2 %)** |
| Container image, check threshold | 1:26 | 1:31 |
| Container image, publication threshold | 1:47 | 1:56 |

The five at α = 1 % were all Container image: four check-path pull request runs at 1:27–1:29 against 1:26, and one publication-path run at 1:49 against 1:47 ([42406526987](https://github.com/mgasca/calendar/actions/runs/42406526987), [42407820194](https://github.com/mgasca/calendar/actions/runs/42407820194), [42409145976](https://github.com/mgasca/calendar/actions/runs/42409145976), [42421895699](https://github.com/mgasca/calendar/actions/runs/42421895699), [42393238030](https://github.com/mgasca/calendar/actions/runs/42393238030)). The check-path Container image sample is unusually steady (log-MAD 0.059), so its bound was only 20 s above the median and ordinary variation crossed it.

- **Measured: the floor and the margin do not help.** Raising the margin to 20 % or 30 % or the floor to 20 s left every threshold and all five exceedances unchanged, because the log-normal term is the larger of the two for every job. Only `α` moves the thresholds.
- **Decided by the maintainer on #420 (2026-11-08):** `α = 0.1 %`. This is a change of constants, which ADR-0045 settles with a record, so no amendment. The default in `tools/ci-timings/Baseline.cs` changed with it (`GateConstants.Default`), so the next regeneration does not silently go back to 1 %; `BaselineTests.Z_ForATenthOfAPercentAcrossFiveJobs_IsAbout3Point54` fails on the old default.
- **Cost of the change, measured:** thresholds rise by 5–19 s per job (Container image on the check path +5 s, Docs site on the publication path +19 s). The gate now misses a regression smaller than the new margin above the median: Container image on the check path, +25 s over its median. A smaller slowdown is the trend check's job.

### The Docs site lint step on pull requests

#422 added "Format and lint the docs site" (prettier and eslint on `apps/docs`) to the Docs site job on a run where Frontend does not run. A push or dispatch runs Frontend, so neither baseline sample contains it. Measured on the 94 held-out pull request runs in this window whose Docs site job ran the step (jobs API, whole seconds):

| | min | median | p90 | max |
| --- | --: | --: | --: | --: |
| The step | 4 s | 6 s | 7 s | 8 s |
| Docs site job on those runs | 1:10 | 1:41 | 2:02 | 2:10 |

The step adds a median of 6 s. The Docs site job on those runs has a median of 1:41 against 1:37 in the publication baseline, and its maximum, 2:10, is under the threshold of 3:01. **It fits within the publication-path margin and needs no handling of its own.** No such run exceeded the threshold.

### Coverage of the hours pull requests run in

| | UTC hours covered |
| --- | --- |
| Check-path baseline (30 runs) | 00 (2), 15 (2), 18 (5), 19 (6), 20 (4), 21 (3), 22 (4), 23 (4) |
| Publication-path baseline (48 runs) | 00 (1), 14 (2), 15 (3), 16 (2), 17 (7), 18 (1), 19 (10), 20 (6), 21 (5), 22 (5), 23 (6) |
| Held-out pull request runs (136) | 00 (1), 14 (3), 15 (9), 16 (7), 17 (16), 18 (1), 19 (35), 20 (27), 21 (18), 22 (10), 23 (9) |

This window covers the afternoon and evening, 14–00Z, which record 0014 did not (09–12Z and 20–23Z). It still has **no run between 01Z and 13Z**, so the overnight and morning hours are untested; 13 % of recent pull request runs start at 00–08Z (record 0014). Every held-out run falls inside the baseline's hours, so a low false-failure rate here does not speak for the others.

### The gate's cost

Not re-measured: the gate and its step are unchanged, and `Changes` is a job ahead of the others (record [0016](0016-ci-jobs-by-changed-paths.md)), not part of the gate. Record 0014's +3 s at the median for `CI result` stands.

## Reading

- **Measured: both paths are pinned, so the gate now fails on both.** Until this record, the publication path only reported, so a docs-only pull request could not fail. Most gated pull request runs are on the publication path since #422 builds the publication artifact on every same-repository pull request that runs Docs site (117 of 136 held-out runs).
- **Measured: the previous constants would have failed 3.7 % of runs, mostly on one job.** That is why `α` is 0.1 % here. The 0 of 136 at the new constants comes with a 95 % upper bound of 2.2 %, still above the 1 % budget, so the observed rate is within the budget but not proven to be.
- **Measured: the thresholds are 15–84 s above the medians**, from Changes (+15 s) to Docs site on the publication path (+84 s). The gate catches a regression of about that size. Smaller creep is the trend check's job (#386).
- **Inferred: runner slowness.** Record 0014's slow-runner events (a whole VM two to four times slower) did not recur in this window: the largest job in the sample is 2:02, Docs site on the publication path.
- **Not measured:** 01Z–13Z, and any week of gated pull request runs. Both feed [#421](https://github.com/mgasca/calendar/issues/421).

## Reconsider when

- The first week of gated pull request runs shows false failures, in particular clustered in hours this baseline did not cover (01–13Z). Re-pin with a window that includes them, with a new record.
- A job's steps change, a job is added or split, or GitHub changes the `ubuntu-latest` image. Re-pin in the same PR as the change, with a new record.
- The trend check (#386) reports a job significantly faster than its baseline: a deliberate re-pin tightens its threshold.

Re-run the harness command above with a new window and compare; never edit this record.
