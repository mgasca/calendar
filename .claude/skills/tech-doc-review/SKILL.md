---
name: tech-doc-review
description: Review a technical document (a runbook, setup guide, procedure or other how-to) for clarity and simplicity. Two reviewers write a clear draft and a simple draft in parallel, a third writes a combined draft that resolves the trade-offs, and each document gets its own review PR. Use this whenever the user asks to review, clarify, simplify, tidy or streamline a runbook, guide or procedure; asks for "clear" or "simple" versions or a combined rewrite; wants a newcomer to be able to follow a document; or asks to "review the runbooks" or "keep the drafts" rather than replace the original. Not for writing a new document from scratch, and not for ADRs or story cards (use adr-draft and story-draft).
---

# Technical document review

The goal is a document that a newcomer can follow to the end, and that a busy expert can scan. Clarity and simplicity pull against each other: explanation helps the newcomer and costs the expert time. This skill makes one reviewer work on each side, then a third weighs both and keeps the best of each. The result is recorded so a human can see every trade-off.

You coordinate; you do not write the drafts yourself. Each draft comes from a subagent, so the reviewers are independent of each other and of you.

## Inputs

Ask only for what is missing:

- **Document path(s)**, relative to the repository root. Several documents can be reviewed in one run; each gets its own draft set and its own PR.
- **Issue number** (optional). Used in commit trailers (`Refs #N`) and the PR body.
- **Mode**: `finalize` (default) or `keep-drafts`. Read the table below.
- **Dry run** (optional). If the user says "dry run", "don't publish" or "no PR", do every step through the commits, then stop before any `git push` or `gh pr create`. Report the branch name instead.

| Mode | Triggers | What the PR contains | Ready to merge? |
| --- | --- | --- | --- |
| `finalize` (default) | No mode named | The original, the three drafts, then a commit that replaces the original with the combined draft and deletes the clear and simple drafts | Yes. The net change is the rewritten document only. |
| `keep-drafts` | "keep the drafts", "review only", "don't replace the original", "leave the drafts" | The original and the three drafts, side by side | No. The user chooses the final version; one document must remain under the original name before merge. |

## Setup

Work only in a fresh git worktree. Never edit the main checkout.

1. From the main checkout, run `git fetch`, then for each document `git worktree add ../wt-<slug> -b doc-review-<slug> origin/main`. The slug is the file name without `.md`.
2. Run at most two documents at a time. The delegation limit is six live children, and a document uses up to two children in stage 1 and one in stage 2.
3. Each document runs through stages 1–4 independently. As soon as one document's PR is open, report its link, even if the others are still running.

## Stage 1: Clear and simple drafts (two children, in parallel)

Spawn both in the same turn, with `task_type: straightforward` and `working_directory` set to the document's worktree. The children do not see this conversation, so give them pointers:

- **Clarity child**: "Follow the brief at `<skill>/references/clarity-brief.md`. Document: `<path>`. Write the draft to `<dir>/clear-<name>.md`. Write the change log to your report directory."
- **Simplicity child**: "Follow the brief at `<skill>/references/simplicity-brief.md`. Document: `<path>`. Write the draft to `<dir>/simple-<name>.md`. Write the change log to your report directory."

`<skill>` is the absolute path to this skill's folder, so the children read the same briefs you do.

Wait for both reports. Check that each draft exists, is not empty, and that its change log exists. Then run the command check below. If a draft fails, send that child one correction with the failing lines (`send_message`). If it fails again, take over the edit yourself and say so in the PR body.

## Stage 2: Combined draft (one subtle child)

Only after both drafts pass stage 1, spawn one child with `task_type: subtle`, the same worktree, and the brief `<skill>/references/combine-brief.md`. Pointers to give: the original, `clear-<name>.md`, `simple-<name>.md`, and both change logs. It writes `<dir>/combined-<name>.md` and `decisions.md` (the trade-offs it resolved) to its report directory.

Check the combined draft with the command check, and check that its decisions list covers each conflict in the change logs. If it fails the command check, send one correction. If it fails again, take over.

## Command check

Commands are the most dangerous part of a runbook, so check them by script every time. Do not rely on reading the drafts:

1. Collect every non-blank line inside the fenced code blocks of the original, trimmed of leading and trailing spaces.
2. Check that each of those lines appears, unchanged, in the draft's fenced code blocks. Any missing line is a failure.
3. List every command line the draft adds. Each addition must have a reason in the change log, and must be checkable against the repository (a file, a Make target, a workflow name). If it isn't, remove it.

Record the result for the PR body: lines checked, lines missing (should be none), lines added and why.

## Stage 3: Publish

Follow `references/publish.md`. It covers the commit order, the PR body, and the link check. The commit order is the point of this review: commit 1 copies the original unchanged to the three new names, so a reviewer who selects only the later commit sees each draft as a diff against the original.

## Final report

Tell the user, per document: the PR link (or branch name in a dry run), the mode, the command-check result, the trade-offs the combined reviewer chose that a human should look at first, and anything not verified. Close each child after reading its report.

## Why the steps are split this way

- **Two drafts in parallel, then one combiner.** A single reviewer tends to lean one way. Separate reviewers, each told to optimise one goal, give the combiner two real options to weigh.
- **Subtle for the combiner, straightforward for the drafts.** The drafts follow clear briefs. The combiner has to weigh conflicts and check facts, which is where a mistake is costly.
- **The command check runs by script, not by eye.** A reworded command can look right and still change a flag or a value. Comparing the text mechanically is the only reliable way to catch that.
- **Each change is recorded.** The change logs and `decisions.md` let a reviewer see why a line changed, not just that it did.
- **Pointers to the simple-english skill.** A child profile may not list the skill. The brief gives its file path as a fallback.
