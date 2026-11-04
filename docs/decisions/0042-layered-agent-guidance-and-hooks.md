---
status: proposed
date: 2026-11-04
decision-makers: mgasca, Claude (AI assistant)
---

# Layer agent guidance by scope and enforce its invariants with Claude Code hooks built as repo tools

## Context and Problem Statement

`AGENTS.md`, imported into `CLAUDE.md`, is the guidance every AI coding agent reads at the start of a session. It grew one lesson at a time to 148 lines and about 4,250 words (PRs #12, #64, #70, #122, #123, #129 and the seven PRs of story [0018](../stories/0018-preserve-transcript-insights.md)). Every session pays for all of it, although the backend query lessons, the frontend render lessons, the issue-handover protocol and the file-based-tool formatting procedure each matter in a minority of sessions. Several passages are invariants rather than advice: never discard an unstaged fix with `git checkout --` (the failure in #189), never touch the shared database from a worktree without meaning to, never hand-edit generated contract files, never publish machine paths. Prose is a guideline an agent may judge inapplicable. Where should each kind of guidance live, and how are the invariants enforced?

## Decision Drivers

* **D1 Context cost per session**: the text loaded into every session should be what every session needs; area practice should load only when an agent works in that area.
* **D2 Reliable invariants**: rules that protect uncommitted work, shared resources and the public record must hold even when the agent decides the rule does not apply, and must stop the action before it happens.
* **D3 Agent neutrality**: Codex, Cursor and other agents read `AGENTS.md` too; the guidance, including the enforced rules, must still reach them.
* **D4 Same quality bar and toolchain**: enforcement code is analysed, formatted and tested like the other repo tooling ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)), with no new language or runtime.
* **D5 Fast feedback**: a guard runs on every shell command or edit, so it must answer in well under a second and never block the session when it cannot run.
* **D6 One copy of each rule**: a rule should live in one place, so copies cannot drift.

## Considered Options

* Layered guidance (root, nested `AGENTS.md` with `CLAUDE.md` shims, skills) and hooks as a .NET file-based tool
* Prose only in the root file (status quo)
* Layered guidance and hooks as inline shell in `.claude/settings.json`
* Layered guidance and checks in lint and CI only
* Claude-only path-scoped rules and hooks

## Decision Outcome

Chosen option: "Layered guidance (root, nested `AGENTS.md` with `CLAUDE.md` shims, skills) and hooks as a .NET file-based tool", because it cuts the always-loaded text to what every session needs (D1), stops a destructive action before it happens (D2), keeps every rule readable by any agent as nested `AGENTS.md` files and one-line prose statements (D3), and reuses the [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) tooling pattern with tests run by `just tooling` (D4), at a measured cost of about a quarter of a second per hook call (D5). It accepts that a hooked rule exists twice, as code and as one line of prose (D6).

| Driver | **Layered guidance + .NET hooks (chosen)** | Prose only (status quo) | Layered + inline shell hooks | Layered + lint/CI checks | Claude-only rules + hooks |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Context cost per session | ★★★ | ☆☆☆ | ★★★ | ★★★ | ★★★ |
| D2 Reliable invariants | ★★★ | ☆☆☆ | ★★★ | ★☆☆ | ★★★ |
| D3 Agent neutrality | ★★★ | ★★★ | ★★★ | ★★★ | ★☆☆ |
| D4 Same quality bar and toolchain | ★★★ | ★★☆ | ★☆☆ | ★★★ | ★★★ |
| D5 Fast feedback | ★★☆ | ★★★ | ★★★ | ★☆☆ | ★★☆ |
| D6 One copy of each rule | ★★☆ | ★★★ | ★★☆ | ★★☆ | ★☆☆ |

### Layers

* **Root `AGENTS.md`** (target: at most 90 lines and 1,500 words): overview, commands, architecture invariants, the story and issue workflow, working on several changes, testing principles, the redaction rule, and pointers to the layers below. `CLAUDE.md` stays a shim that imports it.
* **Nested `backend/AGENTS.md` and `frontend/AGENTS.md`**: the practices and testing notes of one stack. Each has a two-line `CLAUDE.md` beside it that imports it, because Claude Code loads a nested `CLAUDE.md` when a file under that directory is read or edited, while Codex and Cursor read a nested `AGENTS.md` natively. Each opens by saying the root still applies.
* **Skills** (`.claude/skills/<name>/SKILL.md`): multi-step procedures used on request, such as `issue-handover`, `adr-draft`, `story-draft` and `run-calendar`.
* **Folder READMEs** (`docs/*/README.md`, `tools/README.md`): conventions that people read too. The root points at them instead of restating them.
* **Hooks** (`tools/agent-hooks/`, wired in the git-tracked `.claude/settings.json`): the invariants below. Every hooked rule keeps a one-line statement in the root marked *(hook)*, so agents without hooks still see it.

