---
status: in-progress
date: 2026-11-05
issue: https://github.com/mgasca/calendar/issues/269
pr:
  - https://github.com/mgasca/calendar/pull/271
adrs: ["0017", "0042"]
---

# 0025 Consolidate what agent sessions learned into guidance

## Story

> As a maintainer who works through AI coding agents, I need the lessons from recent sessions consolidated into the guidance the next session loads, so that an avoidable failure happens once and not in every session after it.

Tracked in issue [#269](https://github.com/mgasca/calendar/issues/269). The card is the source of truth from here on.

## Background

Coding lessons reach the repository on their own, through PRs and reviews. Lessons about *how the work went* (a fix lost to `git checkout --`, three sessions colliding on a story number, a push after the PR had merged) live only in session transcripts, and the next session repeats them. Story [0018](0018-preserve-transcript-insights.md) recovered six such lessons by hand in one audit session and delivered them through an epic. This story turns that audit into a skill, `dream-weaver`, that can run nightly, and asks it to show its value: a lesson that is consolidated should stop recurring.

The skill rests on [0020](0020-restructure-agent-guidance.md), which decided where each kind of guidance lives (root, area files, skills, hooks), and on the `mj` session history tools, which make transcripts searchable. It complements the `issue-sweep` skill: the sweep reads issues, the weaver reads sessions. This repository is as much a place to learn how to work with agents as it is a calendar, so this story's user is the maintainer, not the calendar's end user.

### Agreed scope

* **The skill** in `.claude/skills/dream-weaver/`: inventory the sessions of a window from the history index; triage by signal (user corrections and nudges first, then agent self-corrections, mechanics, surprises); write episodes with citations, then lessons; classify each lesson (`documented`, `missing`, `conflicting`, `stale`, `local-only`); report drift (documented rules that were broken, guidance that names things that no longer exist); reconcile every worker memory root; route each lesson to its ADR-0042 layer and propose a hook where a machine could refuse the action.
* **Modes**: `report` (default, read-only), `issues` (an epic and one enhancement child per lesson), `deliver` (through merge via `story-draft` and `issue-handover`).
* **Portable core**: the repository-specific part (remembered set, memory roots, routing table) is one reference file.
* **A watermark**, so each run reads only new sessions and leads with what is new.
* **The nightly routine** is designed in a reference file; its installation is tracked in [#270](https://github.com/mgasca/calendar/issues/270).
* **Evidence of value**: the first run records a baseline of the signals it found; a later run against the watermark shows whether delivered lessons stopped recurring.

### Not in this story

* Installing the routine on a machine (#270).
* A .NET tool for the mechanical steps (ADR-0017): prose-first; a tool follows once real runs show which steps are mechanical.
* Delivering the lessons the first run found. They are reported on #269; filing or delivering them is a separate decision in `issues` or `deliver` mode.
* Changing the hooks, the root guidance or the other skills, except as a route that a lesson proposes.

### Acceptance criteria

1. **Given** a window of sessions, **when** the skill runs with no mode named, **then** it produces a report in which every lesson has a class, a route and at least one citation that `read_session` can open, and it makes no GitHub or git write. Evidence: the first run (report mode, 48 hours to 2026-11-05 17:29 UTC) found 15 sessions, read 8 in depth and reported 9 lessons; its redacted summary is on #269; no issue, comment, PR, push or merge was made by the run. The private report with citations stays local. No automatic test proves this for future runs; the eval case `evals/report-mode-is-read-only` describes the check.
2. **Given** a previous report and watermark, **when** the skill runs again, **then** it reads only sessions after the watermark and leads with what is new since the previous report. **Evidence gap, tracked by [#282](https://github.com/mgasca/calendar/issues/282):** the second run ([#549](https://github.com/mgasca/calendar/issues/549)) used an explicitly requested 24-hour window without recovering the first watermark. Its window is after the first cutoff, but this does not prove watermark-driven execution or continuous incremental coverage. The skill now requires prior-report recovery and continuing-session checks; a real run exercising that procedure remains necessary. No automatic test proves this criterion.
3. **Given** every worker memory root for this project, **when** the skill reconciles memory, **then** each memory gets one action (keep, point, date, delete) with the roots that hold it listed. Evidence: the first run fingerprinted 11 roots and found 8 holding the 2026-11-01 versions, including a limitation retired on 2026-11-03. Recommended only; no root was edited.
4. **Given** a lesson, **when** it is routed, **then** the route is one of ADR-0042's layers, and a lesson that protects uncommitted work, shared resources or the public record is proposed as a hook with its one-line prose statement. Evidence: lesson 1 of the first run (a push to a merged PR's branch, third occurrence) is proposed as a `git push` guard.
5. **Given** the routing reference, **when** its paths are checked against `origin/main`, **then** every one exists. Evidence: 12 of 12 on `dee2e71e`, checked by script before PR #271.
6. **Given** the first run's baseline (in 15 sessions: the user asked "is any work remaining?" in 5, reported a merge by hand in 3, typed `resume` in 2, and a push went to a merged PR's branch once), **when** the lessons that address them have been delivered and a later run covers a comparable window, **then** the report shows those counts falling, or says why they did not. **Checked by hand:** the second report's [dated comparison](https://github.com/mgasca/calendar/issues/549) found four follow-up outstanding-work questions, three manual merge notices, no bare resume nudges and an unknown merged-branch push count in 24 sessions. The comparison below explains why differing windows and reading coverage cannot establish improvement. Recurrence persists despite delivered guidance.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes. The skill is Markdown only; the docs corpus tests and site build cover the card and index.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope and enforce invariants with hooks | The skill's routing table is this decision applied to each lesson: invariants to hooks, area practice to the nested files, procedures to skills, conventions to READMEs. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling | Any tool the skill grows must be a .NET file-based app in the skill folder, listed in `tool_dirs`; this is why the story is prose-first. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Read-only by default:** a wrong lesson in a report costs a minute; a wrong rule in `AGENTS.md` costs every later session. Public writes need a named mode.
* **Signals before briefs:** a session brief summarises what was done and hides what went wrong; user corrections and nudges mark the minute a lesson was paid for. `read_session(role: "user")` is the first triage step because it returns only those.
* **Episodes before lessons:** one lesson may rest on several sessions; episodes with citations keep the recurrence countable, which is what the evidence-of-value criterion needs.
* **All memory roots:** memory is written per worker, so a run that reads one root reconciles one eleventh of what the agents remember.
* **Evidence stays private:** session IDs, message indices and machine paths live in the local report; posts carry issue and PR links and repository-relative paths, as the `gh` hook requires.
* **The card follows the skill:** the skill was requested directly and #269 was opened to drive the handover, so the card is in the delivery PR rather than a PR 0. The maintainer chose a card so that the skill's value is evidenced here.

## Implementation notes

The skill shipped in [PR #271](https://github.com/mgasca/calendar/pull/271). The maintainer confirmed the report on [#549](https://github.com/mgasca/calendar/issues/549) is its second run. This card remains `in-progress` because criterion 2 was not exercised against the earlier watermark; [#282](https://github.com/mgasca/calendar/issues/282) owns that remaining evidence. The documentation site derives status from the card; no hand-maintained index row exists.

### Second run and evidence of value

The first report on [#269](https://github.com/mgasca/calendar/issues/269#issuecomment-6664843872) covered 48 hours ending 2026-11-05 17:29 UTC: 15 sessions triaged, eight deep-read, nine lessons. Epic [#292](https://github.com/mgasca/calendar/issues/292) delivered those lessons; #282 records the last delivery at 2026-11-05 22:21 UTC.

The second run covered 2026-11-07 00:21:37 to 2026-11-08 00:21:37 UTC, entirely after that delivery boundary: 24 sessions triaged, 12 selectively deep-read, six lessons (four documented, one missing and one local-only at its cutoff). It started at 2026-11-08 00:21:37 UTC and completed at 00:25:24 UTC. It made no repository or GitHub changes. The maintainer subsequently requested public publication, then confirmed its second-run status and requested handover on #282 and #549.

| Signal, once per session | First run, 15 sessions / 48 hours | Second run, 24 sessions / 24 hours | Evidence and interpretation |
| --- | --- | --- | --- |
| Follow-up outstanding-work question | 5 | 4 | Second-run work: #452, #454, #291 and #458. Still recurs. |
| Human manual merge notice | 3 | 3 | Notices concern #457, delivery under #428 and the Pages revert under #473. Still recurs. |
| Bare human resume nudge | 2 | 0 | None in the second run's read user outlines; setup instructions and generated notifications excluded. |
| Push to a merged PR branch | 1 | Unknown | Selective deep reads cannot establish absence across all tool activity. |

Counts for the second run were checked from its retained user outlines during the later handover and added to #549 as a dated supplement. Two opening scope questions (#291 and #380) were excluded from the four follow-up nudges. The first report's public summary does not retain an equally precise counting protocol, so classification equivalence is uncertain. Different duration, task/harness mix and reading depth prevent a causal before/after claim; a lower raw count or no observed event does not establish prevention.

The original run did not recover the prior report or watermark, leaving an unreviewed interval between the first cutoff and the start of its explicit window. Older continuing sessions were not comprehensively included. The supplement preserves that gap rather than rewriting the original run as incremental. The private watermark and transcript citations remain local; public evidence carries only repository links and UTC boundaries.

### Where things live

| Area | Location |
| --- | --- |
| Procedure, modes, evidence rules | `.claude/skills/dream-weaver/SKILL.md` |
| Repository-specific routing, remembered set, memory roots | `.claude/skills/dream-weaver/references/routing.md` |
| Signal words and history-tool semantics | `.claude/skills/dream-weaver/references/signals.md` |
| Report shape and watermark format | `.claude/skills/dream-weaver/references/report-template.md` |
| Nightly routine design | `.claude/skills/dream-weaver/references/routine.md` |
| Eval case | `.claude/skills/dream-weaver/evals/report-mode-is-read-only/` |
| Local state (not in the repository) | the state directory the routine reference describes |

### API

No changes.

### Testing

* The [docs corpus tests](../../frontend/apps/docs/src/lib/adr.test.ts) and site build check this card's structure, derived status and links. Nothing tests the skill's behaviour automatically; the eval case describes the graders, the first report supplies evidence for criteria 1, 3, 4 and 5, and the second supplies the qualified comparison for criterion 6. Criterion 2 remains explicitly unverified.
* The routine script's watermark extraction and prompt substitution were run on a sample, including the no-watermark case.

### Lessons learned, known issues and follow-ups

* **The first run changed the skill in five places** before the PR: the history index is the primary inventory (the daemon list showed 1 session where the index held 15, because native Claude Code sessions are index-only); `read_session(role: "user")` is the first triage step; the history tools accept about six concurrent queries; `read_session` navigates by `start`, not `offset`; `search_session` matches inside words.
* **A watch script can declare CI done on an empty check list** right after a push (`all()` over nothing is true). Observed on PR #271; the fix is to require the full set of checks. Candidate bullet for `issue-handover`.
* **Recover the baseline before falling back.** The second run treated the missing supplied watermark as a fresh baseline, although #269 and this card recorded the first report. The skill now separates run history from watermark availability, recovers prior evidence and reports interval gaps.
* **A new-session filter misses continuing sessions.** An incremental run must inspect later messages in sessions named by the prior watermark, or state that those boundaries cannot be recovered.
* **Unknown is not zero.** User outlines can establish a lack of bare resume nudges; selective tool-call reading cannot establish a lack of pushes to merged branches. The report template and eval grader now require those limits.
* **First-run lessons delivered:** epic [#292](https://github.com/mgasca/calendar/issues/292) and its ten children shipped the guidance and memory reconciliation. The second run still found close-out friction; the new worker-brief omission was separately addressed by [PR #533](https://github.com/mgasca/calendar/pull/533).
* **Follow-ups:** #282 retains watermark-driven execution evidence and the card's final status change; #270 owns routine installation independently of the local active-session monitor. #549 is the second report and comparison, not an implementation epic for every proposed lesson.

### Memory coverage disposition

The first run found 8 of 11 worker memory roots holding the 2026-11-01 versions of three memories that were reconciled with the merged guidance on 2026-11-03 (story [0018](0018-preserve-transcript-insights.md)). Issue [#302](https://github.com/mgasca/calendar/issues/302) reconciled them on 2026-11-05 with the maintainer's go-ahead. Versions were identified by SHA-256 fingerprint, compared with the project-level memory root that new workers are seeded from.

| Memory | 2026-11-01 version | Disposition |
| --- | --- | --- |
| Issue-driven handover workflow | Full handover rules, now owned by `AGENTS.md` and the `issue-handover` skill, and the retired "Node 22 / `make build-docs` cannot run" limitation | Replaced by the reconciled pointer to the merged guidance, which records that the limitation was retired and capabilities must be re-probed. |
| Issue sweep routine | Says the six-hourly timer runs sweeps | Replaced by the dated note: the timer was found disabled and inactive on 2026-11-03, with recovery steps. Stays local (machine-specific). |
| Redact GitHub posts | Own copy of the redaction rule | Replaced by the pointer to "Public GitHub posts" in `AGENTS.md`. |

* **Roots at reconciliation time:** by 2026-11-05 only 4 worker roots for this project were left. The other 7 had been removed with their workers. 3 of the 4 already held the reconciled versions, because they were seeded from the project-level root after 2026-11-03. One live, long-running worker still held all three 2026-11-01 versions. Its three files and their three index lines were replaced with the reconciled ones, and nothing in it differed from both known versions. Another worker root was removed while the reconciliation ran.
* **Verified:** afterwards the fingerprints of all three files matched the project-level root in each of the 3 remaining roots, and no root still stated the Node 22 limitation as current. The harness's per-worker baseline copies and the other memories in each root were not changed.
* **Limits:** stale copies come from workers that were seeded before a reconciliation and are still running; new workers start from the project-level root. A later dream-weaver run should fingerprint the roots again rather than assume this result holds.

## User guide

### Ask what recent sessions learned

Say "use the dream-weaver skill" (or ask what recent sessions learned, which lessons are undocumented, or to audit memory against the guidance) and name a window if you want one other than the default. You get a report: lessons ranked by cost and recurrence, each with its class and the place it belongs; the documented rules that were broken anyway; the guidance that names things that no longer exist; what to do with each memory; and what the run did not read. Report mode makes no repository or public changes; when local state is requested, it saves the report and its continuation boundary there.

For a later run, supply the previous report and continuation boundary, or identify its source issue. The skill looks for earlier reports before declaring a new baseline. An explicit shorter window is respected, with any gap stated. Ask for a comparison to see whether the same signals recur; the report distinguishes an observed count from an unknown and explains coverage differences before claiming improvement.

### Turn lessons into work

Say "file issues" to get one epic and one child issue per lesson, or "deliver" to have them taken to merge through the usual story workflow. Say "install the routine" to have the report arrive every night (#270).
