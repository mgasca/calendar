# Report template

The report is private: it may name session IDs, message indices, worker handles and local paths. Anything that goes to GitHub is derived from it in step 9 with those removed. Keep it short; a lesson a person cannot read in a minute is not yet a lesson.

```markdown
# Dream weaver report — <window start> to <window end> UTC

<One paragraph: what is new since the previous report, or `No new lessons since <previous watermark>`. Counts: N sessions in the window, N triaged, N deep-read, N lessons (by class), N drift findings, N memory actions.>

## Lessons

| # | Lesson (the rule or check) | Class | Route | Capture | Cost × recurrence | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | <imperative sentence> | missing | hook + root line | <pattern the hook catches; the one-line rule> | <lost fix; 2 sessions> | `<session id>` m<idx>–<idx>; `<session id>` m<idx> |
| 2 | … | conflicting | skill: story-draft | <which text wins and why> | … | … |

For each lesson one short paragraph: what happened, what it cost, what would have prevented it, and the capture in the exact words proposed for its route. Say "measured", "observed" or "inferred".

## Drift

- **Violations of documented rules**: <rule> is stated in <path> and was broken in `<session id>` m<idx>; <respected or worked around>. Hook candidate: yes/no.
- **Stale references**: <path or memory> names <recipe, path, version>; on main <what exists>; in this environment <what was observed, date>.

## Memory

| Memory (name) | Roots holding it | Action | Reason |
| --- | --- | --- | --- |
| <name> | <worker ids or "all 11"> | keep / point / date / delete | <what was checked> |

## Positive patterns

- <approach that worked, where it is or is not documented, proposed capture>

## Coverage

Sessions in the window: <N> (<N> top-level, <N> sub-agents; profiles: …). Triaged by signal: <N>. Deep-read: <N> (ids). Brief only: <N>. Not read: <ids and why>. Index lag: <yes/no; latest indexed session vs daemon>. Memory roots read: <N of N>. Guidance read from `origin/main` at `<sha>`.

## Watermark

`dream-weaver watermark <window end UTC> sessions=<comma-separated ids consolidated> main=<sha>`
```

## Rules for the report

- Every lesson has at least one citation that a person can open with `read_session`. No citation, no lesson: move it to "Positive patterns" as a hunch or drop it.
- A class and a route for every lesson, even when the route is "none; noise" (then it does not belong in the table).
- The coverage section is not optional. The report's value is bounded by what was not read.
- The watermark line is the last line and its format does not change, so the routine can parse it.
- Never rewrite a previous report. The next run states what changed.
