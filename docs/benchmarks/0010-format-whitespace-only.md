---
subject: "The Backend format check runs whitespace only (#350)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0010 The Backend format check runs whitespace only

- **Date:** 2026-11-06
- **Issue:** [#350](https://github.com/mgasca/calendar/issues/350), child 3 of [#347](https://github.com/mgasca/calendar/issues/347)
- **Harness:** `tools/ci-timings/ci-timings.cs`. Before: `just tools ci-timings --job Backend`, taken 2026-11-06 16:51Z (to reproduce it now, `dotnet run tools/ci-timings/ci-timings.cs -- --job Backend --created "<2026-11-06T16:45:00Z"`, run directly because the recipe does not quote its arguments, #345). After: `just tools ci-timings --branch ci/350-format-whitespace-only --job Backend`.
- **Baseline commit:** the last 40 successful runs of `ci.yml` before this change, all running `dotnet format --verify-no-changes --no-restore`
- **Measured commit:** the delivery branch of #350: `aeffd7e5` (the change at `24ea6d0c` with `main` merged in, 4 runs) and `52f2ed86` (`main` merged in again, 1 run)

## Question

After the Release build, the Backend job ran `dotnet format --verify-no-changes --no-restore`, which took slightly longer than the build itself (24 s median, against 21 s). That command runs three passes: whitespace, code style and third-party analyzers. The build already enforces code style (`EnforceCodeStyleInBuild`) and the analyzers, with warnings as errors (`backend/Directory.Build.props`). Does the full command catch anything that the build and a whitespace-only pass would miss? If not, how much does the narrower check save?

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
| parameters wrapped onto a shared line (SA1116) | fail: SA1116, S2190 | pass | fail |
| camelCase `private static readonly` field (IDE1006) | fail: IDE1006 | pass | fail |

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

Steps of `Backend`:

| Step | n | min s | median s | p90 s | max s | mean s |
| --- | --: | --: | --: | --: | --: | --: |
| 1. Set up job | 5 | 1 | 1 | 2 | 2 | 1.2 |
| 2. Run actions/checkout@v7 | 5 | 1 | 1 | 1 | 1 | 1.0 |
| 3. Run actions/setup-dotnet@v6 | 5 | 3 | 5 | 10 | 10 | 6.2 |
| 4. Run dotnet restore --locked-mode | 5 | 3 | 3 | 5 | 5 | 3.8 |
| 5. Run dotnet build --no-restore -c Release | 5 | 19 | 24 | 27 | 27 | 23.6 |
| 6. Run dotnet format whitespace --verify-no-changes --no-restore | 5 | 6 | 8 | 13 | 13 | 9.4 |
| 7. EF Core model matches migrations | 5 | 4 | 5 | 7 | 7 | 5.2 |
| 8. Run dotnet test --no-build --configuration Release -- --coverage --coverage-output-format cobertura --results-directory "$GITHUB_WORKSPACE/backend/TestResults" | 5 | 28 | 31 | 32 | 32 | 30.0 |
| 9. OpenAPI contract is up to date | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 10. Run actions/upload-artifact@v7 | 5 | 1 | 1 | 2 | 2 | 1.4 |
| 19. Post Run actions/setup-dotnet@v6 | 5 | 0 | 0 | 1 | 1 | 0.2 |
| 20. Post Run actions/checkout@v7 | 5 | 0 | 0 | 0 | 0 | 0.0 |
| 21. Complete job | 5 | 0 | 0 | 1 | 1 | 0.4 |

### Negative control (CI)

Both control branches were made from this PR's commit `f549ab20` and dispatched once each. They were deleted afterwards, and no PR was opened for them.

| Branch (head) | Broken file | Run | Backend | Failing step | `CI result` |
| --- | --- | --- | --- | --- | --- |
| `probe/350-misformatted` (`a0abad1e`) | `DateRangeWindow.cs`, one line indented 6 spaces instead of 2 | [42257973784](https://github.com/mgasca/calendar/actions/runs/42257973784) | failure | `dotnet format whitespace --verify-no-changes --no-restore` | failure |
| `probe/350-misstyled` (`cc6454cd`) | `DateRangeWindow.cs`, a private method declaring `int probe = …` | [42269590747](https://github.com/mgasca/calendar/actions/runs/42269590747) | failure | `dotnet build --no-restore -c Release` (IDE0007, S1144) | failure |

The misformatted file passed the build and failed the new whitespace step. The mis-styled file failed the build before the format step ran. Container image also failed on it, because the image build compiles the same code.

## Reading

- **Measured on the ten violations probed; inferred for the other configured rules: the full command only repeated the build for style and analyzers.** Every code-style and analyzer violation tried failed the Release build. They covered a rule set only through a `:warning` option suffix (IDE0011), a naming rule (IDE1006) and a StyleCop layout rule (SA1116), the probe of these last two run on 2026-11-06 after review on a fresh copy of the same commit. Every whitespace violation passed the build and failed `dotnet format whitespace`. No violation failed the full command without failing one of the two. The negative control shows the same on CI.
- **Measured: the format step went from 24 s to 8 s median** (15–31 s before, n=40; 6–13 s after, n=5). The Release build control was 21 s before and 24 s after, inside its before range (15–34 s). The Backend job also went from 1:52 to 1:26, but that includes #349 (PR #359, merged before these runs), which took `dotnet test` from 41 s to 31 s. The step level is therefore the measure for this change.
- **Inferred: about 16 s off Backend** on every run. #349 and #350 together brought Backend under Tooling (1:28 median on the same runs), so the Tooling job is now the critical path, as #347 predicted. #351 works on it.
- **CI runs used:** 4 `workflow_dispatch` runs of this PR's head and 2 for the negative control, plus 2 organic PR runs. One dispatch, [42270142424](https://github.com/mgasca/calendar/actions/runs/42270142424), is not in the sample: its Tooling job failed to download an action. In that run `CI result` reported success anyway, which is filed as #368.
- **Not chosen:** `dotnet format whitespace --folder` was about 4 s faster locally. Workspace mode was kept because it checks the same project documents as the old command; that `--folder` would also check files outside the projects, such as `obj/`, is inferred, not probed.

## Reconsider when

- The build stops enforcing code style: `EnforceCodeStyleInBuild` or warnings-as-errors is turned off, or a style rule is set to a severity the build does not fail on but `dotnet format style` would. The full command would then catch something again.
- A new kind of check is added that only `dotnet format` runs, for example a third-party formatter plugged into `dotnet format`.
- The whitespace step's median rises above about 15 s.

Re-run the probe with the violations above against the build and `dotnet format whitespace`, and the harness commands above; never edit this record.
