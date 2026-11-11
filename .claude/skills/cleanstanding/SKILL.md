---
name: cleanstanding
description: Check whether the current session has outstanding work (uncommitted or unpushed changes, open PRs and their checks, unmerged branches, running processes, throwaway Docker resources, worktrees, pending tasks or promised follow-ups). If something is outstanding, give a concise report and stop; if nothing is, clean up the resources this session created so the session can be archived. Use when the user says cleanstanding, wrap up, close out or archive this session, "am I done?", or asks what is left before ending a session.
---

# Cleanstanding

Answers one question: is anything from this session still outstanding? Outstanding work gets a short report and **no cleanup**. A session with nothing outstanding gets cleaned up so it can be archived.

Check first, clean second, and never mix them: cleaning a session that still has work in flight destroys the evidence the owner needs.

## 1. Establish what this session owns

Build the list from the conversation, not from the machine: branches, worktrees, PRs, issues, PIDs, containers, volumes, ports and temp directories **this session created or started**. Anything else (the shared Compose project `calendar`, other worktrees, other people's PRs, processes you did not start) is not yours: report it if relevant, never touch it (AGENTS.md "Working on several changes at once").

## 2. Check for outstanding work

Run these read-only checks from the checkout in use. Run independent ones in parallel.

- **Git:** `git status --short`, `git stash list`, `git log @{u}..` (unpushed; if there is no upstream, `git log origin/main..`), `git worktree list`, and `git branch -vv` for session branches that are ahead, gone or unmerged.
- **PRs:** for each session PR, `gh pr view <n> --json state,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,headRefOid`, then compare the head with the local `HEAD` (a push may be missing, or the PR may have merged and the branch moved on; see AGENTS.md "Verify delivery across a merge"). Merged is done; open, draft, failing or unreviewed checks, requested changes and unresolved review comments are outstanding.
- **Issues:** session issues with open scope, unanswered questions on the thread, or a card/`pr` list that the work made stale.
- **Runtime:** processes the session started (dev servers, watchers, background shells), and throwaway-stack containers or volumes from the `run-calendar` skill (ports 55432, 55041, 55173). A still-running process you started is *not* outstanding work by itself: it is cleanup, unless it is doing work (a watch, a long build or test run).
- **Conversation:** the user's requests not yet done, tasks left pending or in progress, follow-ups you promised, checks you skipped or could not run (no Docker, no network), and decisions waiting on the user.

Count only real signals. Untracked build output that `.gitignore` already hides, a clean worktree on a merged branch and a stopped process are not outstanding.

## 3a. Something is outstanding: report and stop

Reply with a concise report and change nothing:

- One line verdict: `Outstanding work: N items`.
- A table or list, most blocking first: item, state (with evidence such as PR number, check name, file count, commit count), and the single next action. Name the owner when it is the user's decision.
- Skipped or unverifiable checks, stated plainly.
- Resources that are safe to clean later, in one line, so the user knows what a second run will do.

No preamble, no restating of finished work. Do not offer to clean up partially.

## 3b. Nothing is outstanding: clean up

Clean only what step 1 listed as yours, and verify ownership of each item immediately before removing it (container name, volume, PID and its command line, branch's author and merged state). If ownership is uncertain, leave it and say so.

1. Stop background processes and watchers the session started (`kill <pid>` after checking `ps -p <pid> -o args=`); stop and remove the throwaway stack with the `run-calendar` skill's own teardown, never `just db down` or `just db reset` (those hit the shared project).
2. Remove session worktrees whose branch is merged or fully pushed: `git worktree remove <path>` (no `--force`; a refusal means there is unsaved work, so go back to 3a). Delete the local branch only when merged to `origin/main` (`git branch -d`, not `-D`). Check the merge by content on `main`, since squash merges change commit identity.
3. Delete the session's own temp directories and files (scratch worktrees, saved patches, downloaded artifacts) under `/tmp` or the tool-cache that this session created. Do not touch `.env`, `.plan/` or other users' files.
4. `git fetch --prune` so deleted remote branches drop from the local view.
5. Never delete remote branches, close issues or PRs, or merge anything as part of cleanup unless the user asked for it in this session.

Finish with a short summary: what was removed (one line each, grouped), what was deliberately left and why, and the closing statement `Clean: ready to archive`. If a cleanup step failed, say which and do not claim the session is clean.

## Rules

- Report what each check covered (command and tree), and say which did not run. Never write "nothing outstanding" from checks that were skipped.
- Re-run the outstanding check after cleanup that changed state, and before declaring the session clean.
- Do not post to GitHub from this skill.
