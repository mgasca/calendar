---
status: planned
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/390
pr:
  - https://github.com/mgasca/calendar/pull/400
adrs: ["0044", "0042", "0017"]
---

# 0035 Review before merge with a workflow and a skeptic per finding

## Story

> As a maintainer who works through AI coding agents, I need the review that runs before every merge to check its own findings before I read them, so that what reaches me is confirmed, what was refuted is still visible, and the review costs the same minutes whether a change has two findings or twenty.

Tracked in issue [#390](https://github.com/mgasca/calendar/issues/390). The card is the source of truth from here on. The proposal came from [agent thoughts 0003](../agent-thoughts/0003-workflows-and-a-proposal-for-the-first-one.md); the maintainer asked for the issue and this card in conversation, and answered the four open questions in conversation on 2026-11-06, as recorded below.

## Background

Before anyone asks to merge a code change in this repository, the `issue-handover` skill runs two reviewer subagents, `performance-reviewer` and `security-reviewer`, in parallel and presents each report as it returns. The reviewers run in a fresh context, read the branch against `origin/main`, and report; they never edit. Their findings go on the issue or PR with the `agent-found` label, and the session reproduces a finding before fixing it. The step is written down, it runs on every code PR, and it has earned its keep: the review on the handover watch ([agent thoughts 0002](../agent-thoughts/0002-handover-watch-from-finding-to-fix.md)) made a fix slower and made it right.

What the step lacks is a check on the findings themselves. A reviewer's claim is taken at face value until a person reads it, and a wrong claim costs a reproduction nobody needed while a missed one costs an incident. Each finding is also judged in one context, by the agent that made it. Claude Code **workflows**, scripts that fan work out to subagents and return structured data, make it cheap to give every finding its own skeptics. There are none in this repository yet. [ADR-0044](../decisions/0044-claude-first-agent-automation.md) opened a Claude-first period in which automation under `.claude/` may be Claude Code only, so a saved workflow is allowed; this story is its first use, chosen because the step exists, runs often and is measured within days.

This story builds on [0027](0027-focus-agent-guidance-on-claude-code-for-a-while.md), which moved the handover's mechanics to the harness, a tool and a hook, and on the review practice of [0020](0020-restructure-agent-guidance.md), which created the reviewer subagents. It changes neither reviewer. Like those stories, its user is the maintainer, not the calendar's end user.

### Agreed scope

* **A saved workflow**, `.claude/workflows/review-before-merge.js`, in three stages: the two reviewer agents run at once, each as the agent it already is; every finding, as soon as it arrives, goes to three skeptics with distinct lenses (*is the claim true of this code*, *does it reproduce*, *does it matter at this severity*); the script returns confirmed findings, refuted findings with the skeptics' reasons, and what it did not examine.
* **Findings as data.** Each reviewer and each skeptic answers in a schema (file, line, claim, severity, reproduced; refuted with a reason), so the script filters and counts in code. A finding is confirmed when at least two of its three skeptics decline to refute it.
* **A cap of 60 agents per run**, the two reviewers included, so about nineteen findings are fully judged. Findings are judged highest severity first (both reviewers assign one), then in report order; those past the cap are returned unexamined and the script logs how many it left.
* **Both lists reach the PR.** The session posts each confirmed finding on the issue or PR with the `agent-found` label, as today, and posts the refuted findings under one collapsed section with the skeptics' reasons, so a wrong refutation can be caught by a person. Unexamined findings are named in the same post.
* **The step still exists without the workflow.** The reviewer agents and their checklists are unchanged. The review line in `issue-handover` gains half a sentence: in Claude Code, run the saved workflow; elsewhere, run the two reviewers by hand. The workflow is marked Claude Code only where it is described, as ADR-0044 asks.
* **Code changes only.** The workflow is not run on docs-only PRs (cards, ADRs, posts, READMEs); the review step already applies to code changes.
* **Measured.** A benchmark record under `docs/benchmarks/` compares, on the same PRs, the wall-clock time and the agent count of the workflow against the two sequential reviews it replaced, and reports how often the skeptics were right for the first ten refuted findings, checked by a person.

### Not in this story

* **Changing what the reviewers look for.** Their prompts, lenses and ground rules stay as they are; a weak lens is its own issue.
* **Posting by the workflow.** The script returns data; the session posts, with the public-post guard in front of it as today. A workflow that writes to GitHub is a later decision.
* **Running on a standing opt-in.** The workflow runs when the review step runs; this story does not turn on ultracode or any default that starts workflows unasked.
* **The next candidates.** The close-out across a PR stack, the issue sweep and the dream-weaver's reading (the "What would come after" section of agent thoughts 0003) wait for this one's record.
* **Other harnesses.** A Codex or Cursor session runs the two reviewers by hand; no adapter is built, as ADR-0044 accepted.

### Acceptance criteria

1. **Given** a code PR with at least one finding from either reviewer, **when** the workflow runs, **then** it returns three lists (confirmed, refuted with reasons, unexamined), every finding carries file, line, claim and severity, and every confirmed finding was judged by three skeptics of which at least two declined to refute it.
2. **Given** a reviewer that returns no findings or dies, **when** the workflow runs, **then** the run completes, the other reviewer's findings are judged, and the result says which reviewer returned nothing.
3. **Given** more findings than the cap allows, **when** the workflow runs, **then** findings are judged highest severity first up to 60 agents in total, the rest are returned unexamined, and the run's log names how many were left.
4. **Given** the workflow's result, **when** the session posts it, **then** each confirmed finding is a comment with the `agent-found` label as today, the refuted findings appear in one collapsed section with their reasons, unexamined findings are named, and nothing is posted that the public-post guard would refuse.
5. **Given** the `issue-handover` skill, **when** an agent reaches the review step, **then** the skill names the workflow for Claude Code and the by-hand run of both reviewers for any other harness, and the reviewer agents are unchanged on `main`.
6. **Given** a docs-only PR, **when** the handover reaches the review step, **then** the workflow is not run.
7. **Given** three real code PRs, **when** the record is written, **then** it gives for each the measured wall-clock time and agent count of the workflow and of the two sequential reviews, the number of confirmed, refuted and unexamined findings, and the human check of the first ten refutations with how many the skeptics got right.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes. The workflow is a script and the skill is Markdown; the docs corpus tests and site build cover this card, the record and the skill.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Focus new agent automation on Claude Code for a while, keeping the guidance files agent-neutral | A saved workflow is Claude Code only; this story marks it so, keeps the by-hand path in the skill, and is the period's first workflow. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope and enforce its invariants with hooks | The reviewer subagents and the skill are layers of this decision; the workflow sits inside the skill's step and the public-post guard stays in front of every post. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling | The workflow script is harness code, not repo tooling: it runs only inside Claude Code's workflow runtime and is not a `tools/` app. The record says so, so the exception is deliberate. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Three skeptics, distinct lenses:** two identical skeptics catch one kind of mistake twice; three lenses catch three kinds, and the third breaks ties. Answered by the maintainer in conversation on 2026-11-06.
* **Refuted findings are posted, collapsed:** the day a skeptic is wrong is the day we most want to see it, and a collapsed section keeps the PR readable. Same answer, same day.
* **A cap of 60 agents, with the remainder logged:** a PR with forty findings would otherwise start 122 agents; the cap bounds cost and the log keeps the truncation visible, which the repository's "say what was dropped" rule asks. Same answer, same day.
* **Not on docs-only PRs:** the reviewers have nothing to review there. Same answer, same day.
* **The session posts, not the script:** keeps every GitHub write behind the same hygiene guard and the same session judgement as today, and keeps the script a pure function of the branch.
* **Severity first under the cap:** both reviewers give every finding a severity (critical to low, high to low), so sorting on it before the cap judges the serious ones first without a ranking agent; report order breaks ties.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| The workflow | `.claude/workflows/review-before-merge.js` |
| Reviewer agents (unchanged) | `.claude/agents/performance-reviewer.md`, `.claude/agents/security-reviewer.md` |
| The review step | `.claude/skills/issue-handover/SKILL.md`, "Resume and close out" |
| The record | `docs/benchmarks/NNNN-review-before-merge-workflow.md` (next free number when written) |
| Where the workflow is marked Claude Code only | the skill line and a one-line note at the top of the script |

### API

No changes.

### Testing

* The workflow runtime validates each agent's answer against its schema, so a malformed finding or verdict is retried by the harness rather than reaching the script.
* The criteria that need a real PR (1, 2, 4, 7) are checked on three real code PRs and recorded; criterion 3 by a scratch branch seeded with more findings than the cap allows, or by lowering the cap in a scratch copy of the script.
* Criteria 5 and 6 are checked by reading the skill on `main` and by one docs-only PR that reaches the review step without a run.
* The docs corpus tests and site build cover this card, the index row and the record.

### Lessons learned, known issues and follow-ups

* Filled in on delivery, with the record's numbers and the human check of the refutations.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Reading a review before a merge

When an agent asks you to merge a code change, the pull request carries the review. Each confirmed finding is its own comment, labelled as found by an agent, with the file and line, the claim and how serious it is. Below them, one collapsed section lists the findings the review considered and set aside, each with the reason the skeptics gave, so you can open it when a dismissal looks wrong. If a change had more findings than the review could examine, the same post says how many were left and which they are.

For a change that only touches documentation, there is no review post; the pull request is read as it is today.
