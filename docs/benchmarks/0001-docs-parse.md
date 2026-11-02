# 0001 Loading the ADRs and stories

- **Date:** 2026-10-31
- **Issue:** [#151](https://github.com/mgasca/calendar/issues/151)
- **Harness:** `frontend/apps/docs/benchmarks/parse.bench.ts` (`just bench-docs`)
- **Baseline commit:** `9f2a444` (main after #152)

## Question

`readDocuments()` reads and validates every ADR and story. It runs in the docs tests, in the dev-server watcher and at build time. Under CPU load it made three tests time out (#151). Where does its time go, and does parsing document bodies without GFM help?

## Method

Corpus: 48 files (38 ADRs, 10 stories), 400 KB, the largest 22.5 KB. Each task runs 3 warm-up and 15 timed iterations in one Vitest worker. Four runs of the harness alternated between the old and the new `parseDocument`, on an idle 8-core WSL2 machine. The table gives the median of the 4 run means, with the lowest and highest in brackets.

## Baseline: where the time goes

Measured on the baseline commit, one run, idle machine:

| Task | mean (ms) |
| --- | ---: |
| `gray-matter`, 48 files | 1.7 |
| remark + GFM parse, 48 bodies | 1,089 |
| remark parse without GFM, 48 bodies | 518 |
| `parseLog`, 38 ADRs + index | 747 |
| `parseStories`, 10 stories + index | 264 |
| `readDocuments`, disk + both collections | 1,450 |

Parsing is the cost. File reads and front matter take a few milliseconds. GFM roughly doubles the parse cost, and `parseDocument` parses each body only to find its single `#` title, which needs no GFM. The index tables do need it.

## Change: parse document bodies without GFM

`parseDocument` uses a parser without `remark-gfm` (`titleParser` in `adr.ts`). The index parser keeps GFM.

| Task | Before: median (range) ms | After: median (range) ms | Change |
| --- | ---: | ---: | ---: |
| `parseLog`, 38 ADRs + index | 629 (600–714) | 344 (327–428) | −45% |
| `parseStories`, 10 stories + index | 215 (213–229) | 138 (122–145) | −36% |
| `readDocuments`, disk + both collections | 895 (856–911) | 505 (477–562) | −44% |
| Control: remark + GFM parse, 48 bodies | 821 (774–920) | 828 (802–975) | unchanged |

The control task does not call `parseDocument`, so it should not move, and it did not. It shows the two sets of runs were comparable.

## Reading

- Measured: loading all documents is about 45% faster, and the saving matches the parse share removed. The remaining cost is still mostly parsing the document bodies (without GFM) and the two index tables.
- Behaviour change: a title that uses GFM-only syntax, such as `~~strikethrough~~`, now stays literal in the document while the index cell (parsed with GFM) drops the marks, so the two no longer match and the load fails loudly. Plain titles and `` `code` `` are unaffected. A test pins this.
- Not measured: the effect on `astro build`, which renders every document again through its own Markdown pipeline, so the saving there is expected to be small. The effect under CPU load beyond what the issue records.

## Considered, not done

A fence-aware line scan that finds the `#` title without any Markdown parser took 0.85 ms for all 48 files (against 518 ms without GFM) and found the same title position in every file. It was not adopted: it means owning a hand-written subset of Markdown (fences, indented code, setext headings) for a saving of about 0.5 s. Revisit it if the remaining load time matters.
