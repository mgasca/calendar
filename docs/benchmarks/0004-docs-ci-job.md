---
subject: "The docs site in its own CI job (#274): job, step and critical-path durations, before #273"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0004 The docs site in its own CI job

- **Date:** 2026-11-05
- **Issue:** [#274](https://github.com/mgasca/calendar/issues/274)
- **Harness:** `tools/ci-timings/ci-timings.cs` (`dotnet run tools/ci-timings/ci-timings.cs -- --runs 10 --branch claude/docs-ci-job-274 --job "Docs site" --job Frontend`; the `just tools ci-timings` recipe splits a quoted job name into words, so a job name with a space needs the harness run directly)
- **Baseline commit:** `0f28a3d3` (record [0002](0002-frontend-ci-job.md), the Frontend job before any child of #272)
- **Measured commit:** the delivery branch of #274 at `6bca34ac` and five empty commits on it (up to `9f8c476e`), all on `main` at `c2bc51e1`, before #273 (the docs loader fix) merged

## Question

`.github/workflows/ci.yml` ran the docs site's type-check and three builds in series with the web app's checks, in the one Frontend job (record 0002: four content syncs, about 175 s of a 4:28 median). #274 moves the docs site into its own job, **Docs site**, and lets `astro check --noSync` reuse the types the first build generated. How long are the two jobs now, and how much shorter is the run?

## Method

The same harness and command family as record 0002, narrowed to one branch with the `--branch` option this PR adds: successful pull-request runs of `ci.yml` on `claude/docs-ci-job-274`, GitHub-hosted `ubuntu-latest` runners, nearest-rank medians. Six runs, 2026-11-05 19:21Z to 19:41Z: the PR's own run and five empty commits pushed one at a time, each after the previous run had completed. The harness output is pasted unchanged below.

The run's critical path is not in the harness output. It was read from the same jobs API by hand: the start of the **CI result** job minus the run's `run_started_at`, for these six runs and for the last ten successful runs on `main` before the branch's first run (the old workflow), listed in the last table.

Six runs is a small sample on hardware that varies (record 0002: the fastest runs were about 15 s faster per content sync). p90 equals the maximum at this size; the medians are the comparable numbers, and a difference under about 10 s between two step medians is within that variance.

## Results

Sample: 6 successful runs of `ci.yml` in mgasca/calendar on branch `claude/docs-ci-job-274`, 2026-11-05 19:21Z to 2026-11-05 19:41Z (events: pull_request).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Docs site | 6 | 2:04 | 3:00 | 3:46 | 3:46 |
| Backend | 6 | 1:38 | 1:57 | 2:42 | 2:42 |
| Container image | 6 | 1:02 | 1:13 | 1:25 | 1:25 |
| Tooling | 6 | 0:56 | 1:10 | 1:20 | 1:20 |
| Frontend | 6 | 0:48 | 0:49 | 1:09 | 1:09 |
| CI result | 6 | 0:02 | 0:03 | 0:04 | 0:04 |
| ADR preview | 2 | 0:00 | 0:00 | 0:00 | 0:00 |

Steps of `Docs site`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 6 | 1 | 1 | 2 | 2 | 1.3 |
| 2. Run actions/checkout@v7 | 6 | 1 | 1 | 2 | 2 | 1.5 |
| 3. Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 6 | 4 | 4 | 8 | 8 | 5.0 |
| 4. Run actions/setup-node@v7 | 6 | 4 | 5 | 10 | 10 | 5.7 |
| 5. Run pnpm install --frozen-lockfile | 6 | 3 | 3 | 3 | 3 | 3.0 |
| 6. Architecture model conforms to the CALM schema | 6 | 0 | 1 | 2 | 2 | 1.2 |
| 7. Run pnpm --filter @calendar/docs test:coverage | 6 | 3 | 3 | 5 | 5 | 3.7 |
| 8. Build ADR site at the root path | 6 | 30 | 46 | 57 | 57 | 45.5 |
| 9. Type-check with the types the build generated | 6 | 2 | 4 | 5 | 5 | 3.7 |
| 10. Verify ADR site at the root path | 6 | 3 | 4 | 7 | 7 | 4.8 |
| 11. Verify ADR site at a project subpath | 6 | 31 | 50 | 63 | 63 | 48.0 |
| 12. Read GitHub Pages configuration | 6 | 0 | 0 | 1 | 1 | 0.3 |
| 13. Build and verify publication artifact | 6 | 32 | 49 | 62 | 62 | 48.2 |
| 14. Upload verified publication artifact | 6 | 1 | 2 | 3 | 3 | 2.2 |
| 15. Run actions/upload-artifact@v7 | 6 | 1 | 1 | 2 | 2 | 1.3 |
| 28. Post Run actions/setup-node@v7 | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 29. Post Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 6 | 0 | 0 | 1 | 1 | 0.5 |
| 30. Post Run actions/checkout@v7 | 6 | 0 | 0 | 1 | 1 | 0.2 |
| 31. Complete job | 6 | 0 | 0 | 0 | 0 | 0.0 |

Steps of `Frontend`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 6 | 0 | 1 | 1 | 1 | 0.8 |
| 2. Run actions/checkout@v7 | 6 | 1 | 1 | 1 | 1 | 1.0 |
| 3. Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 6 | 3 | 3 | 4 | 4 | 3.5 |
| 4. Run actions/setup-node@v7 | 6 | 4 | 5 | 6 | 6 | 4.8 |
| 5. Run pnpm install --frozen-lockfile | 6 | 2 | 3 | 3 | 3 | 2.7 |
| 6. Run pnpm format:check | 6 | 1 | 2 | 3 | 3 | 2.2 |
| 7. Run pnpm lint | 6 | 9 | 10 | 16 | 16 | 12.8 |
| 8. Run pnpm -r --filter '!@calendar/docs' typecheck | 6 | 3 | 4 | 6 | 6 | 4.8 |
| 9. Run pnpm -r --filter '!@calendar/docs' test:coverage | 6 | 12 | 14 | 22 | 22 | 17.3 |
| 10. Run pnpm -r --filter '!@calendar/docs' build | 6 | 2 | 3 | 5 | 5 | 3.8 |
| 11. Run actions/upload-artifact@v7 | 6 | 1 | 2 | 2 | 2 | 1.8 |
| 20. Post Run actions/setup-node@v7 | 6 | 0 | 0 | 1 | 1 | 0.2 |
| 21. Post Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 22. Post Run actions/checkout@v7 | 6 | 0 | 0 | 1 | 1 | 0.3 |
| 23. Complete job | 6 | 0 | 0 | 1 | 1 | 0.2 |

Critical path of a run (start of **CI result** minus the run's start, by hand from the jobs API):

| Sample | n | min | median | max | values (s) |
| --- | --: | --: | --: | --: | --- |
| `main` before this branch (old workflow, last 10 successful runs) | 10 | 3:00 | 4:14 | 4:48 | 180 183 185 232 254 276 282 284 285 288 |
| `claude/docs-ci-job-274` (the six runs above) | 6 | 2:13 | 3:06 | 3:51 | 133 167 186 209 220 231 |

## Reading

- Measured: the Frontend job goes from a 4:28 median (record 0002, 40 runs) to 0:49 (6 runs); it now holds the workspace format and lint, the web and api-client type-check, tests and build, and nothing of the docs site.
- Measured: the Docs site job's median is 3:00, with the spread (2:04 to 3:46) that record 0002 attributes to runner hardware. Its three builds are 46, 50 and 49 s, as before; the type-check that cost 48 s in the Frontend job costs 4 s here (step 9), because `--noSync` reuses the types step 8 generated. That is the one content sync removed: three per run instead of four.
- Measured: the critical path of a run goes from a 4:14 median (last 10 runs on `main`) to 3:06, 68 s less. The Docs site job was the critical job in five of the six runs and Backend in one (run 42093089374: Docs site 2:04, Backend 2:42). The 4:14 baseline is lower than record 0002's Frontend median because three of those ten runs landed on fast runners (3:00 to 3:05); the branch sample has the same kind of spread.
- Measured number, inferred reason: the web tests take 14 s instead of 23 s, because `pnpm -r` no longer runs the docs suite's corpus tests in a third Vitest process beside them on the 4-core runner (record 0002 noted the contention). The web build step is 3 s (`tsc -b && vite build`), the subject of #276.
- Inferred: once #273 removes the quadratic route-map cost, each build drops to about 5 s and the Docs site job to roughly 1:00 to 1:10, which makes Backend (1:57) the critical path of every run. All three URL variants were kept for that reason: after #273 they cost about 10 s on a job that is no longer critical, and the root-path build is what `just docs build` produces locally.

## Reconsider when

#273 merges (resample `main` with `just tools ci-timings --runs 40 --job "Docs site" --job Frontend` and add a record; the medians above are the before numbers for it), the Docs site job becomes the critical path again (then the subpath build is the first candidate to drop, since the publication build already verifies a base path), or the workflow's job or step names change.
