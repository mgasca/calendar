---
status: implemented
date: 2026-11-04
issue: https://github.com/mgasca/calendar/issues/216
pr:
  - https://github.com/mgasca/calendar/pull/220
  - https://github.com/mgasca/calendar/pull/221
  - https://github.com/mgasca/calendar/pull/222
  - https://github.com/mgasca/calendar/pull/223
  - https://github.com/mgasca/calendar/pull/226
  - https://github.com/mgasca/calendar/pull/229
adrs: ["0017", "0042"]
---

# 0020 Restructure agent guidance: a short root AGENTS.md, nested area files, a skill and hooks

## Story

> As a calendar maintainer, I need the shared agent guidance to be short where every session reads it, disclosed on demand where only some sessions need it, and enforced mechanically where a rule must always hold, so that agents follow it reliably and each session pays only for the guidance it uses.

Tracked in [epic #216](https://github.com/mgasca/calendar/issues/216). Card PR: [#220](https://github.com/mgasca/calendar/pull/220); delivery PRs [#221](https://github.com/mgasca/calendar/pull/221) (skill), [#222](https://github.com/mgasca/calendar/pull/222) (hooks and ADR-0042), [#223](https://github.com/mgasca/calendar/pull/223) (restructure) and [#226](https://github.com/mgasca/calendar/pull/226) (a review suggestion on #221 that missed its merge); close-out [#229](https://github.com/mgasca/calendar/pull/229).

## Background

`AGENTS.md` is imported into `CLAUDE.md` and read by every agent session. It grew one lesson at a time: PR #12 created it, #64 and #70 added the performance lessons, #122 and #123 the analyzer traps, #129 the story workflow, and the seven PRs of [0018](0018-preserve-transcript-insights.md) the transcript insights. On 2026-11-04 it was 148 lines and about 4,250 words. Every session pays for all of it, although the backend query lessons, the frontend render lessons, the issue-handover protocol and the file-based-tool formatting procedure each matter in a minority of sessions.

Several passages are rules that must always hold: never `git checkout --` or `git restore` over an unstaged fix (the failure in #189), never run the shared `just db` recipes from a worktree without meaning to (the shared Compose defaults recorded by 0018), never hand-edit the generated contract files, never publish absolute machine paths or private session handles. Instruction text is a guideline that an agent may judge inapplicable; Claude Code's own guidance says such rules belong in hooks.

Facts checked on 2026-11-04, before delivery, which shaped the design:

* The repo had no hooks and no `.claude/settings.json`. Four skills existed (`adr-draft`, `run-calendar`, `story-draft`, `tech-doc-review`); `adr-draft` and `story-draft` referred to `AGENTS.md` sections by name.
* Claude Code loads a nested `CLAUDE.md` lazily when it reads or edits a file under that directory, and `@imports` resolve relative to the importing file. Codex and Cursor read nested `AGENTS.md` natively. Hooks match on tool name; a deny or ask decision blocks or prompts, and additional context informs; shared hooks live in a git-tracked `.claude/settings.json`.
* [ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) makes every repo tool a .NET 10 file-based app under `tools/<name>/`, tested by `just tools test`. A cached `dotnet run` of `tools/tool-versions` took 0.21–0.26 s (first run 4.5 s), fast enough for a hook on every Bash or Edit call.

This story extends 0018, which made the guidance complete; this one makes it effective. The planned review of the drafting skills ([0009](0009-review-drafting-skills-for-clarity-and-simplicity.md)) stays independent: this story only repointed two references in those skills.

### Agreed scope

* **Short root:** `AGENTS.md` keeps only what every session needs (overview, commands, architecture invariants, the story and issue workflow, working on several changes, testing principles, the redaction rule), at most 90 lines and 1,500 words, with a pointer to the nested files, the skills and the hooks.
* **Nested area files:** `backend/AGENTS.md` and `frontend/AGENTS.md` hold the backend and frontend practices and testing notes. Each has a two-line `CLAUDE.md` shim that imports it, so Claude Code loads it when a file under that directory is touched and other agents read the same text natively. Each stays under 200 lines and opens by saying that the root file still applies.
* **Tooling procedures in `tools/README.md`:** the ADR-0017 layout, `tool_dirs` inclusion and test discovery, the `#:include` SDK minimum, the scratch-project formatting procedure and the lock-file notes move there. No new skill for them: the procedure is rare and people read it too.
* **`issue-handover` skill:** the "Public GitHub posts and optional issue handovers" section becomes `.claude/skills/issue-handover/SKILL.md`, loaded only when the user asks for that mode or one of its behaviours. The general redaction rule stays in the root.
* **Hooks as an ADR-0017 tool:** `tools/agent-hooks/` is run by Claude Code from a git-tracked `.claude/settings.json`. Guards that protect work or the public record deny (`git restore`/`git checkout --` over unstaged changes, `gh` posts carrying machine paths or session handles, edits of generated files). The shared-database guard asks, because the user may want the shared database. The rest informs: C# lines over 140 characters after an edit, a stale contract when the agent stops, and a session-start line that warms the build cache and names the runtime. Each handler carries an `if` filter, so unrelated commands and edits start no process.
* **Rules survive the move:** every hooked rule keeps a one-line statement in the root marked *(hook)*, so agents without hooks still see it. The decision is recorded in [ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md), accepted in the hooks PR.
* **Delivery as an epic:** one child issue and one PR per deliverable (#217 skill, #218 hooks and ADR, #219 restructure), as 0018 did.

### Not in this story

* Changes to what any rule requires. Wording, placement and enforcement changed; a rule that turns out to be wrong gets its own issue.
* Lint rules for guidance that is really a code rule, such as `new QueryClient()` outside `createQueryClient` or `new Intl.DateTimeFormat` outside `dayTime.ts`. Follow-up [#228](https://github.com/mgasca/calendar/issues/228).
* A guard for bare `git stash`: dropped in review on #222, because it is a harness rule rather than repository guidance.
* The `issue-sweep` and `issue-closeout` skills proposed in #168, and the content review of `adr-draft` and `story-draft` (0009).
* Hooks for agents other than Claude Code. Their rules stay in prose.

### Dependencies

Story 0019 (the justfile modules) ran in parallel. Its card ([PR #214](https://github.com/mgasca/calendar/pull/214)) merged before the hooks PR; its delivery ([PR #227](https://github.com/mgasca/calendar/pull/227)) merged after this story was delivered. #227 moved `tool_dirs` into `tools/mod.just` and renamed `just tooling` to `just tools test`, which still discovers `tools/agent-hooks/tests` (criterion 5). It also taught the shared-database guard the module forms `just db up` and `just db::up`, and renamed the recipes throughout this card.

### Acceptance criteria

1. **Given** the restructure PR, **when** the files are measured, **then** the root `AGENTS.md` is at most 90 lines and 1,500 words, and every instruction file (`AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`) is under 200 lines. Measured with `wc -lw` on #223's head and again on `main` at `6b32bc2f`: [`AGENTS.md`](../../AGENTS.md) 51 lines / 1,367 words (148 / 4,249 before the story), [`backend/AGENTS.md`](../../backend/AGENTS.md) 56 / 829, [`frontend/AGENTS.md`](../../frontend/AGENTS.md) 47 / 872. On `main` at `d2ee13f1`, after story 0019 rewrote the recipe names, they are 51 / 1,459, 56 / 843 and 47 / 901: still within the limits, with 41 words to spare in the root. No check enforces these budgets: nothing fails if the root grows again.
2. **Given** the old `AGENTS.md`, **when** it is compared with the new files, **then** every rule, command and path appears in exactly one new place, or the PR description lists it as removed because a folder README or skill already states it. The rule-preservation table in [#223's description](https://github.com/mgasca/calendar/pull/223) maps every old passage to its new place or gives the reason for removing it; [#221's description](https://github.com/mgasca/calendar/pull/221) does the same for the handover section. Reviewed by hand; no test compares the old and new files.
3. **Given** a rule enforced by a hook, **when** the root `AGENTS.md` is read, **then** the rule is still stated in one line marked *(hook)*. [`AGENTS.md`](../../AGENTS.md) marks four rules on five lines: generated files and the stale contract (Commands), the shared database (Commands and "Working on several changes at once"), `git checkout --`/`git restore` over an unstaged fix (Testing principles) and private details in posts (Public GitHub posts). The S103 line-length report, which only informs, is stated in [`backend/AGENTS.md`](../../backend/AGENTS.md) (analyzer traps). Checked by reading; no test.
4. **Given** `backend/CLAUDE.md` and `frontend/CLAUDE.md`, **when** they are read, **then** each holds only one comment and the `@AGENTS.md` import. [`backend/CLAUDE.md`](../../backend/CLAUDE.md) and [`frontend/CLAUDE.md`](../../frontend/CLAUDE.md) each hold one HTML comment and `@AGENTS.md`. Checked by reading; no test.
5. **Given** the hooks PR, **when** `just tools test` runs, **then** its output lists `tools/agent-hooks/tests/agent-hooks.tests.cs` and the whitespace check on `tools`. On 2026-11-04, `just tooling` (as the recipe was named before story 0019) on `main` content (`6b32bc2f`; this card changes no tool) printed `dotnet run tools/agent-hooks/tests/agent-hooks.tests.cs` with `Total: 63, Errors: 0, Failed: 0`, then `dotnet format whitespace tools`, and exited 0. `shellcheck` was not installed locally and was skipped; CI runs it.
6. **Given** a hook decision branch (deny, ask, inform, pass, loop guard, malformed input), **when** the tests run, **then** a test feeds that branch sample input and asserts the exit code and output. At the process boundary, [`HookRunnerTests`](../../tools/agent-hooks/tests/HookRunnerTests.cs) covers each branch: deny ([`Pre_bash_deny_is_pretooluse_json_with_exit_0`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L18), [`Pre_edit_denies_generated_files_and_passes_sources`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L43)), ask and pass ([`Pre_bash_ask_and_pass`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L32)), inform ([`Post_edit_reports_long_lines_as_context`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L51), [`Warm_adds_session_context`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L78)), loop guard ([`Stop_blocks_once_then_respects_stop_hook_active`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L64)) and malformed input ([`Malformed_json_and_unknown_subcommands_exit_2`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L87), [`Missing_tool_input_passes_with_a_stderr_note`](../../tools/agent-hooks/tests/HookRunnerTests.cs#L95)). Each rule's cases are in its guard's tests: [`Discarding_unstaged_changes_is_denied`](../../tools/agent-hooks/tests/BashGuardTests.cs#L19), [`Restore_after_cd_probes_the_path_relative_to_the_new_directory`](../../tools/agent-hooks/tests/BashGuardTests.cs#L46), [`Public_posts_with_private_details_are_denied`](../../tools/agent-hooks/tests/BashGuardTests.cs#L67), [`Body_file_contents_are_scanned_and_its_path_is_not`](../../tools/agent-hooks/tests/BashGuardTests.cs#L84), [`Shared_database_from_a_linked_worktree_asks`](../../tools/agent-hooks/tests/BashGuardTests.cs#L100) and their pass counterparts in [`BashGuardTests`](../../tools/agent-hooks/tests/BashGuardTests.cs#L38); [`Generated_files_are_denied`](../../tools/agent-hooks/tests/EditGuardTests.cs#L13) and [`Source_files_pass`](../../tools/agent-hooks/tests/EditGuardTests.cs#L25); [`LineLengthCheckTests`](../../tools/agent-hooks/tests/LineLengthCheckTests.cs#L12); [`ContractCheckTests`](../../tools/agent-hooks/tests/ContractCheckTests.cs#L12); [`ShellCommandTests`](../../tools/agent-hooks/tests/ShellCommandTests.cs#L9). Not covered: the runner tests check the exit code for deny, inform, pass and malformed input, but only the JSON for ask, the pre-edit deny and the first stop block; the guard tests check verdicts, not process output. `GitProbe`'s git queries (unstaged changes, changed files) have no unit test, since [`GitProbeTests`](../../tools/agent-hooks/tests/GitProbeTests.cs#L13) covers only worktree detection and file reads. The live refusal in criterion 8 exercised the unstaged-changes query against real git.
7. **Given** a fresh Claude Code session, **when** a file under `backend/` is read, **then** the loaded context lists `backend/CLAUDE.md`; likewise for `frontend/`. Observed by hand on 2026-11-04 in a fresh Claude Code desktop session on a worktree of `main` at `1177aba3`; between that commit and `6b32bc2f` only the 0019 card changed. Reading `backend/src/Calendar.Api/Program.cs` made Claude Code inject `backend/CLAUDE.md` and the `backend/AGENTS.md` it imports right after the read. Reading `frontend/apps/web/src/queryClient.ts` did the same for `frontend/CLAUDE.md` and `frontend/AGENTS.md`. An `ls` through Bash under `frontend/` beforehand loaded nothing. Not automated.
8. **Given** a worktree with an unstaged edit, **when** an agent runs `git restore` on that file through Claude Code, **then** the hook refuses with a reason; and an edit of `contracts/openapi.json` is refused the same way. Observed by hand in the same session. The session context opened with `agent-hooks active (tools/agent-hooks, .NET runtime 10.0.14)`, and `dotnet --version` at the repo root was 10.0.403. With a throwaway line appended to `README.md`, `git restore README.md` through Bash was denied by the PreToolUse hook: "Unstaged changes in README.md would be discarded. Save the patch (git diff > file) or make a WIP commit first, then restore the saved version explicitly (AGENTS.md: preserve the fix when proving a regression test)." The probe was then removed with an edit. A one-character Edit of `contracts/openapi.json` (`3.1.1` to `3.1.2`) was denied: "openapi.json is generated. Run `just contracts` for the API contract and TS client, `dotnet restore` for packages.lock.json, or `pnpm install` for pnpm-lock.yaml, and commit the result instead of editing it." Neither probe was committed. The ask guard was not run live, because it prompts the user; [`Shared_database_from_a_linked_worktree_asks`](../../tools/agent-hooks/tests/BashGuardTests.cs#L100) and the #222 smoke test cover it.
9. **Given** the change is complete, **when** I run `just check`, **then** it passes. `just check` passed locally on the head of the close-out PR ([#229](https://github.com/mgasca/calendar/pull/229)), with Podman serving the Docker socket for the Testcontainers suites; the PR description names the revision and the CI result. Each delivery PR passed CI on its final head, and CI passed on `main` at `6b32bc2f`.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling is .NET file-based apps with analyzers and tests per folder | The hooks tool follows this layout and is discovered by `just tools test`; it uses `#:include`, so it needs SDK 10.0.300 and degrades to prose-only rules on older SDKs. |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layer agent guidance by scope (root, nested `AGENTS.md` with `CLAUDE.md` shims, skills, folder READMEs) and enforce its invariants with Claude Code hooks built as repo tools | Sets where each kind of guidance lives, the deny/ask/inform policy, the *(hook)* line that keeps every enforced rule in prose for other agents, and the fallback to prose when the tool cannot run. Drafted with `adr-draft`, approved in review and set to `accepted` in #222 before it merged; the CALM model lists it in `metadata.adrs`. |

### Other decisions (not ADR-worthy)

* **Nested `AGENTS.md` plus a `CLAUDE.md` shim, not `.claude/rules`:** path-scoped rules are Claude-only, while nested `AGENTS.md` is read natively by Codex and Cursor. The shim exists because nested `AGENTS.md` under a root `CLAUDE.md` is undocumented for Claude Code.
* **The shared-database guard asks instead of denying:** a maintainer in a worktree may want the shared database; the prompt names the isolated stack from the `run-calendar` skill as the alternative. Confirmed in review on #222.
* **The `issue-handover` skill stays model-invocable:** the old section applied to "its individual behaviours" too, so a prose request such as "watch PR N for review comments" must still load it. The description is scoped to explicit requests.
* **No `(hook)` markers before the hooks exist:** the hooks PR preceded the root rewrite, so the rewritten rules point at hooks that were already in place.
* **`tools/README.md` instead of a `repo-tooling` skill:** about thirty lines of gotchas that people also read, with precedent in `tools/infra/README.md`.

## Implementation notes

The story shipped as four delivery PRs after the card, each squash-merged on 2026-11-04. No application code, endpoint, dependency or migration changed.

| PR | Delivered | Merged as |
| --- | --- | --- |
| [#220](https://github.com/mgasca/calendar/pull/220) | This card (PR 0) | `95e5a93e` |
| [#221](https://github.com/mgasca/calendar/pull/221) | `issue-handover` skill; `adr-draft` and `story-draft` point at it (closes #217) | `edb73461` |
| [#222](https://github.com/mgasca/calendar/pull/222) | `tools/agent-hooks`, `.claude/settings.json`, `.claude/settings.local.json` git-ignored, `tools/README.md`, ADR-0042 and its model entry (closes #218) | `395a97ae` |
| [#223](https://github.com/mgasca/calendar/pull/223) | Root rewrite, `backend/AGENTS.md`, `frontend/AGENTS.md`, the two shims, the `story-draft` and ADR-0037 pointers (closes #219) | `6de45ea4` |
| [#226](https://github.com/mgasca/calendar/pull/226) | One line in the `issue-handover` skill: the review suggestion on #221 | `1177aba3` |

### Where things live

| Area | Location |
| --- | --- |
| Root guidance | `AGENTS.md`, imported by `CLAUDE.md` |
| Area guidance | `backend/AGENTS.md` and its `backend/CLAUDE.md` shim; `frontend/AGENTS.md` and its `frontend/CLAUDE.md` shim |
| Tooling procedures | `tools/README.md` |
| Handover protocol | `.claude/skills/issue-handover/SKILL.md` |
| Hook entry point | `tools/agent-hooks/agent-hooks.cs`: reads the hook JSON on stdin, calls `HookRunner`, writes the answer |
| Dispatch | `tools/agent-hooks/HookRunner.cs`: subcommands `warm`, `pre-bash`, `pre-edit`, `post-edit`, `stop`; malformed input and unknown subcommands exit 2 |
| Hook JSON | `tools/agent-hooks/HookProtocol.cs`: `HookInput`, `Verdict`, `HookResult`, `HookOutput` |
| Guards, one per file | `BashGuard.cs` (restore and checkout, public posts, shared database) with `ShellCommand.cs` (splitting a command line, following `cd`); `EditGuard.cs` (generated files); `LineLengthCheck.cs` (S103); `ContractCheck.cs` (stale contract) |
| Repository questions | `tools/agent-hooks/IRepoProbe.cs` (what the guards ask), `GitProbe.cs` (answered with git) |
| Tests | `tools/agent-hooks/tests/agent-hooks.tests.cs`, the single test app that includes one `<Subject>Tests.cs` per class and `FakeProbe.cs` |
| Hook configuration | `.claude/settings.json` (shared); personal overrides go in the git-ignored `.claude/settings.local.json` |
| Decision | `docs/decisions/0042-layered-agent-guidance-and-hooks.md`, `docs/architecture/calendar.architecture.json` (`metadata.adrs`) |

### What the hooks do

| Event | Rule | Decision |
| --- | --- | --- |
| PreToolUse `Bash` (`git`, `gh`, `just`, `docker`) | `git restore` or `git checkout [--]` over paths with unstaged changes, following `cd` | deny |
| | `gh` issue, PR, comment, edit, review or `api` posts whose body (or `--body-file` contents) carries an absolute machine path, a worktree path, a session, task or agent handle, or a UUID | deny |
| | `just db` `up`, `down`, `reset`, `migrate` or `psql` (also `db::up`; `db-*` before story 0019), or `docker compose`, from a linked worktree | ask |
| PreToolUse `Edit\|Write` | `contracts/openapi.json`, `schema.gen.ts`, `packages.lock.json`, `pnpm-lock.yaml` | deny |
| PostToolUse `Edit\|Write` | `.cs` lines over 140 characters outside `Migrations/` | inform |
| Stop | API contract sources changed without `contracts/openapi.json`, or the contract without `schema.gen.ts`; honours `stop_hook_active` | block once |
| SessionStart | compile the tool and name the .NET runtime ([#233](https://github.com/mgasca/calendar/pull/233) adds the SDK) | inform |

### API

No changes.

### Testing

* 63 xUnit tests at delivery (66 after story 0019 added the `db` module forms) in `tools/agent-hooks/tests/`, one class per subject, with `FakeProbe` standing in for the repository; `GitProbeTests` uses temporary directories with a `.git` file or directory. `just tools test` runs them with the analyzers on (warnings are errors) and checks whitespace on `tools`. Criterion 6 lists the tests per decision branch.
* Smoke tests in #222 piped real hook JSON into each subcommand from a worktree.
* Live checks in a fresh session after the merge (criteria 7 and 8), because hooks and settings load at session start.
* Docs corpus tests and the site build check this card and ADR-0042.
* Not tested: no test proves that agents follow prose, so the root, the nested files and the skill are reviewed by hand. The line and word budgets are not enforced. The `if` filters in `.claude/settings.json` have no test; criterion 8 observed the `git` and `openapi.json` filters firing live.

### Review changes during delivery

* **Stash guard dropped:** #222 first denied bare `git stash`. Review dropped it, with its 12 test cases, because it is a harness rule rather than repository guidance. The root lost the stash line too.
* **An `if` filter on every handler:** each handler in `.claude/settings.json` carries a permission-rule filter (`Bash(git *)`, `Bash(gh *)`, `Bash(just *)`, `Bash(docker *)`, one per generated path, `Edit(**/*.cs)`), one handler per pattern, so an unrelated command or edit starts no process. The filter is best effort: when Claude Code cannot tell which commands a Bash input runs, the hook runs and decides in process.
* **Code and tests split by cohesion:** one file per guard or check, `HookProtocol.cs` for the hook JSON and `IRepoProbe.cs` for the repository questions, one test class per file included by `agent-hooks.tests.cs`. The same 63 tests passed before and after the split.

### Lessons learned, known issues and follow-ups

* **Measured:** root `AGENTS.md` 148 lines / 4,249 words before, 51 / 1,367 after (`wc -lw`). A cached hook call took 0.23–0.29 s during delivery, with a first compile of about 5 s; on 2026-11-04, five cached `pre-bash` calls on `main` content took 0.265–0.291 s each (piped sample input, timed with `date`, on the development machine under WSL). Later that day, at a load average of about 2.4, the same call took 0.50–0.66 s, so the cost depends on machine load.
* **A review suggestion committed after a squash merge misses `main`:** the suggestion on #221 was committed to its branch after #221 had merged, so it reached `main` only through #226 from fresh `main`. This is the case that "Verify delivery across a merge" in `AGENTS.md` describes (#180/#186), met again: re-read the PR state before adding to a reviewed branch.
* **Remote rebases leave local branches stale:** the stacked branches were rebased and retargeted on GitHub as their bases merged. Fetch and rebuild the local branch from the remote before pushing. Force-push is blocked by the auto-mode classifier, so the way out of a rejected push is to rebuild on the fetched branch, not to force it.
* **Hooks load at session start:** the session that builds or changes them can't observe them live. Plan a fresh-session check, as criteria 7 and 8 did.
* **Nested guidance loads on Read or Edit only:** Claude Code injects `backend/` or `frontend/` guidance when its own Read or Edit tool touches a file there. A Bash `ls` did not trigger it, so an agent that explores only through the shell may miss the area practice until it reads a file.
* **The SessionStart line named only the runtime:** it showed `Environment.Version` (10.0.14 in the live check), while the minimum that matters is SDK 10.0.300 (10.0.403 here), so the figure read as too old. The tool's header comment and parameter name said SDK. Tracked in [#231](https://github.com/mgasca/calendar/issues/231); [#233](https://github.com/mgasca/calendar/pull/233) makes the line name both (`.NET SDK 10.0.403, runtime 10.0.14`), which keeps ADR-0042's "names the runtime" true. It costs about 0.3 s once a session, for `dotnet --version`.
* **Limits:** the hooks are Claude Code only; other agents follow the *(hook)* lines by hand. Below SDK 10.0.300 the tool fails to compile, Claude Code treats that as a non-blocking error, and the rules stay prose (ADR-0042).
* **Follow-up:** [#228](https://github.com/mgasca/calendar/issues/228) turned two code rules that `frontend/AGENTS.md` stated as prose into ESLint rules (`frontend/eslint.config.js`): no `new QueryClient(` outside `createQueryClient`, and no `Intl.DateTimeFormat` or `toLocale*String` outside `features/agenda/dayTime.ts` (the four `toLocaleString` calls moved onto a cached `formatDateTime`, and the one test that called `new QueryClient(` now uses `createQueryClient`). `frontend/AGENTS.md` marks them *(lint)*. `useNow()` placement stays prose: no selector can judge "the smallest component".

## User guide

### Working in the repository with an agent

Open a session anywhere in the repository and the agent reads a short guide that every session needs. When it reads or edits backend or frontend code, it also picks up that area's practices; other agents such as Codex and Cursor read the same text natively. Ask for an issue-driven handover, or for one of its behaviours such as watching a pull request for review comments, and the agent loads that protocol.

In Claude Code, the session opens with a line saying the repository's hooks are active and which .NET version they run on. From then on:

* If the agent tries to discard unstaged changes with `git restore` or `git checkout --`, it is stopped and told to save the patch or make a work-in-progress commit first.
* If it tries to post an issue, pull request or comment that contains a path on your machine or a private session handle, the post is stopped, naming what was found.
* If it tries to hand-edit a generated file (the API contract, the generated client or a lock file), it is stopped and told which command regenerates the file.
* If it runs a shared-database command from a separate worktree, you are asked to approve, with the isolated stack offered as the alternative.
* After it edits a C# file with a line over 140 characters, it is told which lines to wrap. If it finishes a turn with the API changed but the contract not regenerated, it is asked to regenerate it once.

The hooks need .NET SDK 10.0.300 or later; `just doctor` checks the toolchain. With an older SDK they do nothing, and the same rules still apply as written guidance. Each rule the hooks enforce is also written in the root guide, marked *(hook)*, so agents without hooks follow it by hand. Personal Claude Code settings that should stay out of git go in the git-ignored local settings file.