### Hook policy

* **Deny** actions that destroy work or damage the public record: `git restore` or `git checkout --` over paths with unstaged changes; `gh` posts whose body carries absolute machine paths or private session handles; edits of generated files (`contracts/openapi.json`, `schema.gen.ts`, lock files).
* **Ask** before `just db-*` or `docker compose` runs from a linked worktree, because the Compose project, volume and port are shared with the human's checkout and the user may still want that.
* **Inform** otherwise: C# lines over 140 characters after an edit (S103, which nothing fixes automatically), a stale API contract when the agent stops (blocked once, then let through), and a session-start line that compiles the tool and names the runtime.
* **Spawn only when relevant**: each handler carries an `if` permission-rule filter (`Bash(git *)`, `Bash(gh *)`, `Bash(just *)`, `Bash(docker *)`; `Edit(**/openapi.json)` and the other generated paths; `Edit(**/*.cs)`), so an unrelated command or edit starts no process. The filter is best-effort: when Claude Code cannot tell which commands a Bash input runs, the hook runs anyway and decides in-process.
* **Degrade to prose** when the tool cannot run (an SDK below 10.0.300 rejects `#:include`): Claude Code treats that exit as non-blocking, and the one-line rules remain.

### Consequences

* Good, because a session reads about a third of the text it read before, and the backend or frontend practice arrives exactly when a file of that stack is touched.
* Good, because the four invariants that caused real incidents (#189, the shared database, stale contracts, machine paths in posts) are refused mechanically for Claude Code sessions.
* Good, because the hooks are an ordinary [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) tool: analysers, `dotnet format whitespace`, xUnit tests per decision branch, `just tooling` and `just tool-versions` cover it without a new job.
* Bad, because every `git`, `gh`, `just` or `docker` command and every edit of a C# or generated file now spawns a process (about 0.25 s when cached, 4.5 s on the first run after the tool's source changes); mitigated by the `if` filters and by a `SessionStart` hook that compiles it.
* Bad, because a hooked rule exists twice, as code and as a line of prose, and the two must be kept in step by review.
* Bad, because `.claude/settings.json` is now shared behaviour for every Claude Code user of the repo; personal overrides go in the git-ignored `.claude/settings.local.json`.
* Neutral, because other agents keep the prose and lose nothing they had; the hooks add enforcement only where Claude Code runs.
* Neutral, because area practice is unseen until a file of that area is read or edited, and never for edits made through shell commands; the root keeps the architectural invariants for that reason.

### Confirmation

* `just tooling` (local and the CI `Tooling` job) runs `tools/agent-hooks/tests/agent-hooks.tests.cs` and the whitespace check on `tools/`; `just tool-versions` checks its package pins.
* Story 0020 (card in [PR #220](https://github.com/mgasca/calendar/pull/220)) records the acceptance criteria: file budgets, rule preservation, one *(hook)* line per hooked rule, and a live check that a hook refuses `git restore` on a dirty file and an edit of `contracts/openapi.json`.
* Reviewers check that a new rule added to `AGENTS.md` goes to the layer this ADR names: an invariant becomes a hook with a one-line statement, area practice goes to the nested file, a procedure to a skill or README.

## Pros and Cons of the Options

### Layered guidance (root, nested `AGENTS.md` with `CLAUDE.md` shims, skills) and hooks as a .NET file-based tool

* Good, because **D1 Context cost per session**: the root shrinks to what every session needs and the rest loads on demand.
* Good, because **D2 Reliable invariants**: a `PreToolUse` deny stops the action before it runs, whatever the agent concluded from the prose.
* Good, because **D3 Agent neutrality**: nested `AGENTS.md` files are read natively by Codex and Cursor, and every hooked rule keeps its prose line.
* Good, because **D4 Same quality bar and toolchain**: the tool follows [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) exactly, with analysers, formatting and tests discovered by `just tooling`.
* Neutral, because **D5 Fast feedback**: 0.21–0.26 s per call when cached (measured on `tools/tool-versions`, 2026-11-04), 4.5 s after a source change; acceptable, not free.
* Bad, because **D6 One copy of each rule**: each hooked rule exists as code and as one line of prose.

### Prose only in the root file (status quo)

* Good, because **D3 Agent neutrality**: one file, read by every agent.
* Good, because **D5 Fast feedback**: nothing runs.
* Good, because **D6 One copy of each rule**: every rule has one home.
* Neutral, because **D4 Same quality bar and toolchain**: there is no code to hold to a bar, and no test that a rule is followed.
* Bad, because **D1 Context cost per session**: every session reads 4,250 words, most of them irrelevant to it.
* Bad, because **D2 Reliable invariants**: #189 happened with the rule written down; prose cannot stop an action.

### Layered guidance and hooks as inline shell in `.claude/settings.json`

* Good, because **D1 Context cost per session**: same layering as the chosen option.
* Good, because **D2 Reliable invariants**: same hook events and decisions.
* Good, because **D3 Agent neutrality**: same prose lines for other agents.
* Good, because **D5 Fast feedback**: a shell one-liner answers in milliseconds.
* Neutral, because **D6 One copy of each rule**: same duplication as the chosen option.
* Bad, because **D4 Same quality bar and toolchain**: inline shell and `jq` are untested, unanalysed, hard to read in JSON strings, and contradict [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md), which reserves shell for bootstrap checks.

### Layered guidance and checks in lint and CI only

* Good, because **D1 Context cost per session**: same layering as the chosen option.
* Good, because **D3 Agent neutrality**: CI applies to every contributor and agent alike.
* Good, because **D4 Same quality bar and toolchain**: checks are ordinary tooling.
* Bad, because **D2 Reliable invariants**: CI cannot stop `git restore` from discarding a fix or a `gh` post from publishing a path; it sees only what is pushed, after the fact.
* Bad, because **D5 Fast feedback**: minutes later, on the PR, when the damage is done.
* Neutral, because **D6 One copy of each rule**: a rule exists as prose and as a check.

### Claude-only path-scoped rules and hooks

* Good, because **D1 Context cost per session**: `.claude/rules/*.md` with `paths:` load only when matching files are touched.
* Good, because **D2 Reliable invariants**: same hooks as the chosen option.
* Good, because **D4 Same quality bar and toolchain**: same tool.
* Neutral, because **D5 Fast feedback**: same hook cost.
* Bad, because **D3 Agent neutrality**: path-scoped rules are a Claude Code feature; Codex and Cursor would see nothing for the backend or frontend.
* Bad, because **D6 One copy of each rule**: keeping other agents informed would mean a second copy of the area practice.

## More Information

* Facts verified on 2026-11-04 against the Claude Code documentation (memory, hooks, skills and best-practices pages): a nested `CLAUDE.md` loads when Claude reads, writes or edits a file in that subdirectory; `@imports` resolve relative to the importing file; hook matchers are regexes on the tool name, a hook blocks with exit 2 or `permissionDecision: deny`, `ask` prompts, `additionalContext` informs, and a `Stop` hook receives `stop_hook_active`; the documentation recommends keeping each instruction file under 200 lines and says rules that must always hold belong in hooks because "CLAUDE.md is for guidelines". Whether a nested `AGENTS.md` is read natively when a root `CLAUDE.md` exists is undocumented, hence the shims.
* Related: [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md) (tool layout, SDK 10.0.300 minimum for `#:include`), [ADR-0016](0016-local-database-provisioning.md) (the shared Compose defaults the database guard protects), story [0018](../stories/0018-preserve-transcript-insights.md) (the lessons that became invariants) and story 0020 (delivery; card in [PR #220](https://github.com/mgasca/calendar/pull/220), epic #216).
* Revisit when: hook latency is still felt in sessions despite the `if` filters; Claude Code documents native nested `AGENTS.md` loading under a root `CLAUDE.md` (drop the shims); or a rule in the root is ignored repeatedly (promote it to a hook). The triggers are also noted in `tools/README.md` next to the agent-hooks section.
