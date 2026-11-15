---
status: planned
date: 2026-11-15
issue: https://github.com/mgasca/calendar/issues/782
pr:
  - https://github.com/mgasca/calendar/pull/943
  - https://github.com/mgasca/calendar/pull/944
adrs: ["0012", "0045", "0046", "0058"]
---

# 0066 Keep CI result from failing while the jobs API catches up

## Story

> As a maintainer, I need the required `CI result` check to fail only when a job really did not succeed, so that a pull request whose jobs all passed is not sent back for a rerun, and a new head when the branch has moved.

Tracked in issue #782.

## Background

`CI result` is the single required check ([ADR-0012](../decisions/0012-ci-and-dependency-updates.md)). Its step "All needed jobs succeeded" makes two checks. First, every job in `needs` must have succeeded, or have been skipped because the Changes job said this run does not need it ([ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md), story [0038](0038-run-ci-jobs-only-for-the-paths-they-check.md)). Second, it reads this run attempt's jobs from the GitHub jobs API and fails on any job that did not succeed. The second check was added by #368: in run 42270142424 a job that failed in "Set up job" did not show as failed in `needs`, and the gate turned green.

The jobs API is eventually consistent. The step reads it up to three times, 5 s apart, while it still shows a job as running, and then treats the last read as final: about 10 s in all. In [run 43474865497](https://github.com/mgasca/calendar/actions/runs/43474865497) (PR #743, head `cb669a806`), `Backend` finished at 17:43:04Z and `CI result`, which needs it, started at 17:43:08Z. The API still showed `Backend: in_progress null` after all three reads, so the gate exited 1 although every job it needs had succeeded. In the finished run, every job is `success` or `skipped` except `CI result`.

Every job the API lists is in `needs`, except `Cancel superseded runs`, which the check excludes and the `ci-result-needs-all` guard keeps out of `needs`. So once `needs` has passed, a job the API still shows as running has already finished; the API has not caught up. The check is also an inline `run:` script with no committed tests, the pattern [ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) rejects for its own gate.

### Agreed scope

* **A real failure still fails at once**: a job the API shows as completed with any conclusion other than `success`, or `skipped` when the Changes job did not skip it, fails the gate on the first read that shows it, as today.
* **A finished job the API still shows as running waits**: while some job is not yet `completed` in the API, the gate reads the API again every 5 s, for up to 120 s (today about 10 s). A healthy run passes on the first read, so the longer limit costs time only when the API lags.
* **Limit reached (proposed)**: when a job still shows as running after 120 s, the gate fails with a message that says the jobs API had not caught up and that a rerun is the remedy, distinct from the message for a job that did not succeed. The alternative, passing on the `needs` result with a warning, is an open question on PR 0.
* **API errors**: a read that fails is retried within the same limit; if the API cannot be read by the limit, the gate fails, as today.
* **Tested logic**: the classification of the jobs API response moves from the inline script into a jq file under `.github/`, as ADR-0045 did with `ci-gate.jq`. Committed Deno tests run that file with `jq` on canned responses, and a test checks that `ci.yml` runs it. The step keeps only the loop: read, classify, wait or stop.
* **Guards stay meaningful**: the `ci-result-needs-all` guard keeps requiring a `needs` success check and a jobs-API check, reading them where they live after the move.
* **The run-time gate is unchanged**: the ADR-0045 step still reads the last saved jobs response, `$RUNNER_TEMP/jobs.json`.

### Not in this story

* **Trusting `needs` alone**: dropping the jobs-API check would reopen #368.
* **The inverse case**: a job that failed while `needs` showed success is #368's, already fixed; this story keeps that protection.
* **Other workflows and gates**: `e2e.yml`, `ci-trend.yml` and the dashboard snapshot are not part of `CI result` and are unchanged.
* **Changing which jobs run**: the Changes rules, `ci-changes.jq` and the `needs` list are unchanged.
* **Rerunning automatically**: the gate never reruns jobs; a lag beyond the limit still needs a manual rerun.

### Acceptance criteria

1. **Given** every needed job succeeded and the jobs API shows one of them as `in_progress` on the first reads, **when** the API reports it `completed` with `success` within 120 s, **then** `CI result` passes.
2. **Given** the jobs API still shows a job as `in_progress` after 15 s of waiting, **when** the classification runs, **then** it asks to wait again rather than fail (today the gate decides after about 10 s).
3. **Given** the jobs API still shows a job as not completed after 120 s, **when** the classification runs, **then** the gate fails with a message naming the job and saying the jobs API had not caught up.
4. **Given** the jobs API shows a completed job with conclusion `failure` (or `cancelled`), **when** the classification runs on the first read, **then** the gate fails at once and names the job, without waiting.
5. **Given** a job the Changes job skipped, **when** the API shows it `skipped`, **then** it does not fail the gate; **given** a job skipped that the Changes job did not skip, **then** the gate fails.
6. **Given** `ci.yml`, **when** the tooling tests run, **then** they fail unless `CI result` runs the committed jq file on the jobs API response and the run-time gate still reads the saved response.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0012](../decisions/0012-ci-and-dependency-updates.md) | CI and dependency updates, with `CI result` as the one required check | A false failure of this check blocks every merge |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | Run-time gates in `CI result`, logic in a tested jq file, no untested inline scripts | The jobs-API check follows the same pattern and keeps feeding the gate's saved response |
| [0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) | Jobs run only for the paths they check; `CI result` accepts a skip only when Changes intended it | The classification keeps both skip exceptions exactly |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | Repository tooling and its tests on Deno | The new tests are Deno tests run by `just tools test` |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **jq, not a Deno script, in the job**: `CI result` checks out `.github/` only and installs nothing; jq is on the runner, as for `ci-gate.jq`.
* **120 s limit**: long enough to cover the lag seen in run 43474865497 many times over, short enough that a stuck API still fails the check in about two minutes. The limit is an argument to the jq file, so tests can set the waited time.
* **Fail at the limit (proposed)**: a job that still shows as running after two minutes is rare enough to deserve a human look; passing on `needs` would trust the source #368 showed can miss a failure.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| The gate step | `.github/workflows/ci.yml`, job `result`, step "All needed jobs succeeded" |
| Jobs-API classification | `.github/ci-result.jq` (new) |
| Tests | `tools/ci-timings/tests/` (new test file, next to `gate_test.ts`) |
| Guard | `tools/delivery-guards/delivery-guards.ts`, `ci-result-needs-all` |

### API

No changes.

### Testing

* Deno tests that run `.github/ci-result.jq` with `jq` on canned jobs responses for each criterion, failing (not skipping) when `jq` is missing, as `gate_test.ts` does.
* The criterion 2 test is proved to fail against today's logic.
* The workflow test reads `ci.yml`, so the file the tests run is the one CI runs.

### Lessons learned, known issues and follow-ups

* To be filled on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### When `CI result` fails

* **"The jobs API reports jobs that did not succeed"**: a job failed, was cancelled or was skipped when it should have run. Open that job's log and fix the cause.
* **"The jobs API had not caught up"**: every job finished, but GitHub still showed one as running after two minutes. Rerun the `CI result` job; no new commit is needed.
