---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/325
pr:
  - https://github.com/mgasca/calendar/pull/326
  - https://github.com/mgasca/calendar/pull/327
adrs: ["0042"]
---

# 0028 Coordinate epic delivery across agent sessions

## Story

> As a maintainer, I need a coordinator that launches and steers delivery sessions for an epic and tells me when to act, so that I can finish the epic without restarting workers or reconstructing its delivery state myself.

Tracked in issue #325.

## Background

The first dream-weaver report in [story 0025](0025-consolidate-what-agent-sessions-learned-into-guidance.md) produced an epic whose monitoring session grouped ten children into five delivery sessions by overlapping files. That session surfaced useful decisions and delivery milestones, but left worker restarts to the maintainer and repeated unchanged reminders. The maintainer requested a reusable skill and a refined invocation prompt based on its full transcript.

The maintainer also clarified that they intentionally used GitHub's native stacked PR feature to merge from the top. Historical immediate bases and grouped merge events must not be treated as proof of accidental folding. This story adds an epic coordinator alongside the existing issue-handover skill from [story 0020](0020-restructure-agent-guidance.md); it does not refactor that protocol. The separate handover refactoring work is tracked in issue #318 and its children.

### Agreed scope

* **Active coordination:** launch and steer independent delivery sessions and maintain issue/PR tracking within the accepted epic scope. The maintainer approves scope changes and performs merges.
* **Work grouping:** use file overlap, dependencies and existing workers to assign ownership; do not fix the number at five or start duplicate workers.
* **Visible dependencies:** publish and maintain a Mermaid dependency map on the epic issue. When there are multiple dependent delivery paths, highlight the critical path with bold arrows, including ties; explain duration estimates or label an equal-duration longest-chain assumption as provisional. Added by maintainer review on PR #327.
* **Shared instructions:** one repository skill and refined prompt usable by Claude Code and Codex/Mjolnir, with capability checks and honest reporting when a launch or watch requires user action.
* **Actionable notifications:** reconcile every five minutes; notify only for maintainer actions or significant milestones, in Item / Change / State / Action tables. Keep unchanged reminders quiet.
* **Native stack awareness:** distinguish native stacks from ordinary branch chains, recognise intentional top-of-stack group merges, assess current checks in trunk context, and verify final content and issue bookkeeping before diagnosing a gap.
* **Verified finish:** stop epic monitoring after accepted delivery, delivered-revision checks, issue bookkeeping and the story record are complete; report related unfinished work separately.

### Not in this story

* Implementing a new scheduler, watch tool, API integration or runtime dependency.
* Refactoring issue-handover, agent hooks or the work proposed in #318 and its children.
* Authorising coordinator merges, unapproved product scope changes or edits to another worker's unrelated resources.
* Installing personal skills or changing global agent settings.

### Acceptance criteria

1. **Given** an epic with overlapping files and active workers, **when** the coordinator plans delivery, **then** it assigns non-duplicated ownership and self-contained worker briefs without assuming a fixed session count.
2. **Given** an authorised worker that stops before delivery, **when** its PR needs routine conflict repair, **then** the coordinator steers that worker directly where tools allow it and leaves scope decisions and merges to the maintainer.
3. **Given** routine pending checks or unchanged reminders, **when** a five-minute reconciliation runs, **then** it stays quiet unless a maintainer action or significant milestone changes, using the agreed table when it notifies.
4. **Given** a native stack merged from its top, **when** intermediate events mention historical parent bases, **then** the coordinator waits for stack reconciliation and verifies trunk delivery rather than reporting an accidental merge.
5. **Given** a new PR head without checks, **when** the previous head was green, **then** the new head remains pending until its applicable checks are verified.
6. **Given** completed epic requirements, checks, tracking and story evidence, **when** related follow-up issues remain open outside scope, **then** the coordinator reports them separately and stops the epic watch with an explicit Remaining line.
7. **Given** the skill package, **when** its instructions and refined prompt are validated, **then** its references resolve and its behaviour is consistent across the supported agent environments without assuming unavailable tools.
8. **Given** an epic with multiple dependent delivery paths, **when** the coordinator publishes its dependency map, **then** the epic issue contains a Mermaid flowchart with bold critical-path arrows and an explicit estimate basis or provisional equal-duration assumption.
9. **Given** the change is complete, **when** I run `just check`, **then** it passes.

