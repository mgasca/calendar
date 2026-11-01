# Benchmarks

Reference measurements for performance work. A benchmark here is a repeatable harness in the code base plus a dated record of what it measured. Records are not asserted in tests or CI: timings only compare on one machine, so a record is evidence for a change, not a gate.

| Record | Subject | Harness |
| --- | --- | --- |
| [0001](0001-docs-parse.md) | Loading the ADRs and stories for the docs site and tests | `frontend/apps/docs/benchmarks/parse.bench.ts` |

## Running one

`just bench-docs` runs the docs harness with [tinybench](https://github.com/tinylibs/tinybench) inside Vitest (`vitest.bench.config.ts`). Set `BENCH_OUT=<file>` to also write the Markdown table to a file. `just test`, `just check` and CI never run benchmarks.

## Writing a record

- Name it `NNNN-short-title.md`, the next number, and add a row to the table above.
- State what was measured and why, the commit, the machine, and how many iterations ran.
- Compare before and after in one session, alternating the two versions (A, B, A, B), because a busy machine moves absolute numbers more than a code change does. Include a control task that the change should not affect.
- Report the median of the runs and the spread, and say whether a finding is measured or inferred.
- Never rewrite an old record. Add a new one and link it, so the history stays comparable.
