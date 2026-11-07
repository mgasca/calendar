---
status: implemented
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/452
pr:
  - https://github.com/mgasca/calendar/pull/451
adrs: ["0038"]
---

# 0041 Run the lint recipe's checks in parallel

## Story

> As a maintainer, I need `just lint` (and so `just check`) to run its independent checks at the same time, so that I wait for the slowest check instead of the sum of all of them.

Tracked in issue #452.

## Background

`just check` is `lint` then `test`. The root `lint` recipe lists the backend lint, the frontend lint, the frontend type-check and, after `&&`, the tooling tests, the version check, the ADR check and the architecture-model check. just runs the dependencies of a recipe one after another unless the recipe carries the `[parallel]` attribute, and no recipe in the repository used it. The checks are independent: they read different trees and write different build outputs. Measured locally, `just lint` took about 72 s sequentially, while its parts took 24 to 35 s each for the four big ones.

The story is small enough that its card and the one-line change travel in the same pull request, instead of a docs-only PR 0 followed by a delivery PR.

### Agreed scope

* **Parallel lint:** the root `lint` recipe has the `[parallel]` attribute, so all of its dependencies, including the `&&` group, run concurrently.
* **Same outcome:** a failing part still fails `just lint`, and the `&&` group is skipped as before.

### Not in this story

* **`test`:** stays sequential. `frontend/AGENTS.md` warns that running full Vitest suites alongside other work can push normal tests past the 5 s timeout, and the backend tests need Docker and CPU.
* **`build` and `setup`:** stay sequential. The measured gains (about 3.6 s and 0.6 s, two runs each) do not justify interleaved output.
* **`contracts`:** must stay sequential, because `frontend::generate` reads the `contracts/openapi.json` that `backend::contract` writes.
* **Buffered output:** keeping each part's output together, as `just tools test` does for its test apps, is not done. The cost in complexity is larger than the gain.
* **CI:** CI calls module recipes, not the root `lint`, so the CI jobs and their run-time gates (ADR-0045) are not touched.

### Acceptance criteria

1. **Given** the checks are healthy, **when** I run `just lint` on the same machine with warm caches, **then** it takes clearly less time than the sequential recipe did (measured: 68.8 to 74.0 s before, 37.5 to 43.4 s after, three runs each).
2. **Given** one part of `lint` fails, **when** I run `just lint`, **then** the other running parts finish, the `&&` group does not run, the output ends with the failing recipe's name, and the exit code is non-zero (checked with a scratch justfile, not with the real recipes).
3. **Given** the change is complete, **when** I run `just check`, **then** it passes (75.9 s locally with Docker available).

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | just is the thin top-level task runner over native tooling | Parallelism comes from a just attribute, not from a wrapper script. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Attribute on `lint` only:** the measured gain is large there and within noise for `build` and `setup`. It is a one-line change that is easy to revert.
* **Interleaved output accepted:** just does not buffer per recipe. A failure still names its recipe in the last line.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| The attribute | `justfile` (root `lint` recipe) |
| Existing parallelism inside one recipe | `tools/mod.just` (`test` runs the tool test apps with `xargs -P`) |

### API

No changes.

### Testing

* No automated test covers the attribute. The measurements were taken by hand on one WSL2 machine, and the failure behaviour was checked with a scratch justfile.
* `just check` was run with the change and passed. It was not run on CI, which does not use the root `lint` recipe.
* `tools/delivery-guards` reads the backend and tools justfiles only, and its recipe parser is not affected by an attribute line above a recipe header.

### Lessons learned, known issues and follow-ups

* **Measured:** `just lint` 68.8, 74.0 and 73.1 s sequential; 43.4, 37.5 and 42.3 s parallel. Single parts: `tools::test` 34.8 s, `backend::lint` 32.6 s, `frontend::lint` 31.8 s, `frontend::typecheck` 23.7 s. One machine, three runs, so a small sample and not a CI-grade baseline.
* **Known limit:** running dotnet, ESLint and the type-checker together can oversubscribe a small machine. Set against the measured gain on this one, but not measured elsewhere.
* **Output:** the lines of different checks interleave, and dotnet lines carry no prefix.
* **Redundant work, not changed:** `backend::lint` builds the solution and `backend::test` builds it again (incrementally).

## User guide

### Running the checks

Run `just lint` for the static checks, or `just check` for everything CI runs. The static checks now run at the same time, so the output of different checks is mixed. If something fails, the last lines name the failing recipe; run that recipe alone (for example `just frontend lint`) to read its output in one piece.