Criteria 1 and 7 were checked by reading the [skill](../../.claude/skills/epic-delivery/SKILL.md) and [refined prompt](../../.claude/skills/epic-delivery/references/coordinator-prompt.md), validating the skill package and resolving its two local references. Criteria 2–6 were exercised in an independent read-only scenario evaluation: a stopped worker with a conflicting PR, a new head without checks, a native top-of-stack merge followed by stale issue tracking, and completed epic work with an unrelated follow-up. The evaluator correctly steered the existing worker, kept pending CI quiet, waited for stack reconciliation, and stopped the completed epic's watch. This was simulated decision testing, not live orchestration or an actual stack merge. Criterion 8's diagram instructions are checked by source review and a read-only dependency-map scenario; no live epic issue is edited during that evaluation. Criterion 9's final-revision results are recorded in the delivery PR; targeted skill checks alone do not establish it.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope | This coordination procedure belongs in an on-demand skill and supporting references, not root guidance or a new tool. |

No new ADR is expected. The user explicitly requested support for Claude Code and Codex/Mjolnir; the separate proposed Claude-first story does not change this story's agreed scope.

### Other decisions (not ADR-worthy)

* **Active coordinator:** the maintainer chose launch/steer/tracking authority instead of the original notification-only role.
* **Five-minute reconciliation:** the maintainer selected actionable milestone notifications rather than a report on every change.
* **Source-backed stack reference:** preserve GitHub's native stack semantics and distinguish them from conventional branch-chain behaviour.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Coordinator skill | `.claude/skills/epic-delivery/SKILL.md` |
| Refined prompt | `.claude/skills/epic-delivery/references/coordinator-prompt.md` |
| Stack reference | `.claude/skills/epic-delivery/references/stacked-prs.md` |

### API

No changes.

### Testing

The skill-creator package validator passed. Independent scenario testing used the committed skill and its references without parent-conversation guidance or external mutations. The original transcript and the maintainer's explicit choices informed the skill; current GitHub documentation supports the [stack reference](../../.claude/skills/epic-delivery/references/stacked-prs.md). Docs corpus/publication checks and the repository acceptance check are recorded for the final delivery revision in its PR. No persistent watch, real worker session, GitHub stack merge or phone notification was exercised by these tests, and no automated orchestration harness was added.

### Lessons learned, known issues and follow-ups

* The maintainer intentionally used native top-of-stack merging. The original monitor treated grouped events as accidental folding; the skill now waits for reconciliation and verifies trunk content before diagnosing a gap.
* Native stacks evaluate protections and Actions against their trunk. A historical immediate base does not establish reduced CI; inspect the applicable check set on the current revision.
* A stopped worker can usually be steered directly under the accepted authority. A launcher requiring a maintainer click must still be reported honestly, as must watch and notification gaps.
* Related handover refactoring remains with #318. This skill neither introduces a new polling tool nor changes the existing protocol's rules.
* The coordinator now watches mergeability as well as checks (2026-11-07, epic #458): after squash merges into `main`, a stacked PR whose base had merged and a parallel PR both turned `CONFLICTING`, which a watch of checks and comments alone does not report. The skill now reads each open PR's mergeable state on every pass and after each trunk merge, sends conflicts to the owning worker (resuming a finished one), and leaves a branch that is only behind alone.

## User guide

Ask: **Use epic-delivery to coordinate &lt;epic URL&gt;.** The coordinator reads the epic and story, groups and steers workers, and reports decisions or milestones in tables. You approve scope changes and merge PRs, including native stack groups from the top. The coordinator verifies completion and stops; related unfinished work is listed separately.
