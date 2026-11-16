---
subject: "The pinned run-time baseline re-measured for nine jobs on both paths after the first gated week, with the false failures of the first week (ADR-0045)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0030 The CI job baseline for nine jobs, after the first gated week

- **Date:** 2026-11-16
- **Issue:** [#421](https://github.com/mgasca/calendar/issues/421), part of epic [#380](https://github.com/mgasca/calendar/issues/380); method in [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md). It follows records [0014](0014-ci-job-baseline.md) and [0017](0017-ci-baseline-with-changes.md) and never edits them.
- **Harness:** `tools/ci-timings/ci-timings.ts` (Deno, since #743), run as the `tools` recipe runs it:

  ```bash
  deno run --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env tools/ci-timings/ci-timings.ts --baseline --created "2026-11-15T10:20:00Z..2026-11-16T10:05:00Z" --holdout "2026-11-15T10:20:00Z..2026-11-16T10:05:00Z" --record docs/benchmarks/0030-ci-baseline-nine-jobs.md
  ```

  It writes `.github/ci-baseline.json` and prints the tables below. As in the earlier records, the hold-out window equals the baseline window: the back-test leaves out every run the baseline was measured from, so it tests the pull request runs of the same hours.
- **Window:** every successful run of `ci.yml` on `main` created from #889 (2026-11-15 10:20Z, the last change that moved the gated jobs) to 2026-11-16 10:05Z. #944 (15:07Z) changed only `CI result`, which is not gated. The baseline holds 61 runs: 30 dispatches and 31 pushes.
- **Machine:** GitHub-hosted `ubuntu-latest` runners, as for every CI record.
- **Constants:** unchanged from record 0017 (`α = 0.1 %`, floor 15 s, margin 10 %). `J = 9`, because the baseline now holds nine jobs, so `z = 3.692`.

## Question

How did the first week of the gate go (record 0017's constants against real pull request runs), and what does each gated job take now that Backend, Container image, ADR conventions, Narratives and Flow binding exist or have changed? Does the same formula, applied to the new sample, keep false failures within budget?

## The first gated week

From the Actions API, 2026-11-07 13:52Z (when #395 merged) to 2026-11-14 13:52Z: every `ci.yml` run, each attempt's `CI result` job, and the gate's own annotation naming the job, its time and its threshold. Counts are per run; a **Re-run failed jobs** reuses the same durations and is not counted again. Posted on #421 before any change.

| | runs | rate | one-sided 95 % upper bound |
| --- | --: | --: | --: |
| Pull request runs that finished (93 cancelled left out) | 761 | | |
| The gate failed `CI result` on the first attempt | 37 | 4.9 % | 6.3 % |
| …and the run **passed on a re-run** (a false failure) | **22** | **2.9 %** | **4.1 %** |
| …and the run never passed | 15 | 2.0 % | |

- **Above the 1 % budget.** Record 0017 back-tested 0 of 136. The week also included 2026-11-13, with 26 gate failures in 282 PR runs (9.2 %); the other six days had 11 in 479 (2.3 %), 8 of them passed on re-run (1.7 %, upper bound 3.0 %).
- **By job** (first attempt, finished PR runs): Tooling 21 runs (17 publication, 4 check), Docs site 9 (publication), Container image 7 (check), Changes 1. The median excess over the threshold was small: Docs site 5 s, Container image 9 s, Tooling 7 s on the check path and 16 s on the publication path. 27 of the 37 were within 15 s.
- **By hour:** 00–08Z 23 PR runs, no failures; 08–13Z 14 failures in 209 runs; 13–19Z 22 in 227; 19–24Z 1 in 302. The baselines of records 0014 and 0017 were measured at 14–00Z. Hour and change are mixed (Tooling and Docs site grew on 2026-11-13); this data does not separate them.
- **Run-level slowness did not separate false failures from real ones.** In 14 of the 22 false failures and 14 of the 15 never-passed runs, the run's other jobs were also at least 1.15 times their baseline median. A rule that scales each threshold by the median speed ratio of the other jobs (clamped 1–2, at least two other jobs) would have passed 10 of the 22 false failures and also 9 of the 15 never-passed runs. It is not adopted. A method change needs an amendment of ADR-0045.
- **Two jobs left the file.** #674 (2026-11-11) removed the Backend and Container image entries from the baseline file, so those two jobs warned after that.
- **Maintainer's decision on #421 (2026-11-15, given in a Claude Code session):** re-pin first and decide about a slow-runner rule afterwards; every sampled job is gated; record the back-test as it is.

## Method

- **Quantity, paths and threshold:** as in records 0014 and 0017: each job's `started_at` to `completed_at` from the jobs API, successful jobs only; the publication path when the Docs site step "Build and verify publication artifact" succeeded, otherwise the check path; threshold `ceil(max(exp(m + z·1.4826·MAD), M + max(15 s, 10 % · M)))`.
- **Gated jobs:** ADR conventions, Backend, Changes, Container image, Docs site, Flow binding, Frontend, Narratives and Tooling. ADR-0045's rule for a job without a baseline entry (it warns until the next baseline update adds it) covers the new ones, as record 0017 found for `Changes`.
- **Check-path sample:** 30 `workflow_dispatch` runs on `main`, one at a time, each waiting until no CI run on `main` was in progress, approved by the maintainer on #421. They ran from 2026-11-15 12:31Z to 16:36Z, over 10 commits. **The spacing was not constant**: the first gap was 30 minutes (the loop waited for pushes to `main`), dispatches 1–14 were about 10 minutes apart (gaps 9.4–14.5 min), and from dispatch 15 the maintainer asked for 5 minutes (gaps 5.0–8.6 min). All 30 succeeded.
- **Publication-path sample:** the 31 successful pushes to `main` since #889, 10:20Z on 2026-11-15 to 09:53Z on 2026-11-16, over 31 commits. The tool takes every successful push in the window, not only 30.

## Results

### Window

| Path | status | runs | events | from | to | span | commits |
| --- | --- | --: | --- | --- | --- | --: | --: |
| check | **pinned** | 30 | workflow_dispatch | 2026-11-15 12:31Z | 2026-11-15 16:36Z | 4.1 h | 10 |
| publication | **pinned** | 31 | push | 2026-11-15 10:20Z | 2026-11-16 09:53Z | 23.6 h | 31 |

### Baseline and thresholds

| Path | Job | n | median | log-MAD | p90 | p95 | max | threshold | status |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |
| check | ADR conventions | 30 | 0:08 | 0.134 | 0:11 | 0:15 | 0:15 | 0:23 | pinned |
| check | Backend | 30 | 1:57 | 0.035 | 2:03 | 2:07 | 2:08 | 2:22 | pinned |
| check | Changes | 30 | 0:05 | 0.223 | 0:07 | 0:09 | 0:11 | 0:20 | pinned |
| check | Container image | 30 | 1:23 | 0.081 | 1:32 | 1:36 | 1:37 | 2:10 | pinned |
| check | Docs site | 30 | 1:19 | 0.121 | 1:39 | 1:51 | 1:51 | 2:34 | pinned |
| check | Flow binding | 30 | 0:18 | 0.118 | 0:24 | 0:26 | 0:31 | 0:35 | pinned |
| check | Frontend | 30 | 1:08 | 0.061 | 1:14 | 1:14 | 1:16 | 1:35 | pinned |
| check | Narratives | 30 | 0:08 | 0.134 | 0:12 | 0:12 | 0:16 | 0:23 | pinned |
| check | Tooling | 30 | 0:38 | 0.027 | 0:42 | 0:42 | 0:43 | 0:53 | pinned |
| publication | ADR conventions | 31 | 0:08 | 0.134 | 0:11 | 0:14 | 0:14 | 0:23 | pinned |
| publication | Backend | 31 | 1:52 | 0.102 | 2:05 | 2:07 | 4:31 | 3:16 | pinned |
| publication | Changes | 31 | 0:04 | 0.223 | 0:06 | 0:07 | 0:08 | 0:19 | pinned |
| publication | Container image | 31 | 1:32 | 0.140 | 1:49 | 3:35 | 4:01 | 3:18 | pinned |
| publication | Docs site | 31 | 1:27 | 0.119 | 1:44 | 1:46 | 1:49 | 2:47 | pinned |
| publication | Flow binding | 31 | 0:18 | 0.105 | 0:24 | 0:25 | 0:27 | 0:33 | pinned |
| publication | Frontend | 31 | 1:04 | 0.116 | 1:14 | 1:19 | 2:07 | 2:01 | pinned |
| publication | Narratives | 31 | 0:08 | 0.134 | 0:11 | 0:14 | 0:15 | 0:23 | pinned |
| publication | Tooling | 31 | 0:41 | 0.048 | 0:43 | 0:46 | 0:48 | 0:56 | pinned |

Against record 0017's medians: **Tooling is about half** (check path 1:19 → 0:38, publication 1:19 → 0:41, after the Deno ports), Frontend is slower (0:52 → 1:08 and 1:04), Docs site is similar (check 1:16 → 1:19, publication 1:37 → 1:27). Backend and Container image have new medians (1:57 and 1:23 on the check path) because the Rust backend replaced the .NET one. The Tooling thresholds are now 0:53 and 0:56, so a Tooling job that took 1:19 in the old baseline fails today.

### Back-test on held-out pull request runs

The 85 successful `pull_request` runs in the window are held out; 83 had a gated job with a baseline. No push or dispatch is held out, because all of them are in the baseline.

| Path | Job | held-out runs | exceeded | observed rate | 95 % upper bound |
| --- | --- | --: | --: | --: | --: |
| check | Backend | 13 | 1 | 7.7 % | 31.6 % |
| check | Changes | 20 | 0 | 0.0 % | 13.9 % |
| check | Container image | 15 | 2 | 13.3 % | 36.3 % |
| check | Tooling | 9 | 0 | 0.0 % | 28.3 % |
| publication | ADR conventions | 22 | 0 | 0.0 % | 12.7 % |
| publication | Backend | 9 | 0 | 0.0 % | 28.3 % |
| publication | Changes | 63 | 0 | 0.0 % | 4.6 % |
| publication | Container image | 24 | 3 | 12.5 % | 29.2 % |
| publication | Docs site | 63 | 0 | 0.0 % | 4.6 % |
| publication | Flow binding | 6 | 0 | 0.0 % | 39.3 % |
| publication | Frontend | 23 | 0 | 0.0 % | 12.2 % |
| publication | Tooling | 28 | 0 | 0.0 % | 10.1 % |

- **Runs the gate would have failed: 6 of 83** (7.2 %; one-sided 95 % upper bound 13.8 %). **That is far above the 1 % budget.** The runs: [43708665842](https://github.com/mgasca/calendar/actions/runs/43708665842) (Backend, check, 3:46 against 2:22), [43710892275](https://github.com/mgasca/calendar/actions/runs/43710892275) (Container image, publication, 4:12 against 3:18), [43723717139](https://github.com/mgasca/calendar/actions/runs/43723717139) (Container image, check, 3:37 against 2:10), [43724540288](https://github.com/mgasca/calendar/actions/runs/43724540288) (Container image, publication, 4:03 against 3:18), [43724773565](https://github.com/mgasca/calendar/actions/runs/43724773565) (Container image, publication, 3:59 against 3:18) and [43831695321](https://github.com/mgasca/calendar/actions/runs/43831695321) (Container image, check, 3:19 against 2:10).
- **Five of the six are Container image.** The slow runs are in its "Build image with Buildx cache" step (measured on two of them and one normal dispatch):

  | Run | Container image job | "Build image with Buildx cache" |
  | --- | --: | --: |
  | normal dispatch [43728921984](https://github.com/mgasca/calendar/actions/runs/43728921984) | 1:25 | 57 s |
  | pull request [43723717139](https://github.com/mgasca/calendar/actions/runs/43723717139) (a Postgres readiness fix) | 3:37 | 188 s |
  | pull request [43710892275](https://github.com/mgasca/calendar/actions/runs/43710892275) (a frontend dependency bump) | 4:12 | 214 s |

  **Inferred, not measured:** a layer-cache miss when a dependency manifest or a source layer changes. The job is bimodal, and the 31 pushes already contain two such runs (215 s and 241 s, in-sample exceedances below).
- **Exceedances inside the baseline itself** (the robust bound ignores a slow tail by design): publication Backend 4:31 against 3:16; publication Container image 3:35 and 4:01 against 3:18; publication Frontend 2:07 against 2:01. None on the check path.
- **Thin cells.** Several cells have few held-out runs (publication Flow binding 6, publication Backend 9, check Tooling 9), so their upper bounds, 28–39 %, say little. The pooled figure is the one to read.
- **First week against this back-test:** 2.9 % of finished PR runs were false failures against record 0017's constants, and 7.2 % would fail against these. The hours and the job mix are different, so the two are not comparable as a trend.

### Coverage of the hours pull requests run in

| | UTC hours covered |
| --- | --- |
| Check-path baseline (30 runs) | 12 (1), 13 (6), 14 (6), 15 (10), 16 (7) |
| Publication-path baseline (31 runs) | 09 (2), 10 (5), 11 (6), 12 (4), 14 (4), 15 (2), 16 (4), 17 (4) |
| Held-out pull request runs (85) | 08 (3), 09 (2), 10 (16), 11 (13), 12 (12), 14 (19), 15 (4), 16 (5), 17 (10), 19 (1) |

The check path covers 12–16Z and the publication path 09–17Z, so together they cover more of the 08–19Z stretch where the first week's failures sat than records 0014 and 0017 did. **There are still no runs between 18Z and 08Z in either baseline**, and the first week had 302 PR runs at 19–24Z with one gate failure. The 5-minute spacing and a 4-hour dispatch window compressed the check path into 12–16Z. Held-out runs at 08Z (3) and 19Z (1) fall outside both baselines' hours, and the check-path jobs of held-out runs at 09–11Z are outside the check-path baseline's 12–16Z. A rate here does not speak for the night and the evening.

### The gate's cost

Not re-measured: the gate and its step are unchanged. Record 0014's +3 s at the median for `CI result` stands (#944 changed how `CI result` waits for the jobs API, not the gate).

## Reading

- **Measured: both paths are pinned for nine jobs.** The Tooling threshold halved with the Deno ports, so every Tooling regression from 0:53 on fails on the check path.
- **Measured: the rate is far above the budget.** 6 of 83 held-out runs (7.2 %; upper bound 13.8 %) would fail with no regression the author could remove, five of them Container image, against a budget of 1 %.
- **Measured: the Container image failures are in one step.** The Buildx build took 188–214 s on the slow runs against 57 s on a normal run.
- **Decided by the maintainer on #421:** record this as it is; constants and method are unchanged. The remedies to weigh at the next review are a per-job treatment of Container image (a bimodal job gets a wider bound or its own handling), a recalibrated `z`, or a slow-runner rule (an ADR-0045 amendment).
- **Where the new thresholds are loose, read from the file (measured ratios, inferred consequences).**
  - **Backend on the publication path** has a threshold of 3:16, 1.75 times its 1:52 median, against 2:22 (1.21 times) on the check path, although Backend does the same work on both. The publication sample has a wider spread (log-MAD 0.102 against 0.035) and a 4:31 outlier. A Backend slowdown from 1:52 to 3:15 passes on the publication path, which most PR runs take, and fails on the check path.
  - **Container image** has thresholds of 3:18 (2.15 times its median) on the publication path and 2:10 (1.57 times) on the check path, because the job is bimodal.
  - **Frontend** is 31 % slower on the check path (0:52 to 1:08) and 23 % on the publication path (0:52 to 1:04) than in record 0017, and the thresholds follow (publication 1:30 to 2:01). **The cause was not investigated**, so this re-pin accepts it as normal.
  - **The four short jobs** (ADR conventions, Narratives, Changes, Flow binding) are bounded by the 15 s floor, not by their spread, so a slowdown of up to about 15 s passes; the trend check is their backstop.
- **Not measured:** the nights (18Z–08Z) in both baselines; the real regressions among the 15 first-week runs that never passed (it needs each PR's diff); whether a faster runner explains the 22 false failures; how many more Container image cache misses the gate will see.

## Reconsider when

- Someone finds what moved Frontend's median up between record 0017 and #889, or Backend's publication-path spread, and one of them turns out to be a regression rather than the new normal.
- Container image keeps failing the gate on pull requests that change dependencies or source layers: weigh a wider bound or its own handling for it (a change of constants or method, so a record or an amendment).
- The next week of gated runs shows false failures above the 1 % budget, in particular at hours this baseline did not cover (18–08Z).
- A job's steps change, a job is added or split, or GitHub changes the `ubuntu-latest` image. Re-pin in the same PR as the change, with a new record.
- The trend check reports a job significantly faster or slower than its baseline: a deliberate re-pin.

Re-run the harness command above with a new window and compare; never edit this record.
