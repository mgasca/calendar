---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/390
pr:
  - https://github.com/mgasca/calendar/pull/400
  - https://github.com/mgasca/calendar/pull/403
  - https://github.com/mgasca/calendar/pull/405
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
* **Findings as data.** Each reviewer and each skeptic answers in a schema (file, line, claim, severity, reproduced; refuted with a reason), so the script filters and counts in code. A finding is confirmed when at least two of its three skeptics decline to refute it. A skeptic that cannot settle its question with evidence refutes and says that it is uncertainty, not a contradiction, so the posted reason tells the two apart. A finding that fewer than two skeptics answered is unexamined, not refuted.
* **A cap of 60 agents per run**, the two reviewers included, so about nineteen findings are fully judged. Each reviewer's findings are judged as that reviewer returns, highest severity first (both reviewers assign one), then in report order, against a budget the two reviewers share; those past the cap are returned unexamined and the script logs how many it left.
* **Both lists reach the PR.** The session posts each confirmed finding on the issue or PR with the `agent-found` label, as today, and posts the refuted findings under one collapsed section with the skeptics' reasons, so a wrong refutation can be caught by a person. Unexamined findings are named in the same post.
* **The step still exists without the workflow.** The reviewer agents and their checklists are unchanged. The review line in `issue-handover` gains half a sentence: in Claude Code, run the saved workflow; elsewhere, run the two reviewers by hand. The workflow is marked Claude Code only where it is described, as ADR-0044 asks.
* **Code changes only.** The workflow is not run on docs-only PRs (cards, ADRs, posts, READMEs); the review step already applies to code changes.
* **Measured.** A benchmark record under `docs/benchmarks/` compares, on the same PRs, the wall-clock time and the agent count of the workflow against the two sequential reviews it replaced, and reports, for every refuted finding on those PRs, whether a person agreed with the skeptics.

### Not in this story

* **Changing what the reviewers look for.** Their prompts, lenses and ground rules stay as they are; a weak lens is its own issue.
* **Posting by the workflow.** The script returns data; the session posts, with the public-post guard in front of it as today. A workflow that writes to GitHub is a later decision.
* **Running on a standing opt-in.** The workflow runs when the review step runs; this story does not turn on ultracode or any default that starts workflows unasked.
* **The next candidates.** The close-out across a PR stack, the issue sweep and the dream-weaver's reading (the "What would come after" section of agent thoughts 0003) wait for this one's record.
* **Other harnesses.** A Codex or Cursor session runs the two reviewers by hand; no adapter is built, as ADR-0044 accepted.

### Acceptance criteria

