---
subject: "API test classes in parallel, a database copy per test, one reset per test (#349)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0009 API test classes in parallel, a database copy per test

- **Date:** 2026-11-06
- **Issue:** [#349](https://github.com/mgasca/calendar/issues/349), child 2 of [#347](https://github.com/mgasca/calendar/issues/347); PR [#359](https://github.com/mgasca/calendar/pull/359)
- **Harness:** `tools/ci-timings/ci-timings.cs` (`dotnet run tools/ci-timings/ci-timings.cs -- --runs 5 --branch perf/349-parallel-api-tests --job Backend`) for CI; the test project itself, `backend/tests/Calendar.Api.Tests/Calendar.Api.Tests.csproj`, for local per-test durations
- **Baseline commit:** `d44480f3` (main); CI baseline from #347's sample of 40 runs ending at 3c3304d1
- **After commit:** `8984c021` (the code of #359); the record commit after it changes only `docs/`

## Question

Every `ApiTestBase` class shared one database through `[Collection("Database")]`, so xUnit ran the 14 database classes one at a time, and each test reset the database twice. The `dotnet test` step was the longest step of the Backend job, which was the critical path of 37 of 40 runs. How much do a database per running test (classes in parallel) and one reset per test take off the step, the job and the run?

## Method

- **The change.** After migrating `calendar` (as `calendar_migrator`, ADR-0015), the assembly fixture copies it once to `calendar_template`, which nothing can connect to. Each test rents a copy of the template (`CREATE DATABASE … TEMPLATE`, with the database-level grants of `docker/postgres/init/01-roles.sh`), resets it once and returns it. Returned copies are reused, at most 8 exist, and test classes run in parallel; the tests of one class still run one at a time.
- **Resets per test.** Before: a throwaway timing probe in `ApiTestBase` (not committed), one run. After: `ApiTestLifecycleTests.EachTest_ResetsItsDatabaseOnce`, which fails on the old base class (`should be 1 but was 2`).
- **Local per-test durations.** `dotnet test --test-modules <build>/Calendar.Api.Tests.dll --report-xunit-trx`, with Release builds of d44480f3 and f08e3c51 (8984c021 changed only the release of a copy after a failed setup), alternating before and after, 3 runs each. The machine was a WSL2 laptop with 12 logical cores, Docker through podman, and other work running (load average about 5), so absolute numbers moved by up to 20 s between runs. `--report-trx` needs the Microsoft TRX extension, which these projects don't reference; xUnit's `--report-xunit-trx` gives the same durations.
- **CI.** GitHub-hosted `ubuntu-latest` (4 vCPUs). Three successful runs of 8984c021, 2026-11-06 16:27Z to 16:33Z: one organic `pull_request` run and two `workflow_dispatch` runs. Two more runs, of the record commit, follow the results table. Five runs were dispatched in all, the whole budget of #349: three completed, and two were queued while another dispatched run was pending, so the concurrency group cancelled them before any job started (0 jobs each). The one `pull_request` run of f08e3c51 is listed separately. The step and job figures below are per run, because three runs is too few for a p90.
- **Control.** The steps before `dotnet test` (build, format, EF model check) and the other jobs, which the change does not touch.

## Results

Local, measured (median and range of 3 alternating runs):

| Quantity | Before (d44480f3) | After (f08e3c51) |
| --- | --: | --: |
| `Calendar.Api.Tests` duration | 53.4 s (39.7–59.2) | 23.4 s (20.8–30.1) |
| First test start → last test end | 45.4 s (32.5–51.3) | 15.7 s (13.9–18.5) |
| Tests | 264 | 267 (3 new) |
| Database resets per test | 2 (472 over 236) | 1 |
| Longest class span, `TaskEndpointsTests` (51 tests) | 6.9 s of a 34 s serial collection | 15.6 s (13.8–18.4) of a 15.7 s test phase |

CI, measured, one row per run:

| Run | Commit | Event | `dotnet test` step | Backend | Tooling | Longest job |
| --- | --- | --- | --: | --: | --: | --- |
| 42251233749 | f08e3c51 | pull_request | 28 s | 1:53 | 1:40 | Backend |
| 42252550883 | 8984c021 | pull_request | 24 s | 1:13 | 1:24 | Tooling |
| 42252801468 | 8984c021 | workflow_dispatch | 32 s | 1:52 | 1:28 | Backend |
| 42252949111 | 8984c021 | workflow_dispatch | 28 s | 1:37 | 1:40 | Tooling |

| Quantity (8984c021, n=3) | Before (#347, n=40) | After |
| --- | --: | --: |
| `dotnet test` step, median (range) | 44 s (p90 47 s) | 28 s (24–32) |
| Backend job, median (range) | 1:55 (1:25–2:18) | 1:37 (1:13–1:52) |
| Tooling job, median (range) | 1:19 (1:00–2:15) | 1:28 (1:24–1:40) |
| Longest job | Backend in 37 of 40 | Tooling in 2 of 3, Backend in 1 |

The record commit `d7decb08` changes only `docs/` (`git diff --stat 8984c021 d7decb08 -- backend` is empty), so its two runs test the same backend code. They are listed apart from the runs of 8984c021: one organic `pull_request` run and the fifth and last dispatched run, 2026-11-06 16:35Z to 16:39Z.

| Run | Commit | Event | `dotnet test` step | Backend | Tooling | Longest job |
| --- | --- | --- | --: | --: | --: | --- |
| 42253810779 | d7decb08 | pull_request | 32 s | 1:37 | 1:00 | Backend |
| 42254153995 | d7decb08 | workflow_dispatch | 24 s | 1:17 | 1:22 | Container image (1:23) |

Over all five runs of this backend code (8984c021 and d7decb08), the `dotnet test` step's median is 28 s (24–32) and the Backend job's is 1:37 (1:13–1:52). Backend was the longest job in 2 of the 5.

## Reading

- Measured: the `dotnet test` step fell from a 44 s median to 28 s, so about 16 s, at the low end of #349's prediction of 10–25 s. Locally the API test phase fell from about 45 s to about 16 s on 12 cores.
- Measured: one reset per test instead of two. The probe put a reset at about 15 ms, so the dropped resets were worth about 3.4 s of the old serial collection (inferred from the probe).
- Measured, small sample: the Backend job median fell from 1:55 to 1:37 (five runs), and Backend was the longest job in only 2 of 5 runs, against 37 of 40 before; Tooling or Container image was the longest in the others. The run is now capped by Tooling and the other jobs, so the step saving does not all reach the run: about the Backend lead of 20 s at most (#347), shared with #350 and now partly used by this change. The run wall clock is left to record 0012 on `main`.
- Measured locally, inferred for CI: the tail is now the largest class, `TaskEndpointsTests`, which still runs serially and spans the whole test phase on 12 cores. On a 4-core runner, 4 threads share about 34 s of serial work, so the class tail matters less there. Splitting the agenda and task classes is the next saving only if Backend becomes the cap again.
- Variance: the step ranged 24–32 s and Backend 1:13–1:52 over five runs, and the build and format steps moved by 10–15 s between runs, so the job figures are rough.

## Reconsider when

The `dotnet test` step's median rises above about 35 s, a test class grows past about 60 tests, or Backend is again the longest job in most runs after #350 and #351. Re-run the harness command above on the branch or on `main` with `--branch main`, compare with this record, and never edit it.
