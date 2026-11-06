---
subject: "A superseding pull request run no longer waits for the old one to stop (#348)"
harness: "tools/ci-timings/ci-timings.cs"
---

# 0008 A superseding pull request run no longer waits for the old one to stop

- **Date:** 2026-11-06
- **Issue:** [#348](https://github.com/mgasca/calendar/issues/348), child 1 of [#347](https://github.com/mgasca/calendar/issues/347)
- **Harness:** `tools/ci-timings/ci-timings.cs`. Before: `dotnet run tools/ci-timings/ci-timings.cs -- --superseded --created "<2026-11-06T16:15:00Z"`, run directly because the `just tools ci-timings` recipe does not quote its arguments (#345) and the shell would read `<` as a redirection. After: `just tools ci-timings --superseded --branch ci/348-superseded-run-wait`.
- **Baseline:** pull request runs superseded from 2026-11-05 16:25Z to 2026-11-06 16:14Z, all with the `concurrency` block `main` had before this change (one group per ref, `cancel-in-progress` on `pull_request`)
- **Measured commit:** the delivery branch of #348: the workflow change at `58b93549` and five empty commits on it (`b6b864b4` to `05f28c96`), on `main` at `92c2800c`

## Question

When a push supersedes a pull request run, `concurrency` cancels the old run, and the new run queues in the same group until the old run has stopped completely. #347 measured 8 of 40 runs that queued 19–85 s before their first job. Where does that wait go? Does GitHub deliver the cancel late, or do the steps take long to honour it? And what removes it?

## Method

`--superseded` is a mode of the CI sampler, added by the same PR as this record. It lists the last 200 runs of `ci.yml` (5 × `--runs`) and pairs each cancelled `pull_request` run with the next `pull_request` run of the same branch. T0 is the moment that superseding run was created, and every time below is in seconds after T0. A pair whose old run had already ended at T0 was cancelled by hand, not superseded, so it is dropped. The jobs API gives, for each pair:

- **Wait:** T0 to the superseding run's first job starting. **All started:** T0 to the last of its first jobs starting, meaning the jobs created with the run and not `CI result`, which waits on `needs`. The two differ when jobs queue for runners.
- **Cancel heard (lower..upper bound):** when the old run's runners learned of the cancel. A runner starts a step only if it hasn't heard of the cancel, so the latest step to start after T0 in a job GitHub marked `cancelled` gives the lower bound (set-up, clean-up and skipped steps aside). The first step to end `cancelled` gives the upper bound. Either bound is missing when no step shows it. Runners of one run hear at slightly different times, so a lower bound can exceed the upper one.
- **Old jobs end** and **old run ends:** the last end of the jobs GitHub marked `cancelled`, then of any job. The difference is mostly `CI result`, which runs whatever happens (`if: always()`).
- **Control:** created → first job, and created → all first jobs started, for the last 40 successful pull request runs that superseded nothing.

The runners are GitHub-hosted `ubuntu-latest`. Statistics are nearest-rank, as in the other CI records. The harness output is pasted unchanged below. `--created` fixes the before window, so the before table can be reproduced after this PR's own runs have joined the list. The design comment on #348 quoted a hand analysis of the same window with a stricter filter: 21 pairs whose new run waited for the old run's `CI result`, median wait 67 s. The harness keeps every superseded pair, including old runs that were about to finish anyway, so its median is lower.

The after sample is the PR's own runs. The PR's first run (organic), then five empty commits, each superseding the run before it. The first came 89 s after the PR was opened, and the rest followed 36–42 s apart. That makes five pairs, from **five runs pushed only to measure**, within #348's budget of 0–6. No run was dispatched. Five pairs is a small sample, so the spread matters as much as the median.

## Results

### Before: one group per ref

Sample: 31 superseded pull request runs of `ci.yml` in mgasca/calendar created <2026-11-06T16:15:00Z, superseded 2026-11-05 16:25Z to 2026-11-06 16:14Z, and 40 pull request runs that superseded nothing.

| Seconds after the superseding run was created | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Wait: the superseding run's first job starts | 29 | 4 | 56 | 85 | 96 |
| All of the superseding run's first jobs have started | 29 | 4 | 63 | 86 | 97 |
| The old run's runners had not yet heard of the cancel (lower bound) | 28 | 9 | 38 | 64 | 72 |
| The old run's runners had heard of it (upper bound) | 25 | 3 | 45 | 69 | 74 |
| The old run's cancelled jobs end | 30 | 15 | 48 | 73 | 89 |
| The old run ends | 31 | 1 | 53 | 78 | 93 |
| Control: a pull request run that superseded nothing, created → first job | 40 | 2 | 2 | 3 | 19 |
| Control: the same runs, created → all first jobs started | 40 | 2 | 3 | 8 | 25 |

| Cancelled | Superseding | Push gap s | Wait s | All started s | Cancel heard s | Old jobs end s | Old run ends s | Not cancelled |
| --- | --- | --: | --: | --: | --: | --: | --: | --- |
| 42250213405 | 42250450796 | 91 | 23 | 23 | –..3 | 15 | 20 | Frontend success, Docs site success, Container image success, CI result failure |
| 42248152297 | 42248216342 | 26 | 77 | 78 | 42..51 | 67 | 73 | CI result failure |
| 42247379297 | 42247424766 | 18 | 73 | 74 | 48..64 | 66 | 71 | CI result failure |
| 42237120711 | 42237172093 | 20 | 80 | 81 | 57..58 | 73 | 78 | CI result failure |
| 42234017819 | 42234242027 | 94 | 75 | 76 | 48..65 | 68 | 72 | CI result failure |
| 42233945592 | 42234017819 | 29 | 71 | 72 | 40..50 | 64 | 69 | CI result failure |
| 42232334821 | 42232495271 | 65 | 37 | 37 | 12..13 | 29 | 35 | Frontend success, CI result failure |
| 42228158565 | 42228377872 | 99 | 45 | 46 | 33..– | 38 | 43 | Container image success, Tooling success, Frontend success, Docs site success, CI result failure |
| 42225322308 | 42225474787 | 68 | 85 | 86 | 64..74 | 78 | 83 | CI result failure |
| 42225240134 | 42225322308 | 37 | 64 | 66 | 40..41 | 55 | 64 | CI result failure |
| 42221971136 | 42222082775 | 47 | 55 | 56 | 27..38 | 46 | 53 | CI result failure |
| 42220866200 | 42220946959 | 40 | – | – | 38..40 | 43 | 48 | CI result failure |
| 42220410833 | 42220516389 | 49 | 50 | 50 | 23..29 | 43 | 47 | CI result failure |
| 42218764643 | 42218966200 | 93 | 44 | 45 | 32..– | 36 | 41 | Tooling success, Frontend success, Docs site success, Container image success, CI result failure |
| 42218488186 | 42218548843 | 28 | 73 | 74 | 50..58 | 66 | 71 | CI result failure |
| 42209010974 | 42209128410 | 58 | 42 | 42 | 12..26 | 34 | 39 | Frontend success, CI result failure |
| 42208679330 | 42208818482 | 65 | 36 | 37 | 9..13 | 27 | 34 | Frontend success, CI result failure |
| 42205655948 | 42205710628 | 25 | 76 | 76 | 51..58 | 68 | 74 | CI result failure |
| 42114849589 | 42114986624 | 56 | 46 | 46 | 19..30 | 37 | 43 | CI result failure |
| 42114002400 | 42114092479 | 35 | 67 | 68 | 40..46 | 59 | 65 | CI result failure |
| 42111115322 | 42111170382 | 22 | – | – | 51..69 | 71 | 78 | CI result failure |
| 42110827233 | 42111129869 | 117 | 26 | 63 | 13..– | 18 | 24 | Tooling success, Docs site success, Container image success, Frontend success, CI result failure |
| 42110826077 | 42111131037 | 118 | 23 | 25 | 12..8 | 16 | 20 | Frontend success, Tooling success, CI result failure |
| 42110826925 | 42111129458 | 117 | 4 | 4 | –..– | – | 1 | Backend success, Docs site success, Container image success, Frontend success, Tooling success, CI result success |
| 42110269656 | 42110374759 | 40 | 63 | 64 | 33..40 | 54 | 60 | CI result failure |
| 42105214940 | 42105433058 | 87 | 73 | 73 | 58..– | 63 | 70 | Frontend success, Container image success, CI result failure |
| 42089327607 | 42090312753 | 365 | 31 | 31 | 14..– | 22 | 28 | Container image success, Backend success, Tooling success, CI result failure |
| 42089292322 | 42089327607 | 14 | 90 | 91 | 64..69 | 82 | 88 | CI result failure |
| 42076258062 | 42076565186 | 116 | 51 | 52 | –..40 | 43 | 49 | Container image success, Backend success, Tooling success, CI result failure |
| 42073687328 | 42073700796 | 5 | 96 | 97 | 72..74 | 89 | 93 | CI result failure |
| 42064173036 | 42064306952 | 46 | 56 | 56 | 24..45 | 48 | 53 | CI result failure |

### After: a group per pull request run, and the `Cancel superseded runs` job

Sample: 5 superseded pull request runs of `ci.yml` in mgasca/calendar on branch `ci/348-superseded-run-wait`, superseded 2026-11-06 16:21Z to 2026-11-06 16:24Z, and 0 pull request runs that superseded nothing.

| Seconds after the superseding run was created | n | min | median | p90 | max |
| --- | --: | --: | --: | --: | --: |
| Wait: the superseding run's first job starts | 5 | 2 | 3 | 10 | 10 |
| All of the superseding run's first jobs have started | 5 | 3 | 9 | 27 | 27 |
| The old run's runners had not yet heard of the cancel (lower bound) | 5 | 2 | 4 | 20 | 20 |
| The old run's runners had heard of it (upper bound) | 5 | 6 | 13 | 32 | 32 |
| The old run's cancelled jobs end | 5 | 15 | 31 | 39 | 39 |
| The old run ends | 5 | 22 | 37 | 45 | 45 |
| Control: a pull request run that superseded nothing, created → first job | 0 | – | – | – | – |
| Control: the same runs, created → all first jobs started | 0 | – | – | – | – |

| Cancelled | Superseding | Push gap s | Wait s | All started s | Cancel heard s | Old jobs end s | Old run ends s | Not cancelled |
| --- | --- | --: | --: | --: | --: | --: | --: | --- |
| 42251903671 | 42252012000 | 42 | 10 | 24 | 15..20 | 37 | 45 | Frontend success, Cancel superseded runs success, CI result failure |
| 42251809504 | 42251903671 | 37 | 3 | 27 | 20..32 | 39 | 45 | Container image success, Frontend success, Cancel superseded runs success, CI result failure |
| 42251714929 | 42251809504 | 36 | 3 | 3 | 2..6 | 31 | 37 | Cancel superseded runs success, CI result failure |
| 42251617636 | 42251714929 | 37 | 2 | 5 | 4..6 | 30 | 36 | Cancel superseded runs success, CI result failure |
| 42251379518 | 42251617636 | 89 | 2 | 9 | 2..13 | 15 | 22 | Container image success, Docs site success, Frontend success, Cancel superseded runs success, CI result failure |

The control rows are empty because every run on the branch superseded another, or was superseded, except the last. The before control (2 s to the first job, 3 s to all first jobs) is the comparison.

The no-op case was checked by hand: run 42251379518, the PR's first run, had nothing to cancel. Its `Cancel superseded runs` job ran for 4 s with a token holding only `Actions: write` and `Metadata: read`, and logged "No older run of this branch is still in progress."

## Reading

- **Measured: GitHub delivers the concurrency cancel late.** Before, the old run's runners heard of the cancel a median of 38–45 s after T0, and as late as 72–74 s. Until then they kept starting steps: in run 42237120711, Tooling ran three more steps to success, and Container image ran its smoke test. Once the cancel arrived, the old run's jobs ended a few seconds later, or about 10 s later for a long step, which the runner stops with SIGINT, then SIGTERM 7.5 s later, then a kill 2.5 s after that. `CI result` then added about 5 s. The superseding run waited for all of it: a median of **56 s** to its first job and **63 s** until all its first jobs had started (p90 85–86 s, max 96–97 s), against 2–3 s for a run that superseded nothing.
- **Measured: after the change, the superseding run starts at once.** Its first job started after a median of **3 s** (2–10 s), and all its first jobs after **9 s** (3–27 s), over 5 pairs. The spread to 27 s comes from jobs queueing for runners, not for a group. The probe chain pushed every 36–42 s, and each push also starts CodeQL (3 jobs) and dependency review, so two or three overlapping runs competed for the account's concurrent-job limit while the old run's jobs still held runners. That cause is inferred. Under heavy contention the cancel itself waits for the new job to get a runner, and the old run holds its runners until then. In this sample the new job always started within 10 s, so that effect stayed small; "Reconsider when" watches for it. "All started" now also counts the new job, six jobs against five before, which biases the after figure slightly against the change.
- **Measured: the old run now stops sooner.** With the cancel requested through the API by the new run's job, the old run's runners heard of it after a median of 4–13 s (2–32 s), and the old run ended after a median of **37 s** (22–45 s) instead of 53 s. So the change saves runner time on superseded runs as well as wall clock. The after pushes came closer together than the before median (36–42 s, one at 89 s, against 49 s), and an old run near its end stops by itself. So the fairer comparison is with the six before rows whose pushes were 35–47 s apart: there the old run ended after a median of 53 s and the wait was 63 s. Inferred: about 16 s less on each of the old run's jobs still running at T0, minus about 4 s for the new job on every pull request run. The repository is public, so standard runners cost nothing; on a private one, each extra job would bill a whole minute.
- **Measured: a cancelled run still never reports success for the commit being checked.** `CI result` of each of the five cancelled runs concluded `failure`, because the job keeps `if: ${{ always() }}`. The issue's candidate `if: ${{ !cancelled() }}` would have saved only that job's 5 s. It also opens a hole: GitHub counts a job skipped by its `if` as passing a required check, and `CI result` is the only check that ruleset 25881041 requires. One before row, 42110826925, shows a run marked cancelled with `CI result success`. That run finished within a second of T0, and its commit was already outdated, so it could not satisfy the check for the PR's head.
- **Not changed:** fork pull requests keep the per-ref group and its cancel (their token cannot cancel runs), as do pushes to `main`, `merge_group` and `workflow_dispatch`. `codeql.yml` has the same `concurrency` pattern, so a superseding CodeQL run still waits; that is outside #348. One side effect: two same-repository pull requests from the same head branch into different bases (X → main and X → another branch) now cancel each other's runs, where before they were in separate groups. That blocks a merge until a re-run; it never lets one through.
- **Push batching:** pushes in the before pairs were a median of 49 s apart (5–365 s). With the wait gone, a quick second push costs only the cancelled run's runner time, so #348's batching follow-up was not filed.

## Reconsider when

- The superseding run's "All started" median rises above about 30 s on organic traffic. Runners would then be the bottleneck, and batching pushes, or fewer jobs per push, would be the next lever.
- The old run's "old run ends" median rises toward the before value of 53 s, or `Cancel superseded runs` warns or fails repeatedly. The API cancel would then not be landing.
- GitHub starts delivering concurrency cancels within a few seconds, in which case one group per ref is simpler again, or fork pull requests become common, since they still wait.

Re-run the two harness commands above and compare; never edit this record.
