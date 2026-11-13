---
subject: "The web build step of the Frontend job without the repeated tsc -b (#276)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0006 The web build step without a second tsc -b

- **Date:** 2026-11-05
- **Issue:** [#276](https://github.com/mgasca/calendar/issues/276)
- **Harness:** `tools/ci-timings/ci-timings.cs` (`just tools ci-timings --runs 10 --branch claude/web-build-ci-276 --job Frontend`)
- **Baseline commit:** the delivery branch of #274 at `9f8c476e` (record [0004](0004-docs-ci-job.md), the Frontend job after the docs site moved to its own job), and for the original step the job logs the issue cites, on `main` at `dee2e71e`
- **Measured commit:** the delivery branch of #276 at `aff98ca9` and four empty commits on it (up to `d534465f`), stacked on the #274 branch, before #273 merged

## Question

The Frontend job's build step ran the web app's `tsc -b && vite build` right after the typecheck step had run `tsc -b` for the same project. #276 makes the CI step `pnpm --filter @calendar/web exec vite build`, the bundler alone, while `pnpm build` and `just frontend build` keep type-checking. How much of the step, and of the job, was the repeated type-check?

## Method

The same harness and command family as records 0002 and 0004, narrowed to one branch: successful pull-request runs of `ci.yml` on `claude/web-build-ci-276`, GitHub-hosted `ubuntu-latest` runners, nearest-rank medians. Five runs, 2026-11-05 19:24Z to 19:38Z: the PR's own run and four empty commits pushed one at a time, each after the previous run had completed; a sixth run was cancelled by GitHub while the base branch received a merge and is not in the sample. The harness output is pasted unchanged below.

The before number on the same basis is step 10 of the Frontend job in record 0004 (`pnpm -r --filter '!@calendar/docs' build`, six runs on the #274 branch): median 3 s, mean 3.8 s, 2 to 5 s. The issue's baseline, 5.9 to 6.2 s, comes from log timestamps of three jobs on `main` before the split and is a different basis: it has sub-second resolution where the jobs API reports whole seconds, and it predates the split that took the docs build out of the same `pnpm -r build` invocation.

Five runs is a small sample on hardware that varies (record 0002); the job medians here differ from record 0004's by less than that variance.

## Results

Sample: 5 successful runs of `ci.yml` in mgasca/calendar on branch `claude/web-build-ci-276`, 2026-11-05 19:24Z to 2026-11-05 19:38Z (events: pull_request).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Docs site | 5 | 2:10 | 2:58 | 3:16 | 3:16 |
| Backend | 5 | 1:40 | 2:00 | 2:16 | 2:16 |
| Tooling | 5 | 1:21 | 1:24 | 2:06 | 2:06 |
| Container image | 5 | 1:01 | 1:14 | 1:20 | 1:20 |
| Frontend | 5 | 0:49 | 0:52 | 1:00 | 1:00 |
| CI result | 5 | 0:02 | 0:04 | 0:04 | 0:04 |

Steps of `Frontend`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 2. Run actions/checkout@v7 | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 3. Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 5 | 4 | 4 | 8 | 8 | 4.8 |
| 4. Run actions/setup-node@v7 | 5 | 3 | 4 | 5 | 5 | 4.0 |
| 5. Run pnpm install --frozen-lockfile | 5 | 3 | 3 | 5 | 5 | 3.6 |
| 6. Run pnpm format:check | 5 | 2 | 2 | 2 | 2 | 2.0 |
| 7. Run pnpm lint | 5 | 10 | 11 | 13 | 13 | 11.2 |
| 8. Run pnpm -r --filter '!@calendar/docs' typecheck | 5 | 3 | 4 | 5 | 5 | 3.8 |
| 9. Run pnpm -r --filter '!@calendar/docs' test:coverage | 5 | 14 | 15 | 17 | 17 | 15.6 |
| 10. Build the web app | 5 | 0 | 0 | 1 | 1 | 0.4 |
| 11. Run actions/upload-artifact@v7 | 5 | 1 | 2 | 2 | 2 | 1.8 |
| 20. Post Run actions/setup-node@v7 | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 21. Post Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 5 | 0 | 0 | 1 | 1 | 0.4 |
| 22. Post Run actions/checkout@v7 | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 23. Complete job | 5 | 0 | 0 | 0 | 0 | 0.0 |

## Reading

- Measured: the web build step goes from a 3 s median (mean 3.8 s, record 0004) to 0 s (mean 0.4 s, at the whole-second resolution of the jobs API): about 3 s per run, the whole of the repeated `tsc -b`, with `vite build` itself under a second as the issue measured (225 to 279 ms).
- Measured: the Frontend job's median is 0:52 against 0:49 in record 0004. The 3 s saving is smaller than the run-to-run spread of the job (0:48 to 1:09 there, 0:49 to 1:00 here), so it does not show at the job level, and the Frontend job is not the critical path of a run since #274 (Docs site, then Backend after #273). The change is worth keeping because it removes duplicated work, as the issue said a sub-3 s saving would be, not because the run gets measurably shorter.
- Inferred: the issue's 5.9 to 6.2 s for the old step was measured when `pnpm -r build` also carried the docs build in the same invocation and from logs with finer resolution; the 3 s of record 0004 is the comparable before number for this step.

## Reconsider when

The web app's `tsc -b` grows to tens of seconds (then the typecheck step itself is the subject), or the workflow drops the typecheck step, in which case the build step must type-check again.
