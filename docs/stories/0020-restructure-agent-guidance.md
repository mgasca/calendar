---
status: planned
date: 2026-11-04
issue: https://github.com/mgasca/calendar/issues/216
pr:
  - https://github.com/mgasca/calendar/pull/220
  - https://github.com/mgasca/calendar/pull/221
  - https://github.com/mgasca/calendar/pull/222
  - https://github.com/mgasca/calendar/pull/223
adrs: ["0017"]
---

# 0020 Restructure agent guidance: a short root AGENTS.md, nested area files, a skill and hooks

## Story

> As a calendar maintainer, I need the shared agent guidance to be short where every session reads it, disclosed on demand where only some sessions need it, and enforced mechanically where a rule must always hold, so that agents follow it reliably and each session pays only for the guidance it uses.

Tracked in [epic #216](https://github.com/mgasca/calendar/issues/216). Card PR: [#220](https://github.com/mgasca/calendar/pull/220); delivery PRs [#221](https://github.com/mgasca/calendar/pull/221) (skill), [#222](https://github.com/mgasca/calendar/pull/222) (hooks and ADR-0042), [#223](https://github.com/mgasca/calendar/pull/223) (restructure).

## Background

`AGENTS.md` is imported into `CLAUDE.md` and read by every agent session. It grew one lesson at a time: PR #12 created it, #64 and #70 added the performance lessons, #122 and #123 the analyzer traps, #129 the story workflow, and the seven PRs of [0018](0018-preserve-transcript-insights.md) the transcript insights. On 2026-11-04 it was 148 lines and about 4,250 words. Every session pays for all of it, although the backend query lessons, the frontend render lessons, the issue-handover protocol and the file-based-tool formatting procedure each matter in a minority of sessions.

Several passages are rules that must always hold: never `git checkout --` or `git restore` over an unstaged fix (the failure in #189), never run the shared `db-*` recipes from a worktree without meaning to (the shared Compose defaults recorded by 0018), never hand-edit the generated contract files, never publish absolute machine paths or private session handles. Instruction text is a guideline that an agent may judge inapplicable; Claude Code's own guidance says such rules belong in hooks.

Facts checked on 2026-11-04, which shape the design:

* The repo has no hooks and no `.claude/settings.json`. Four skills exist (`adr-draft`, `run-calendar`, `story-draft`, `tech-doc-review`); `adr-draft` and `story-draft` refer to `AGENTS.md` sections by name.
* Claude Code loads a nested `CLAUDE.md` lazily when it reads or edits a file under that directory, and `@imports` resolve relative to the importing file. Codex and Cursor read nested `AGENTS.md` natively. Hooks match on tool name; a deny or ask decision blocks or prompts, and additional context informs; shared hooks live in a git-tracked `.claude/settings.json`.
* [ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) makes every repo tool a .NET 10 file-based app under `tools/<name>/`, tested by `just tooling`. A cached `dotnet run` of `tools/tool-versions` took 0.21–0.26 s (first run 4.5 s), fast enough for a hook on every Bash or Edit call.

This story extends 0018, which made the guidance complete; this one makes it effective. The planned review of the drafting skills ([0009](0009-review-drafting-skills-for-clarity-and-simplicity.md)) stays independent: this story only repoints two references in those skills.

### Agreed scope

* **Short root:** `AGENTS.md` keeps only what every session needs (overview, commands, architecture invariants, the story and issue workflow, working on several changes, testing principles, the redaction rule), at most 90 lines and 1,500 words, with a pointer to the nested files, the skills and the hooks.
* **Nested area files:** `backend/AGENTS.md` and `frontend/AGENTS.md` hold the backend and frontend practices and testing notes. Each has a two-line `CLAUDE.md` shim that imports it, so Claude Code loads it when a file under that directory is touched and other agents read the same text natively. Each stays under 200 lines and opens by saying that the root file still applies.
* **Tooling procedures in `tools/README.md`:** the ADR-0017 layout, `tool_dirs` inclusion and test discovery, the `#:include` SDK minimum, the scratch-project formatting procedure and the lock-file notes move there. No new skill for them: the procedure is rare and people read it too.
* **`issue-handover` skill:** the "Public GitHub posts and optional issue handovers" section becomes `.claude/skills/issue-handover/SKILL.md`, loaded only when the user asks for that mode or one of its behaviours. The general redaction rule stays in the root.
* **Hooks as an ADR-0017 tool:** `tools/agent-hooks/` is run by Claude Code from a git-tracked `.claude/settings.json`. Guards that protect work or the public record deny (`git restore`/`git checkout --` over unstaged changes, `gh` posts carrying machine paths or session handles, bare `git stash`/`pop`/`drop`, edits of generated files). The shared-database guard asks, because the user may want the shared database. The rest informs: C# lines over 140 characters after an edit, a stale contract when the agent stops, and a session-start line that warms the build cache and names the SDK.
* **Rules survive the move:** every hooked rule keeps a one-line statement in the root marked *(hook)*, so agents without hooks still see it. The decision is recorded in a new ADR (0042) that lands in the hooks PR.
* **Delivery as an epic:** one child issue and one PR per deliverable (#217 skill, #218 hooks and ADR, #219 restructure), as 0018 did.

### Not in this story

* Changes to what any rule requires. Wording, placement and enforcement change; a rule that turns out to be wrong gets its own issue.
* Lint rules for guidance that is really a code rule, such as `new QueryClient()` outside `createQueryClient` or `new Intl.DateTimeFormat` outside `dayTime.ts`. Proposed as a follow-up issue at close-out.
* Hook `if` argument filters that avoid spawning the tool for unrelated commands. Measured follow-up once the cached cost is observed in real sessions.
* The `issue-sweep` and `issue-closeout` skills proposed in #168, and the content review of `adr-draft` and `story-draft` (0009).
* Hooks for agents other than Claude Code. Their rules stay in prose.

### Dependencies

Story 0019 (the justfile modules, [PR #214](https://github.com/mgasca/calendar/pull/214)) is open in parallel; the stories index row is the only shared file. If #214 moves `tool_dirs` into a justfile module, the hooks PR re-verifies that `just tooling` still discovers `tools/agent-hooks/tests`.

### Acceptance criteria

1. **Given** the restructure PR, **when** the files are measured, **then** the root `AGENTS.md` is at most 90 lines and 1,500 words, and every instruction file (`AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`) is under 200 lines.
2. **Given** the old `AGENTS.md`, **when** it is compared with the new files, **then** every rule, command and path appears in exactly one new place, or the PR description lists it as removed because a folder README or skill already states it.
3. **Given** a rule enforced by a hook, **when** the root `AGENTS.md` is read, **then** the rule is still stated in one line marked *(hook)*.
4. **Given** `backend/CLAUDE.md` and `frontend/CLAUDE.md`, **when** they are read, **then** each holds only one comment and the `@AGENTS.md` import.
5. **Given** the hooks PR, **when** `just tooling` runs, **then** its output lists `tools/agent-hooks/tests/agent-hooks.tests.cs` and the whitespace check on `tools`.
6. **Given** a hook decision branch (deny, ask, inform, pass, loop guard, malformed input), **when** the tests run, **then** a test feeds that branch sample input and asserts the exit code and output.
7. **Given** a fresh Claude Code session, **when** a file under `backend/` is read, **then** the loaded context lists `backend/CLAUDE.md`; likewise for `frontend/`.
8. **Given** a worktree with an unstaged edit, **when** an agent runs `git restore` on that file through Claude Code, **then** the hook refuses with a reason; and an edit of `contracts/openapi.json` is refused the same way.
9. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling is .NET file-based apps with analyzers and tests per folder | The hooks tool follows this layout and is discovered by `just tooling`; its tests use `#:include`, so it needs SDK 10.0.300 and degrades to prose-only rules on older SDKs. |

A new ADR (0042) records that agent guidance is layered (root, nested area files, skills) and that invariants are enforced with Claude Code hooks built as ADR-0017 tools, with the deny/ask/inform policy. It is drafted with `adr-draft` and lands in the hooks PR.

### Other decisions (not ADR-worthy)

* **Nested `AGENTS.md` plus a `CLAUDE.md` shim, not `.claude/rules`:** path-scoped rules are Claude-only, while nested `AGENTS.md` is read natively by Codex and Cursor. The shim exists because nested `AGENTS.md` under a root `CLAUDE.md` is undocumented for Claude Code.
* **The shared-database guard asks instead of denying:** a maintainer in a worktree may want the shared database; the prompt names the isolated stack from the `run-calendar` skill as the alternative.
* **The `issue-handover` skill stays model-invocable:** the old section applied to "its individual behaviours" too, so a prose request such as "watch PR N for review comments" must still load it. The description is scoped to explicit requests.
* **No `(hook)` markers before the hooks exist:** the hooks PR precedes the root rewrite, so the rewritten rules point at hooks that are already in place.
* **`tools/README.md` instead of a `repo-tooling` skill:** about thirty lines of gotchas that people also read, with precedent in `tools/infra/README.md`.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Root guidance | `AGENTS.md`, `CLAUDE.md` |
| Area guidance | `backend/AGENTS.md`, `backend/CLAUDE.md`, `frontend/AGENTS.md`, `frontend/CLAUDE.md` |
| Tooling procedures | `tools/README.md` |
| Handover protocol | `.claude/skills/issue-handover/SKILL.md` |
| Hooks tool and tests | `tools/agent-hooks/agent-hooks.cs`, `tools/agent-hooks/Hooks.cs`, `tools/agent-hooks/tests/agent-hooks.tests.cs` |
| Hook configuration | `.claude/settings.json` |
| Decision | `docs/decisions/0042-*.md`, `docs/architecture/calendar.architecture.json` (`metadata.adrs`) |

### API

No changes.

### Testing

* xUnit tests per hook decision branch, feeding sample hook input and asserting exit code and JSON output; worktree detection uses temporary directories with a `.git` file or directory.
* `just tooling` discovery and `dotnet format whitespace` on `tools`.
* Smoke tests by piping sample input into each subcommand, plus a live check in a session (criterion 8).
* Docs corpus tests and the site build for the card and the ADR.
* Guidance semantics remain reviewed by hand; no test proves that future agents follow prose.

### Lessons learned, known issues and follow-ups

*To be completed on delivery.*

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Working in the repository with an agent

Open a session anywhere in the repository and the agent reads a short root guide. When it starts editing backend or frontend code, it also picks up that area's practices. Ask for an issue-driven handover and it loads that protocol. If it tries to discard unstaged work, post a machine path to GitHub, hand-edit a generated file or touch the shared database from a worktree, a hook stops or questions it and explains why, so you do not have to.
