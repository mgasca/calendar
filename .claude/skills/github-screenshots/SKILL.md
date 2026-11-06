---
name: github-screenshots
description: Show a screenshot or other image in a GitHub issue, PR or comment of this repo by adding it to the never-merged `screenshots` branch with git plumbing and linking it by commit. Covers the directory per issue number, file naming, the push-and-retry block, pinned raw links and the before-and-after table for a UI change. Use whenever an image has to appear in a GitHub post, a PR description needs before and after screenshots, or someone asks how to attach, upload or link a screenshot, since `gh` cannot attach images.
---

# Screenshots on GitHub

`gh` cannot attach an image to an issue or PR, so images live on the orphan branch `screenshots` and posts link them there. The `run-calendar` skill takes the screenshots; this skill publishes them.

- One directory per GitHub number, bare: `259/add-event-before.png`. Issues and PRs share one number sequence, so numbers never collide. Images taken for a delivery PR go under the issue it delivers; use the PR number only when there is no issue.
- Name a file by what it shows (`add-event-before.png`, `week-after.png`), never by a session or task handle.
- The branch is never merged, rebased, force-pushed or deleted, and a file is never replaced or removed: a retaken screenshot gets a new name, so earlier links keep showing what the reviewer saw.
- Add images with git plumbing from any checkout, without checking the branch out. With the number in `N` and the PNGs in `DIR`, and the commit message ending with the usual agent attribution:

```bash
git fetch -q origin screenshots && P=$(git rev-parse origin/screenshots) && export GIT_INDEX_FILE=$(mktemp) && git read-tree "$P" && for f in "$DIR"/*.png; do git update-index --add --cacheinfo 100644,$(git hash-object -w "$f"),"$N/$(basename "$f")"; done && C=$(git commit-tree "$(git write-tree)" -p "$P" -m "Screenshots for #$N") && unset GIT_INDEX_FILE && git update-ref refs/heads/screenshots "$C" "$P" && git push -q origin screenshots && echo "$C"
```

If the push is rejected, someone added images meanwhile: run the block again, which starts from the new tip. The branch exists; never recreate it with `--orphan`.
- Link each image by the commit the block printed, `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/N/<file>.png`, as a Markdown image whose alt text says what it shows. The link is immutable; a link by branch name is not pinned and is not used.
- A UI change's PR description shows before and after side by side (a table with one image per cell) and says which revision each was taken at.
- The post that carries the images follows the root `AGENTS.md` rule for public posts: repository-relative paths, public links, no private handles or machine paths.
