# Benchmarks

Reference measurements for performance work. A benchmark here is a repeatable harness in the code base plus a dated record of what it measured. Records are not asserted in tests or CI: timings only compare on one machine, so a record is evidence for a change, not a gate.

| Record | Subject | Harness |
| --- | --- | --- |
| [0001](0001-docs-parse.md) | Loading the ADRs and stories for the docs site and tests | `frontend/apps/docs/benchmarks/parse.bench.ts` |
| [0002](0002-frontend-ci-job.md) | The Frontend CI job: job and step durations before the fixes of #272 | `tools/ci-timings/ci-timings.cs` |
| [0003](0003-docs-loader-sync.md) | One corpus read per docs-site sync instead of one per document (#273) | `frontend/apps/docs/benchmarks/parse.bench.ts` |
| [0004](0004-docs-ci-job.md) | The docs site in its own CI job (#274): job, step and critical-path durations, before #273 | `tools/ci-timings/ci-timings.cs` |
| [0005](0005-web-test-suite.md) | The web test suite: one jsdom per worker and a unit-level batching test (#275) | `tools/ci-timings/ci-timings.cs` |
| [0006](0006-web-build-without-tsc.md) | The web build step of the Frontend job without the repeated tsc -b (#276) | `tools/ci-timings/ci-timings.cs` |
| [0007](0007-frontend-ci-job-after.md) | The Frontend CI job and the whole run after the four fixes of #272 | `tools/ci-timings/ci-timings.cs` |
| [0010](0010-format-whitespace-only.md) | The Backend format check runs whitespace only (#350) | `tools/ci-timings/ci-timings.cs` |

## Performance issues

An issue labelled `performance` is closed on evidence, not on a merged diff.

- Before implementing, the issue states the baseline: the quantity, its value, how it was measured (CI job or step medians over a stated number of runs, or a harness run) and the commit. `just tools ci-timings` samples CI job and step durations; `just docs bench` runs the docs harness.
- The delivery PR reports the same quantity after the change on the same basis, says which numbers are measured and which inferred, and adds a record here following "Writing a record" below. A measured decision to leave code unchanged gets a record too, with its reconsideration condition.
- Close the issue only when the record is merged and the after measurement is on the issue; the story card links the record.

## Running one

`just tools ci-timings --job <name>` samples a workflow's job and step durations from the runs GitHub keeps (needs `gh` signed in) and prints the tables for a record. `just docs bench` runs the docs harness with [tinybench](https://github.com/tinylibs/tinybench) inside Vitest (`vitest.bench.config.ts`). Set `BENCH_OUT=<file>` to also write the Markdown table to a file. `just test`, `just check` and CI never run benchmarks.

## Writing a record

- Preserve measured decisions to leave code unchanged as carefully as performance fixes. Include a reconsideration condition tied to a changed workload or observed user cost. Retain harnesses and benchmark code. If an old measurement has no retained harness, record it in the relevant story with its source and missing methodology; do not create a benchmark record that implies it is repeatable. Layout-only timing does not measure rendering or interaction latency.
- Name it `NNNN-short-title.md`, the next number, title it `# NNNN Short title`, and add a row to the table above. The harness cell must name a file that exists in the repository.
- State what was measured and why, the commit, the machine, and how many iterations ran.
- Compare before and after in one session, alternating the two versions (A, B, A, B), because a busy machine moves absolute numbers more than a code change does. Include a control task that the change should not affect.
- Report the median of the runs and the spread, and say whether a finding is measured or inferred.
- Never rewrite an old record. Add a new one and link it, so the history stays comparable.

The documentation site publishes each record at `benchmarks/NNNN/`. The docs build fails on a record that is not in the table, a title without its number or a harness path that does not exist.
