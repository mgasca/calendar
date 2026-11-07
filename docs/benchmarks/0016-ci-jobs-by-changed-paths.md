---
subject: "CI runner time and wall clock when each job runs only for the paths it checks (ADR-0046)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0016 CI runner time and wall clock when jobs run only for their paths

- **Date:** 2026-11-07
- **Issue:** [#418](https://github.com/mgasca/calendar/issues/418), story [0038](../stories/0038-run-ci-jobs-only-for-the-paths-they-check.md), [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md)
- **Harness:** `just tools ci-timings --runs 40` for the before sample. The after runs were read from the jobs API (`gh api repos/mgasca/calendar/actions/runs/<id>/jobs`, `started_at` to `completed_at` per job, and `created_at` to `updated_at` for wall clock), one run per changed-path class.
- **Before:** 40 successful `ci.yml` runs, 2026-11-07 11:10Z to 13:50Z (pull request, push and dispatch), on `main` up to `bdf5cebab`. Wall clock: 40 successful pull request runs, 2026-11-06 23:07Z to 2026-11-07 13:50Z.
- **After:** the runs of delivery PR #422 at `31e35eaa8` and its throwaway proof PRs #423 (one docs file), #424 (one backend file) and #425 (the root README), all at 2026-11-07 ~13:59Z on GitHub-hosted `ubuntu-latest`.

## Question

Before this change, every pull request ran all five jobs, whatever it changed. How much runner time and waiting does a pull request save when CI runs only the jobs whose inputs it changes? And what does the new Changes job cost every run?

## Before (measured)

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 40 | 0:58 | 1:20 | 1:32 | 1:52 |
| Tooling | 40 | 0:57 | 1:16 | 1:25 | 1:40 |
| Docs site | 40 | 0:51 | 1:12 | 1:41 | 1:49 |
| Container image | 40 | 0:56 | 1:10 | 1:22 | 1:31 |
| Frontend | 40 | 0:38 | 0:52 | 0:57 | 1:11 |
| CI result | 40 | 0:02 | 0:04 | 0:06 | 0:07 |

- Runner time of the five checking jobs, from their medians: **5:50 per pull request run**, the same for every change.
- Wall clock of a pull request run (n = 40): median **1:38**, p90 2:07, min 1:22, max 2:25.

## After (measured, one run each)

| Run | Changed | Jobs that ran (s) | Skipped | Runner time | Wall clock |
| --- | --- | --- | --- | --: | --: |
| #423 | `docs/runbooks/README.md` | Changes 4, Docs site 79, CI result 7 | Backend, Frontend, Tooling, Container image | 1:30 | 1:38 |
| #424 | `backend/AGENTS.md` | Changes 5, Backend 86, Container image 84, CI result 9 | Frontend, Docs site, Tooling | 3:04 | 1:47 |
| #425 | `README.md` | Changes 4, CI result 6 | all five | 0:10 | 0:16 |
| #422 | `ci.yml` and the rules (runs everything) | Changes 5, Frontend 50, Backend 82, Container image 67, Docs site 101, Tooling 83, CI result 7 | none | 6:35 | 2:00 |

Runner time is the sum of the job durations listed, without `Cancel superseded runs` (4–5 s). Measured on one run each, so the wall-clock values carry the spread of the before sample (1:22–2:25). They are not medians.

## Findings

- **Runner time** (measured): a docs-only pull request went from 5:50 to 1:30 (−74 %), a backend-only one to 3:04 (−47 %), and a change outside every path set to 0:10.
- **Wall clock** (measured, one run each): a README-only pull request finished in 0:16 instead of about 1:38. The docs-only (1:38) and backend-only (1:47) runs are inside the before range. Their critical path is still one checking job, so wall clock does not drop much when the slowest job is the one that runs.
- **Cost of the Changes job** (measured): 4–5 s of execution on each of the four runs, in front of every filtered job. Runner pickup comes on top of that and is not in the job's execution time; the 0:16 wall clock of #425 bounds Changes plus CI result, both pickups included. Pushes and dispatches pay this and skip nothing. The run that runs everything (#422) finished in 2:00, inside the before range.
- **Correctness** (measured): on every run CI result passed with the skipped jobs listed, and the ADR-0045 gate reported "Changes has no baseline on the check path; it is not gated". In run 42379749204 (#424 with a file that does not compile), Backend and Container image failed, Frontend, Docs site and Tooling were skipped, and CI result failed, as it must.

## Decision and reconsideration

Keep the Changes job: it costs about 5 s per run and saves 2:46–5:40 of runner time on every pull request that does not change everything. Reconsider when:
- the Changes job exceeds 15 s of execution in the ADR-0045 trend sample;
- a change a skipped job would have caught reaches `main` (widen that job's path set);
- the next ADR-0045 baseline update adds Changes as a gated job.
