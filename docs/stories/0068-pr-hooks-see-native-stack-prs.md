---
status: implemented
date: 2026-11-15
issue: https://github.com/mgasca/calendar/issues/894
pr:
  - https://github.com/mgasca/calendar/pull/959
  - https://github.com/mgasca/calendar/pull/960
  - https://github.com/mgasca/calendar/pull/963
adrs: ["0042", "0044", "0058", "0065"]
---

# 0068 PR hooks see native stack PRs

## Story

> As a maintainer, I need the agent hooks to check the PRs that a native GitHub stack opens and edits, so that every stack layer that completes an issue carries `Closes #N` before it merges.

Tracked in issue #894.

## Background

The agent hooks in `tools/agent-hooks` ([ADR-0042](../decisions/0042-layered-agent-guidance-and-hooks.md)) check two things when an agent writes a PR body with `gh pr create` or `gh pr edit`. The bash guard refuses a body that would publish private details (session handles, absolute machine paths). The link check, added by #358 for story [0027](0027-focus-agent-guidance-on-claude-code-for-a-while.md), reminds the agent when a PR to `main` has neither `Closes #N` nor `Refs #N`. The reminder runs only for a PR whose base is `main`, or one that is being retargeted to `main`. Its message for a PR with only `Refs` says that a stacked PR "gets its `Closes` when it is retargeted to main".

