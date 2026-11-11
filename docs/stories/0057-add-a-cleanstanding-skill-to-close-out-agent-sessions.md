---
status: implemented
date: 2026-11-11
issue: https://github.com/mgasca/calendar/issues/669
pr:
  - https://github.com/mgasca/calendar/pull/670
adrs: ["0042", "0044"]
---

# 0057 Add a cleanstanding skill so an agent session can be closed out safely

## Story

> As a maintainer who ends agent sessions often, I need a `cleanstanding` skill that checks whether a session still has outstanding work, so that nothing is lost when the session is archived and a finished session leaves no stray processes, worktrees or containers behind.

Tracked in issue #669.

## Background

Agent sessions in this repo leave state in several places: uncommitted and unpushed work, branches and worktrees, open PRs with checks still running, dev servers and watchers, throwaway Docker stacks (the `run-calendar` skill's PostgreSQL 55432, API 55041 and Vite 55173), and promises made in the conversation. Today the maintainer has to check each place by hand before archiving a session, and cleaning up too early destroys the evidence of work that was still in flight. Cleanup is also risky because the Compose project, port and volume of the ordinary `just db` recipes are shared by every checkout ([AGENTS.md](../../AGENTS.md), "Working on several changes at once").

The `cleanstanding` skill answers one question: is anything from this session still outstanding? If so it reports concisely and changes nothing. If not, it cleans up what the session created, so the session can be archived.

### Agreed scope

* **Ownership first:** the skill builds the list of what the session created (branches, worktrees, PRs, issues, PIDs, containers, volumes, ports, temp directories) from the conversation, not from the machine. Anything else is reported when relevant and never touched.
* **Read-only outstanding-work check:** git state (uncommitted, stashed, unpushed, unmerged branches, worktrees), session PRs (state, draft, checks, review status, remote head against local `HEAD`), session issues (open scope, unanswered questions, stale card), running processes and throwaway-stack resources, and the conversation (undone requests, pending tasks, promised follow-ups, skipped or unrunnable checks).
* **Outstanding means report and stop:** one verdict line, then the items most-blocking first, each with evidence and the single next action, plus skipped checks. Nothing is cleaned, not even partially.
* **Nothing outstanding means clean up:** stop the session's own processes, tear down its throwaway stack with the `run-calendar` skill's teardown (never `just db down` or `just db reset`), remove merged or fully pushed worktrees without `--force`, delete merged local branches with `git branch -d`, delete the session's own temp files, and `git fetch --prune`. Ownership is verified immediately before each removal.
* **Honest verdict:** the skill says what each check covered and which did not run, and ends a successful run with `Clean: ready to archive`.

### Not in this story

* **Merging, closing issues or PRs, deleting remote branches or posting to GitHub:** cleanup never does these unless the user asked for them in the session.
* **A tool, hook or recipe** that automates the check; the skill is guidance for the agent, written in Markdown.
* **Archiving the session itself:** that belongs to the harness; the skill only prepares for it.
* **Support for other agents:** the skill lives under `.claude/skills/`, which ADR-0044 allows to be Claude Code only.

### Acceptance criteria

1. **Given** a session with uncommitted, stashed or unpushed changes, **when** I run `cleanstanding`, **then** it reports them as outstanding with counts and the next action, and removes nothing.
2. **Given** a session PR that is open, draft, failing checks, awaiting review or whose remote head differs from local `HEAD`, **when** I run `cleanstanding`, **then** it reports the PR as outstanding with its state; a merged PR is not reported.
3. **Given** the conversation holds a request not yet done, a pending task, or a check that was skipped, **when** I run `cleanstanding`, **then** it lists each one and states the skipped check plainly.
4. **Given** nothing is outstanding and the session started a dev server, a throwaway stack and a worktree on a merged branch, **when** I run `cleanstanding`, **then** it stops the server, tears down the stack with the `run-calendar` teardown, removes the worktree and the merged branch, and ends with `Clean: ready to archive`.
5. **Given** a resource whose ownership is uncertain (for example the shared Compose project, or a process the session did not start), **when** I run `cleanstanding`, **then** it leaves the resource alone and says so.
6. **Given** a worktree that `git worktree remove` refuses to delete, **when** I run `cleanstanding`, **then** it treats the session as having outstanding work and reports instead of forcing removal.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Agent guidance is layered: root and area `AGENTS.md`, skills and hooks | The behaviour is a skill, not a rule in `AGENTS.md`, because it applies only when a session ends. |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Automation under `.claude/` may be Claude Code only | The skill is Claude Code only for now. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Report or clean, never both:** cleaning a session that still has work in flight would destroy the evidence the owner needs, so the two outcomes are exclusive.
* **Ownership from the conversation:** the machine holds other sessions' branches, containers and processes, so matching by name or port alone could remove someone else's resources.
* **Non-forcing commands:** `git worktree remove` and `git branch -d` without force refuse when work would be lost, and that refusal is itself the signal that the session is not clean.
* **No GitHub posts:** the skill is local housekeeping; posting belongs to `issue-handover`.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| The skill | `.claude/skills/cleanstanding/SKILL.md` |
| Story card | `docs/stories/0057-add-a-cleanstanding-skill-to-close-out-agent-sessions.md` |

### API

No changes.

### Testing

* No automated test: the skill is a Markdown instruction file. Criteria 1 to 6 describe agent behaviour and were not exercised on a real session before merge, by the owner's decision to close the issue on merge; the first real run is the check, and any gap it shows belongs in a follow-up issue.
* `just docs test` and `just docs build` validate the card.

### Lessons learned, known issues and follow-ups

* The skill was drafted in one session and merged without a real run (see Testing). Follow-ups, if a run shows gaps, are tracked as new issues.

## User guide

### Closing out a session

Ask the agent to run `cleanstanding` (or say "wrap up", "close out" or "archive this session") when you think a session is finished.

* If anything is still open, the agent replies with a short list: what it is, its state and what to do next. It cleans nothing, so you can finish the work and run `cleanstanding` again.
* If nothing is open, the agent stops the processes it started, tears down its throwaway app stack, removes its merged worktrees and branches and temporary files, and tells you `Clean: ready to archive`.

It never merges, closes issues, deletes remote branches or touches the shared database stack unless you ask it to.