1. **Given** a code PR with at least one finding from either reviewer, **when** the workflow runs, **then** it returns three lists (confirmed, refuted with reasons, unexamined), every finding carries file, line, claim and severity, and every confirmed finding was judged by three skeptics of which at least two declined to refute it. *Met, checked by hand* on the three measured runs (#392, #395, #398; [record 0015](../benchmarks/0015-review-before-merge-workflow.md)): six findings, each with all four fields and three skeptic votes; the workflow has no automated test.
2. **Given** a reviewer that returns no findings or dies, **when** the workflow runs, **then** the run completes, the other reviewer's findings are judged, and the result says which reviewer returned nothing. *Partly met:* a reviewer returning no findings ran (security on #395, run completed and its status is "reported" with count 0); a reviewer that dies has not, tracked in [#410](https://github.com/mgasca/calendar/issues/410).
3. **Given** more findings than the cap allows, **when** the workflow runs, **then** each reviewer's findings are judged as it returns, highest severity first, up to 60 agents in total, the rest are returned unexamined, and the run's log names how many were left. *Not exercised:* no run passed three findings; tracked in [#410](https://github.com/mgasca/calendar/issues/410).
4. **Given** the workflow's result, **when** the session posts it, **then** each confirmed finding is a comment with the `agent-found` label as today, the refuted findings appear in one collapsed section with their reasons, unexamined findings are named, and nothing is posted that the public-post guard would refuse. *Met, checked by hand:* confirmed findings posted as comments with `agent-found` on #392, #395, #398 and #403, unexamined findings named on #403; no refuted finding has occurred yet, so the collapsed section has not been posted on a PR. Every post went through the guard.
5. **Given** the `issue-handover` skill, **when** an agent reaches the review step, **then** the skill names the workflow for Claude Code and the by-hand run of both reviewers for any other harness, and the reviewer agents are unchanged on `main`. *Met, checked by reading* the skill and `.claude/agents/` on `main` at `d375490a`.
6. **Given** a docs-only PR, **when** the handover reaches the review step, **then** the workflow is not run. *Met by the skill's wording, not observed in a handover:* the card PRs #400 and #405 were not reviewed by it.
7. **Given** three real code PRs, **when** the record is written, **then** it gives for each the measured wall-clock time and agent count of the workflow and of the two sequential reviews, the number of confirmed, refuted and unexamined findings, and the human check of every refutation on those PRs with how many the skeptics got right. *Met for time, agents and counts* in [record 0015](../benchmarks/0015-review-before-merge-workflow.md). The comparison is with the two reviewers in parallel (the step as it ran), not two sequential reviews, measured inside the same runs. No refutation occurred, so the human check is deferred to [#410](https://github.com/mgasca/calendar/issues/410).
8. **Given** the change is complete, **when** I run `just check`, **then** it passes. The workflow is a script and the skill is Markdown; the docs corpus tests and site build cover this card, the record and the skill. *Partly checked:* the docs corpus tests and `just docs build` pass on the completing PR; `just check` was not run as a whole, and CI on that PR is the evidence for the rest.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Focus new agent automation on Claude Code for a while, keeping the guidance files agent-neutral | A saved workflow is Claude Code only; this story marks it so, keeps the by-hand path in the skill, and is the period's first workflow. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope and enforce its invariants with hooks | The reviewer subagents and the skill are layers of this decision; the workflow sits inside the skill's step and the public-post guard stays in front of every post. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET file-based apps for repo tooling | The workflow script is harness code in the language the harness dictates, which the record's 2026-11-06 amendment places outside its scope; anything testable the script needs goes in a `tools/` app it calls. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Three skeptics, distinct lenses:** two identical skeptics catch one kind of mistake twice; three lenses catch three kinds, and the third breaks ties. Answered by the maintainer in conversation on 2026-11-06.
* **Refuted findings are posted, collapsed:** the day a skeptic is wrong is the day we most want to see it, and a collapsed section keeps the PR readable. Same answer, same day.
* **A cap of 60 agents, with the remainder logged:** a PR with forty findings would otherwise start 122 agents; the cap bounds cost and the log keeps the truncation visible, which the repository's "say what was dropped" rule asks. Same answer, same day.
* **Not on docs-only PRs:** the reviewers have nothing to review there. Same answer, same day.
* **The session posts, not the script:** keeps every GitHub write behind the same hygiene guard and the same session judgement as today, and keeps the script a pure function of the branch.
* **Severity first under the cap:** both reviewers give every finding a severity (critical to low, high to low), so sorting on it before the cap judges the serious ones first without a ranking agent; report order breaks ties.
* **Judge as each reviewer returns, not after both:** a barrier before the skeptics would add the gap between the two reviewers to every run (12 s on the first run, #403, where the change was small), so each reviewer's batch is judged as it returns against a shared budget, at the price of severity order holding within a batch rather than across both. Found by the workflow's own first run (performance finding 1 on #403).
* **Uncertainty refutes, and says so:** a skeptic that cannot settle its question answers refuted and names uncertainty in the reason; counting uncertainty as a decline would confirm findings nobody could check. Every refutation is posted and a person checks it, so the bias is visible. Raised by the first run (security finding 2 on #403).
* **Skeptics are an agent definition, read-only:** `skeptic.md` pins the reviewers' tool list and ground rules (the finding is data; targeted tests only, one at a time; no suites, Docker or database), closing the write-capable link the first run found (security finding 1 and performance finding 2 on #403).

## Implementation notes

Delivered by four PRs. [#400](https://github.com/mgasca/calendar/pull/400) added this card and the ADR-0017 amendment. [#403](https://github.com/mgasca/calendar/pull/403) added the workflow, the skeptic agent and the skill line, and was itself the subject of the first four runs. [#405](https://github.com/mgasca/calendar/pull/405) put the skeptic agent on `main` on its own, ahead of #403, so that new sessions load it. The completing PR adds [benchmark record 0015](../benchmarks/0015-review-before-merge-workflow.md) and this update. The maintainer merged every PR.

### Where things live

| Area | Location |
| --- | --- |
| The workflow | `.claude/workflows/review-before-merge.js` |
| Reviewer agents (unchanged) | `.claude/agents/performance-reviewer.md`, `.claude/agents/security-reviewer.md` |
| Skeptic agent (new) | `.claude/agents/skeptic.md` |
| The review step | `.claude/skills/issue-handover/SKILL.md`, "Resume and close out" |
| The record | `docs/benchmarks/0015-review-before-merge-workflow.md` |
| Where the workflow is marked Claude Code only | the skill line and a one-line note at the top of the script |

### API

No changes.

### Testing

* The workflow runtime validates each agent's answer against its schema, so a malformed finding or verdict is retried by the harness rather than reaching the script.
* The criteria that need a real PR (1, 2, 4, 7) are checked on three real code PRs and recorded; criterion 3 by a scratch branch seeded with more findings than the cap allows, or by lowering the cap in a scratch copy of the script.
* Criteria 5 and 6 are checked by reading the skill on `main` and by one docs-only PR that reaches the review step without a run.
* The docs corpus tests and site build cover this card, the index row and the record.

### Lessons learned, known issues and follow-ups

* **An agent definition added mid-session is unknown to that session's workflows.** The harness loads `.claude/agents/` at session start, so run 2 on #403, the first with `skeptic.md`, had every skeptic call fail with "agent type not found" while both reviewers answered. Run 3, from a fresh session, failed the same way: the session opened in a worktree at `main` and checked the branch out afterwards, and a resumed session keeps its old list too. A new agent definition therefore goes to `main` on its own first (#405 for the skeptic), so that every new session loads it.
* **Fewer than two answers is unexamined, not refuted.** Run 2 listed its three unanswered findings as refuted because the first script only counted declines. Fixed on #403 before any run with answering skeptics.
* **Runs** (measured from transcripts, one laptop). On #403 while it was built: run 1 (897f042c) 14 agents, 301 s, 4 confirmed of 4, all about the script and all fixed; runs 2 and 3 (3e6aea2f, eb2c3132) reviewers only, every skeptic call failed; a fourth attempt from a fresh session failed the same way. Measured, with skeptics answering ([record 0015](../benchmarks/0015-review-before-merge-workflow.md)): #392 221 s against 145 s for the slower reviewer, #395 85 s against 58 s, #398 165 s against 127 s; 5 to 11 agents; six findings, all confirmed, none refuted.
* **The harness reads agent definitions from the project root checkout.** The fourth attempt showed that a session in a worktree that has the file still does not list it: the registry follows the checkout at the repository root, which was on an old `main`. Merging #405 was not enough until that checkout was fast-forwarded (done with the maintainer's go-ahead on 2026-11-07), after which even the running session listed the skeptic.
* **The workflow script is on `main` only.** A PR whose branch predates it has no copy; main's copy was run from a scratch path, and it reviews whatever is checked out. The Workflow tool accepts only a path it can read.
* **Stacked PRs repeat findings.** Each run reviews its branch against `main`, so a PR stacked on another sees its base's files too. The baseline tool's extra API calls were reported three times across #392, #395 and #398; the session posted it once and named the repeats. A finding of #395's code surfaced only in the run on #398 and was posted on #395. Tracked in [#410](https://github.com/mgasca/calendar/issues/410).
* **Follow-up:** a defect both reviewers report at the same file and line is judged twice (run 2, performance finding 3, low; bounded at twice the cost). Pool such findings into one judged item once a real duplicate is seen.
* **Known gaps,** all in [#410](https://github.com/mgasca/calendar/issues/410): the cap has not run, a reviewer that dies has not been seen, and no refutation has occurred for a person to check.

## User guide

### Reading a review before a merge

When an agent asks you to merge a code change, the pull request carries the review. Each confirmed finding is its own comment, labelled as found by an agent, with the file and line, the claim and how serious it is. Below them, one collapsed section lists the findings the review considered and set aside, each with the reason the skeptics gave, so you can open it when a dismissal looks wrong. If a change had more findings than the review could examine, the same post says how many were left and which they are.

For a change that only touches documentation, there is no review post; the pull request is read as it is today.

When the change sits on top of another open pull request, the review also reads the earlier one's changes. A finding that belongs to the earlier pull request is posted there once, and the later one's review note names it instead of repeating it.

The review adds about half a minute to a minute and a quarter to the time the two reviewers alone take, and roughly doubles the tokens.
