# 0007 The Frontend CI job after the fixes of #272

- **Date:** 2026-11-05
- **Issue:** [#272](https://github.com/mgasca/calendar/issues/272)
- **Harness:** `tools/ci-timings/ci-timings.cs` (`just tools ci-timings --runs 5 --branch main --job Frontend --job "Docs site"`)
- **Baseline commit:** `97f787ed` (main after #290, the last child of #272); compares with record 0002 (main before the epic)

## Question

Record 0002 measured the Frontend job at a 4:28 median over 40 runs, the critical path of every CI run, with four Astro content syncs of 48–50 s each. The four children of #272 each recorded their own change (0003 to 0006). What does a run of `ci.yml` on `main` cost now that all four have merged, on the same basis as record 0002?

## Method

The same harness and statistics as record 0002, restricted with `--branch main` to the newest five successful runs of the workflow on `main`: the push run of fe6b4029 (after #274 and #276, before #275) and four runs on 97f787ed (one push, three `workflow_dispatch`, started one at a time because the concurrency group keeps one queued run per ref), 2026-11-05 20:07Z to 20:29Z, GitHub-hosted `ubuntu-latest` runners. The harness output is pasted unchanged below. Five runs is a smaller sample than the baseline's forty, so the spread matters more than the median; the per-child records measured each change on five or six runs of its PR branch before merging.

## Results

Sample: 5 successful runs of `ci.yml` in mgasca/calendar on branch `main`, 2026-11-05 20:19Z to 2026-11-05 20:32Z (events: push, workflow_dispatch).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 5 | 1:25 | 2:39 | 4:56 | 4:56 |
| Tooling | 5 | 1:12 | 1:19 | 1:43 | 1:43 |
| Docs site | 5 | 1:02 | 1:14 | 1:17 | 1:17 |
| Container image | 5 | 1:02 | 1:06 | 1:20 | 1:20 |
| Frontend | 5 | 0:46 | 0:53 | 1:02 | 1:02 |
| CI result | 5 | 0:03 | 0:04 | 0:04 | 0:04 |

Steps of `Frontend`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 5 | 1 | 1 | 2 | 2 | 1.2 |
| 2. Run actions/checkout@v7 | 5 | 1 | 1 | 2 | 2 | 1.2 |
| 3. Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 5 | 4 | 4 | 7 | 7 | 5.0 |
| 4. Run actions/setup-node@v7 | 5 | 6 | 7 | 11 | 11 | 7.6 |
| 5. Run pnpm install --frozen-lockfile | 5 | 3 | 3 | 4 | 4 | 3.2 |
| 6. Run pnpm format:check | 5 | 2 | 2 | 3 | 3 | 2.4 |
| 7. Run pnpm lint | 5 | 9 | 14 | 16 | 16 | 13.0 |
| 8. Run pnpm -r --filter '!@calendar/docs' typecheck | 5 | 3 | 5 | 6 | 6 | 4.6 |
| 9. Run pnpm -r --filter '!@calendar/docs' test:coverage | 5 | 7 | 9 | 10 | 10 | 8.6 |
| 10. Build the web app | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 11. Run actions/upload-artifact@v7 | 5 | 2 | 2 | 3 | 3 | 2.2 |
| 20. Post Run actions/setup-node@v7 | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 21. Post Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 22. Post Run actions/checkout@v7 | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 23. Complete job | 5 | 0 | 0 | 0 | 0 | 0.0 |

Steps of `Docs site`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 5 | 1 | 2 | 2 | 2 | 1.6 |
| 2. Run actions/checkout@v7 | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 3. Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 5 | 3 | 4 | 4 | 4 | 3.6 |
| 4. Run actions/setup-node@v7 | 5 | 4 | 6 | 6 | 6 | 5.6 |
| 5. Run pnpm install --frozen-lockfile | 5 | 3 | 3 | 4 | 4 | 3.4 |
| 6. Architecture model conforms to the CALM schema | 5 | 0 | 1 | 1 | 1 | 0.8 |
| 7. Run pnpm --filter @calendar/docs test:coverage | 5 | 11 | 15 | 16 | 16 | 13.8 |
| 8. Build ADR site at the root path | 5 | 8 | 11 | 11 | 11 | 10.0 |
| 9. Type-check with the types the build generated | 5 | 3 | 4 | 4 | 4 | 3.6 |
| 10. Verify ADR site at the root path | 5 | 4 | 5 | 6 | 6 | 5.2 |
| 11. Verify ADR site at a project subpath | 5 | 12 | 15 | 17 | 17 | 14.4 |
| 12. Read GitHub Pages configuration | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 13. Build and verify publication artifact | 5 | 0 | 0 | 12 | 12 | 2.4 |
| 14. Upload verified publication artifact | 5 | 0 | 0 | 3 | 3 | 0.6 |
| 15. Run actions/upload-artifact@v7 | 5 | 1 | 1 | 2 | 2 | 1.4 |
| 28. Post Run actions/setup-node@v7 | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 29. Post Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 5 | 0 | 0 | 1 | 1 | 0.4 |
| 30. Post Run actions/checkout@v7 | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 31. Complete job | 5 | 0 | 0 | 1 | 1 | 0.2 |

## Reading

- Measured: a run's critical path moved from the Frontend job (4:28 median, record 0002) to the Backend job (1:57 median here, 1:58 in record 0002); the Frontend job is now 0:57 and the new Docs site job 1:14, both under Backend.
- Measured, by step: the content syncs that cost 48–50 s each four times per run are gone from the Frontend job; the docs site syncs once per build at 11–15 s a build, in its own job, and type-checks from the types the build generated in 4 s. The web test step is 10 s (23 s in record 0002), lint 16 s (unchanged), the web build under 1 s after the typecheck step.
- Inferred: the remaining Frontend time is setup (about 15 s), lint and tests; the next saving on the Frontend job would come from lint, and on a run's critical path from the Backend job (Testcontainers PostgreSQL and the test projects), which this epic did not touch.
- Variance: `pnpm test:coverage` ranged 7–21 s over the five runs and the Backend job 1:25–2:49, so a change of a few seconds is inside the noise of this sample.

## Reconsider when

The Backend job's median rises above about 2:30, or the Frontend job's median rises above 1:30 (a regression of the kind the children fixed, such as a new per-document read in the docs loader or a reintroduced sync), or the docs corpus doubles. Re-run the harness command above on `main` and compare with this record; never edit it.
