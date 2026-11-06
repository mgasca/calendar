---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/318
pr:
  - https://github.com/mgasca/calendar/pull/324
  - https://github.com/mgasca/calendar/pull/354
  - https://github.com/mgasca/calendar/pull/356
  - https://github.com/mgasca/calendar/pull/357
  - https://github.com/mgasca/calendar/pull/358
  - https://github.com/mgasca/calendar/pull/360
  - https://github.com/mgasca/calendar/pull/362
adrs: ["0042", "0017", "0044"]
---

# 0027 Focus agent guidance on Claude Code for a while

## Story

> As an explorer who has finished looking at the mjolnir cross-harness subagent dispatch and has already written non-portable, trigger-driven agent code, I need the decision on fully portable agent content changed so that the guidance can focus on Claude Code for a while, so that I can explore its native benefits.

Tracked in issue [#318](https://github.com/mgasca/calendar/issues/318). The card is the source of truth from here on. The story statement is the maintainer's; the scope below was derived from the epic, reviewed in PR 0 ([#324](https://github.com/mgasca/calendar/pull/324)) and delivered as written.

## Background

[ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md) decided where agent guidance lives and made **agent neutrality** one of its drivers (D3): every rule, including the ones a Claude Code hook enforces, keeps a form that Codex, Cursor and other agents can read and follow by hand. That driver shaped what has been built since: hooks carry a one-line prose twin in the root `AGENTS.md`, reviewer subagents are plain Markdown checklists, and skills are written so another agent could follow them.

The exploration that motivated neutrality is over. The maintainer has looked at cross-harness subagent dispatch through mjolnir, and the repository already holds code that only Claude Code runs: the hooks in `tools/agent-hooks`, the reviewer subagents, the `spawn_task` pattern for parallel children, and the skills that drive issue handovers. Holding every new piece to a portable twin now costs more than it returns, and it keeps Claude-native mechanisms (recurring loops, scheduled routines, workflows, hooks that act rather than remind) at arm's length.

What ended is the exploration of cross-harness *subagents*, not cross-harness work (the maintainer's clarification on [#324](https://github.com/mgasca/calendar/pull/324#issuecomment-6683737468)). The harnesses split the work like this:

* **mj stays the multi-harness session manager.** Each session it manages uses its own harness's native subagents, not mjolnir subagents.
* **Scheduled work stays cross-harness.** Sweeps and other routines are scheduled and run in mj on a non-Claude harness, and the epics and child issues their reports lead to are created there too.
* **Delivery happens mostly in Claude Code.** Epics and single issues are managed and delivered there, which is where the Claude-first automation of [ADR-0044](../decisions/0044-claude-first-agent-automation.md) runs.

An inference from that split, not a decision: the skills that scheduled work runs (for example `dream-weaver`, `issue-sweep` and `adr-sweep`) are read by a non-Claude harness too, so their prose may need to stay harness-neutral, while the delivery skills and hooks may be Claude Code only. The maintainer deferred the question of which skills, if any, must stay harness-neutral ([#366](https://github.com/mgasca/calendar/pull/366#issuecomment-6692829765)).

The `issue-handover` skill shows the cost. It has grown to cover polling cadence, a seen-ID record, public-post rules a hook already enforces, screenshots, performance evidence, reopened decisions and local operations, all stated as prose that loads on every handover turn, including a poll that finds nothing. Each part has a better home once Claude Code is the target: the harness for timing, a repo tool for mechanics, a hook for invariants, and reference documents for conventions people read too. Epic #318 holds those moves as children; this card is the story they deliver, and the record of what the Claude-first period teaches.

This story builds on [0020](0020-restructure-agent-guidance.md), which created the layers, and on [0025](0025-consolidate-what-agent-sessions-learned-into-guidance.md), whose first run last extended the handover skill (#292). Like those, its user is the maintainer who works through agents, not the calendar's end user.

### Agreed scope

* **The decision change, as an ADR.** [ADR-0044](../decisions/0044-claude-first-agent-automation.md) amends ADR-0042's agent-neutrality driver for a stated period: new agent guidance and automation may target Claude Code alone, without a portable twin, while the root `AGENTS.md` and the nested area files stay readable by any agent. The record names the condition on which the decision is revisited (when the maintainer states it) and is `accepted` before this story's children merge code that relies on it.
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
| [0044](../decisions/0044-claude-first-agent-automation.md) | Focus new agent automation on Claude Code for a while, keeping the guidance files agent-neutral | The decision this story asks for: which layers stay agent-neutral, what may be Claude Code only, and the trigger that ends the period. |

The new ADR is [0044](../decisions/0044-claude-first-agent-automation.md), drafted in PR 0 with this card. PR 0 merged with the record still `proposed`, so [#354](https://github.com/mgasca/calendar/pull/354) accepted it on its own before any child merged code that relies on it. The maintainer accepted it as merged, with one change: the period is revisited when the maintainer states it, not on a second harness in regular use or on this epic's close.

### Other decisions (not ADR-worthy)

* **One card for the epic, not one per child:** the children are four moves of one skill under one decision; four cards would repeat the same background and split the lessons the closing update collects.
* **Inform, not deny, for the `Closes` hook:** a docs-only or stacked PR legitimately carries only `Refs`, so a hard refusal would block the ordinary PR 0; the message is enough to catch the merges that left #274, #275 and #276 open.
* **Deliver #322 first:** it shrinks the file the other three children edit, which keeps their diffs small and their reviews independent.
* **The closing update is an epic PR, not part of the last child:** the lessons depend on having lived with the Claude-first period, not on any one child, so they are written when the epic closes.

## Implementation notes

Delivered by six PRs after PR 0 ([#324](https://github.com/mgasca/calendar/pull/324)). Three delivery sessions worked in parallel under the delivery map on #318, each owning named files or sections, and the maintainer merged every PR.

| PR | What it delivered | On `main` |
| --- | --- | --- |
| [#354](https://github.com/mgasca/calendar/pull/354) | ADR-0044 `accepted`, trigger "when the maintainer states it", in the record, the architecture model and `tools/README.md` | `d3d85d25` |
| [#356](https://github.com/mgasca/calendar/pull/356) | #322: screenshots, performance issues, reopened decisions and local operations moved out of `issue-handover` | `92c2800c` |
| [#357](https://github.com/mgasca/calendar/pull/357) | #355: the public-post guard reads the whole of a multi-line body (a shell lexer replaces a regex split) | `f7de6c96` |
| [#358](https://github.com/mgasca/calendar/pull/358) | #321: an inform hook when a PR to `main` has neither `Closes` nor `Refs`; the public-post paragraph dropped from the skill | `8e012a77` |
| [#360](https://github.com/mgasca/calendar/pull/360) | #320: `just tools handover-watch`, the watch as a repo tool with its seen-ID record | `091439e6` |
| [#362](https://github.com/mgasca/calendar/pull/362) | #319: the watch runs on an in-session `/loop 5m`; the skill says what a tick does | `f7693551` |

### Where things live

| Area | Location |
| --- | --- |
| The decision change | `docs/decisions/0044-claude-first-agent-automation.md`, `docs/architecture/calendar.architecture.json`, the amendment note in ADR-0042, the trigger sentence in `tools/README.md` |
| The handover protocol | `.claude/skills/issue-handover/SKILL.md` (60 lines, from 98 before #356) |
| Handover watch tool | `tools/handover-watch/` (`HandoverWatch.cs`, entry file, `tests/`), `tools/mod.just`, `tools/README.md`; state in the git-ignored `.plan/handover-watch/<issue>.seen` |
| Hook handlers and tests | `tools/agent-hooks/PullRequestLinkCheck.cs` (the inform note), `tools/agent-hooks/ShellCommand.cs` (the lexer), `tools/agent-hooks/tests/` |
| Screenshots on GitHub | `.claude/skills/github-screenshots/SKILL.md`, pointed at from `run-calendar`, the root `AGENTS.md` and `issue-handover` |
| Performance issues | `docs/benchmarks/README.md`, "Performance issues" |
| Reopened decisions | `docs/decisions/README.md`, "Reopening a decision", pointed at from `adr-draft` |
| Local operations | `.claude/skills/dream-weaver/references/routine.md`, "What stays local" |

### API

No changes.

### Testing

* `just tools test` runs the new suites with the rest: `tools/handover-watch/tests/` (49 tests on #360) and `tools/agent-hooks/tests/` (227 tests on #358, which includes #357's lexer cases).
* Each code fix was proved against the old code in a scratch worktree. #357's multi-line cases failed 6 tests on `main`'s guard. #360's negative controls failed 1 to 4 tests each (keeping empty review wrappers, counting a quoted footer, accepting a bare mention, dropping the author check, multi-line header cleaning).
* The docs corpus tests and the site build cover this card, the ADR and the READMEs the children changed.
* CI, CodeQL and the ADR-site publish passed on `main` at `f7693551`, which holds every delivering PR. That run is the evidence for criterion 7; `just check` was not run as a whole on one machine for this card.

Acceptance criteria:

1. Met by #354: the ADR names the trigger, lists what stays agent-neutral and what may be Claude-only, links ADR-0042 both ways, and the architecture model lists it as `accepted`.
2. Met by #362, checked by hand: the session delivering #319 and #320 ran its own handover on `/loop 5m` with the tool from the time #360 opened. The skill has no sleep loop.
3. Met by #360's tests and by real runs: on #318 the tool listed #324, #354, #357, #358 and #360 and dropped the PRs that only mention the epic in prose.
4. Met by #358's tests and by hand, by piping hook input into the handler; **not seen live in a Claude Code session** (see below).
5. Met, checked by reading the file on `main`: `issue-handover` holds Terms, Instruction provenance, Starting a handover, Watching, Questions and progress, and Resume and close out. "Starting a handover" was already part of the protocol and stays. Each moved section has a pointer where its reader starts.
6. Met by this PR.
7. Met by CI on `main` at `f7693551`, as above.

### What the Claude-first period made possible, and what it cost

* **Possible:** the harness now owns the watch's timing (`/loop`), so the skill lost its sleep-and-re-arm prose. The `Closes` rule became an inform hook with no prose twin it needs to keep in step, and its one *(hook)* marker in the root says the rule is now enforced. The repo tool stays callable from any shell (ADR-0017), and the skill says what an agent without a loop does: run the same command by hand every five minutes.
* **Possible:** writing the hook led to the first test of a whole PR body, and that found a hole in an existing invariant. The public-post deny guard had read only the first line of a multi-line body since story 0020 (#355, fixed in #357).
* **Cost:** a hook under development cannot be seen working in the session that builds it, because that session runs the hook code on `main`. The new PreToolUse note is proved by unit tests and by piping hook input into the handler, not by a live session.
* **Cost:** a Codex or Cursor session gets no `Closes` reminder and no loop. It gets the `AGENTS.md` line and the hand-run command instead, as ADR-0044 accepted.
* **Cost, measured on #360 and not yet paid off:** a tick of the watch makes 2 + 3N REST calls for N delivery PRs. #363 proposes one GraphQL query.

### Has the period ended?

No. The maintainer has not stated an end to the Claude-first period, so ADR-0044 stands. The maintainer will say when it ends ([#366](https://github.com/mgasca/calendar/pull/366#issuecomment-6692824098)), and ending it is a new ADR.

### Lessons learned, known issues and follow-ups

* **An ADR merged while `proposed`, again.** #324 merged with ADR-0044 still `proposed`, the pattern `adr-draft` warns about from ADRs 0014–0016. #354 fixed it as a separate docs PR before any child relied on it. Accepting in the card PR itself, when the maintainer approves it there, saves that PR.
* **A stack merge bypasses the reminder.** #362 reached `main` through the native stack merge with only `Refs #319` in its body, and #319 still closed with it. The new reminder fires on create or retarget to `main`, and a PR merged as part of a stack is never retargeted, so the reminder never fires for it. That last point is inferred from #358's design, not observed. Check issue state after a stack merge, as the skill's close-out already says.
* **The maintainer updates branches from GitHub.** #356 got a GitHub "Update branch" merge right after its stacked base, #354, merged. Fetching and merging the remote head before the push, as the skill says, kept both.
* **A guidance claim was untrue.** The root `AGENTS.md` said `.plan/` was git-ignored, but it was not until #360 added it.
* **The watch interval changed from 60 s to 5 minutes**, approved on #319. Ticks that find nothing were the common case, and each one costs a turn.
* **The docs build's link test is close to its timeout locally.** `tests/build.test.ts` "resolves every internal link and anchor" uses Vitest's default 5 s timeout. It hit that timeout once on #356, at a load average of about 8, and twice more on #366 at about 2.7. Run alone with a 60 s timeout it passed in 12.2 s over 129 pages (measured), so it is slow rather than flaky; CI has not hit it. It is not filed.
* **Known gap:** the PreToolUse note of #358 has not been seen live. The first session that runs `gh pr create` with such a body on the new `main` can confirm it.
* **Filed outside the epic:** the public-post guard does not read the body of `gh api --input`, a file or stdin ([#369](https://github.com/mgasca/calendar/issues/369), `bug`, `agent-found`). This predates the epic and was found while delivering #321.
* **Follow-ups:** #363 (one GraphQL query per watch tick). The saved Claude Code workflows deferred on #318 (close-out checks across a stack, review bursts, the issue sweep) can now call the tool and the hook.

## User guide

### Working with an agent on an issue

The maintainer starts a handover by asking the agent, in the Claude Code session that delivers the work, for an issue-driven handover of the issue by number. The agent starts a loop in that session with `/loop 5m` (shorter on request, never below a minute), so the maintainer does not need to keep the session in view. Each tick runs `just tools handover-watch <issue>`, which prints only the comments, reviews and pull-request state changes that are new since the last tick, across the issue and every pull request of the story; a tick with nothing new posts nothing. The loop lives in the session, not in a scheduled cloud routine, and stops after the close-out or when the session closes. An agent without such a loop runs the same command by hand every five minutes while the work is active.

When the maintainer answers a question, approves a step or merges a pull request on GitHub, the next check picks it up and the agent continues. Before a pull request to the main branch is created or retargeted, the agent is reminded if the description names no issue it refers to or closes, so the issue is not left open after the merge.

Guidance about screenshots, performance evidence, reopened decisions and local operations lives with the activity it describes, so a handover loads only the handover rules.
