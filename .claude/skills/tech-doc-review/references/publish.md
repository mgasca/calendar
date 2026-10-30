# Publishing a document's review

Run these steps in the document's worktree, once its combined draft has passed the command check. Add `Refs #N` to every commit when an issue number was given. Never write `Closes #N` here: the story card decides when an issue closes.

## Commit order

The order matters. It lets a reviewer select a single commit in GitHub's **Files changed** and see each draft as a diff against the original.

1. **Copy commit.** Move the three drafts to a scratch directory outside the checkout (`mktemp -d`). Copy the original to the three new names. Stage and commit:

   ```
   Runbook review: copy <name> to clear-, simple- and combined- names

   Unchanged copies of the original, so the next commit shows each review
   leg as a diff against it.
   ```

2. **Drafts commit.** Move the drafts back beside the original, stage them and commit:

   ```
   Runbook review: <name> clear, simple and combined drafts
   ```

3. **Replacement commit (finalize mode only).** Replace the original with the combined draft and delete the other two drafts. Use `git mv -f` so the original's history follows the rewrite:

   ```
   Runbook review: adopt the combined <name> draft

   The combined version replaces <name>.md, and the clear-, simple- and
   combined- drafts are removed.
   ```

   In `keep-drafts` mode, skip this commit.

Each commit ends with the `Co-Authored-By` line from the session's attribution reminder.

## Link check

Before the final commit (or before the PR, in `keep-drafts` mode), search the repository for the document's file name and for each heading anchor the draft changed or removed:

```
git grep -n "<name>.md" -- . ':!docs/runbooks/<name>.md'
git grep -n "<name>.md#"
```

A changed anchor breaks any link into the old heading. Fix the links in the same branch, and say so in the PR body. If you cannot fix a link, record it as an open item.

## Stop before publishing in a dry run

If this is a dry run, stop after the commits and link check. Report the branch name. Do not run `git push` or `gh pr create`.

## Push and open the PR

```
git push -u origin doc-review-<slug>
gh pr create --title "<title>" --body-file <file>
```

Titles:

- finalize: `Doc review: <name> rewritten for clarity and simplicity`
- keep-drafts: `Doc review: <name> (clear, simple and combined drafts)`

Write the body to a file. Use this structure:

```
## What changed
<finalize> The combined draft replaces <name>.md, and the clear- and simple- drafts are removed. The net change is the rewritten document only.
<keep-drafts> Three drafts sit beside the original. **Not ready to merge.** Before merge, one document stays under the original name and the drafts are removed.

## How to review
The first commit copies the original unchanged to the three new names, and the second adds the drafts. In **Files changed**, select only the second commit to see each draft as a diff against the original.

## Trade-offs resolved
<the trade-offs from decisions.md, each with the options and the choice>

## Changes beyond wording
<each command added, each heading renamed, and each claim changed, with the reason and what was checked>

## Checks
- Command check: <lines checked, lines missing, lines added and why>
- Link check: <links found, links fixed, open items>
- Not verified live. These are docs only.

Refs #N

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Record the PR URL and report it to the user. Do not wait for the other documents.
