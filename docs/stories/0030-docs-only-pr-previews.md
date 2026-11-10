---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/332
pr:
  - https://github.com/mgasca/calendar/pull/333
  - https://github.com/mgasca/calendar/pull/334
adrs: ["0023", "0025"]
---

# 0030 Publish a docs-site preview only for docs-only pull requests

## Story

> As a maintainer, I need the docs-site preview to be published only for pull requests that change nothing but documentation, so that code pull requests stop producing previews, comments, checks and Pages deployments that show nothing new.

Tracked in issue #332.

## Background

[ADR-0025](../decisions/0025-github-pages-pr-previews.md) gives every open pull request from this repository a hosted preview of the docs site at `pr-preview/pr-N/`. The Docs site job in CI builds the publication artifact for the PR, and the Publish docs site workflow publishes it, creates an **ADR preview** check and posts a sticky comment. Nothing in that chain looks at what the PR changes, so a backend or frontend PR gets a preview that shows the same content as production.

Each preview is a GitHub Pages deployment. Issue #285 showed that publishes between two `main` commits can collide and block the site for about half an hour; fewer publishes mean fewer collisions. The owner asked that the preview automation run only for docs-only pull requests.

### Agreed scope

* **Docs-only** means every file the PR changes, as GitHub lists them against the merge base, is under `docs/` or `frontend/apps/docs/`: the sources the site is built from, and the site itself.
* **CI decides.** The Docs site job lists the PR's files on same-repository `pull_request` events and builds and uploads the `docs-site` publication artifact only for `main` pushes and docs-only PRs. Every PR still builds and verifies the site at the root path and at a project subpath.
* **The publisher follows the artifact.** In preview mode the Publish docs site workflow ends without publishing when the CI run uploaded no `docs-site` artifact, instead of failing at the download. Production publication, removal on close, reconciliation of closed previews and the fork exclusion are unchanged.
* **The guidance says so.** ADR-0025 gets an amendment narrowing eligibility, the docs app `README.md` and the architecture model say "docs-only", and this card records the rule.

### Not in this story

* Previews for pull requests from forks: ADR-0025 excludes them, and that stays.
* A unique Pages deployment ID per publish, the prevention item of #285.
* Removing the preview of a PR that was docs-only and later adds code: the publisher removes previews when the PR closes, and that stays.
* A new ADR: the publication mechanism is unchanged, so ADR-0025 is amended, not superseded.

### Acceptance criteria

1. **Given** an open same-repository PR whose every changed file is under `docs/` or `frontend/apps/docs/`, **when** its CI run succeeds, **then** the Docs site job uploads the `docs-site` artifact and the publisher publishes the preview, the **ADR preview** check and the sticky comment, as before.
2. **Given** an open same-repository PR that changes any other file, **when** its CI run succeeds, **then** the Docs site job still builds and verifies the site at both URL variants but uploads no `docs-site` artifact, and the publisher's run for that CI run ends successfully without publishing, commenting or creating a check.
3. **Given** a push to `main`, **when** its CI run succeeds, **then** production is published as before.
4. **Given** a docs-only PR with a published preview, **when** the PR closes, **then** the preview is removed as before.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0023](../decisions/0023-static-adr-log-publication.md) | Production is published from `main` only | Production publication is out of scope and must keep working |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Previews alongside production, published by a trusted `workflow_run` publisher | This story narrows which PRs are eligible; the mechanism and trust boundaries stay |

No new ADR is expected; ADR-0025 is amended with the narrowed eligibility.

### Other decisions (not ADR-worthy)

* **The rule lives in CI, the publisher follows the artifact:** one definition of docs-only, in the job that builds the artifact. The publisher only has to tolerate a run without one. A PR can already change what CI builds into the artifact, so letting it decide whether there is one changes no trust boundary.
* **The file list comes from the API:** `gh api repos/<owner>/<repo>/pulls/<number>/files` returns the merge-base diff GitHub shows, with the shallow checkout CI already has; a `git diff` would need history CI does not fetch.
* **Docs-only, not "touches docs":** the owner asked for docs-only, so a PR that changes code and docs together gets no preview. Widening the rule later is a one-line change to the step.

## Implementation notes

Delivered in the PRs listed in the front matter: the card, then the workflow, ADR and guidance changes.

### Where things live

| Area | Location |
| --- | --- |
| The docs-only decision and the artifact gate | `.github/workflows/ci.yml`, Docs site job: the step "Decide whether this pull request is docs-only" and the `if` of "Read GitHub Pages configuration", which the publication build and the `docs-site` upload depend on |
| The publisher's exit without an artifact | `.github/workflows/pages.yml`, assemble job, step "Validate source run and current revision", preview branch |
| Eligibility rule in the guidance | [ADR-0025](../decisions/0025-github-pages-pr-previews.md) amendment of 2026-11-06, `frontend/apps/docs/README.md` ("Pull request previews"), `docs/architecture/calendar.architecture.json` (docs site, Pages, the publication flow) |

### API

No changes.

### Testing

* Nothing in the repository executes the workflows, so the rule has no unit test; a step of shell in a workflow is not repository tooling in the sense of [ADR-0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md), and ADR-0025's own confirmation is a live pull request. The story's PRs are that confirmation: PR 0 is docs-only and gets a preview (criterion 1); the delivery PR changes workflows and gets none (criterion 2). Criteria 3 and 4 are confirmed after the merge, on the production publish for the merge commit and the removal of PR 0's preview.
* `just docs test`, `just docs build`, `just tools adr` and the workspace format check cover the card, the ADR amendment, the architecture model and the README.

### Lessons learned, known issues and follow-ups

* **The publisher runs from `main`**, so a change to it cannot be exercised by its own pull request. While the delivery PR was stacked on the card branch, the publisher on `main` returned early for its CI runs, because a PR whose base is not `main` was never eligible; once retargeted to `main` and until merged, that publisher expected an artifact from every same-repository PR and failed at the download for the delivery PR's CI runs. That run is not a PR check, and it stops with the merge. A change that alters what CI uploads should land with the publisher change that tolerates it, as here, and expect that short window.
* **A preview outlives its docs-only status.** The publisher removes previews on close only, so a PR that was docs-only and then adds code keeps the last preview. Removing it would cost a publish per code PR, the opposite of this story's aim.
* **Fewer publishes, not unique ones.** This story reduces the Pages deployments that collided in #285 but does not prevent the collision; that prevention item stays with #285.

## User guide

### Getting a hosted preview for a documentation change

Open a pull request that changes only files under `docs/` or the docs site in `frontend/apps/docs/`. After its CI run succeeds, the **ADR preview** check and a comment on the PR link to the preview, which is replaced on each successful run and removed when the PR closes.

A pull request that also changes code gets no preview. To review the rendered docs of such a change, run the site locally with `just docs dev`, or put the documentation in a PR of its own.
