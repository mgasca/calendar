# 0003 One corpus read per docs sync

- **Date:** 2026-11-05
- **Issue:** [#273](https://github.com/mgasca/calendar/issues/273)
- **Harness:** `frontend/apps/docs/benchmarks/parse.bench.ts` (`just docs bench`), task "loader sync, every entry rendered with link rewriting"
- **Baseline commit:** `2228eea5` (main after #280); the change is the commit of PR #273 on top of it

## Question

Record 0002 showed four Astro content syncs of 48–50 s each in the Frontend CI job. A probe (on the issue) found that one `astro sync` called `readDocuments()` 110 times: once from the loader and once per rendered document from the `remarkDocLinks` plugin, which was given `documentRoutes` as a function and awaited it on every file. How much does computing the route map once per sync save, in the loader and end to end?

## Change

`documentRoutes()` caches its promise, and the loader's `sync()` primes that cache from the one corpus read it already makes before rendering the entries, so a build or `astro check` reads the corpus once. `resetDocumentRoutes()` forgets the cache; the dev watcher's resync primes it again. A test (`docs-loader.test.ts`) loads the collection through a stand-in context with the real remark plugin and asserts one directory listing of `docs/decisions/`; against the old loader it fails with 111.

## Method

Two measurements on one machine (12 × Intel Core 7 150U, WSL2, Node 24.22.2) in one session, while two other sessions ran builds and tests on the same machine, so the spread is wide.

1. **Harness** (`just docs bench`): a new task runs the whole loader against a stand-in context whose `renderMarkdown` parses each body and runs `remarkDocLinks` with `documentRoutes`, like `astro.config.ts`; 15 timed and 3 warm-up iterations. The control is the existing `remark + GFM parse` task, which the change does not touch. The task was run twice on the fixed loader. **On the old loader it does not complete**: 18 iterations at about 33 s each exceed the harness's 10-minute budget (`vitest.bench.config.ts`), so there is no harness number for the old loader; the test above and the end-to-end measurement stand in for it.
2. **End to end**: `astro sync` from a clean `.astro/` with the two versions of `docs-loader.ts` swapped in alternation (fixed, fixed, old, old, fixed, fixed, old, old), reporting Astro's `[types] Generated` time. The old version was the committed file plus a no-op `resetDocumentRoutes` so the harness compiles.

Corpus: 69 ADRs and stories (731 KB) plus runbooks, benchmarks and the CALM model; 110 entries rendered.

## Results

Harness, fixed loader (mean / p50 / p99 ms):

| Task | Run 1 | Run 2 |
| --- | ---: | ---: |
| loader sync, every entry rendered with link rewriting | 1,218 / 1,158 / 1,691 (±9%) | 1,345 / 1,226 / 2,216 (±17%) |
| readDocuments, disk + both collections | 478 / 472 / 557 (±5%) | 560 / 524 / 799 (±12%) |
| Control: remark + GFM parse, 69 bodies | 841 / 790 / 1,087 (±9%) | 657 / 646 / 730 (±3%) |

End to end, `astro sync` `[types] Generated`:

| Version | Runs (s) | Median (s) |
| --- | --- | ---: |
| Fixed | 4.95, 5.10, 3.59, 3.64 | 4.3 |
| Old | 33.4, 37.0, 39.0, 100.3 | 38.0 |

The 100 s run coincided with a sibling session's full build; it is kept as the spread, not discarded.

## Reading

- Measured: one sync goes from a median of 38 s to 4.3 s on this machine, about 9×. The remaining 4 s is Astro's own work (dependency optimisation, type generation) plus one corpus read (about 0.5 s) and the rendering of 110 entries (about 0.7 s in the harness).
- Measured: a full loader load now costs about 1.2 s in the harness, of which the corpus read is about 0.5 s; before, the same load re-read the corpus 109 more times (about 33 s).
- Inferred for CI: the four steps of the Frontend job that each hold one sync (record 0002: 48, 48, 50 and 50 s medians) should each drop by about 40 s, about 160 s off the job's 268 s median. The CI numbers after the change belong to the PR and the next record from `tools/ci-timings`.
- The control moved between runs (841 → 657 ms mean) by more than the change could explain, which shows the machine was not idle; the loader task moved the other way by a smaller amount, so the fixed-loader numbers are a range, not a point.

## Reconsider when

The remark plugin needs per-document data that the one route map does not hold (it would have to be derived from the same read, never from another `readDocuments()`), or the dev watcher shows stale links after a document is added or renamed (the resync should prime the cache; a stale map means the reset was skipped).
