---
status: planned
date: 2026-11-02
issue: https://github.com/mgasca/calendar/issues/193
pr: [https://github.com/mgasca/calendar/pull/201]
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

* **Separate delivery:** one enhancement child and delivery PR per insight, in order 1, 2, 4, 6, 3, 5; memory coverage follows.
* **Reusable guidance:** preserve fixes during experiments (#194), isolate runtime resources (#195), coordinate story numbers (#196), verify delivery after merges (#197), report validation scope (#198), and retain evidence for rejected optimisations (#199).
* **Memory coverage:** reconcile optional issue-handover preferences, public redaction and question placement; keep local scheduler details local and retire stale environment claims (#200).
* **Honest evidence:** distinguish historical reports from new measurements, and documentation checks from demonstrated agent behaviour.

### Not in this story

* Application behaviour, default database provisioning, new dependencies or changes to accepted architecture decisions.
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

### Architecture Decision Records

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

*Planned. This section is completed as the story is built.*

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

The epic records the audit evidence and all seven enhancement children. Delivery notes will be added per child. No child is complete merely because its instructions have been proposed.

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

*Planned behaviour. This section is finalised when the story is implemented.*

Open **Transcript Insights** to follow each enhancement and its review. Read this card for the lasting outcomes and the limits of the evidence. Use the normal development setup for ordinary work; concurrent isolated environments must identify their own resources before starting or cleaning up.

