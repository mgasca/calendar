# Measuring delivery automation

How to get numbers that survive review. The benchmark-record rules in `docs/benchmarks/README.md` apply on top of these: commit, machine, iterations, median and spread, a control, A/B alternation, never rewrite an old record.

## Samples from CI history

- **Quoting.** `just tools ci-timings` splits a quoted argument, so `--job "Docs site"` arrives as two words and fails (#345). Until that is fixed, run the harness directly: `dotnet run tools/ci-timings/ci-timings.cs -- --job "Docs site"`.
- **Harness first.** `just tools ci-timings` takes successful runs only, so cancelled and failed runs don't drag the numbers. Paste its tables unchanged into the report or record. If you need something it lacks, use the same API it uses (`gh run list`, `repos/<owner>/<repo>/actions/runs/<id>/jobs`), say so, and propose the option as a follow-up. That is how `--branch` arrived, in #286, after #273 had to sample by hand.
- **Size.** For a baseline, take what history allows up to about 40 runs (#272 had 40 in 19 hours). For an after-sample, the number of runs depends on the spread: if the predicted saving is larger than the baseline's min-to-p90 range for that step, five runs show it. If it isn't, measure the changed step rather than the job, or take more runs and say why.
- **Filter by head commit, not branch.** A branch sample can include runs from before a push. Record 0007's first draft did, and the prose had to be corrected. Read `headSha` with `gh run list --json databaseId,headSha,conclusion` and keep only the commit under test.
- **Check what the window spans.** A baseline over many commits is a mixture. That's fine if none of them changed what the job consumes. Check with `git log --stat <first>..<last> -- <paths the job reads>`. If one did, split the sample.
- **Event mix.** `push`, `pull_request` and `workflow_dispatch` runs can run different steps. A `workflow_dispatch` run skips the publication build (record 0005), and a docs-only PR skips others. Report the mix, and compare like with like.

## Statistics

- Report n, min, median, p90 and max for jobs. For steps, add the mean, which shows a long tail the median hides.
- With n = 5, p90 is the maximum, and one slow runner moves the median by a lot. Record 0007's Backend median of 2:39, against 1:58 over forty runs, was one 4:56 run, not a regression. Say this whenever n is small.
- Prefer step-level comparisons for the changed step. A job adds the noise of every step the change didn't touch.
- **Bimodal samples.** Sort the durations and look for a gap. If there is one, compare a control step that the reviewed code can't affect (set-up, checkout, toolchain install) across the two clusters. If the control moves with the cluster, the cause is runner hardware or load, and you should report each cluster separately. #272's 2:48–3:35 runs were this: every content sync was about 15 s faster.

## The two lenses

- **Superseded runs.** On `pull_request`, a new push cancels the run in progress, but the new run's first job may not start until the old run's jobs, and any `if: always()` job, have stopped. Measure superseding-run creation to first-job start for these pairs. It looks like queue time but isn't runner capacity.
- **Latency:** the critical path per run, plus queue time. Get queue time from the jobs API: each job's `created_at` to `started_at`, and the run's `created_at` to the first job's start. The harness doesn't report it yet, so mark it as sampled by hand.
- **Compute:** for each run, sum its job durations, then take the median of those sums. A sum of job medians is only an approximation, and if you use one, label it as such. (#342's proposal used it: about 9:00 → about 6:30 per run.)
- A change can move the two lenses in opposite directions. Report both, every time.

## Local measurement

- Use local runs for mechanisms, CI for magnitudes. Count first (calls, files parsed, environments created), then time.
- **A/B:** alternate A, B, A, B in one session, with a control task the change shouldn't move. Size the iterations so that the slow side fits the harness timeout. In #273, 18 iterations at about 33 s each hit Vitest's 600 s limit, and that half of the table never came back.
- **Probes** (temporary counters or timers in code) go in a scratch worktree made from the reviewed commit. If you must probe in place, first copy the original file outside the checkout, restore it from that copy, and check `git status` and `git diff`. Never `git checkout --` or `git restore` to undo a probe (#189). Use absolute paths in probe commands: a carried-over `cd` made #272's first probe `cp` fail on a relative path.

## Dispatching CI for an after-sample

- Every dispatched run costs a run's worth of runner minutes, the compute lens. Say how many you plan before starting, and stop when the spread allows.
- `ci.yml`'s concurrency group (`${{ github.workflow }}-${{ github.ref }}`) keeps one pending run per ref. Dispatch the next run only after the previous one has started or finished, or it replaces the queued one. Two of #273's four parallel dispatches were cancelled this way.
- A run is done only when every check of the set is present and complete. Right after a push the list can be empty, and an empty list satisfies `all()` (#271).
- Before merging after a sample, re-read the PR head. The maintainer's "Update branch" can add a merge commit, and its checks then start again (seen on #288).
