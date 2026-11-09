---
status: implemented
date: 2026-11-09
issue: https://github.com/mgasca/calendar/issues/593
pr:
  - https://github.com/mgasca/calendar/pull/636
adrs: []
---

# 0055 Publish screenshots from a checkout that has no local screenshots branch

## Story

> As a maintainer who has agents deliver changes in fresh worktrees, I need the `github-screenshots` publish block to work in a checkout that has never had a local `screenshots` branch, so that an agent can attach before and after images to a post without improvising a different command.

Tracked in issue #593.

## Background

The `github-screenshots` skill (`.claude/skills/github-screenshots/SKILL.md`) publishes images to the never-merged `screenshots` branch with git plumbing, from any checkout and without checking the branch out. Its block fetches `origin/screenshots`, builds a commit on top of it, then ends with `git update-ref refs/heads/screenshots "$C" "$P" && git push -q origin screenshots`.

The `update-ref` call names a local branch and expects it to exist at `$P`. In a fresh worktree there is no local `screenshots` branch (only `origin/screenshots`), so it fails with `cannot lock ref 'refs/heads/screenshots': unable to resolve reference` and nothing is pushed. This was seen while delivering #554, where pushing the commit straight to the remote branch worked.

The local ref is not needed: the block already holds the new commit in `$C`, and a push of `$C` to `refs/heads/screenshots` on the remote is rejected as a non-fast-forward when someone else published meanwhile, which is the same safety the old-value check gave.

### Agreed scope

* **One-line fix:** the block's last step becomes `git push -q origin "$C:refs/heads/screenshots"`, with no local ref update.
* **Retry advice unchanged:** a rejected push still means someone added images meanwhile, and running the block again starts from the new tip.
* **Rules unchanged:** the branch is still never merged, rebased, force-pushed or deleted, and files are still never replaced or removed.

### Not in this story

* **Other changes to the skill**, such as naming, linking or the before and after table.
* **A tool or recipe** that wraps the block; the skill stays a documented command.

### Acceptance criteria

1. **Given** a checkout with no local `screenshots` branch, **when** I run the skill's publish block, **then** the commit is pushed to `origin/screenshots` and the block prints its hash. Checked by hand (see Testing).
2. **Given** another publisher moved `origin/screenshots` after my fetch, **when** I run the block, **then** the push is rejected, and running the block again succeeds from the new tip. Checked by hand (see Testing).
3. **Given** the change is complete, **when** I run `just check`, **then** it passes. CI on the delivery PR.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Agent automation under `.claude/` may be Claude Code only | The skill lives under `.claude/skills/`, so this is guidance for Claude Code first. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Push the commit, not a ref:** `git push origin "$C:refs/heads/screenshots"` needs no local branch and still fails on a non-fast-forward, so the safety of the old-value check is kept without a local ref that every fresh checkout would have to create.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Publish block | `.claude/skills/github-screenshots/SKILL.md` |

### API

No changes.

### Testing

* No automated test: the change is a command in a skill file. Checked by hand on 2026-11-09 against a throwaway bare remote and fresh clones, never the real branch. The old block, in a clone with no local `screenshots` branch, failed with `cannot lock ref 'refs/heads/screenshots'`; the new block in the same state pushed the commit and printed its hash, and the remote then held the new file beside the old ones. With the remote moved after the fetch, the push was rejected ("fetch first"), and running the block again succeeded from the new tip.

### Lessons learned, known issues and follow-ups

* None. The local ref was never needed; the push of the commit already carries the old-value safety.

## User guide

### Publishing a screenshot

No user-facing change. This story affects only how agents publish screenshots for GitHub posts.
