---
status: accepted
date: 2026-10-27
decision-makers: mgasca, Codex (AI assistant)
---

# GitHub Pages pull-request previews alongside production using a retained static snapshot

## Context and Problem Statement

The ADR website uses Astro and Starlight ([ADR-0022](0022-astro-starlight-documentation-ui.md)), with merged content published to GitHub Pages ([ADR-0023](0023-static-adr-log-publication.md)). Reviewers need hosted previews before merge, but the user has no Cloudflare account and wants to use the existing GitHub hosting. How can pull-request previews coexist with production when each Pages deployment replaces the site's complete artifact?

## Decision Drivers

* **D1 Review convenience**: reviewers can open an updated hosted preview without installing the toolchain.
* **D2 Existing hosting**: use the configured GitHub Pages site without requiring another provider account.
* **D3 Content preservation**: updating a preview must preserve production and other previews; production updates must preserve open previews.
* **D4 Trusted publication**: separate pull-request builds from privileged publishing and reject obsolete or ineligible artifacts.
* **D5 Maintainable lifecycle**: make preview creation, updates and cleanup explicit and testable.

## Considered Options

* Combined Pages artifact backed by a retained static snapshot
* Cloudflare Pages Git integration
* Publish each pull-request artifact directly to the existing Pages site
* Local previews and production-only Pages

## Decision Outcome

Chosen option: "Combined Pages artifact backed by a retained static snapshot", because it provides hosted previews (D1) using existing hosting (D2), preserves all published content through subtree updates (D3), and permits a trusted publisher with explicit lifecycle checks (D4, D5).

| Driver | **Combined Pages artifact backed by a retained static snapshot (chosen)** | Cloudflare Pages Git integration | Publish each pull-request artifact directly to the existing Pages site | Local previews and production-only Pages |
| --- | :---: | :---: | :---: | :---: |
| D1 Review convenience | ★★★ | ★★★ | ★★☆ | ★☆☆ |
| D2 Existing hosting | ★★★ | ☆☆☆ | ★★★ | ★★★ |
| D3 Content preservation | ★★★ | ★★★ | ☆☆☆ | ★★★ |
| D4 Trusted publication | ★★☆ | ★★☆ | ★☆☆ | ★★★ |
| D5 Maintainable lifecycle | ★★☆ | ★★★ | ★☆☆ | ★★★ |

### Published tree and lifecycle

* Keep GitHub Pages configured with GitHub Actions as its publishing source. Store the latest combined static tree on a dedicated `gh-pages` branch used as deployment state, not as the Pages publishing source.
* Production occupies the site root. Each eligible pull request occupies `pr-preview/pr-N/`, relative to the configured site base. For this repository, PR 42 uses `/calendar/pr-preview/pr-42/`.
* Build previews with that complete base path, so navigation, search and assets remain within the preview. Do not merely copy a production build beneath a new directory.
* A successful main build replaces production files while preserving the preview directory. A successful eligible pull-request build replaces only its numbered subtree. Closed pull requests have their subtree removed.
* Serialize every read-modify-publish operation against the same state branch. Load the latest snapshot inside the serialized operation and publish the whole updated tree. Cleanup is also reconciled during publication so interrupted cleanup can recover.
* Expose the preview URL in GitHub workflow output. Preview availability depends on deployment success; the first preview can be published only after the trusted publishing workflow exists on the default branch.

### Build and trust boundaries

* Existing CI builds and verifies the canonical ADR content with read-only repository permissions. It uploads static output for the source revision, event and intended publication target.
* A separate publisher uses `workflow_run` after successful CI. Publisher code comes from the trusted default branch. It downloads the corresponding artifact without checking out or executing pull-request code.
* Validate the originating workflow, repository, source event, revision and live pull-request state before applying an update. Only open pull requests from this repository are eligible; fork-origin pull requests retain local preview support.
* Reject stale results when the pull-request head has moved or the PR has closed. Main publication likewise must not roll production back to an older revision.
* Treat downloaded files as untrusted data: prevent archive traversal, symbolic-link escapes and reserved-path writes before adding the selected subtree to the snapshot. Never execute scripts from the artifact.
* Grant only the publishing job the permissions needed to update deployment state and deploy Pages. Build jobs receive neither production credentials nor a write-capable publication token.
* These previews share the production browser origin. A numbered path separates content but does not isolate arbitrary HTML or JavaScript. Limit previews to same-repository contributors and keep the documentation site free of authentication or sensitive application state.
* GitHub Pages remains the production host. This decision extends [ADR-0023](0023-static-adr-log-publication.md) by moving deployment orchestration to a trusted follow-on workflow that combines verified production and preview artifacts; it does not change the canonical Markdown source or production's main-only content rule.

