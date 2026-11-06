---
status: planned
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/318
pr: []
adrs: ["0042", "0017"]
---

# 0027 Focus agent guidance on Claude Code for a while

## Story

> As an explorer who has finished looking at the mjolnir cross-harness subagent dispatch and has already written non-portable, trigger-driven agent code, I need the decision on fully portable agent content changed so that the guidance can focus on Claude Code for a while, so that I can explore its native benefits.

Tracked in issue [#318](https://github.com/mgasca/calendar/issues/318). The card is the source of truth from here on. The story statement is the maintainer's; the scope below is derived from the epic and is to be confirmed by the maintainer in the PR 0 review.

## Background

[ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md) decided where agent guidance lives and made **agent neutrality** one of its drivers (D3): every rule, including the ones a Claude Code hook enforces, keeps a form that Codex, Cursor and other agents can read and follow by hand. That driver shaped what has been built since: hooks carry a one-line prose twin in the root `AGENTS.md`, reviewer subagents are plain Markdown checklists, and skills are written so another agent could follow them.

The exploration that motivated neutrality is over. The maintainer has looked at cross-harness subagent dispatch through mjolnir, and the repository already holds code that only Claude Code runs: the hooks in `tools/agent-hooks`, the reviewer subagents, the `spawn_task` pattern for parallel children, and the skills that drive issue handovers. Holding every new piece to a portable twin now costs more than it returns, and it keeps Claude-native mechanisms (recurring loops, scheduled routines, workflows, hooks that act rather than remind) at arm's length.

The `issue-handover` skill shows the cost. It has grown to cover polling cadence, a seen-ID record, public-post rules a hook already enforces, screenshots, performance evidence, reopened decisions and local operations, all stated as prose that loads on every handover turn, including a poll that finds nothing. Each part has a better home once Claude Code is the target: the harness for timing, a repo tool for mechanics, a hook for invariants, and reference documents for conventions people read too. Epic #318 holds those moves as children; this card is the story they deliver, and the record of what the Claude-first period teaches.

This story builds on [0020](0020-restructure-agent-guidance.md), which created the layers, and on [0025](0025-consolidate-what-agent-sessions-learned-into-guidance.md), whose first run last extended the handover skill (#292). Like those, its user is the maintainer who works through agents, not the calendar's end user.

### Agreed scope

* **The decision change, as an ADR.** A new record amends ADR-0042's agent-neutrality driver for a stated period: new agent guidance and automation may target Claude Code alone, without a portable twin, while the root `AGENTS.md` and the nested area files stay readable by any agent. The record names the condition on which the decision is revisited (for example a second harness in regular use, or the end of the exploration the maintainer sets) and is `accepted` before this story's children merge code that relies on it.
* **Polling and re-arm to the harness** ([#319](https://github.com/mgasca/calendar/issues/319)): the handover watch runs on a Claude Code loop or scheduled routine, and the skill says what a tick does, not how to sleep.
* **The handover watch as a repo tool** ([#320](https://github.com/mgasca/calendar/issues/320)): a .NET file-based app under `tools/` (ADR-0017) fetches new comments and reviews across an issue and its delivery PRs and keeps the seen-ID record, with tests.
* **Invariants as hooks** ([#321](https://github.com/mgasca/calendar/issues/321)): an inform hook for a PR to `main` without `Closes` or `Refs`, and the public-post hygiene paragraph dropped from the skill in favour of the hook that already enforces it.
* **Reference material out of the skill** ([#322](https://github.com/mgasca/calendar/issues/322)): screenshots, performance evidence, reopened decisions and local operations move to the place their reader starts, leaving `issue-handover` with the protocol alone.
* **A closing update to this card** in a final epic PR: what the Claude-first period made possible, what it cost, whether the revisit condition has arrived, and the lessons for the next exploration.

### Not in this story

* **Removing or shrinking `AGENTS.md`, `backend/AGENTS.md` or `frontend/AGENTS.md`.** They stay the agent-neutral layer; this story changes what *new* automation must provide, not what exists.
* **Rewriting existing skills or subagents for other harnesses.** Nothing is made less portable on purpose; nothing is ported either.
* **Saved Claude Code workflows** for close-out checks, review bursts and the issue sweep. Deferred on the epic until #320 and #321 exist, so a workflow has a tool and a hook to call.
* **The mjolnir dispatch work itself.** It is the reason the decision can change, not part of this story.
* **Reversing the decision.** When the revisit condition arrives, that is a new ADR, not an edit to this card.

### Acceptance criteria

1. **Given** ADR-0042 is accepted with agent neutrality as a driver, **when** this story's ADR is accepted, **then** it names the period or revisit condition, says which layers stay agent-neutral and which may be Claude-only, links ADR-0042 both ways, and the architecture model lists it.
2. **Given** a handover started from the `issue-handover` skill, **when** the watch runs, **then** its interval is owned by a Claude Code loop or routine, a tick with nothing new posts nothing, and no sleep loop appears in the skill or the transcript.
3. **Given** an issue with open, closed and merged delivery PRs, **when** the handover watch tool runs twice, **then** the first run lists every unseen comment and non-empty review once, the second run lists nothing, and empty review wrappers never appear.
4. **Given** a PR created or retargeted to `main` with neither `Closes #N` nor `Refs #N` in its body, **when** the `gh` command runs under the hooks, **then** an inform message names the rule and the PR proceeds.
5. **Given** the four children have merged, **when** `issue-handover/SKILL.md` is read, **then** it holds only terms, instruction provenance, watching, questions and progress, and resume and close-out, and every moved section is reachable from a pointer where its reader starts.
6. **Given** the epic is closing, **when** the final epic PR merges, **then** this card is `implemented`, lists every delivering PR, records the native benefits found and the costs paid, and states whether the revisit condition has arrived.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes, including `just tools test` for the new tool and hook handlers.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope and enforce invariants with hooks | Its layers are where each part of the skill moves; its agent-neutrality driver is what this story amends. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling | The handover watch tool and the new hook handler are built this way, with tests run by `just tools test`. |

A new ADR is expected: amend ADR-0042's agent-neutrality driver for a Claude-first period, with the revisit condition. Draft it with the `adr-draft` skill as the first delivery PR of the epic, before the children that rely on it.

### Other decisions (not ADR-worthy)

* **One card for the epic, not one per child:** the children are four moves of one skill under one decision; four cards would repeat the same background and split the lessons the closing update collects.
* **Inform, not deny, for the `Closes` hook:** a docs-only or stacked PR legitimately carries only `Refs`, so a hard refusal would block the ordinary PR 0; the message is enough to catch the merges that left #274, #275 and #276 open.
* **Deliver #322 first:** it shrinks the file the other three children edit, which keeps their diffs small and their reviews independent.
* **The closing update is an epic PR, not part of the last child:** the lessons depend on having lived with the Claude-first period, not on any one child, so they are written when the epic closes.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| The decision change | `docs/decisions/00NN-….md` (next free number when drafted), `docs/architecture/calendar.architecture.json` |
| The handover protocol | `.claude/skills/issue-handover/SKILL.md` |
| Handover watch tool | `tools/<name>/` (name to confirm against `tools/README.md`), `tools/mod.just`, `tools/README.md` |
| Hook handlers and tests | `tools/agent-hooks/BashGuard.cs`, `tools/agent-hooks/tests/` |
| Moved reference material | a screenshots skill or runbook, `docs/benchmarks/README.md`, `docs/decisions/README.md` or `adr-draft`, `dream-weaver` |

### API

No changes.

### Testing

* xUnit tests for the watch tool (first run, nothing new, closed PR still watched, empty review wrapper skipped, quoted footer not an agent post) and for the two hook handlers, all run by `just tools test`.
* The docs corpus tests and site build cover this card, the ADR and any README the children change.
* Criteria 2 and 5 are checked by hand on a real handover; the card says so when it is completed.

### Lessons learned, known issues and follow-ups

* Filled in by the closing epic PR.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Working with an agent on an issue

The maintainer starts a handover by asking the agent for it and naming the issue. The agent sets up a recurring check on a fixed interval using the harness, so the maintainer does not need to keep the session in view. Each check reads only comments and reviews that are new since the last check, across the issue and every pull request of the story, and stays silent when there is nothing new.

When the maintainer answers a question, approves a step or merges a pull request on GitHub, the next check picks it up and the agent continues. Before a pull request to the main branch is created or retargeted, the agent is reminded if the description names no issue it refers to or closes, so the issue is not left open after the merge.

Guidance about screenshots, performance evidence, reopened decisions and local operations lives with the activity it describes, so a handover loads only the handover rules.
