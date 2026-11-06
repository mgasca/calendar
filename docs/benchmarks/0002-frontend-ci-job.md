---
subject: "The Frontend CI job: job and step durations before the fixes of #272"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0002 The Frontend CI job before the fixes of #272

- **Date:** 2026-11-05
- **Issue:** [#272](https://github.com/mgasca/calendar/issues/272)
- **Harness:** `tools/ci-timings/ci-timings.cs` (`just tools ci-timings --runs 40 --job Frontend`)
- **Baseline commit:** `0f28a3d3` (main after #268; the sampled runs span dee2e71e to 0f28a3d3)

## Question

The Frontend job of `.github/workflows/ci.yml` is the slowest job of every run. How long does it take, which steps make it so, and how do the other jobs compare? This record is the baseline that the child issues of #272 measure their changes against.

## Method

The harness lists the last successful runs of the workflow with `gh run list` and reads each run's jobs and steps from the GitHub jobs API. Only completed, successful runs count, so cancelled and failed runs do not skew the sample. Durations are the wall-clock spans GitHub recorded; the median and the 90th percentile are nearest-rank, so every reported value is a sampled one. Runs of the same workflow are the repetitions: 40 here, all on GitHub-hosted `ubuntu-latest` runners, on pushes to `main` and PR runs between 2026-11-05 10:49Z and 17:38Z. The harness output is pasted unchanged below.

Runner hardware varies: the fastest runs (2:48 to 3:35) are not code differences but runs in which every Astro sync was about 15 s faster. The median is the comparable number; the spread is reported so that a later record can tell a change from runner variance.

## Results

Sample: 40 successful runs of `ci.yml` in mgasca/calendar, 2026-11-05 10:49Z to 2026-11-05 17:38Z (events: pull_request, push).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Frontend | 40 | 2:48 | 4:28 | 4:41 | 4:48 |
| Backend | 40 | 1:23 | 1:58 | 2:19 | 2:36 |
| Container image | 40 | 1:01 | 1:19 | 1:35 | 2:10 |
| Tooling | 40 | 0:56 | 1:14 | 1:34 | 2:00 |
| CI result | 40 | 0:02 | 0:03 | 0:04 | 0:05 |
| ADR preview | 6 | 0:00 | 0:00 | 0:00 | 0:00 |

Steps of `Frontend`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 40 | 0 | 2 | 2 | 2 | 1.5 |
| 2. Run actions/checkout@v7 | 40 | 0 | 1 | 2 | 5 | 1.3 |
| 3. Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 40 | 3 | 4 | 7 | 8 | 4.5 |
| 4. Run actions/setup-node@v7 | 40 | 0 | 5 | 8 | 12 | 5.2 |
| 5. Run pnpm install --frozen-lockfile | 40 | 2 | 3 | 4 | 5 | 3.2 |
| 6. Run pnpm format:check | 40 | 2 | 2 | 3 | 3 | 2.4 |
| 7. Run pnpm lint | 40 | 10 | 16 | 16 | 17 | 14.4 |
| 8. Run pnpm typecheck | 40 | 29 | 48 | 51 | 55 | 45.2 |
| 9. Architecture model conforms to the CALM schema | 40 | 0 | 1 | 1 | 2 | 1.0 |
| 10. Run pnpm test:coverage | 40 | 14 | 23 | 23 | 25 | 20.7 |
| 11. Run pnpm build | 40 | 28 | 48 | 50 | 50 | 43.8 |
| 12. Verify ADR site at the root path | 40 | 3 | 5 | 6 | 6 | 4.8 |
| 13. Verify ADR site at a project subpath | 40 | 30 | 50 | 54 | 55 | 47.0 |
| 14. Read GitHub Pages configuration | 40 | 0 | 0 | 1 | 1 | 0.4 |
| 15. Build and verify publication artifact | 40 | 29 | 50 | 54 | 55 | 46.9 |
| 16. Upload verified publication artifact | 40 | 1 | 2 | 3 | 11 | 2.4 |
| 17. Run actions/upload-artifact@v7 | 40 | 1 | 2 | 3 | 24 | 2.6 |
| 32. Post Run actions/setup-node@v7 | 40 | 0 | 0 | 1 | 6 | 0.6 |
| 33. Post Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 40 | 0 | 0 | 1 | 1 | 0.2 |
| 34. Post Run actions/checkout@v7 | 40 | 0 | 0 | 1 | 1 | 0.2 |
| 35. Complete job | 40 | 0 | 0 | 0 | 1 | 0.0 |

## Reading

- Measured: Frontend is the critical path of every run, at 2.3× the next job (median 4:28 against 1:58 for Backend).
- Measured: four steps hold one full Astro content sync each (typecheck, build, the subpath verification and the publication build), at 48 to 50 s a step. Together they are about 175 s of the 268 s median; every other step together is about 90 s. The job logs put the sync at `[types] Generated 43.3–45.2s` in each of those steps.
- Measured: lint (16 s), the web app's own type-check and build (about 6 s each, inside steps 8 and 11) and tests (23 s) are the rest of the job's real work; setup, install and uploads are about 20 s.
- Reported, not repeatable from this harness: the issue records a local probe in which one `astro sync` called `readDocuments()` 110 times, once per rendered document, for 31.0 s of the 33.7 s sync. The fix is #273; its record will come from `frontend/apps/docs/benchmarks/parse.bench.ts`, extended with a loader task.

## Reconsider when

A child of #272 merges (each one adds a record from this harness with the same command, so the medians compare), the docs corpus grows by more than a few dozen documents (the sync cost grows with its square until #273 lands), or the workflow's steps change so that the step names no longer match.
