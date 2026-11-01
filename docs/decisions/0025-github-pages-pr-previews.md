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
* This remains a proposed architectural decision while the requested implementation is prepared for review.
