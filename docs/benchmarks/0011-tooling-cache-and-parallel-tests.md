---
subject: "The Tooling job with a NuGet cache and parallel test apps (#351)"
harness: "tools/ci-timings/ci-timings.ts"
---

# 0011 The Tooling job with a NuGet cache and parallel test apps

- **Date:** 2026-11-06
- **Issue:** [#351](https://github.com/mgasca/calendar/issues/351), child 4 of [#347](https://github.com/mgasca/calendar/issues/347)
- **Harness:** `tools/ci-timings/ci-timings.cs`, run directly because the recipe does not quote its arguments (#345):
  - before: `dotnet run tools/ci-timings/ci-timings.cs -- --job Tooling --created "<2026-11-06T18:15:00Z"`;
  - uncached control: `-- --branch ci/350-format-whitespace-only --job Tooling`;
  - cache only: `-- --branch ci/351-tooling-nuget-cache --created "<2026-11-06T19:00:00Z" --job Tooling`;
  - cache and parallel tests: `-- --branch ci/351-tooling-nuget-cache --runs 5 --job Tooling`.
- **Measured commits:** the delivery branch of #351. The cache commit `85a36cdb`, on `main` at `8e578ebb`, ran on itself and five empty commits (`62bcd201` to `489545c5`). The parallel-tests commit `763c46ec`, with `main` merged in at `99e48323`, ran on itself and four empty commits (`497d7207` to `97d9f23f`).

## Question

The Tooling job's "Test and lint tooling" step (`just tools test`) took 48 s median, with a wide spread (31–78 s). #347 expected it to become the cap on the critical path once #349 and #350 had shortened Backend. Its first test app was the slowest by far, and the issue's lead was a cold NuGet restore, since the job had no cache. Does a NuGet cache remove that cost? And does running the independent test apps in parallel, the issue's second candidate, shorten the step?

## Method

The CI sampler measured job and step durations on GitHub-hosted `ubuntu-latest` runners (nearest-rank). Four samples:

- **Before:** the last 40 successful runs created before the first run of this branch. Most of them predate #360 (merged at 17:18Z), which added a tenth test app (`handover-watch`). Treat the before row as one app lighter.
- **Uncached control:** the 5 successful runs of the #350 branch, 18:19Z–18:56Z, on the same 10 apps and in the same hour, without the cache. #350 does not touch the Tooling job.
- **Cache only:** this branch's first 6 runs. The first run missed and saved the cache; the other five each restored it.
- **Cache and parallel tests:** this branch's 5 runs after the `tools/mod.just` change.

The first app's time was read from the Tooling logs: the gap between its `dotnet run` line and its `Total:` line. The "Azure role SQL" step is the control, because neither change touches it.

Runs pushed only to measure: 9 empty commits, the first 5 within #351's budget and 4 more approved by the maintainer. No dispatches.

Locally, on a 12-core WSL2 workstation with .NET SDK 10.0.403, the ten test apps were run three times in each mode, alternating, each app compiling from scratch (`--artifacts-path` in a fresh directory, build servers shut down): one at a time took 89.4, 90.2 and 72.8 s; four at a time took 60.7, 44.0 and 33.9 s.

## Results

### Before (no cache, apps one at a time)

Sample: 40 successful runs of `ci.yml` in mgasca/calendar created <2026-11-06T18:15:00Z, 2026-11-06 14:28Z to 2026-11-06 17:18Z (events: pull_request, push, workflow_dispatch).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 40 | 1:13 | 1:49 | 2:03 | 2:35 |
| Tooling | 40 | 0:59 | 1:17 | 1:38 | 1:49 |
| Container image | 40 | 0:58 | 1:13 | 1:31 | 2:05 |
| Docs site | 40 | 0:48 | 1:13 | 1:36 | 1:49 |
| Frontend | 40 | 0:39 | 0:53 | 1:02 | 1:40 |
| CI result | 40 | 0:02 | 0:03 | 0:04 | 0:04 |
| Cancel superseded runs | 2 | 0:03 | 0:03 | 0:07 | 0:07 |

Steps of `Tooling`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 40 | 0 | 1 | 2 | 2 | 1.4 |
| 2. Run actions/checkout@v7 | 40 | 1 | 1 | 2 | 5 | 1.3 |
| 3. Run actions/setup-dotnet@v6 | 40 | 0 | 1 | 1 | 2 | 0.7 |
| 4. Ensure shellcheck | 40 | 0 | 0 | 0 | 1 | 0.1 |
| 5. Read the pinned just version | 40 | 0 | 0 | 0 | 0 | 0.0 |
| 6. Run extractions/setup-just@53165ef7e734c5c07cb06b3c8e7b647c5aa16db3 | 40 | 1 | 1 | 2 | 2 | 1.1 |
| 7. justfile and its modules parse and are formatted | 40 | 0 | 0 | 0 | 1 | 0.1 |
| 8. Test and lint tooling | 40 | 31 | 48 | 66 | 78 | 49.2 |
| 9. Azure role SQL matches the local init script (PostgreSQL in Docker) | 40 | 15 | 17 | 19 | 19 | 17.0 |
| 10. Tooling package pins match backend | 40 | 1 | 1 | 2 | 3 | 1.5 |
| 11. ADRs follow conventions | 40 | 1 | 2 | 3 | 3 | 2.0 |
| 21. Post Run actions/setup-dotnet@v6 | 40 | 0 | 0 | 1 | 1 | 0.1 |
| 22. Post Run actions/checkout@v7 | 40 | 0 | 0 | 1 | 1 | 0.3 |
| 23. Complete job | 40 | 0 | 0 | 0 | 1 | 0.1 |

### Uncached control (the #350 branch, same hour, same apps)

Sample: 5 successful runs of `ci.yml` in mgasca/calendar on branch `ci/350-format-whitespace-only`, 2026-11-06 18:19Z to 2026-11-06 18:56Z (events: pull_request, workflow_dispatch).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Tooling | 5 | 1:06 | 1:28 | 1:54 | 1:54 |
| Backend | 5 | 1:09 | 1:26 | 1:40 | 1:40 |
| Docs site | 5 | 0:51 | 1:13 | 1:18 | 1:18 |
| Container image | 5 | 1:07 | 1:09 | 1:15 | 1:15 |
| Frontend | 5 | 0:42 | 0:54 | 1:07 | 1:07 |
| CI result | 5 | 0:03 | 0:03 | 0:04 | 0:04 |
| Cancel superseded runs | 1 | 0:03 | 0:03 | 0:03 | 0:03 |

Steps of `Tooling`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 2. Run actions/checkout@v7 | 5 | 1 | 1 | 2 | 2 | 1.2 |
| 3. Run actions/setup-dotnet@v6 | 5 | 0 | 1 | 1 | 1 | 0.8 |
| 4. Ensure shellcheck | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 5. Read the pinned just version | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 6. Run extractions/setup-just@53165ef7e734c5c07cb06b3c8e7b647c5aa16db3 | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 7. justfile and its modules parse and are formatted | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 8. Test and lint tooling | 5 | 39 | 58 | 85 | 85 | 58.8 |
| 9. Azure role SQL matches the local init script (PostgreSQL in Docker) | 5 | 17 | 18 | 19 | 19 | 17.8 |
| 10. Tooling package pins match backend | 5 | 1 | 1 | 2 | 2 | 1.4 |
| 11. ADRs follow conventions | 5 | 2 | 2 | 2 | 2 | 2.0 |
| 21. Post Run actions/setup-dotnet@v6 | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 22. Post Run actions/checkout@v7 | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 23. Complete job | 5 | 0 | 0 | 0 | 0 | 0.0 |

### Cache only

Sample: 6 successful runs of `ci.yml` in mgasca/calendar on branch `ci/351-tooling-nuget-cache` created <2026-11-06T19:00:00Z, 2026-11-06 18:21Z to 2026-11-06 18:32Z (events: pull_request).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 6 | 1:14 | 1:34 | 1:56 | 1:56 |
| Tooling | 6 | 1:22 | 1:25 | 1:43 | 1:43 |
| Container image | 6 | 1:01 | 1:13 | 1:22 | 1:22 |
| Docs site | 6 | 0:49 | 1:06 | 1:13 | 1:13 |
| Frontend | 6 | 0:44 | 0:52 | 1:00 | 1:00 |
| Cancel superseded runs | 6 | 0:02 | 0:03 | 0:05 | 0:05 |
| CI result | 6 | 0:02 | 0:02 | 0:04 | 0:04 |

Steps of `Tooling`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 6 | 1 | 1 | 2 | 2 | 1.5 |
| 2. Run actions/checkout@v7 | 6 | 1 | 1 | 2 | 2 | 1.2 |
| 3. Run actions/setup-dotnet@v6 | 6 | 3 | 6 | 17 | 17 | 7.5 |
| 4. Ensure shellcheck | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 5. Read the pinned just version | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 6. Run extractions/setup-just@53165ef7e734c5c07cb06b3c8e7b647c5aa16db3 | 6 | 1 | 1 | 1 | 1 | 1.0 |
| 7. justfile and its modules parse and are formatted | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 8. Test and lint tooling | 6 | 50 | 55 | 62 | 62 | 54.7 |
| 9. Azure role SQL matches the local init script (PostgreSQL in Docker) | 6 | 14 | 15 | 17 | 17 | 15.5 |
| 10. Tooling package pins match backend | 6 | 1 | 2 | 2 | 2 | 1.7 |
| 11. ADRs follow conventions | 6 | 2 | 2 | 3 | 3 | 2.3 |
| 21. Post Run actions/setup-dotnet@v6 | 6 | 0 | 0 | 4 | 4 | 0.8 |
| 22. Post Run actions/checkout@v7 | 6 | 0 | 0 | 1 | 1 | 0.2 |
| 23. Complete job | 6 | 0 | 0 | 0 | 0 | 0.0 |

### Cache and parallel test apps

Sample: 5 successful runs of `ci.yml` in mgasca/calendar on branch `ci/351-tooling-nuget-cache`, 2026-11-06 19:08Z to 2026-11-06 19:30Z (events: pull_request).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 5 | 1:34 | 1:46 | 1:56 | 1:56 |
| Container image | 5 | 1:03 | 1:11 | 1:21 | 1:21 |
| Tooling | 5 | 0:58 | 1:03 | 1:20 | 1:20 |
| Docs site | 5 | 0:57 | 1:01 | 1:13 | 1:13 |
| Frontend | 5 | 0:43 | 0:51 | 1:07 | 1:07 |
| Cancel superseded runs | 5 | 0:03 | 0:04 | 0:07 | 0:07 |
| CI result | 5 | 0:02 | 0:03 | 0:04 | 0:04 |

Steps of `Tooling`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 5 | 1 | 1 | 3 | 3 | 1.4 |
| 2. Run actions/checkout@v7 | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 3. Run actions/setup-dotnet@v6 | 5 | 4 | 5 | 7 | 7 | 5.2 |
| 4. Ensure shellcheck | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 5. Read the pinned just version | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 6. Run extractions/setup-just@53165ef7e734c5c07cb06b3c8e7b647c5aa16db3 | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 7. justfile and its modules parse and are formatted | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 8. Test and lint tooling | 5 | 29 | 30 | 41 | 41 | 33.0 |
| 9. Azure role SQL matches the local init script (PostgreSQL in Docker) | 5 | 16 | 17 | 19 | 19 | 17.2 |
| 10. Tooling package pins match backend | 5 | 1 | 1 | 2 | 2 | 1.4 |
| 11. ADRs follow conventions | 5 | 1 | 2 | 3 | 3 | 2.0 |
| 21. Post Run actions/setup-dotnet@v6 | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 22. Post Run actions/checkout@v7 | 5 | 0 | 0 | 1 | 1 | 0.4 |
| 23. Complete job | 5 | 0 | 0 | 0 | 0 | 0.0 |

### The first test app (`check-adr.tests`), from the logs

| Sample | Seconds |
| --- | --- |
| No cache: the five latest runs on `main` and in PRs before 17:20Z, and three runs of the #350 branch | 46, 10, 19, 10, 23, 41, 16, 24 (median 19) |
| Cache restored (five runs) | 15, 31, 14, 14, 14 (median 14) |
| Cache missed and saved (one run) | 16 |

Every cached run logged `Cache restored successfully`, at about 242 MB.

## Reading

- **Measured: the cache alone did not shorten the step.** The step took 55 s median with the cache (50–62 s) against 58 s uncached in the same hour (39–85 s). Restoring 242 MB made `setup-dotnet` take 6 s instead of 1 s. The first app took 14 s median with the cache and 19 s without, but the uncached runs range from 10 to 46 s, and the one run that missed the cache and downloaded took 16 s. So at these sample sizes (5 and 8), the share of downloading in the first app's cost is not shown. That most of it is the job's first `dotnet run` starting the SDK's build servers and compiling is inferred.
- **Measured: running the test apps four at a time cut the step to 30 s median** (29–41 s, n=5), against 55 s for the cache alone and 58 s for the uncached control. The Tooling job fell from 1:25–1:28 to **1:03** (0:58–1:20). The control step did not move (17 s against 15–18 s).
- **Critical path:** in the same five runs, Tooling took 1:03 median and Backend 1:46 (this branch has #349 but not #350). On the #350 branch, which has both, Backend took 1:26 and Tooling 1:28, the only sample where Tooling's median led. These are per-job medians, not the per-run critical path; record 0012 measures that on `main` after every child has merged.
- **Kept the cache, but its value is not shown.** With parallel apps, it is unmeasured whether the cache still helps (four apps restoring cold at once could contend for downloads) or only costs its 5 s restore. Tooling is now off the critical path, so that 5 s does not lengthen a run. Removing the cache is the next candidate if Tooling becomes the cap again.
- **Local loop:** `just tools test` also runs the apps four at a time (`TOOLS_TEST_JOBS` changes the number). Locally, from a cold build, that took 34–61 s instead of 73–90 s. The output stays in app order, and a failing app still fails the recipe and is named; both were checked by hand.

## Reconsider when

- The Tooling job's median rises above Backend's again: then measure parallel runs without the cache, and consider more jobs at once or caching the compiled test apps.
- A tool's tests start sharing state (a port, a file, a database) so that they can no longer run side by side: set `TOOLS_TEST_JOBS=1` for that run, and fix the tests.
- The cache restore grows well beyond 242 MB or 5 s.
- A test app hangs: the parallel recipe prints each app's output only once all of them have finished, so a hang shows nothing until the job's 10-minute timeout. Print each log as its app finishes, or add a per-app timeout.
- `tools/infra/tests/database.tests.cs` and `infra.tests.cs` share one `packages.lock.json` and restore at the same time. That is safe while their pins are identical (CI restores in locked mode); if they diverge, a local run could write the file twice at once.

Re-run the harness commands above and compare; never edit this record.
