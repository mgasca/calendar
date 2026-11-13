---
status: implemented
date: 2026-11-13
issue: https://github.com/mgasca/calendar/issues/702
pr:
  - https://github.com/mgasca/calendar/pull/703
adrs: []
---

# 0062 Install the graphify skill and point agents at the committed graph

## Story

> As the maintainer, I need the graphify skill, its hooks and a short rule for agents to live in the repository, so that every checkout, worktree and agent session can refresh and query the committed knowledge graph the same way, without a per-machine install of the skill.

Tracked in issue #702. Card in [#703](https://github.com/mgasca/calendar/pull/703); the skill, hooks and guidance are delivered in the pull request stacked on it.

## Background

Story [0061](0061-commit-the-graphify-knowledge-graph.md) committed the graph that `/graphify` builds (`graphify-out/`) and kept a run's local state out of git. It left two things out on purpose: the skill that builds and queries the graph, and any guidance telling agents to use it. Today the skill exists only where `graphify install` was run, so a fresh checkout or a new worktree has the graph but not the `/graphify` command, and the repository's guidance says nothing about the graph.

The `graphify` tool installs three kinds of file for Claude Code in a project: the skill (`.claude/skills/graphify/`, with its reference files), a pointer to it in `.claude/CLAUDE.md`, and a `graphify` section in `AGENTS.md` with the rules for agents. It also registers three hooks in `.claude/settings.json`, which run `graphify hook-guard` before a search (`Bash|Grep`), before a read (`Read|Glob`) and on compaction. The hooks print a reminder to query the graph first; they do not block a call.

### Agreed scope

* **Commit the skill:** `.claude/skills/graphify/` (the `SKILL.md`, the `references/` files and `.graphify_version`) and `.claude/CLAUDE.md`, so `/graphify` is available in every checkout.
* **Add the agent rule:** the `graphify` section of `AGENTS.md`: query the graph (`graphify query`, `path`, `explain`) before the first search or source read for a codebase question, run `graphify update .` after changing code, and do not flag a large `graph.json` diff as churn.
* **Register the three hooks** in `.claude/settings.json`, beside the existing hooks of `tools/agent-hooks`, which are not changed.
* **Keep the tool optional for people.** The hooks must not fail a session on a machine where `graphify` is not installed (see criterion 3).

### Not in this story

* **Keeping the graph fresh.** Rebuilding it on a schedule, in CI or by a hook stays out, as in story 0061. The `AGENTS.md` rule asks an agent to run `graphify update .` after code changes, which refreshes code only and costs no model tokens.
* **Installing the `graphify` program.** `just setup` and `just doctor` do not install or check it. Whether they should is a follow-up if the hooks prove to need it.
* **Other agents' hooks.** Only Claude Code runs the hooks (ADR [0044](../decisions/0044-claude-first-agent-automation.md)). Other agents read the `AGENTS.md` rule.
* **Changing the skill.** The files are committed as the tool wrote them, so a later `graphify install` shows only real differences.

### Acceptance criteria

1. **Given** a fresh checkout of `main`, **when** Claude Code starts in it, **then** `/graphify` is listed as a skill, without running `graphify install`.
2. **Given** the change, **when** `AGENTS.md` is read, **then** it has a `graphify` section that tells an agent to query the graph before searching, to run `graphify update .` after code changes, and not to flag a large `graph.json` diff.
3. **Given** a machine where the `graphify` program is not installed, **when** Claude Code runs a Bash, Grep, Read or Glob call, **then** the session carries on, and the call is not blocked by the missing program.
4. **Given** a machine with `graphify` installed, **when** an agent runs a Bash, Grep, Read or Glob call, **then** a hook reminds it that the graph exists, and the call still runs.
5. **Given** the hooks, **when** `.claude/settings.json` is read, **then** the hooks of `tools/agent-hooks` are unchanged, and the file is valid JSON that ends with a newline.
6. **Given** the change, **when** the maintainer runs `just docs test` and `just docs build`, **then** they pass.
7. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Automation under `.claude/` may be Claude Code only; guidance files stay readable by every agent | The hooks and skill are Claude Code only, and the `AGENTS.md` rule is the part other agents read |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repository tooling is written in .NET, never Python, Node or shell | The graphify skill and its `graphify` program are a third-party tool installed per developer, not repository tooling. The story adds no script of ours |

No new ADR is expected. Story 0061 said that a rule that agents consult the graph, or a job that rebuilds it, would be a decision for an ADR. This story adds the rule but no job, and the rule is advice that an agent can set aside, so it is recorded here. If the hooks become blocking, or a job rebuilds the graph, that needs an ADR.

### Other decisions (not ADR-worthy)

* **Commit the tool's output unchanged.** The skill is about 1,800 lines of third-party instructions. Editing them would make every upgrade a merge, so the card records what to check instead (criteria 3 and 5).
* **Leave out the stray files a run left behind.** `package.json` and `package-lock.json` at the repository root (a placeholder `node.js` dependency, not the repository's), `.claude/settings.json.graphify-bak` (a backup of `settings.json`) and `.claude/worktrees/` (agent worktrees) are not part of the install and are not committed.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| The skill and its references | `.claude/skills/graphify/` |
| The pointer to the skill | `.claude/CLAUDE.md` |
| The rule for agents | `AGENTS.md`, section `graphify` |
| The hooks | `.claude/settings.json` |

### API

No changes.

### Testing

* Criteria 1 to 4 are behaviour of Claude Code and the `graphify` program, so they have no committed test. Criterion 1 follows from the skill being a tracked file under `.claude/skills/`: a new worktree contains it. Not observed in a fresh Claude Code session. Criterion 4: with `graphify` installed, `graphify hook-guard search` prints a reminder and exits 0.
* Criterion 3 was checked with `graphify` removed from `PATH`: the hook command fails with exit code 127. Claude Code treats an exit code other than 2 as a non-blocking error, so the call is not blocked; whether it shows a notice on every call was not observed.
* Criterion 5: `.claude/settings.json` parses as JSON and ends with a newline (the install had removed the final newline, restored here); the existing hooks are untouched in the diff.
* Criterion 6: `just docs test` passes. `just docs build` fails here on a 5 s timeout of the link-check test, which also fails on `origin/main`, so it was not verified locally. `just check` was not run in full.

### Lessons learned, known issues and follow-ups

* **Machines without `graphify`.** The installed command is `graphify hook-guard …` with no guard of its own, so it exits 127 on every Bash, Grep, Read, Glob call and on compaction. Guarding it (`command -v graphify >/dev/null || exit 0; …`) would make the file differ from what `graphify install` writes. Left as the tool wrote it; decide on the PR.
* **A second install run** rewrites `.claude/settings.json` and may drop the final newline again, and leaves a `.graphify-bak` backup and root `package.json` files, which are not committed.
* **`just doctor`** does not check for `graphify`; a follow-up if the missing-program notices prove noisy.

## User guide

### The task the user performs

Type `/graphify` in Claude Code to build or refresh the graph, or ask a question about the codebase and the agent queries the committed graph before it searches. The program that answers the queries, `graphify`, is installed per developer; without it the hooks have nothing to run, and the repository carries on as before.
