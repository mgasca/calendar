# 0012 A CI run on main after the five fixes of #347

- **Date:** 2026-11-06
- **Issue:** [#347](https://github.com/mgasca/calendar/issues/347), the closing measurement after #348 (record [0008](0008-superseded-run-wait.md)), #349 ([0009](0009-api-tests-in-parallel.md)), #350 ([0010](0010-format-whitespace-only.md)), #351 ([0011](0011-tooling-cache-and-parallel-tests.md)) and #368
- **Harness:** `tools/ci-timings/ci-timings.cs`, run directly because the recipe does not quote its arguments (#345):
  - before: `dotnet run tools/ci-timings/ci-timings.cs -- --branch main --created "2026-11-06T09:00:00Z..2026-11-06T16:50:00Z" --runs 40`;
  - after: `-- --branch main --created ">=2026-11-06T20:04:00Z" --job "Docs site" --job Backend`.
  The run-level lenses (wall clock, critical path, compute, queue) were read from the jobs API by hand, as in #347 and record 0004. The method is below.
- **Baseline:** successful push runs on `main` from 2026-11-06 10:53Z to 16:27Z, before the first child merged (#349, at 16:55Z)
- **Measured commits:** `main` at `209f497f` (the last child, #351) and `a0d3b4da` (the next commit, an agent-hooks change)

## Question

Epic #347 found a CI run on `main` or a PR taking a median of 2:10, with the Backend job the critical path in 37 of 40 runs. Superseded PR runs added a tail of up to 85 s. Five changes followed:

- the superseding run no longer waits for the old one (#348);
- API test classes run in parallel (#349);
- the format check runs whitespace only (#350);
- Tooling runs its test apps in parallel, with a NuGet cache (#351);
- `CI result` requires every needed job to succeed (#368), a correctness fix.

With all five on `main`, how long is a run now, what does it cost, and which job is the new critical path?

## Method

**Runs.** Before: the 19 successful push runs on `main` between 10:53Z and 16:27Z, before any child merged. After: every successful run on `main` from `209f497f` onward. That is two organic push runs, one on `209f497f` and one on `a0d3b4da`, plus four `workflow_dispatch` runs started one at a time, each after the previous one had finished. The maintainer approved the four dispatches on #347, because only one organic push run existed yet.

**Lenses, per run, from `GET /actions/runs/{id}/jobs`.** T0 is the run's `created_at`.

- **Queue:** T0 to the first job's start.
- **Wall clock:** T0 to the last job's end.
- **Critical path:** the job, other than `CI result` and `Cancel superseded runs`, that ends last.
- **Lead:** how much later that job ends than the next-latest.
- **Compute:** the sum of every job's start-to-end time.

Statistics are nearest-rank.

**A dispatch is not a push.** The Docs site job builds, verifies and uploads the GitHub Pages publication artifact only on a push to `main` (or for a docs-only PR). A dispatch skips those three steps, as a PR run that isn't docs-only does. So the dispatch runs stand for the PR path, and the push runs for `main`. They are reported apart. `Cancel superseded runs` is skipped on both, because it runs only for pull requests. Dispatches and pushes on `main` share one concurrency group without cancelling, so the `a0d3b4da` push run queued 17 s behind the third dispatch.

This PR also fixes the harness. The job table used to show a skipped job with a negative duration (`Cancel superseded runs` at 0:-01 on push runs). Skipped jobs are now left out, with a test that fails without the fix. Both tables below were produced with the fix.

## Results

### Before: push runs on `main`, no child merged

Sample: 19 successful runs of `ci.yml` in mgasca/calendar on branch `main` created 2026-11-06T09:00:00Z..2026-11-06T16:50:00Z, 2026-11-06 10:53Z to 2026-11-06 16:27Z (events: push).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 19 | 1:26 | 1:53 | 2:10 | 2:11 |
| Docs site | 19 | 1:03 | 1:31 | 1:49 | 2:06 |
| Tooling | 19 | 1:05 | 1:19 | 1:38 | 1:49 |
| Container image | 19 | 1:02 | 1:13 | 1:43 | 1:46 |
| Frontend | 19 | 0:39 | 0:52 | 1:02 | 1:04 |
| CI result | 19 | 0:02 | 0:03 | 0:04 | 0:04 |

Per-run lenses, n=19: wall clock **2:02** median (1:32–2:18, p90 2:17); critical path Backend in 17 runs and Docs site in 2; Backend's lead 13 s median (0–40 s); compute **7:01** median (6:09–7:30); queue 2–3 s.

### After: every successful run on `main` from `209f497f`

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

Per-run lenses:

| Run | Event | Commit | Queue s | Wall clock | Critical path | Lead s | Compute |
| --- | --- | --- | --: | --: | --- | --: | --: |
| [42285139981](https://github.com/mgasca/calendar/actions/runs/42285139981) | push | `209f497f` | 1 | 1:50 | Docs site | 8 | 6:22 |
| [42287301827](https://github.com/mgasca/calendar/actions/runs/42287301827) | push | `a0d3b4da` | 17 | 2:02 | Docs site | 14 | 6:15 |
| [42286613929](https://github.com/mgasca/calendar/actions/runs/42286613929) | dispatch | `209f497f` | 2 | 1:30 | Backend | 1 | 5:53 |
| [42286877700](https://github.com/mgasca/calendar/actions/runs/42286877700) | dispatch | `209f497f` | 2 | 1:29 | Docs site | 3 | 5:39 |
| [42287131208](https://github.com/mgasca/calendar/actions/runs/42287131208) | dispatch | `209f497f` | 2 | 1:29 | Container image | 7 | 5:35 |
| [42287647050](https://github.com/mgasca/calendar/actions/runs/42287647050) | dispatch | `a0d3b4da` | 2 | 1:45 | Backend | 19 | 5:30 |

On the two push runs, Docs site spent 20 s and 19 s in the publication steps: "Read GitHub Pages configuration", "Build and verify publication artifact" (16 s and 17 s) and "Upload verified publication artifact". The dispatch runs skipped them.

## Reading

- **Measured: the PR path is about 30 s shorter.** The dispatch runs, which take the same path as a PR run that isn't docs-only, took **1:29–1:45**, median 1:29. The before median was 2:02 for a push run, or 2:10 over #347's 40 mixed runs. Compute fell from 7:01 to 5:30–5:53. The tail that #347 found in superseded PR runs is gone (record 0008).
- **Measured: on `main`, a push run took 1:50 and 2:02** (n=2; the second queued 17 s behind a dispatch, so 1:45 from its first job), against 2:02 before. The saving on `main` is smaller, because the publication steps (about 20 s) put Docs site on top.
- **The new critical path:**
  - On pushes to `main`, it is **Docs site** (2 of 2 runs), because of the publication build.
  - On the PR path, **no single job leads**. Backend, Container image and Docs site took turns, and the critical job led the next by a median of 3 s (1–19 s, n=4). Before, Backend led in 17 of 19 runs by a median of 13 s.
  - Backend fell from 1:53 to 1:19 median, Tooling from 1:19 to 1:06; Container image (1:13 → 1:18) did not change. The next saving on the PR path would need two or three jobs shortened together. On `main`, the publication build is the next lever. Both are inferred from these medians.
- **Reconciling record 0011's Backend figures:** 0011 reported Backend at 1:46 on the #351 branch, against 1:26 on the #350 branch (1:19 when that sample had 4 runs). The five #351 runs (19:08–19:30Z) predate #350's merge at 19:42Z. So they still ran the full `dotnet format` step (27 s median, against 8 s on the #350 branch), and their build step took 26 s against 24 s. That accounts for the gap of about 20 s: it is #350's saving, not a regression. Here, with every change on `main`, Backend is 1:19.
- **Sample size:** two push runs and four dispatches on one evening, a small sample. The before sample is 19 push runs over a working day. The medians are the comparable numbers, and differences under about 10 s are within runner noise (see records 0004 and 0007).
- **CI runs used for this record:** 4 dispatches, approved on #347.

## Reconsider when

- A PR run's median rises above 1:45, or one job leads the others by more than about 20 s in most runs. That job is then the critical path again; sample with this record's commands and start there.
- The publication build is changed, or a docs-only change makes pushes to `main` noticeably slower than PR runs.
- A job is added to the run: it joins the three-way tie.

Re-run the harness commands and the lens method above, and compare; never edit this record.
