# Recognising and following PR stacks

Read this before declaring a stack ready, responding to stack merges or directing branch maintenance. These facts were checked against GitHub documentation on 2026-11-06. Recheck the linked docs and installed tool capabilities when behaviour differs; avoid relying on a remembered CLI/API schema.

## Native GitHub stacks and ordinary branch chains

A native GitHub stack is more than PRs whose bases happen to form a chain. Confirm membership and the trunk through available GitHub stack metadata/UI, or supported CLI/API inspection. Stack metadata is exposed in webhook payloads through `pull_request.stack`; do not assume every REST/GraphQL response or `gh pr view` exposes the same field. A `baseRefName` pointing at another PR branch is not enough to distinguish the two modes. If evidence is unavailable, report the uncertainty and inspect final content before diagnosing a merge error.

* **Native stack:** selecting a higher PR merges that PR and the contiguous unmerged layers below it onto the trunk in one operation. Selecting the top can deliver the whole stack. Internal ordering is bottom-up; the maintainer does not need to click each PR bottom-first.
* **Ordinary chain:** PRs target other branches without native stack management. A direct merge into a parent branch may genuinely leave the changes waiting there until a later trunk merge. Trace that delivery instead of claiming it has already reached the default branch.

For native stacks, protections and Actions are evaluated against the trunk. A non-default immediate base does **not** mean checks are reduced. Derive the expected set from current workflow/rules/stack context; explain a real missing check. Ordinary chains may have base-filtered workflows, so assess those separately.

## When the maintainer merges from the top

1. Re-read the selected PR and the stack. Track membership, trunk, current heads and any merge-queue status. A queued operation is not yet delivery.
2. Reconcile the whole affected group, not just the first event received. Events may arrive at different times. Native stack merges can automatically move/rebase remaining layers; wait for this to settle before directing corrective branch work.
3. Confirm each intended layer's content on the trunk and checks for the delivered revision. GitHub can produce a merge commit or squash commit per PR, so neither one expected commit hash nor a PR's historical immediate base is sufficient proof.
4. Verify each linked issue and the epic checklist. Keep normal issue-closing references in each PR, but check their actual result after the stack lands. If an issue remains open, determine whether scope is incomplete or only tracking is stale; reconcile evidence-backed bookkeeping. Do not automatically copy every child's closing keyword into the lowest PR or blame the maintainer's merge choice.
5. Report one meaningful milestone for the group. Keep genuine unresolved review, delivery or CI gaps visible. Ignore stale conflict flags on already-merged PRs.

GitHub supports partial contiguous group merges and merge queues. If a queued layer is ejected, inspect the resulting queue/stack state before telling workers which dependencies are ready. The coordinator never invokes merge, auto-merge or a merge queue to make the maintainer's decision for them.

## Updating work that remains open

Native stacks may require a cascading rebase to restore linear history; GitHub can also rebase them server-side. Fetch and re-read remote state before any worker push. Do not blindly apply ordinary-chain advice to merge `main` into every layer, manually retarget every PR, or force-push over GitHub's changes. If the native stack's required maintenance conflicts with the repository's rules against rewriting pushed branches, explain the specific conflict and seek a maintainer decision instead of overriding either rule. Preserve any local work while reconciling remote changes.

Workers create stacks natively with the `gh-stack` extension (`gh stack init`/`add`/`submit`, or `gh stack link` for PRs that already exist), as root `AGENTS.md` and `issue-handover` prescribe. The update tools are a cascading rebase that force-pushes every layer: GitHub's "Rebase stack", `gh stack rebase` then `gh stack push`, or `gh stack sync`. "Update branch" does not apply, since `PUT /repos/{owner}/{repo}/pulls/{n}/update-branch` returns 403 for stack branches. A worker runs none of them on pushed branches without the maintainer's explicit OK for that stack, so a behind or conflicting native stack is a question for the maintainer, not a worker action.

## Sources

* [Merge stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests): group selection, merge ordering, automatic handling of remaining layers and merge queues.
* [Stacked pull request reference](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests): trunk protections, Actions context, metadata, per-PR merge/squash results and rebasing.
* [Stacked PRs CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands): the `gh stack` commands that create, link, rebase, push, sync and merge a stack.

The original epic-monitoring session interpreted grouped merges as accidental merges into parent branches. The maintainer confirmed they intentionally used GitHub's stack feature. Retain the verification lesson; discard the assumption that this merge choice was an error. No fixed epic IDs, session handles or machine paths belong in the reusable procedure.
