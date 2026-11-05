# 0005 The web test suite: one jsdom per worker and a unit-level batching test

- **Date:** 2026-11-05
- **Issue:** [#275](https://github.com/mgasca/calendar/issues/275) (child of #272)
- **Harness:** `tools/ci-timings/ci-timings.cs` (`just tools ci-timings --runs <n> --job Frontend`) for the CI step; the local comparison runs Vitest itself, with the commands below
- **Baseline commit:** `c2bc51e1` (main after #284); record [0002](0002-frontend-ci-job.md) is the CI baseline

## Question

`pnpm test:coverage` was a 23 s step of the Frontend CI job, 20.5 s of it the web suite (`frontend/apps/web`). Vitest's own breakdown blamed environment creation (one jsdom per file, 28% of the step in CI), and the slowest file, `Triage.test.tsx`, spent its time rendering 501 and 1,001 task rows to test a 500-id batching rule. How much does each change save, on the same basis, and does the suite stay sound without per-file isolation?

## Method

Local measurements on the baseline commit plus the branch of #275, 12-core WSL2, Node 24.22.2, Vitest 5.0.5, jsdom 30.1.3, MSW 3.0.3, idle machine. Each run is

```bash
corepack pnpm exec vitest run --project web --reporter=default --reporter=json --outputFile.json=<file> <variant flags>
```

in `frontend/apps/web`. The two variants of a series alternate (A, B, A, B, …), five runs each; the table gives the median with the lowest and highest in brackets. Suite time is Vitest's `Duration` line; the per-file times are `endTime − startTime` of the file in the JSON report; the control is `dayTime.test.ts`, which has no DOM and no network, as its file time and as the sum of its test durations. Series run at `--maxWorkers=4`, the core count of the `ubuntu-latest` runner, and at the default 12.

- **Pool** (the `isolate: false` change alone): both variants on the final tree; A adds `--isolate`, which overrides the project setting and restores a jsdom per file.
- **Triage** (the batching change alone): isolation on in both; A swaps in `Triage.tsx` and `Triage.test.tsx` from the baseline commit (`git show c2bc51e1:frontend/apps/web/src/features/triage/<file>`), B the branch's.
- **Both**: A is the baseline pair of triage files with `--isolate`; B is the branch as committed.
- **Noise**: the counts of `not wrapped in act(...)` warnings and MSW `intercepted a request without a matching request handler` errors in the run logs.

## Results

### Pool: one jsdom per worker

| Workers | Suite before (s) | Suite after (s) | `Triage.test.tsx` before (ms) | after (ms) | Control, tests before (ms) | after (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 11.35 (10.32–11.94) | 5.18 (4.69–5.97) | 2,004 (1,893–2,114) | 1,574 (1,270–1,945) | 33 (28–45) | 11 (7–17) |
| 12 | 11.45 (10.49–12.52) | 9.52 (7.70–10.02) | 5,564 (5,014–6,035) | 4,018 (2,993–4,754) | 110 (37–126) | 73 (61–115) |

Vitest's environment share rose from 38% to 46% at 4 workers while the suite more than halved: the share is of a much shorter run (four jsdoms instead of twenty-one, at 4 workers). The control moved too, which needs saying: with `pool: 'forks'` and isolation on, Vitest recreates the worker process for every file, so the control file paid a cold process and cold ICU data on each run; without isolation it runs in a warm process. The control therefore measures part of what the change removes, and is not independent of it at the process level. At 12 workers the spread of the control covers both medians.

`vmThreads`, the issue's first candidate, was not measurable: every file fails at import because MSW 3.0.3's SSE module reads `WritableStream` at module scope and the vm context has none.

### Triage: the batching rule at the unit level

Isolation on, 12 workers:

| Quantity | Before | After |
| --- | ---: | ---: |
| `Triage.test.tsx` (ms) | 7,895 (6,758–8,132) | 4,890 (4,561–5,652) |
| Suite (s) | 11.33 (10.20–12.14) | 10.41 (9.43–11.65) |
| Control, tests (ms) | 91 (53–155) | 93 (63–122) |

The two batch tests no longer render 501 and 1,001 rows (3.4 s and 1.9 s in the baseline log, with 15 s timeouts); the rule now has eight unit tests in `bulkBatches.test.ts` that run in milliseconds, and the two DOM tests render three and five rows at a limit of 2. The suite moves less than the file because other files bound the wall time at 12 workers; the control is unchanged.

### Both changes, 4 workers

| Quantity | Before | After |
| --- | ---: | ---: |
| Suite (s) | 15.99 (12.81–16.72) | 6.62 (5.57–7.44) |
| `Triage.test.tsx` (ms) | 5,238 (4,240–6,217) | 2,549 (2,114–2,912) |
| Control, tests (ms) | 39 (36–59) | 14 (13–25) |

### Noise

Per run, in the baseline log and in every run of the branch: 10 act warnings and 4 unhandled-request errors before, 0 and 0 after (measured by counting the log lines). No time effect was expected from this part (retries are off in the test renderer), and none is claimed. The branch also makes an unhandled request fail its test, so the count cannot drift back up unnoticed.

### Soundness of the shared registry

Measured, and the reason the setup file resets the module registry per file: with a plain `isolate: false`, `dayTime.test.ts` failed in three runs out of five at 4 workers, because the `Intl.DateTimeFormat` cache in `dayTime.ts` kept formatters built while another file in the same worker had `TZ` stubbed. With the reset, 0 failures in 10 runs at 4 workers and 5 at 12. Coverage totals are identical with and without isolation (96.58% statements on the baseline).

## CI

To be measured on the PR branch once it has at least five successful runs, with `just tools ci-timings --runs <n> --job Frontend`, and compared with step 10 (`pnpm test:coverage`, median 23 s over 40 runs) of record 0002 and the web suite's `Duration` line in the job log (20.33–22.50 s in the three logs the issue cites).

## Reading

- Measured: at the runner's core count, the pool change alone takes the local web suite from 11.4 s to 5.2 s, and both changes together from 16.0 s to 6.6 s. The step in CI also contains the `docs` and `api-client` suites and coverage collection, so the saving there is bounded by the web suite's share of it.
- Measured: the batching change takes 3 s off the slowest file at 12 workers, where it bounds the suite less than it does on four cores.
- Inferred: on the 4-core runner, where the issue measured `Triage.test.tsx` at 8.6 s, the file was the suite's long pole and the pool change cannot shorten it, so both changes are needed for the step to drop by the 10 s the issue expected; the CI section will say whether it did.

## Reconsider when

The CI numbers in this record are added before the PR merges; if the step does not drop, the pool change is the part to question, since its local gain depends on process reuse that the runner may not reproduce. Revisit `vmThreads` if MSW stops reading `WritableStream` at module scope, and the per-file module reset if Vitest grows an option that resets modules without recreating the environment.