That message describes the old model: a bare chain of PRs, each based on the branch below it and retargeted to `main` when the lower one merged. [ADR-0065](../decisions/0065-native-github-stacks-for-stacked-prs-with-a-narrow-rebase-exception.md) (#888, #891) replaced it with native GitHub stacks, created with `gh stack submit` and joined with `gh stack link`. In a native stack every layer lands on `main` as its own squash commit, and no layer is ever retargeted. So the completing layer needs `Closes #N` from the start. Story 0027 already recorded the gap: #362 reached `main` through a stack merge with only `Refs #319`.

Two paths are now unchecked. First, a layer above the bottom of a stack has a base that is not `main`, so `gh pr create` and `gh pr edit` on it get no reminder. Second, `gh stack submit` and `gh stack link` open PRs without calling `gh pr create`, so the hooks never see those PRs at all. Run without a terminal, as agents run it, `gh stack submit` skips its editor and generates the titles and bodies itself. A check that runs before the command therefore has no body to read.

### Agreed scope

* **Every PR body is checked, whatever its base.** `gh pr create` and `gh pr edit` with a new body get the `Closes`/`Refs` reminder for any base branch. ADR-0065 allows no bare chains, so a PR whose base is not `main` is a stack layer, and it lands on `main` itself.
* **Wording for native stacks.** The "retargeted to main" message is removed. A body with `Refs` but no `Closes` gets no reminder, as on `main` today. A body with neither gets the reminder. For a base other than `main`, and in the note after a `gh stack` command, the reminder also says that each stack layer merges onto `main` directly, so the layer that completes the issue carries `Closes #N` from the start.
* **HTML comments link nothing.** A closing keyword or `Refs` inside an HTML comment does not count as a link. Added during delivery: `gh stack submit --auto` fills each body from the PR template, whose comment holds a `Closes #123` example, so without this every generated body passed.
* **A check after `gh stack submit` and `gh stack link`.** A new hook runs after a Bash command that ran `gh stack submit` or `gh stack link` successfully. It reads the PRs of that stack and their bodies, and sends one inform message (not a block) naming each PR whose body has neither `Closes #N` nor `Refs #N`, and each PR whose body contains private details. The bodies are already public by then, so the message says to edit each one in place with `gh pr edit --body-file`. That edit then gets the existing checks before it runs.
* **Failures stay quiet.** A `gh stack` command that failed, a stack whose PRs cannot be read (no network, no `gh` sign-in), or a read that times out produces no message, and the command's own result is unchanged. A hook never turns a successful command into a failure.
* **Registration.** The new hook is a `post-bash` subcommand of `agent-hooks`, registered as a `PostToolUse` entry for `Bash` in `.claude/settings.json`, like the other subcommands ([ADR-0044](../decisions/0044-claude-first-agent-automation.md): Claude Code only).
* **Tests** in `tools/agent-hooks/tests/`, each confirmed to fail without the change.

### Not in this story

* **`gh api` edits of a PR body** (`PATCH /repos/{owner}/{repo}/pulls/{n}`): no guidance tells agents to edit PR bodies that way. Proposed on the issue as a separate follow-up, filed if the owner wants it.
* **Blocking a PR without links.** The reminder stays an inform, not a refusal, as story 0027 decided: PR 0 and partial layers legitimately carry only `Refs`.
* **Deciding which layer completes the issue.** The hook cannot know that; the `issue-handover` skill still decides it.
* **Other `gh stack` commands** (`rebase`, `push`, `sync`, `merge`, `modify`) open no PRs and write no bodies. The bash guard's rules for them are unchanged.
* **Codex, Cursor and other harnesses.** They get no hook, as ADR-0044 accepted, and follow the `AGENTS.md` rule by hand.

### Acceptance criteria

1. **Given** `gh pr create --base <stack branch>` with a body that has neither `Closes #N` nor `Refs #N`, **when** the command runs under the hooks, **then** an inform message names the rule and the PR is created. Tests: [stack branch reminder](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L22) (`A PR on a stack branch gets the reminder…`).
2. **Given** `gh pr edit <n> --body-file <file>` on a PR whose base is not `main`, with a body that has neither link, **when** it runs under the hooks, **then** the same inform message appears. Tests: [stack branch reminder](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L22) (body edit of PR #41, base `docs/story-0027`) and [retarget on any base](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L42).
3. **Given** a PR body with `Refs #N` and no `Closes`, on any base, **when** `gh pr create` or `gh pr edit` runs, **then** no message appears, and no hook message anywhere says a PR "gets its `Closes` when it is retargeted to main". Tests: [Refs alone](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L54) and [no retarget wording](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L66).
4. **Given** `gh stack submit --auto` succeeded and opened two PRs, one with `Refs #N` and one with a generated body without links, **when** the post-command hook runs, **then** one inform message names the second PR and tells the agent to edit its body in place. Tests: [after submit](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L90) and [the PR template's commented-out example](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L187).
5. **Given** `gh stack link 101 102` succeeded and PR 102's body contains an absolute machine path, **when** the post-command hook runs, **then** the message names PR 102 and the private detail, and tells the agent to edit the body in place. Tests: [after link](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L106).
6. **Given** `gh stack submit` failed, or the stack's PRs cannot be read, **when** the post-command hook runs, **then** it sends no message. Tests: [unreadable stack or PRs](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L127); a failed command is a `PostToolUseFailure` event, which the hook does not register, so it is not exercised by a test.
7. **Given** a Bash command that does not run `gh stack submit` or `gh stack link`, **when** the post-command hook runs, **then** it sends no message and makes no GitHub call. Tests: [no GitHub call](../../tools/agent-hooks/tests/stack-pr-links_test.ts#L139).
8. **Given** the change is complete, **when** I run `just check`, **then** it passes. `just tools test` passed locally (1262 tests; shellcheck skipped, not installed); the full `just check` is CI's result on the PR head.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layered agent guidance, with invariants enforced by Claude Code hooks as repo tools | The checks live in `tools/agent-hooks`; a rule marked *(hook)* must stay enforced |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Claude-first agent automation for a while | A new `PostToolUse` hook may be Claude Code only |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | Repository tooling in TypeScript on Deno | The hook and its tests are Deno TypeScript under `tools/` |
| [0065](../decisions/0065-native-github-stacks-for-stacked-prs-with-a-narrow-rebase-exception.md) | Stacked PRs are native GitHub stacks | Each layer lands on `main` itself, so each needs its own link from the start |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Check after the command, not before:** non-interactive `gh stack submit` writes the bodies itself, so only a check that runs afterwards can read them. Forbidding `--auto` was rejected: an agent has no terminal for the editor.
* **Inform after publication, not block:** a `PostToolUse` hook cannot undo a post. Telling the agent to edit the body in place follows the `AGENTS.md` rule for a disclosure that slipped through.
* **Any base counts as a stack layer:** detecting a native stack would cost a GitHub call on every `gh pr create`. ADR-0065 forbids bare chains, so the base alone is enough.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Link reminder, stack check and messages | `tools/agent-hooks/pull-request-link-check.ts` (`describePrLink`, `describeStackPrs`, `unlinked`) |
| `post-bash` subcommand | `tools/agent-hooks/hook-runner.ts`, `tools/agent-hooks/agent-hooks.ts` |
| Stack branches (`gh stack view --json`, 3 s) | `findStackBranches` and `parseStackBranches` in `tools/agent-hooks/pull-request-lookup.ts`; `stackBranches` on `RepoProbe` (`protocol.ts`, `git-probe.ts`) |
| Private-details pattern, shared with the bash guard | `privateDetails` in `tools/agent-hooks/bash-guard.ts` |
| Registration | `PostToolUse`, matcher `Bash`, `if: Bash(gh *)` in `.claude/settings.json` |
| Hook reference | "Agent hooks" in `tools/README.md` |
| Tests | `tools/agent-hooks/tests/stack-pr-links_test.ts`; replaced legacy rows in `tests/legacy-parity_test.ts` and `tests/fixtures/README.md` |

### API

No changes.

### Testing

* Deno tests with the fake probe for every criterion, run by `just tools test`.
* Eight rows of the legacy C# capture recorded the old behaviour (218, 240, 244, 268, 269, 271, 273, 278). They are skipped as approved replacements, counted by an assertion, and `stack-pr-links_test.ts` replays each row's input and probe state against the new result.
* Negative control: the new tests were run in a scratch worktree with the old `pull-request-link-check.ts` (and a stub `describeStackPrs`). Every behaviour test failed there; the tests that passed cover the parts the control kept (runner, parser, registration, quiet paths).
* Live check: the hook was run by hand with the real probe after `gh stack submit --auto --open` opened #959 and #960. The first run printed nothing, which exposed the PR template problem below; after the fix it named both PRs.

### Lessons learned, known issues and follow-ups

* **A generated body is the PR template.** `gh stack submit --auto` fills each body from `.github/pull_request_template.md`. Its HTML comment says `Closes #123`, which the link pattern matched. Unit tests with hand-written bodies did not catch it; running the hook on this story's own stack did.
* **A failed command gets no note** because Claude Code reports a non-zero exit as `PostToolUseFailure`, which the hook does not register. This is inferred from the hooks reference, not observed.
* **The stack merged with its generated bodies.** #959 and #960 were merged from the top about a minute after `gh stack submit --auto --open`, while their bodies were still the PR template, so neither carried `Refs #894` or `Closes #894`, #894 stayed open, and `handover-watch` did not count them as delivery PRs. That is the gap this story closes, hit by the story's own stack before its hook was active. The HTML-comment fix and this card update followed in #963, which carries `Closes #894`. Lesson: set each body with `gh pr edit --body-file` right after `gh stack submit`, before asking for review.
* **The session that delivers a hook does not run it**: hooks come from the settings of the checkout Claude Code started in, so this story's own `gh stack submit` ran the old hooks.
* **`gh stack link <stack number> …`** grows an existing stack. The stack number is not a PR, so its layers are not read; only the named PRs are checked.
* **`gh api` edits of a PR body** remain unchecked, as agreed on #894.

## User guide

### Opening a stack of pull requests with an agent

When an agent opens or edits a PR in a stack, it now gets the same reminder as for a PR to `main` if the body links no issue. After **gh stack submit** or **gh stack link** succeeds, the agent is told which of the stack's PRs link no issue or show private details, and edits those bodies in place. The commands themselves are never blocked or changed. Other agents (Codex, Cursor) do not get these reminders and follow the rule in `AGENTS.md` by hand.