### Amendment, 2026-11-06: previews for docs-only pull requests only

The decision above is unchanged: the combined artifact, the retained snapshot and the trusted publisher stay as they are, and the ratings of D1 to D5 stand. What changes is which pull requests are eligible. Every pull request from this repository used to get a preview, so a backend or frontend change published a site identical to production, with a check and a comment on the PR, and each publish was a Pages deployment of the kind that collided in issue #285. Story [0030](../stories/0030-docs-only-pr-previews.md) (issue #332) narrows eligibility.

* **Eligible** is an open pull request from this repository whose every changed file, as GitHub lists them against the merge base, is under `docs/` or `frontend/apps/docs/`: the sources the site is built from, and the site itself.
* **CI decides.** The Docs site job lists the pull request's files and builds and uploads the publication artifact only for `main` pushes and docs-only pull requests. Every pull request still builds and verifies the site at the root path and at a project subpath.
* **The publisher follows the artifact.** In preview mode it ends without publishing when the CI run uploaded no artifact. A pull request could already change what CI builds into the artifact, so letting it decide whether there is one moves no trust boundary: the publisher still validates the run, the revision and the live pull-request state, and never executes downloaded content.
* **Unchanged:** production publication, removal on close, reconciliation of closed previews and the fork exclusion. A pull request that was docs-only and later adds code keeps its last preview until it closes.

**Consequences of the amendment**

