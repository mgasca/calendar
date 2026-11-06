---
subject: "A CI run on main after the five fixes of #347: critical path, wall clock and compute"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0012 A CI run on main after the five fixes of #347

- **Date:** 2026-11-06
- **Issue:** [#347](https://github.com/mgasca/calendar/issues/347), the closing measurement after #348 (record [0008](0008-superseded-run-wait.md)), #349 ([0009](0009-api-tests-in-parallel.md)), #350 ([0010](0010-format-whitespace-only.md)), #351 ([0011](0011-tooling-cache-and-parallel-tests.md)) and #368
- **Harness:** `tools/ci-timings/ci-timings.cs`, run directly because the recipe does not quote its arguments (#345):
  - before, job table of the push runs: `dotnet run tools/ci-timings/ci-timings.cs -- --branch main --created "2026-11-06T09:00:00Z..2026-11-06T16:50:00Z" --runs 40`;
  - after: `-- --branch main --created ">=2026-11-06T20:04:00Z" --job "Docs site" --job Backend`.
  The run-level lenses (wall clock, critical path, compute, queue) were read from the jobs API by hand, as in #347 and record 0004, and are listed per run below. The method is below.
- **Baseline:** successful runs before the first child merged (#349, at 16:55Z): pull request runs from 12:52Z to 16:26Z, and push runs on `main` from 10:53Z to 16:27Z
- **Measured commits:** `main` at `209f497f` (the last child, #351) and `a0d3b4da` (the next commit, an agent-hooks change)

## Question

Epic #347 found a CI run on `main` or a PR taking a median of 2:10, with the Backend job the critical path in 37 of 40 runs. Superseded PR runs added a tail of up to 85 s. Five changes followed:

- the superseding run no longer waits for the old one (#348);
- API test classes run in parallel (#349);
- the format check runs whitespace only (#350);
- Tooling runs its test apps in parallel, with a NuGet cache (#351);
- `CI result` requires every needed job to succeed (#368), a correctness fix.

With all five on `main`, how long does a run take on the path an author waits for (a pull request) and on `main`? What does it cost, and which job is the new critical path?

## Method

**Two paths, compared each with itself.** The Docs site job builds, verifies and uploads the GitHub Pages publication artifact only on a push to `main` or for a docs-only pull request. That takes about 20 s. Every other pull request, and a `workflow_dispatch`, skips those three steps. So a run takes one of two paths:

- **PR path:** before, the 25 successful `pull_request` runs in the window that built no publication artifact. Left out are docs-only PRs, which build it, and the runs of the two epic branches (`ci/348-superseded-run-wait`, `perf/349-parallel-api-tests`), which already carried part of the change. After, four `workflow_dispatch` runs on `main`, started one at a time, each after the previous one had finished. The maintainer approved them on #347, because only one organic run existed yet. A dispatch takes the same steps as such a PR run. It does skip `Cancel superseded runs`, which only pull requests run, and it cannot be superseded.
- **Push to `main`:** before, the 19 successful push runs in the window; after, the 2 organic push runs from `209f497f` onward.

**Lenses, per run, from `GET /actions/runs/{id}/jobs`.** T0 is the run's `created_at`. Skipped jobs are left out.

- **Queue:** T0 to the first job's start.
- **Wall clock:** T0 to the last job's end.
- **Critical path:** the job, other than `CI result` and `Cancel superseded runs`, that ends last.
- **Lead:** how much later that job ends than the next-latest.
- **Compute:** the sum of every job's start-to-end time.

Statistics are nearest-rank, over every run in a sample. Dispatches and pushes on `main` share one concurrency group without cancelling, so the `a0d3b4da` push run queued 17 s behind the third dispatch.

**Harness fix in this PR.** The job table used to show a skipped job with a negative duration (`Cancel superseded runs` at 0:-01 on push runs). The parser now leaves skipped jobs out, with a test that fails without the fix. The tables below were produced with it. The fix also reaches `--superseded`, which no longer sees a skipped job either. So a re-run of record 0008's command may differ slightly, for example a cancelled run's skipped `CI result` no longer appears among its jobs.

## Results

### PR path

| | Before (pull request runs, n=25) | After (dispatch runs, n=4) |
| --- | --: | --: |
| Wall clock, median (p90; max) | **2:05** (2:57; 3:35) | **1:29** (1:45; 1:45) |
| Compute per run, median (range) | 6:29 (5:40–7:40) | 5:35 (5:30–5:53) |
| Critical path | Backend 22, Tooling 2, Container image 1 | Backend 2, Docs site 1, Container image 1 |
| Lead of the critical job, median (range) | 28 s (0–85 s) | 3 s (1–19 s) |
| Queue, median (p90; max) | 3 s (45 s; 73 s) | 2 s (2 s; 2 s) |

### Push to `main`

| | Before (push runs, n=19) | After (push runs, n=2) |
| --- | --: | --: |
| Wall clock | 2:02 median (p90 2:17; max 2:18) | 1:50 and 2:02 (1:45 from its first job) |
| Compute per run | 7:01 median (6:09–7:30) | 6:22 and 6:15 |
| Critical path | Backend 17, Docs site 2 | Docs site 2 |
| Lead of the critical job | 13 s median (0–40 s, n=19) | 8 s and 14 s |
| Queue | 2–3 s | 1 s and 17 s |

On the two push runs, Docs site spent 20 s and 19 s in the publication steps: "Read GitHub Pages configuration", "Build and verify publication artifact" (16 s and 17 s) and "Upload verified publication artifact".

### Job and step durations, after

Sample: 6 successful runs of `ci.yml` in mgasca/calendar on branch `main` created >=2026-11-06T20:04:00Z, 2026-11-06 20:04Z to 2026-11-06 20:21Z (events: push, workflow_dispatch).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 6 | 1:12 | 1:19 | 1:38 | 1:38 |
| Container image | 6 | 0:59 | 1:18 | 1:24 | 1:24 |
| Docs site | 6 | 0:50 | 1:18 | 1:40 | 1:40 |
| Tooling | 6 | 0:57 | 1:06 | 1:16 | 1:16 |
| Frontend | 6 | 0:40 | 0:45 | 0:50 | 0:50 |
| CI result | 6 | 0:02 | 0:03 | 0:05 | 0:05 |

Steps of `Docs site`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 6 | 1 | 1 | 1 | 1 | 1.0 |
| 2. Run actions/checkout@v7 | 6 | 1 | 1 | 1 | 1 | 1.0 |
| 3. Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 6 | 3 | 4 | 4 | 4 | 3.7 |
| 4. Run actions/setup-node@v7 | 6 | 4 | 6 | 10 | 10 | 6.5 |
| 5. Run pnpm install --frozen-lockfile | 6 | 3 | 3 | 4 | 4 | 3.2 |
| 6. Architecture model conforms to the CALM schema | 6 | 1 | 1 | 1 | 1 | 1.0 |
| 7. Run pnpm --filter @calendar/docs test:coverage | 6 | 9 | 17 | 18 | 18 | 15.7 |
| 8. Build ADR site at the root path | 6 | 7 | 11 | 12 | 12 | 10.5 |
| 9. Type-check with the types the build generated | 6 | 2 | 4 | 4 | 4 | 3.5 |
| 10. Verify ADR site at the root path | 6 | 4 | 6 | 6 | 6 | 5.5 |
| 11. Verify ADR site at a project subpath | 6 | 10 | 16 | 17 | 17 | 15.0 |
| 12. Decide whether this pull request is docs-only | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 13. Read GitHub Pages configuration | 6 | 0 | 0 | 1 | 1 | 0.2 |
| 14. Build and verify publication artifact | 6 | 0 | 0 | 17 | 17 | 5.5 |
| 15. Upload verified publication artifact | 6 | 0 | 0 | 3 | 3 | 0.8 |
| 16. Run actions/upload-artifact@v7 | 6 | 1 | 2 | 2 | 2 | 1.7 |
| 30. Post Run actions/setup-node@v7 | 6 | 0 | 0 | 1 | 1 | 0.2 |
| 31. Post Run pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 32. Post Run actions/checkout@v7 | 6 | 0 | 0 | 1 | 1 | 0.5 |
| 33. Complete job | 6 | 0 | 0 | 0 | 0 | 0.0 |

Steps of `Backend`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 6 | 0 | 1 | 2 | 2 | 1.2 |
| 2. Run actions/checkout@v7 | 6 | 1 | 1 | 4 | 4 | 1.5 |
| 3. Run actions/setup-dotnet@v6 | 6 | 3 | 4 | 12 | 12 | 6.7 |
| 4. Run dotnet restore --locked-mode | 6 | 2 | 3 | 6 | 6 | 3.7 |
| 5. Run dotnet build --no-restore -c Release | 6 | 17 | 24 | 26 | 26 | 23.0 |
| 6. Run dotnet format whitespace --verify-no-changes --no-restore | 6 | 7 | 9 | 10 | 10 | 9.0 |
| 7. EF Core model matches migrations | 6 | 4 | 5 | 6 | 6 | 4.8 |
| 8. Run dotnet test --no-build --configuration Release -- --coverage --coverage-output-format cobertura --results-directory "$GITHUB_WORKSPACE/backend/TestResults" | 6 | 26 | 29 | 32 | 32 | 29.2 |
| 9. OpenAPI contract is up to date | 6 | 0 | 0 | 1 | 1 | 0.2 |
| 10. Run actions/upload-artifact@v7 | 6 | 1 | 1 | 2 | 2 | 1.2 |
| 19. Post Run actions/setup-dotnet@v6 | 6 | 0 | 0 | 1 | 1 | 0.5 |
| 20. Post Run actions/checkout@v7 | 6 | 0 | 0 | 0 | 0 | 0.0 |
| 21. Complete job | 6 | 0 | 0 | 0 | 0 | 0.0 |

### Job durations, before (push runs)

Sample: 19 successful runs of `ci.yml` in mgasca/calendar on branch `main` created 2026-11-06T09:00:00Z..2026-11-06T16:50:00Z, 2026-11-06 10:53Z to 2026-11-06 16:27Z (events: push).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 19 | 1:26 | 1:53 | 2:10 | 2:11 |
| Docs site | 19 | 1:03 | 1:31 | 1:49 | 2:06 |
| Tooling | 19 | 1:05 | 1:19 | 1:38 | 1:49 |
| Container image | 19 | 1:02 | 1:13 | 1:43 | 1:46 |
| Frontend | 19 | 0:39 | 0:52 | 1:02 | 1:04 |
| CI result | 19 | 0:02 | 0:03 | 0:04 | 0:04 |

### Per run, after

| Run | Event | Commit | Queue s | Wall clock | Critical path | Lead s | Compute |
| --- | --- | --- | --: | --: | --- | --: | --: |
| [42285139981](https://github.com/mgasca/calendar/actions/runs/42285139981) | push | `209f497f` | 1 | 1:50 | Docs site | 8 | 6:22 |
| [42287301827](https://github.com/mgasca/calendar/actions/runs/42287301827) | push | `a0d3b4da` | 17 | 2:02 | Docs site | 14 | 6:15 |
| [42286613929](https://github.com/mgasca/calendar/actions/runs/42286613929) | dispatch | `209f497f` | 2 | 1:30 | Backend | 1 | 5:53 |
| [42286877700](https://github.com/mgasca/calendar/actions/runs/42286877700) | dispatch | `209f497f` | 2 | 1:29 | Docs site | 3 | 5:39 |
| [42287131208](https://github.com/mgasca/calendar/actions/runs/42287131208) | dispatch | `209f497f` | 2 | 1:29 | Container image | 7 | 5:35 |
| [42287647050](https://github.com/mgasca/calendar/actions/runs/42287647050) | dispatch | `a0d3b4da` | 2 | 1:45 | Backend | 19 | 5:30 |

### Per run, before: pull request runs

| Run | Queue s | Wall clock | Critical path | Lead s | Compute |
| --- | --: | --: | --- | --: | --: |
| [42252412959](https://github.com/mgasca/calendar/actions/runs/42252412959) | 3 | 1:33 | Tooling | 5 | 5:40 |
| [42252278958](https://github.com/mgasca/calendar/actions/runs/42252278958) | 25 | 2:00 | Backend | 11 | 5:57 |
| [42252010385](https://github.com/mgasca/calendar/actions/runs/42252010385) | 6 | 1:42 | Backend | 16 | 5:55 |
| [42251424380](https://github.com/mgasca/calendar/actions/runs/42251424380) | 46 | 3:35 | Backend | 85 | 7:13 |
| [42251325903](https://github.com/mgasca/calendar/actions/runs/42251325903) | 2 | 2:01 | Backend | 25 | 6:25 |
| [42251287383](https://github.com/mgasca/calendar/actions/runs/42251287383) | 2 | 1:49 | Tooling | 0 | 6:29 |
| [42250963747](https://github.com/mgasca/calendar/actions/runs/42250963747) | 7 | 2:16 | Backend | 26 | 6:39 |
| [42250595069](https://github.com/mgasca/calendar/actions/runs/42250595069) | 2 | 2:02 | Backend | 34 | 6:30 |
| [42250450796](https://github.com/mgasca/calendar/actions/runs/42250450796) | 23 | 2:20 | Backend | 40 | 6:07 |
| [42249768064](https://github.com/mgasca/calendar/actions/runs/42249768064) | 2 | 2:07 | Backend | 40 | 6:27 |
| [42249597715](https://github.com/mgasca/calendar/actions/runs/42249597715) | 3 | 1:36 | Backend | 9 | 6:01 |
| [42249053958](https://github.com/mgasca/calendar/actions/runs/42249053958) | 3 | 1:40 | Backend | 6 | 6:15 |
| [42247424766](https://github.com/mgasca/calendar/actions/runs/42247424766) | 73 | 3:20 | Backend | 35 | 6:15 |
| [42241034660](https://github.com/mgasca/calendar/actions/runs/42241034660) | 2 | 2:04 | Backend | 39 | 6:32 |
| [42238116345](https://github.com/mgasca/calendar/actions/runs/42238116345) | 2 | 2:05 | Backend | 30 | 7:01 |
| [42232495271](https://github.com/mgasca/calendar/actions/runs/42232495271) | 37 | 2:57 | Backend | 28 | 6:52 |
| [42231631493](https://github.com/mgasca/calendar/actions/runs/42231631493) | 2 | 2:12 | Container image | 9 | 7:40 |
| [42228377872](https://github.com/mgasca/calendar/actions/runs/42228377872) | 45 | 2:57 | Backend | 44 | 7:07 |
| [42227567492](https://github.com/mgasca/calendar/actions/runs/42227567492) | 2 | 2:18 | Backend | 38 | 7:28 |
| [42226423305](https://github.com/mgasca/calendar/actions/runs/42226423305) | 2 | 1:40 | Backend | 16 | 5:53 |
| [42225393302](https://github.com/mgasca/calendar/actions/runs/42225393302) | 2 | 2:04 | Backend | 33 | 6:29 |
| [42223124767](https://github.com/mgasca/calendar/actions/runs/42223124767) | 2 | 1:51 | Backend | 27 | 5:59 |
| [42222714781](https://github.com/mgasca/calendar/actions/runs/42222714781) | 2 | 2:05 | Backend | 38 | 7:01 |
| [42221514909](https://github.com/mgasca/calendar/actions/runs/42221514909) | 3 | 2:27 | Backend | 3 | 7:30 |
| [42221012801](https://github.com/mgasca/calendar/actions/runs/42221012801) | 19 | 2:12 | Backend | 31 | 6:12 |

### Per run, before: push runs on `main`

| Run | Queue s | Wall clock | Critical path | Lead s | Compute |
| --- | --: | --: | --- | --: | --: |
| [42252619372](https://github.com/mgasca/calendar/actions/runs/42252619372) | 3 | 1:53 | Backend | 16 | 6:30 |
| [42251856303](https://github.com/mgasca/calendar/actions/runs/42251856303) | 3 | 2:10 | Backend | 25 | 7:03 |
| [42250863782](https://github.com/mgasca/calendar/actions/runs/42250863782) | 2 | 2:09 | Backend | 40 | 7:01 |
| [42250077585](https://github.com/mgasca/calendar/actions/runs/42250077585) | 2 | 1:38 | Docs site | 0 | 6:23 |
| [42248273073](https://github.com/mgasca/calendar/actions/runs/42248273073) | 2 | 2:12 | Backend | 15 | 7:12 |
| [42241807049](https://github.com/mgasca/calendar/actions/runs/42241807049) | 2 | 2:18 | Backend | 38 | 7:01 |
| [42238848770](https://github.com/mgasca/calendar/actions/runs/42238848770) | 3 | 2:02 | Backend | 9 | 7:05 |
| [42234878165](https://github.com/mgasca/calendar/actions/runs/42234878165) | 2 | 1:52 | Backend | 5 | 6:45 |
| [42234042581](https://github.com/mgasca/calendar/actions/runs/42234042581) | 3 | 2:17 | Backend | 38 | 6:47 |
| [42232965801](https://github.com/mgasca/calendar/actions/runs/42232965801) | 2 | 2:14 | Docs site | 7 | 7:27 |
| [42232150491](https://github.com/mgasca/calendar/actions/runs/42232150491) | 2 | 1:42 | Backend | 6 | 6:44 |
| [42229256601](https://github.com/mgasca/calendar/actions/runs/42229256601) | 3 | 2:08 | Backend | 13 | 7:02 |
| [42225743746](https://github.com/mgasca/calendar/actions/runs/42225743746) | 2 | 2:02 | Backend | 20 | 7:02 |
| [42224880334](https://github.com/mgasca/calendar/actions/runs/42224880334) | 3 | 2:00 | Backend | 3 | 7:07 |
| [42222990828](https://github.com/mgasca/calendar/actions/runs/42222990828) | 3 | 2:00 | Backend | 13 | 6:47 |
| [42220978985](https://github.com/mgasca/calendar/actions/runs/42220978985) | 3 | 1:50 | Backend | 19 | 6:09 |
| [42215022503](https://github.com/mgasca/calendar/actions/runs/42215022503) | 3 | 1:57 | Backend | 6 | 7:30 |
| [42212527841](https://github.com/mgasca/calendar/actions/runs/42212527841) | 2 | 2:03 | Backend | 25 | 6:47 |
| [42206123786](https://github.com/mgasca/calendar/actions/runs/42206123786) | 2 | 1:32 | Backend | 4 | 6:23 |

## Reading

- **Measured: on the PR path, a run is 36 s shorter at the median, and the tail is gone.** Wall clock went from **2:05 to 1:29**, and from a p90 of 2:57 to a maximum of 1:45. Compute fell from 6:29 to 5:35. The before p90 and maximum include superseded PR runs waiting for the old run (queue up to 73 s here). Record 0008 measured that wait away; this sample has no superseded run to show it again.
- **The new critical path on the PR path: no single job.** Backend, Docs site and Container image took turns, and the critical job led the next by a median of 3 s. Before, Backend led in 22 of 25 runs, by a median of 28 s. Backend fell from 1:53 to 1:19 median (push-run job table before, every run after; its steps are the same on every event), and Tooling from 1:19 to 1:06. Container image (1:13 → 1:18) moved no more than runner noise. The next saving on the PR path would need two or three jobs shortened together. That is inferred from these medians.
- **Measured: on `main`, wall clock barely moved, and two runs are too few for a median.** The two push runs took 1:50 and 2:02, against 2:02 before; the second queued 17 s behind a dispatch. Compute fell by about 40 s (7:01 → 6:22 and 6:15). Wall clock gained little because **Docs site, with the Pages publication build (about 20 s), is now the critical path on `main`** (2 of 2). The Backend savings went under it. That build is the next lever for `main`.
- **Reconciling record 0011's Backend figures.** Record 0011 reported Backend at 1:46 on the #351 branch, against 1:26 on the #350 branch. Its five #351 runs (19:08–19:30Z) predate #350's merge at 19:42Z, so they still ran the full `dotnet format` step. The two samples, by step:

  | Backend step, median | #351 branch, 19:08–19:30Z (n=5) | #350 branch, before 19:00Z (n=5) |
  | --- | --: | --: |
  | Build (`dotnet build -c Release`) | 26 s | 24 s |
  | Format check | 27 s (full `dotnet format`) | 8 s (`dotnet format whitespace`) |
  | Job | 1:46 | 1:26 |

  The commands: `dotnet run tools/ci-timings/ci-timings.cs -- --branch ci/351-tooling-nuget-cache --created "2026-11-06T19:05:00Z..2026-11-06T19:33:00Z" --job Backend` and `-- --branch ci/350-format-whitespace-only --created "<2026-11-06T19:00:00Z" --job Backend`. The format and build steps account for 21 s of the 20 s gap. The gap is #350's saving, not a regression. With every change on `main`, Backend is 1:19.
- **Sample size:** the after samples are small, 4 dispatches and 2 pushes on one evening, against 25 and 19 runs over a working day. The PR-path medians are the comparable numbers. Differences under about 10 s are within runner noise (records 0004 and 0007).
- **CI runs used for this record:** 4 dispatches, approved on #347.

## Reconsider when

- A PR run's median rises above 1:45, or one job leads the others by more than about 20 s in most runs. That job is then the critical path again; sample with this record's commands and start there.
- The publication build changes, or pushes to `main` become noticeably slower than PR runs.
- A job is added to the run: it joins the three-way tie.

Re-run the harness commands and the lens method above, and compare; never edit this record.
