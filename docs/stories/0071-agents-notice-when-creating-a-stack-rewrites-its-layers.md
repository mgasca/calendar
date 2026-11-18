---
status: planned
date: 2026-11-18
issue: https://github.com/mgasca/calendar/issues/992
pr: []
adrs: ["0042", "0044", "0058", "0065"]
---

# 0071 Agents notice when creating a stack rewrites its layers

## Story

> As a maintainer, I need agents to update a stack themselves before they create it on GitHub, and to report it when GitHub rewrites its layers anyway, so that no pushed layer changes without an old-and-new-head comment.

Tracked in issue #992.

## Background

[ADR-0065](../decisions/0065-native-github-stacks-for-stacked-prs-with-a-narrow-rebase-exception.md) has agents open stacked PRs as native GitHub stacks with `gh stack submit`, or join existing PRs with `gh stack link`. Pushed branches stay merge-only, with one exception: on a stack it owns, an agent may run `gh stack rebase` then `gh stack push`. It may do so only after `git fetch` shows no one else pushed, and it then comments the old and new head on each PR. The rule is written in `AGENTS.md` ("Working on several changes at once"), the `issue-handover` skill and the `epic-delivery` skill's `references/stacked-prs.md`. ADR-0065 says no hook enforces it.

While story [0070](0070-agents-edit-pr-bodies-with-a-gh-that-works.md) was being delivered (#964), `main` moved (#989 merged) between its card PR (#988) and its delivery layer. `gh stack submit` then opened #990 and created the stack. 23 seconds later both layers were rebased onto the new `main` and force-pushed: #988 from `fd7432a` to `1ff2d66`, #990 from `e9c593d` to `ffaf0c2`. The command printed only "Pushed and synced 2 branches", and the local branches stayed at the old heads. The patches were unchanged (`git range-diff` shows `=`), but no one commented the old and new heads, and the agent did not notice.

The investigation on the issue found that the rebase was not done by the `gh stack submit` command itself. In gh-stack v0.3.0, `submit` pushes the local branches, opens the missing PRs and then creates the stack (`POST /repos/{owner}/{repo}/stacks`). It never rewrites a branch. The force-push came after the PRs were `added_to_stack`, and the local branches did not move. Both facts point to GitHub rebasing a newly created stack onto the current trunk on the server, under the account that created it. This is inferred from the timeline and the source, not reproduced. No `submit` or `push` flag skips it. So a `git fetch` check before `submit` does not prevent a rewrite that happens afterwards on GitHub. What prevents it is a stack that is already on the current trunk when it is created.

The only check that runs after `gh stack submit` today is the `post-bash` hook of story [0068](0068-pr-hooks-see-native-stack-prs.md), which reads the PR bodies. It runs right after the command, before GitHub's rebase lands, so it cannot see a rewrite either.

### Agreed scope

* **Update before creating.** The guidance says that creating a stack with `gh stack submit` or `gh stack link` can make GitHub rebase every layer onto the trunk and force-push it. Before an agent creates or grows a stack whose bottom layer does not contain the current `origin/<trunk>`, it runs the ADR-0065 update itself: `git fetch` shows no one else pushed, then `gh stack rebase` and `gh stack push`, then the old-and-new-head comment on each PR that already existed. A new branch with no PR yet needs no comment.
* **Check after creating.** After `gh stack submit` or `gh stack link` creates or grows a stack, the agent waits about a minute, fetches, and compares each layer's remote head with its local head. If GitHub moved a layer, the agent comments that PR's old and new heads and moves the local branch to the remote head. It does not push the old head back.
* **Where the guidance goes.** `AGENTS.md` ("Working on several changes at once"), the `issue-handover` skill ("Resume and close out") and `epic-delivery`'s `references/stacked-prs.md`, the three places ADR-0065 names. They are kept consistent with each other.
* **A note before `gh stack submit`.** A `PreToolUse` inform note (not a block) for a Bash command that runs `gh stack submit`, when the current stack's lowest open layer does not contain `origin/<trunk>` as last fetched. The note names the layer and the trunk, says that GitHub may rebase and force-push every layer when it creates or updates the stack, and tells the agent to run the ADR-0065 update first, or to check the heads afterwards and comment them. It reads only local git state and the stack's local metadata. It makes no network call and runs no `git fetch`, so it reflects the last fetch, and it says so.
* **Quiet when it cannot tell.** No stack, an unreadable stack, a missing `origin/<trunk>`, or a lowest open layer that already contains the trunk produces no note. The hook never changes the command's result.
* **ADR-0065 amended, not superseded.** A short amendment records that GitHub can rebase a stack on the server when it is created. It says that the exception's conditions (the fetch check before, the head comments after) apply to `submit` and `link` as well. It replaces "no hook enforces it" with a pointer to the new note. The decision itself does not change.
* **Tests** in `tools/agent-hooks/tests/`, each confirmed to fail without the change.

### Not in this story

* **Detecting GitHub's rebase with a hook.** A `PostToolUse` hook runs before the rebase lands (23 s later on #990), and waiting in a hook would hold up every `submit`. The check after creating stays a guidance step. A later story can add one to `handover-watch` if a missed rewrite recurs.
* **A note before `gh stack link`.** `link` takes PR numbers or branch names that may have no local stack, so the local check has nothing reliable to read. The guidance covers it.
* **Blocking `gh stack submit`.** An agent may submit a stack behind the trunk on purpose, for example to open a PR fast and update it right after. The note informs.
* **Changing gh-stack.** Asking upstream for a no-rebase mode, or reporting the undocumented rebase, is outside this repository. The guidance names no flag, because none exists in v0.3.0.
* **Other harnesses.** Codex, Cursor and others get no hook ([ADR-0044](../decisions/0044-claude-first-agent-automation.md)) and follow the guidance by hand.

### Acceptance criteria

1. **Given** the guidance in `AGENTS.md`, the `issue-handover` skill and `references/stacked-prs.md`, **when** an agent reads how to open a stack's PRs, **then** each place says that creating or growing a stack can rebase and force-push its layers on GitHub, says to update the stack first when its bottom is behind `origin/<trunk>`, and says to compare and comment the heads afterwards.
2. **Given** a stack whose lowest open layer does not contain `origin/main`, **when** the agent runs `gh stack submit --auto`, **then** one inform note names that layer and `origin/main`, tells the agent to run the ADR-0065 update first or to check and comment the heads afterwards, and the command runs.
3. **Given** a stack whose lowest open layer contains `origin/main`, **when** the agent runs `gh stack submit`, **then** no note about the trunk appears.
4. **Given** a stack whose lowest layers are merged, **when** the agent runs `gh stack submit`, **then** the note is about the lowest open layer only, and it names that layer.
5. **Given** no stack in the checkout, an unreadable stack, or no `origin/<trunk>` ref, **when** the agent runs `gh stack submit`, **then** no note appears and no network call is made.
6. **Given** a Bash command that does not run `gh stack submit`, **when** the hooks run, **then** the new check reads nothing and adds no note.
7. **Given** ADR-0065, **when** I read it, **then** an amendment says that GitHub can rebase a stack when it is created, that the exception's conditions cover `submit` and `link`, and points to the note. `just tools adr` passes.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Layered agent guidance, with invariants enforced by Claude Code hooks as repo tools | The note lives in `tools/agent-hooks`, beside the existing Bash checks |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Claude-first agent automation for a while | The note may be Claude Code only; the guidance stays readable by every agent |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | Repository tooling in TypeScript on Deno | The hook and its tests are Deno TypeScript under `tools/` |
| [0065](../decisions/0065-native-github-stacks-for-stacked-prs-with-a-narrow-rebase-exception.md) | Native stacks; an agent may rebase a stack it owns after a fetch shows no one else pushed | The rewrite this story prevents is one the exception's conditions are meant to govern; the story amends it |

No new ADR is expected. ADR-0065 gets an amendment that applies its existing rule to stack creation.

### Other decisions (not ADR-worthy)

* **Prevent before, not detect after:** the rewrite happens on GitHub after the command returns, so the only reliable hook point is before `submit`. A stack already on the trunk leaves GitHub nothing to rebase (inferred, see Background).
* **Compare with `origin/<trunk>`, not `needsRebase`:** `gh stack view --json` computes `needsRebase` against the local trunk branch, which is often stale in a worktree. The remote-tracking ref is what GitHub rebases onto, as of the last fetch.
* **No fetch inside the hook:** a fetch in a `PreToolUse` hook would add network time to every `submit` and change refs behind the agent's back. The note says it reflects the last fetch.
* **Inform, not block:** submitting a stack that is behind is sometimes intended, and the rewrite keeps the patches. What the maintainer needs is the head comment, which the note asks for.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Guidance | `AGENTS.md`, `.claude/skills/issue-handover/SKILL.md`, `.claude/skills/epic-delivery/references/stacked-prs.md` |
| Note before `gh stack submit` | `tools/agent-hooks/` (a Bash pre-check beside the bash guard; stack read through `RepoProbe`) |
| ADR amendment | `docs/decisions/0065-native-github-stacks-for-stacked-prs-with-a-narrow-rebase-exception.md` |
| Hook reference | "Agent hooks" in `tools/README.md` |
| Tests | `tools/agent-hooks/tests/` |

### API

No changes.

### Testing

* Deno tests with the fake probe for criteria 2 to 6, run by `just tools test`, with a negative control against the old code.
* Criterion 1 is a review of the three guidance files; criterion 7 is `just tools adr`.
* If `main` moves while this story's own stack is open, the delivery records what GitHub does when the stack is created, as live evidence for the inference in Background.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Opening a stack of pull requests with an agent

Before an agent runs **gh stack submit**, it is told when the bottom of its stack is behind the latest `main` it has fetched. GitHub may then rebase and force-push every layer when it creates the stack. The agent brings the stack up to date first, under the rule that lets it rebase its own stack, and comments the old and new heads on each PR. If a layer still moves after the stack is created, the agent comments that PR's old and new heads and updates its local branch. The command is never blocked. Other agents (Codex, Cursor) get no note and follow the rule in `AGENTS.md` by hand.