* Good, because **D1 Review convenience**: a preview appears exactly when there is documentation to review, and a code pull request no longer carries a preview check and comment that show nothing new.
* Good, because **D3 Content preservation**: fewer publishes mean fewer serialized snapshot updates and fewer Pages deployments that can collide (#285).
* Neutral, because **D4 Trusted publication**: the eligibility rule runs in the untrusted CI job, but all it can do is withhold an artifact the publisher had to validate anyway.
* Bad, because **D1 Review convenience**: a pull request that changes code and documentation together gets no hosted preview; its documentation is reviewed locally with `just docs dev`, or in a pull request of its own.

### Amendment, 2026-11-07: previews for any pull request that changes the docs

The decision and the first amendment's mechanism stay: CI decides by uploading the artifact or not, and the publisher follows the artifact. What changes is eligibility again. The maintainer asked, in issue #418, for a preview whenever a pull request changes the docs, including one that also changes code, which removes the Bad consequence above for mixed pull requests. Story [0038](../stories/0038-run-ci-jobs-only-for-the-paths-they-check.md) delivers it with [ADR-0046](0046-run-ci-jobs-only-for-the-paths-they-check.md).

* **Eligible** is an open pull request from this repository for which the CI Changes job sets the Docs site output to `true`: it changes a file under `docs/` or `frontend/apps/docs/`, or a frontend root configuration file the site builds with, or the CI rules themselves (`.github/workflows/ci.yml`, `.github/ci-changes.jq`). The rules file is the one list.
* **CI decides** as before: the Docs site job builds and uploads the publication artifact on `main` pushes and on eligible pull requests, and the Docs site job does not run at all for a pull request that is not eligible. The docs-only step that listed the pull request's files goes away; the Changes job lists them once for every job.
* **Unchanged:** the publisher, production publication, removal on close, reconciliation of closed previews and the fork exclusion. A pull request that stops changing the docs keeps its last preview until it closes.

**Consequences of the second amendment**

* Good, because **D1 Review convenience**: a pull request that changes code and documentation together gets a hosted preview of its documentation.
* Neutral, because **D3 Content preservation**: more publishes than under the first amendment, but still none for a pull request that changes no docs, so the Pages collisions of #285 stay rare.
* Neutral, because **D4 Trusted publication**: the eligibility rule still runs in the untrusted CI job and can only withhold an artifact the publisher validates anyway.

### Consequences

* Good, because reviewers get stable preview URLs with no additional hosting account.
* Good, because production and multiple previews coexist in the same deployed artifact.
* Bad, because retaining deployment state and merging subtrees adds custom publishing logic and repository storage.
* Bad, because preview HTML shares the production origin and is unsuitable for isolated execution of arbitrary third-party contributions.
* Neutral, because preview builds and deployment run asynchronously; passing CI does not itself mean a preview is already available.

### Confirmation

Test that production updates preserve previews, preview updates preserve production and other previews, and closed previews are removed. Test rejection of stale, fork-origin and malformed inputs and archive path escapes. Build and verify an ADR site at a nested preview base path. After merge, open a same-repository PR, confirm its hosted navigation works, update it, close it and verify cleanup while the production site remains available.

## Pros and Cons of the Options

### Combined Pages artifact backed by a retained static snapshot

* Good, because **D1 Review convenience**: a stable numbered URL serves the rendered proposal before merge.
* Good, because **D2 Existing hosting**: the existing Pages site and Actions integration provide hosting.
* Good, because **D3 Content preservation**: serialized subtree updates preserve production and unrelated previews.
* Neutral, because **D4 Trusted publication**: privileged operations use trusted code and validated artifacts, but all published pages share an origin.
* Neutral, because **D5 Maintainable lifecycle**: updates and cleanup can be tested, but the repository owns the state-management logic.

### Cloudflare Pages Git integration

* Good, because **D1 Review convenience**: the integration provides hosted preview URLs and GitHub feedback.
* Bad, because **D2 Existing hosting**: it requires the external account the user does not have.
* Good, because **D3 Content preservation**: separate preview hosting does not replace GitHub Pages production.
* Neutral, because **D4 Trusted publication**: it avoids a custom credentialed upload workflow, but requires GitHub App access and has its own contribution-origin restrictions.
* Good, because **D5 Maintainable lifecycle**: the provider manages preview deployment behavior.

### Publish each pull-request artifact directly to the existing Pages site

* Neutral, because **D1 Review convenience**: the site is reachable, but different PRs compete for the same URL.
* Good, because **D2 Existing hosting**: no new hosting account is needed.
* Bad, because **D3 Content preservation**: each deployment replaces production and previous previews.
* Bad, because **D4 Trusted publication**: promoting unmerged output to the canonical root defeats the production content boundary.
* Bad, because **D5 Maintainable lifecycle**: restoring production and distinguishing concurrent proposals becomes fragile.

### Local previews and production-only Pages

* Bad, because **D1 Review convenience**: reviewers need a checkout and frontend toolchain to see unmerged changes.
* Good, because **D2 Existing hosting**: the current hosting configuration is sufficient.
* Good, because **D3 Content preservation**: the existing main-only deployment does not publish previews.
* Good, because **D4 Trusted publication**: no additional unmerged content reaches the public site.
* Good, because **D5 Maintainable lifecycle**: there is no hosted preview state to manage.

## More Information

* Verified on 2026-10-27: [`actions/deploy-pages`](https://github.com/actions/deploy-pages) documents its normal artifact deployment; its experimental preview input is not a generally available preview-hosting solution. [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) documents the trusted follow-on workflow mechanism and its security considerations.
* Alternative: [Cloudflare preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/).
* **Amendment, 2026-11-06:** previews are published for docs-only pull requests only, in issue #332 and story [0030](../stories/0030-docs-only-pr-previews.md). The decision itself is unchanged, so this ADR was amended, not superseded, as [ADR-0038](0038-just-as-the-top-level-task-runner.md) was for its module layout.
* **Amendment, 2026-11-07:** previews are published for any same-repository pull request that changes the docs, in issue #418 and story [0038](../stories/0038-run-ci-jobs-only-for-the-paths-they-check.md), alongside [ADR-0046](0046-run-ci-jobs-only-for-the-paths-they-check.md). Amended rather than superseded for the same reason.
* This remains a proposed decision while the requested implementation is prepared for review.
