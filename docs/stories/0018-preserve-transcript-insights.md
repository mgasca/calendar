---
status: implemented
date: 2026-11-02
issue: https://github.com/mgasca/calendar/issues/193
pr:
  - https://github.com/mgasca/calendar/pull/201
  - https://github.com/mgasca/calendar/pull/202
  - https://github.com/mgasca/calendar/pull/203
  - https://github.com/mgasca/calendar/pull/205
  - https://github.com/mgasca/calendar/pull/208
  - https://github.com/mgasca/calendar/pull/204
  - https://github.com/mgasca/calendar/pull/206
  - https://github.com/mgasca/calendar/pull/207
adrs: ["0012", "0016"]
---

# 0018 Preserve transcript insights in agent guidance

## Story

> As a calendar maintainer, I need lessons from agent sessions preserved in shared guidance, so that later work does not repeat avoidable failures.

Tracked in [epic #193](https://github.com/mgasca/calendar/issues/193).

## Background

A transcript audit found six reusable lessons and gaps between private memory and merged agent instructions. It compared main at `47047daa` with nine substantive indexed sessions in the 20-hour window ending about 23:38 UTC on 2026-11-02. Indexed history can lag live sessions.

This extends the performance lessons in [0015](0015-backend-performance-review-closeout.md) and the drafting conventions reviewed by [0009](0009-review-drafting-skills-for-clarity-and-simplicity.md). The latter remains independently planned; this story does not claim to complete that review. Existing architecture colour details remain in [0016](0016-colour-the-architecture-flow-diagrams-by-ownership.md).

### Agreed scope

* **Separate delivery:** one enhancement child and delivery PR per insight. Work began with 1, 2, 4 and 6; review and merge order varied. The front matter records delivery order.
* **Reusable guidance:** preserve fixes during experiments (#194), isolate runtime resources (#195), coordinate story numbers (#196), verify delivery after merges (#197), report validation scope (#198), and retain evidence for rejected optimisations (#199).
* **Memory coverage:** reconcile optional issue-handover preferences, public redaction and question placement; keep local scheduler details local and retire stale environment claims (#200).
* **Honest evidence:** distinguish historical reports from new measurements, and documentation checks from demonstrated agent behaviour.

### Not in this story

* Application behaviour, default database provisioning, new dependencies or changes to accepted ADRs.
* Implementing or merging the separate browser-skill proposal (#190), or the sweep/close-out proposal (#168).
* Running a new performance comparison or claiming an unavailable historical harness is reproducible.

### Acceptance criteria

1. **Given** a temporary negative test, **when** an agent restores the intended fix, **then** the guidance requires preserving that version and checking the final tree before publication.
2. **Given** concurrent worktrees, **when** an agent starts or cleans up runtime services, **then** the guidance distinguishes shared defaults from explicitly isolated resources.
3. **Given** parallel story PRs, **when** a number is chosen or collides, **then** the drafting skill describes coordination, rechecking and complete renumbering without promising atomic reservation.
4. **Given** a PR has merged, **when** further changes or close-out are requested, **then** the guidance requires checking main's content and using a new PR for additional work.
5. **Given** local or CI verification passes, **when** results are reported, **then** the guidance requires identifying the tree, configuration and files covered, including skipped or undiscovered tools.
6. **Given** an optimisation is rejected on measurement, **when** the issue closes, **then** its durable record preserves provenance, limits and reconsideration conditions.
7. **Given** each memory coverage note, **when** reconciliation is complete, **then** the card records its destination or why it remains local, and optional workflow rules remain optional.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0012](../decisions/0012-ci-and-dependency-updates.md) | GitHub Actions CI | Required checks remain the merge gate; local evidence does not replace them. |
| [0016](../decisions/0016-local-database-provisioning.md) | Compose and Testcontainers | Runtime guidance preserves ordinary development defaults and isolated test databases. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **One epic card:** the children are delivery units of this shared agent-guidance story, each with its own PR.
* **Public provenance:** use issue/PR links and repository-relative paths; omit private transcript handles and absolute machine paths.
* **Historical evidence:** retain the layout measurement in this card with its gaps, rather than invent a repeatable benchmark record.

## Implementation notes

The six insights have separate guidance PRs, with memory reconciliation in a seventh. No runtime code, dependencies, endpoints or default provisioning changed. PR #207 also completes this card and the epic.

### Where things live

| Area | Location |
| --- | --- |
| General agent guidance | `AGENTS.md` |
| Drafting and delivery guidance | `.claude/skills/story-draft/SKILL.md`, `.claude/skills/adr-draft/SKILL.md` |
| Benchmark conventions | `docs/benchmarks/README.md` |
| Durable outcomes and evidence | This card |

### API

No changes.

### Testing

Docs corpus tests and the built site check card structure, index agreement and links. Guidance semantics are reviewed manually; these checks cannot prove that future agents follow instructions. Each delivery records its checks and limitations. Full CI remains required before merge.

### Lessons learned, known issues and follow-ups

### Delivery and acceptance evidence

| Criterion / child | Delivery | Evidence and limits |
| --- | --- | --- |
| 1 / #194 | [#202](https://github.com/mgasca/calendar/pull/202) | Manually reviewed the negative-control and final-restoration procedure in AGENTS.md against #189. No automatic test proves future agent compliance. |
| 2 / #195 | [#203](https://github.com/mgasca/calendar/pull/203) | Manually checked Compose project/volume/port defaults, the justfile migration port and Vite proxy configuration. No runtime isolation experiment or database reset performed. |
| 3 / #196 | [#206](https://github.com/mgasca/calendar/pull/206) | Manually reviewed story-draft coordination and collision recovery against #166, #167 and #188. It explicitly does not promise atomic reservation. |
| 4 / #197 | [#204](https://github.com/mgasca/calendar/pull/204) | Manually reviewed merge-boundary guidance against #180/#186. Squash-merge verification checks content rather than original commit ancestry. |
| 5 / #198 | [#207](https://github.com/mgasca/calendar/pull/207) | Manually checked analyzer configuration and tool discovery against the repository. The historical #190 coverage gap was fixed independently in #209; the general lesson remains. |
| 6 / #199 | [#205](https://github.com/mgasca/calendar/pull/205) | Historical #48 report transcribed below with provenance, sampling, limits and reconsideration conditions. Not rerun; no new benchmark harness. The reviewer added the explicit instruction to retain harnesses and benchmark code. |
| 7 / #200 | [#208](https://github.com/mgasca/calendar/pull/208) | Manual cross-check of all three memory notes and drafting skills; dispositions below. Local timer state and Node version observed directly on 2026-11-03. |
| 8 / checks | Each linked PR | Required CI gates delivery. Local docs corpus tests and site build/post-build checks validate the card and links. Full just check was not run locally for these documentation-only changes. |

The [docs corpus tests](../../frontend/apps/docs/src/lib/corpus.test.ts) and [publication checks](../../frontend/apps/docs/tests/build.test.ts) cover card structure, index agreement and published links. They do not test guidance semantics or historical timing. No application regression tests were added for reversible prose edits.

### Memory coverage disposition

| Note | Disposition |
| --- | --- |
| Cards, PR sequencing and decision trails | Already in AGENTS.md; retained rather than duplicated. |
| Optional handover activation and human/agent attribution | AGENTS.md scopes the mode explicitly. Terminal versus quoted footers are a heuristic; ambiguous attribution requires clarification. |
| Comment/review channels and watching | AGENTS.md covers IDs, seen-state, empty review wrappers, requested cadence and direct checks if PR binding fails. No new monitor was deployed. |
| Questions, substantive progress, counts and model attribution | AGENTS.md records separate question comments, substantive-only progress, requested numbers-only counts and model-switch disclosure. Both drafting skills defer to the optional mode; agreed answers remain in cards/ADRs. |
| Resume events, stacked squash merges and close-out | AGENTS.md records the next authorized action, content verification, union of PR links and task-owned cleanup, without blanket merge permission. |
| Reopened decision drivers | General rule added to AGENTS.md; the specific task-runner example stays in story 0011. |
| Public GitHub redaction | AGENTS.md excludes private handles and absolute machine paths, and requires editing accidental disclosures in place. |
| Scheduler and recovery | Retained in dated local operations memory. The installed timer was disabled/inactive on 2026-11-03; configured cadence is six-hourly UTC with up to five minutes of jitter and catch-up enabled. No scheduler state changed or new sweep executed. |
| Stale Node 22 / make limitation | Removed from active local memory. Node 24.22.2 was observed and docs builds passed in this environment; future sessions must re-probe capabilities. |

Local workflow/redaction memories now point to merged guidance rather than maintaining competing instructions. Operational paths and transcript identifiers stay private. The independent browser-skill work (#190/#209) and sweep/close-out proposal #168 are outside this epic, not deferred delivery here.

### Historical evidence: decision not to optimise grid layout (#199)

The [original measurement on #48](https://github.com/mgasca/calendar/issues/48#issuecomment-6589857088) reports `layoutDay`, `layoutAllDay` and `eventSpan` at main revision `15cf7d3f`. A throwaway Vitest file timed fully overlapping items with one worker, Node 24.22.2 and a 12-core Intel Core 7 150U, with nothing else running. Each result was a median of 11 iterations (5 at 5,000 items); the ranges below are from two separate runs, not confidence intervals.

| Items | Day: identical spans (ms) | Day: staggered starts (ms) | All-day: week-long bars (ms) | eventSpan alone (ms) |
| --- | --- | --- | --- | --- |
| 100 | 0.5 | 0.5 | 0.2–0.5 | 0.6 |
| 1,000 | 6.6–7.6 | 7.3–8.9 | 4.3–4.5 | 4.3–5.2 |
| 5,000 | 89–95 | 35–38 | 57–63 | 20–24 |

These are **historical reported measurements**, not results reproduced for this story. The harness and raw samples were not retained; exact input generation, warm-up and timing boundaries cannot be independently checked from the report. The source described the time-zone conversion as more than half the 1,000-item cost. The separately measured `eventSpan` values suggest a substantial cost but are not an additive profile of each layout run.

The issue closed without changing the algorithm. The source also noted memoization from #65: layout runs when events, window or zone change. This evidence supports the decision for the sampled workload; it does not establish that every real calendar stays below 5,000 items or that a browser frame completes within 16 ms. React, DOM, painting, device differences and interaction latency were not measured.

**Reconsider when** users report sluggish dense calendars, supported workloads grow substantially, or memoization/time-zone processing changes. First reproduce with a retained harness on representative hardware and measure browser interaction separately. If slot assignment is then material, compare the proposed occupied-slot/free-index heaps against the existing lowest-free-slot behaviour and retain a control measurement. Follow the [benchmark conventions](../benchmarks/README.md) for new measurements; no algorithm or new benchmark harness was added here.

**Validation:** manually compared this transcription with the linked issue comment and reviewed the limits above. Docs corpus/build checks validate structure and links, not the historical timings or future agent compliance.

## User guide

Open **Transcript Insights** to follow each enhancement and its review. Read this card for the lasting outcomes and the limits of the evidence. Use the normal development setup for ordinary work; concurrent isolated environments must identify their own resources before starting or cleaning up.

