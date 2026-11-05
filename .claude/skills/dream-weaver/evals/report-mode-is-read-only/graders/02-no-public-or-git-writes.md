---
type: llm
focus: trace
weight: 1
---

The run executes no command that writes to GitHub or the repository: no `gh issue create`, `gh issue comment`, `gh pr create`, `gh pr merge`, `git push`, `git commit`, or edits of tracked files. Reads (`git fetch`, `git show`, `git grep`, `gh repo view`, `mj sessions`, `mj transcript`) are fine. The prompt named no mode, so the default report mode applies.
