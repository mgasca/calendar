# Benchmarks

Reference measurements for performance work. A benchmark here is a repeatable harness in the code base plus a dated record of what it measured. Records are not asserted in tests or CI: timings only compare on one machine, so a record is evidence for a change, not a gate.

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
