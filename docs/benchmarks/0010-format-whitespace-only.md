# 0010 The Backend format check runs whitespace only

- **Date:** 2026-11-06
- **Issue:** [#350](https://github.com/mgasca/calendar/issues/350), child 3 of [#347](https://github.com/mgasca/calendar/issues/347)
- **Harness:** `tools/ci-timings/ci-timings.cs`. Before: `just tools ci-timings --job Backend`, taken 2026-11-06 16:51Z. After: `just tools ci-timings --branch ci/350-format-whitespace-only --job Backend`.
- **Baseline commit:** the last 40 successful runs of `ci.yml` before this change, all running `dotnet format --verify-no-changes --no-restore`
- **Measured commit:** MEASURED

## Question

After the Release build, the Backend job ran `dotnet format --verify-no-changes --no-restore`, which took as long as the build itself (24 s median). That command runs three passes: whitespace, code style and third-party analyzers. The build already enforces code style (`EnforceCodeStyleInBuild`) and the analyzers, with warnings as errors (`backend/Directory.Build.props`). Does the full command catch anything that the build and a whitespace-only pass would miss? If not, how much does the narrower check save?

## Method

**Coverage, local.** The probe ran on an extracted copy of `main` at `92c2800c` (no git worktree), with .NET SDK 10.0.403 on a WSL2 workstation. One violation at a time went into `backend/src/Calendar.Domain/Time/DateRangeWindow.cs`. For each, three commands ran: `dotnet build --no-restore -c Release`, `dotnet format whitespace --verify-no-changes --no-restore` and the full step. The file was restored between violations, and the copy was rebuilt clean at the end.

**Duration, local.** On the same clean copy after a Release build, five variants ran in three interleaved rounds: the full step, `whitespace`, `whitespace --folder`, `style` and `analyzers`. Wall clock was taken with `date`.

**Duration, CI.** The format step's duration comes from the CI sampler, on GitHub-hosted `ubuntu-latest`, nearest-rank. Before: the last 40 successful runs. After: the PR's own runs. The Release build step is the control, because the change should not move it. The step changes its name with its command, so the before and after rows have different names.

**Negative control.** Two short-lived branches on top of this change, each with one broken file, ran CI through `workflow_dispatch`. One had a misformatted file, the other a mis-styled one. Both branches were deleted afterwards. See Results.

## Results

### Coverage (local)

| Violation | `dotnet build -c Release` | `format whitespace` | full `dotnet format` |
| --- | --- | --- | --- |
| none (control) | pass | pass | pass |
| wrong indentation | pass | fail | fail |
| missing final newline | pass | fail | fail |
| CRLF line endings | pass | fail | fail |
| trailing whitespace | pass | fail | fail |
| `int x = …` (IDE0007) | fail: IDE0007 | pass | fail |
| `if (x) return;` (IDE0011) | fail: IDE0011, S3626 | pass | fail |
| unused `using` (IDE0005) | fail: IDE0005 | pass | fail |
| `s.Contains("b")` (CA1307) | fail: CA1307, CA1847 | pass | fail |

### Duration (local, seconds, rounds 1 / 2 / 3)

| Command | Round 1 | Round 2 | Round 3 |
| --- | --: | --: | --: |
| `dotnet format --verify-no-changes --no-restore` (before) | 30.9 | 34.0 | 30.0 |
| `dotnet format whitespace --verify-no-changes --no-restore` (after) | 7.5 | 9.3 | 7.2 |
| `dotnet format whitespace --folder --verify-no-changes .` | 3.3 | 4.6 | 3.2 |
| `dotnet format style --verify-no-changes --no-restore` | 18.4 | 18.3 | 16.3 |
| `dotnet format analyzers --verify-no-changes --no-restore` | 28.3 | 26.9 | 25.7 |

### Before (CI)

Sample: 40 successful runs of `ci.yml` in mgasca/calendar, 2026-11-06 14:14Z to 2026-11-06 16:41Z (events: pull_request, push, workflow_dispatch).

| Job | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Backend | 40 | 1:13 | 1:52 | 2:04 | 2:35 |
| Tooling | 40 | 0:59 | 1:17 | 1:38 | 1:43 |
| Docs site | 40 | 0:48 | 1:14 | 1:36 | 2:06 |
| Container image | 40 | 0:58 | 1:13 | 1:27 | 2:05 |
| Frontend | 40 | 0:39 | 0:53 | 1:00 | 1:40 |
| CI result | 40 | 0:02 | 0:03 | 0:04 | 0:04 |
| Cancel superseded runs | 2 | 0:03 | 0:03 | 0:07 | 0:07 |

Steps of `Backend`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 40 | 0 | 1 | 2 | 2 | 1.1 |
| 2. Run actions/checkout@v7 | 40 | 1 | 1 | 2 | 4 | 1.2 |
| 3. Run actions/setup-dotnet@v6 | 40 | 3 | 6 | 8 | 14 | 6.3 |
| 4. Run dotnet restore --locked-mode | 40 | 2 | 4 | 6 | 11 | 4.3 |
| 5. Run dotnet build --no-restore -c Release | 40 | 15 | 21 | 26 | 34 | 21.8 |
| 6. Run dotnet format --verify-no-changes --no-restore | 40 | 15 | 24 | 30 | 31 | 23.6 |
| 7. EF Core model matches migrations | 40 | 3 | 4 | 7 | 9 | 4.7 |
| 8. Run dotnet test --no-build --configuration Release -- --coverage --coverage-output-format cobertura --results-directory "$GITHUB_WORKSPACE/backend/TestResults" | 40 | 24 | 41 | 48 | 49 | 39.9 |
| 9. OpenAPI contract is up to date | 40 | 0 | 0 | 0 | 1 | 0.1 |
| 10. Run actions/upload-artifact@v7 | 40 | 0 | 1 | 2 | 3 | 1.4 |
| 19. Post Run actions/setup-dotnet@v6 | 40 | 0 | 0 | 1 | 1 | 0.3 |
| 20. Post Run actions/checkout@v7 | 40 | 0 | 0 | 1 | 1 | 0.2 |
| 21. Complete job | 40 | 0 | 0 | 0 | 1 | 0.1 |

### After (CI)

AFTER

### Negative control (CI)

NEGATIVE

## Reading

READING

## Reconsider when

RECONSIDER
