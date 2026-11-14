---
status: accepted
date: 2026-11-14
decision-makers: mgasca, Claude (AI assistant)
---

# Native GitHub stacks for stacked PRs, with a narrow exception that lets an agent rebase its own stack

## Context and Problem Statement

Agents stack a PR on an open one so that review of the next step can start before the first merges. Until now they did it as ordinary chains (`gh pr create --base <previous-branch>`) and kept every pushed branch merge-only ("Never rewrite a pushed branch", in the `issue-handover` skill). On epic #801 that went wrong twice: after a squash merge of the bottom PR the next one conflicted (#855 after #844), and PRs merged into their parent branch closed nothing (#866/#831, #875/#829), so the maintainer reconciled them by hand. The maintainer uses GitHub's native stacked PRs instead: a merge from the top lands every layer on `main` as its own squash commit, and the stack is brought up to date by a cascading rebase ("Rebase stack" in the UI, or `gh stack rebase` and `gh stack push`). "Update branch" does not work on stack branches: `PUT /repos/{owner}/{repo}/pulls/{n}/update-branch` returns 403. So a native stack cannot be kept current without force-pushing pushed branches. How should agents create stacked PRs, and who may rewrite a stack's pushed branches to keep it current?

## Decision Drivers

* **D1 Delivery after a merge**: once a lower layer merges, the next one neither conflicts nor waits for hand reconciliation, and every PR's `Closes #N` closes its issue.
* **D2 Protection of pushed work**: no one loses a commit that someone else pushed, and a reviewer's view of a PR is never replaced without notice.
* **D3 Maintainer load**: the maintainer is not asked to approve or perform routine branch maintenance on every stack.
* **D4 Review traceability**: a reviewer can tell which head was reviewed and what changed since.
* **D5 Tooling cost and agent neutrality**: what contributors and agents must install, and whether any agent can follow the rule by hand ([ADR-0044](0044-claude-first-agent-automation.md)).
* **D6 Fit with GitHub's native stack features**: stack merge from the top, server-side "Rebase stack", trunk-evaluated checks and protections.

## Considered Options

* Native stacks; an agent may rebase a stack it owns after a fetch shows no one else pushed
* Native stacks; every rebase of pushed branches needs the maintainer's explicit OK for that stack
* Native stacks; only the maintainer updates them ("Rebase stack" in the UI)
* Ordinary `--base` chains, merge-only (the previous practice)

## Decision Outcome

Chosen option: "Native stacks; an agent may rebase a stack it owns after a fetch shows no one else pushed", because only native stacks deliver each layer to `main` and close its issue (D1, D6), and letting the owning agent run the cascading rebase keeps stacks current without the maintainer's attention (D3). The fetch check, the per-branch `--force-with-lease` of `gh stack push` and the old-and-new-head comment keep the risk to pushed work and to review low (D2, D4). The maintainer chose this option in conversation on 2026-11-14 ([#891](https://github.com/mgasca/calendar/pull/891)).

| Driver | **Agent rebases its own stack (chosen)** | Explicit OK per stack | Maintainer only | Ordinary `--base` chains |
| --- | :---: | :---: | :---: | :---: |
| D1 Delivery after a merge | ★★★ | ★★☆ | ★★☆ | ☆☆☆ |
| D2 Protection of pushed work | ★★☆ | ★★★ | ★★★ | ★★★ |
| D3 Maintainer load | ★★★ | ★☆☆ | ☆☆☆ | ★☆☆ |
| D4 Review traceability | ★★☆ | ★★☆ | ★★☆ | ★★★ |
| D5 Tooling cost and agent neutrality | ★★☆ | ★★☆ | ★★☆ | ★★★ |
| D6 Fit with GitHub's native stack features | ★★★ | ★★★ | ★★★ | ☆☆☆ |

### The rule

* Create stacked PRs as native GitHub stacks with the `gh-stack` extension (`gh extension install github/gh-stack`): `gh stack init`, `gh stack add <branch>` per layer, `gh stack submit`. Stack PRs that already exist with `gh stack link <bottom> … <top>`. Never open a bare `gh pr create --base <branch>` chain.
* Each PR carries its own `Closes #N` or `Refs #N` from the start.
* The **exception**: an agent may run `gh stack rebase` and then `gh stack push` on a native stack **it owns** (it created every layer and is delivering them), only after `git fetch` shows that no one else has pushed to any of the stack's branches since its own last push. It then comments on each PR with that PR's old and new head.
* Every other pushed branch stays merge-only: before a push, fetch and merge the remote head. An agent does not run `gh stack sync`, a plain `git push --force`, or a rebase of a stack it does not own. "Rebase stack" in the UI stays the maintainer's call.
* `main` keeps its ruleset: no force-push or deletion ([ADR-0012](0012-ci-and-dependency-updates.md)).
* Where it is written: root `AGENTS.md` ("Working on several changes at once"), the `issue-handover` skill ("Resume and close out"), and the `epic-delivery` skill and its `references/stacked-prs.md`.

### Consequences

