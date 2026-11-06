# Benchmarks

Reference measurements for performance work. A benchmark here is a repeatable harness in the code base plus a dated record of what it measured. Records are not asserted in tests or CI: timings only compare on one machine, so a record is evidence for a change, not a gate. The one exception is the pinned CI baseline below ([ADR-0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md)).

## The pinned CI baseline

Being built in epic #380 (story [0034](../stories/0034-gate-ci-job-run-times-against-a-pinned-baseline.md)); until the file exists, nothing gates on time.

`.github/ci-baseline.json` is the one timing a check asserts. It holds, per CI job and path (publication, when the run built the docs publication artifact, or check), the statistics of at least 30 successful runs on `main` and the threshold derived from them; `CI result` fails a pull request whose job takes longer than its threshold, and a scheduled trend check on `main` reports smaller slowdowns as an issue. The method, the paths and the constants are in ADR-0045; the measurement and the back-test of each version of the file are in a benchmark record.

- **Never edit the file by hand.** `ci-timings baseline` writes it from the sample and constants it states.
- **A slower job that is necessary:** regenerate the file in the same PR that adds the time, and add a record here that names the change, the before and after distributions and the new thresholds. The gate reads the file from the commit under test, so the PR's own run uses the new thresholds, and the reviewer sees them in the diff.
- **Nothing else moves it:** runs on `main` never update it, so it cannot creep upward. Re-measure it when a record's reconsideration condition arrives, for example a new job or new runner hardware.
- **A failure you think is noise:** use **Re-run all jobs**. **Re-run failed jobs** repeats only `CI result` on the same durations.

## Performance issues

An issue labelled `performance` is closed on evidence, not on a merged diff.

- Before implementing, the issue states the baseline: the quantity, its value, how it was measured (CI job or step medians over a stated number of runs, or a harness run) and the commit. `just tools ci-timings` samples CI job and step durations; `just docs bench` runs the docs harness.
- The delivery PR reports the same quantity after the change on the same basis, says which numbers are measured and which inferred, and adds a record here following "Writing a record" below. A measured decision to leave code unchanged gets a record too, with its reconsideration condition.
- Close the issue only when the record is merged and the after measurement is on the issue; the story card links the record.

## Running one

`just tools ci-timings --job <name>` samples a workflow's job and step durations from the runs GitHub keeps (needs `gh` signed in) and prints the tables for a record. `just docs bench` runs the docs harness with [tinybench](https://github.com/tinylibs/tinybench) inside Vitest (`vitest.bench.config.ts`). Set `BENCH_OUT=<file>` to also write the Markdown table to a file. `just test`, `just check` and CI never run benchmarks.

## Writing a record

- Preserve measured decisions to leave code unchanged as carefully as performance fixes. Include a reconsideration condition tied to a changed workload or observed user cost. Retain harnesses and benchmark code. If an old measurement has no retained harness, record it in the relevant story with its source and missing methodology; do not create a benchmark record that implies it is repeatable. Layout-only timing does not measure rendering or interaction latency.
- Name it `NNNN-short-title.md`, the next number, title it `# NNNN Short title`, and give it YAML front matter with `subject` and `harness`. The harness must name a repository-relative file that exists.
- State what was measured and why, the commit, the machine, and how many iterations ran.
- Compare before and after in one session, alternating the two versions (A, B, A, B), because a busy machine moves absolute numbers more than a code change does. Include a control task that the change should not affect.
- Report the median of the runs and the spread, and say whether a finding is measured or inferred.
- Never rewrite an old record. Add a new one and link it, so the history stays comparable.

## Publishing

The site discovers documents from this directory and lists them in the sidebar. README files hold conventions, not inventories. Numbered documents sort by filename; runbooks sort by their `order` field. Titles and metadata come from each document. Invalid metadata, duplicate identifiers and broken publication links fail the build.