* Good, because a squash merge of a lower layer no longer leaves the next one conflicting, and no PR is merged into a parent branch where its `Closes` does nothing.
* Good, because routine stack maintenance no longer waits on the maintainer.
* Bad, because a rebase replaces the commits a reviewer saw; the old-and-new-head comment is the only bridge, and GitHub's "compare" view between heads must be used to see what changed.
* Bad, because the rule rests on the agent's honesty about ownership and the fetch check; `--force-with-lease` catches a push that races the agent, but not one that the agent fetched and then ignored.
* Bad, because contributors and agents need the `gh-stack` extension, which `gh` itself does not ship; `just doctor` checks it once #887 lands.
* Neutral, because the guidance stays plain text that any agent can follow; no hook enforces it.

### Confirmation

* Review: a stacked PR that is not part of a native stack, or a force-push to a PR branch without the old-and-new-head comment, is called out on the PR.
* `just doctor` reports a missing `gh-stack` extension (#887).
* The `adr-sweep` skill checks that `AGENTS.md` and the skills still state the rule as recorded here.

## Pros and Cons of the Options

### Native stacks; an agent may rebase a stack it owns after a fetch shows no one else pushed

* Good, because **D1 Delivery after a merge**: the owning agent restores the stack right after a lower layer merges, so the rest stays mergeable.
* Good, because **D3 Maintainer load**: the maintainer only merges; branch upkeep is the agent's.
* Good, because **D6 Fit with GitHub's native stack features**: it uses the stack merge and the cascading rebase GitHub designed for stacks.
* Neutral, because **D2 Protection of pushed work**: a rewrite is allowed, but only on the agent's own branches, after a fetch, with `--force-with-lease` per branch.
* Bad, because **D4 Review traceability**: the reviewed commits disappear from the branch; the head comment says which head was reviewed, but the diff between heads must be looked up.
* Bad, because **D5 Tooling cost and agent neutrality**: it needs the `gh-stack` extension; the rule is still followable by hand by any agent.

### Native stacks; every rebase of pushed branches needs the maintainer's explicit OK for that stack

* Good, because **D2 Protection of pushed work**: no pushed branch is rewritten without a human decision.
* Good, because **D6 Fit with GitHub's native stack features**: stacks are native.
* Bad, because **D3 Maintainer load**: every behind or conflicting stack turns into a question for the maintainer.
* Bad, because **D1 Delivery after a merge**: a stack stays behind until the maintainer answers.
* Neutral, because **D4 Review traceability**: rebases are as opaque as in the chosen option, only rarer.
* Bad, because **D5 Tooling cost and agent neutrality**: the same extension is needed.

### Native stacks; only the maintainer updates them ("Rebase stack" in the UI)

* Good, because **D2 Protection of pushed work**: agents never rewrite a pushed branch.
* Good, because **D6 Fit with GitHub's native stack features**: GitHub's server-side rebase does the work.
* Bad, because **D3 Maintainer load**: all stack maintenance is the maintainer's, by hand.
* Bad, because **D1 Delivery after a merge**: agents cannot unblock a conflicting stack themselves.
* Neutral, because **D4 Review traceability**: the same rewrite, done by the maintainer.
* Bad, because **D5 Tooling cost and agent neutrality**: agents still need the extension to create stacks.

### Ordinary `--base` chains, merge-only (the previous practice)

* Good, because **D2 Protection of pushed work**: nothing is ever force-pushed.
* Good, because **D4 Review traceability**: merges keep every reviewed commit on the branch.
* Good, because **D5 Tooling cost and agent neutrality**: plain `gh pr create` and `git merge`.
* Bad, because **D1 Delivery after a merge**: a squash-merged bottom leaves the next layer conflicting (#855 after #844), and a PR merged into its parent branch closes nothing (#866/#831, #875/#829).
* Bad, because **D3 Maintainer load**: the maintainer reconciles closing keywords and conflicts by hand.
* Bad, because **D6 Fit with GitHub's native stack features**: the stack merge and "Rebase stack" are unavailable, and the maintainer's top-of-stack merges look like accidents to agents.

## More Information

* Evidence and the request: [#888](https://github.com/mgasca/calendar/issues/888); the decision: [#891](https://github.com/mgasca/calendar/pull/891). The `just doctor` check for the extension: [#887](https://github.com/mgasca/calendar/issues/887).
* Versions at the time of writing: `gh` 2.46.0 (no `gh pr update-branch`), `gh-stack` v0.3.0. `gh stack sync` fetches, cascade-rebases and pushes with `--force-with-lease` in one step, which is why the exception names `rebase` and `push` instead.
* GitHub docs: [Stacked pull requests](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests), [Stacked PRs CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands). The merge API for a stack is `PUT /repos/{owner}/{repo}/pulls/{n}/merge-async`.
* Related: [ADR-0012](0012-ci-and-dependency-updates.md) (the `main` ruleset, unchanged), [ADR-0042](0042-layered-agent-guidance-and-hooks.md) (where the rule is written), [ADR-0044](0044-claude-first-agent-automation.md) (the rule is plain guidance, not Claude-only automation).
* Revisit when a rewrite under the exception loses someone's work, when GitHub's "Update branch" starts supporting stack branches, or when a hook could check ownership and the fetch for the agent.
