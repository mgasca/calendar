---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Codex (AI assistant)
---

# Build the canonical ADR log as a static site and publish main to GitHub Pages

## Context and Problem Statement

The Astro and Starlight documentation application ([ADR-0022](0022-astro-starlight-documentation-ui.md)) must publish the merged ADR log and let readers navigate to individual records. The canonical Markdown records and their index already live in `docs/decisions/` under [ADR-0000](0000-use-markdown-architectural-decision-records.md). How should the web log stay synchronized with these sources and publish only merged content?

## Decision Drivers

* **D1 Single source of truth**: authors edit the existing ADRs and index without maintaining web-only copies or navigation lists.
* **D2 Merged publication**: the public site reflects `main`, while local and pull-request builds can validate proposed changes.
* **D3 Static operation**: publish readable pages without introducing an application server, database or content API.
* **D4 Navigable records**: preserve log order, record statuses, direct URLs and links between ADRs.
* **D5 Build integrity**: invalid inputs or broken transformations fail checks before publication.

## Considered Options

* Build canonical Markdown and publish main with GitHub Actions to GitHub Pages
* Copy ADRs into a separate documentation content tree
* Fetch repository Markdown at browser runtime
* Publish documentation with the product application container

## Decision Outcome

Chosen option: "Build canonical Markdown and publish main with GitHub Actions to GitHub Pages", because it keeps authoring centralized (D1), uses the merge boundary for publication (D2), produces static pages (D3), and validates the log-to-record transformation before deployment (D4, D5).

| Driver | **Build canonical Markdown and publish main with GitHub Actions to GitHub Pages (chosen)** | Copy ADRs into a separate documentation content tree | Fetch repository Markdown at browser runtime | Publish documentation with the product application container |
| --- | :---: | :---: | :---: | :---: |
| D1 Single source of truth | ★★★ | ★☆☆ | ★★★ | ★★★ |
| D2 Merged publication | ★★★ | ★★☆ | ★★☆ | ★★☆ |
| D3 Static operation | ★★★ | ★★★ | ★☆☆ | ★☆☆ |
| D4 Navigable records | ★★★ | ★★☆ | ★★☆ | ★★★ |
| D5 Build integrity | ★★★ | ★★☆ | ★☆☆ | ★★★ |

### Source and navigation contract

* `docs/decisions/README.md` remains the ordered ADR log. Its rows supply the displayed record order and navigation; each referenced numbered Markdown file supplies its body and metadata.
* The documentation application's Astro content integration reads these files at build time. TypeScript inside the Astro application implements framework integration; no separate repository tooling script is introduced, preserving [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md).
* Do not commit generated copies of the records. The template and index are not individual ADR pages.
* Retain every indexed record regardless of decision status. **Merged** means the content is on `main`; it does not mean `status: accepted`. Display proposed, accepted, rejected and superseded statuses without rewriting their meaning.
* Provide an ADR log landing view and a stable `adr/NNNN/` page per record, relative to the site's configured base path. Numeric routes remain stable when a record's title or filename changes. Preserve the log as navigation while a selected ADR renders in the content area.
* Rewrite links between ADR source files to their web pages, preserve fragments, and resolve other repository-file links to the repository. Site URLs and assets must support the GitHub Pages project base path.
* Validate malformed index entries, duplicate records, missing files and inconsistent title/status metadata rather than silently omitting content.

### Build and publication

* Local development and pull-request builds use their checked-out content, including draft ADRs, so proposed changes can be reviewed before merge.
* The production deployment uses only a successful build of `main`. Pull requests validate the documentation but cannot publish to the production Pages site.
* Build and test through the existing frontend workspace and top-level Make interface, in keeping with [ADR-0011](0011-make-as-top-level-task-runner.md) and [ADR-0012](0012-ci-and-dependency-updates.md).
* Use the existing CI workflow to build and upload the Pages artifact on pushes to `main`. Its deployment job depends on both the frontend build and aggregate CI result, uses the `github-pages` environment, restricts deployment permissions to that job and prevents competing deployments through concurrency.
* Configure GitHub Pages to use Actions as its source. Keep the source revision and deployment artifact associated, so the published output corresponds to the verified checkout.

### Consequences

* Good, because a merged ADR and its index change automatically become the next published documentation build.
* Good, because GitHub Markdown and the website share the same canonical records.
* Bad, because the application must adapt MADR metadata and repository-relative links to Starlight's content model.
* Bad, because publication depends on GitHub Actions and Pages configuration, even though the static artifact can be hosted elsewhere.
* Neutral, because a merged proposed ADR remains visible as proposed; publication does not approve architectural decisions.

### Confirmation

Run the existing ADR validator alongside docs type checking, tests and a production build. Tests cover index ordering, metadata validation, source-to-page links and base-path handling. Build or browser checks verify the log navigation, selected ADR rendering and direct record URLs. Workflow review confirms that only verified `main` content can reach the production Pages environment.

## Pros and Cons of the Options

### Build canonical Markdown and publish main with GitHub Actions to GitHub Pages

* Good, because **D1 Single source of truth**: one reviewed index and one file per ADR drive both repository and website readers.
* Good, because **D2 Merged publication**: a branch-restricted deployment separates public content from local and pull-request previews.
* Good, because **D3 Static operation**: Pages serves the generated files without a documentation backend.
* Good, because **D4 Navigable records**: build-time adaptation can preserve ordering, metadata and cross-links consistently.
* Good, because **D5 Build integrity**: validation and tests run on the same source revision used to generate the deployment artifact.
* Bad, because **D5 Build integrity**: the custom adaptation needs targeted tests and maintenance as source conventions evolve.

### Copy ADRs into a separate documentation content tree

* Bad, because **D1 Single source of truth**: maintaining a second editable tree can produce conflicting content and metadata.
* Neutral, because **D2 Merged publication**: deployment can be limited to `main`, but merged canonical records may be absent or stale in the copy.
* Good, because **D3 Static operation**: the copied content is compatible with static generation.
* Bad, because **D4 Navigable records**: copied filenames and separately maintained navigation can drift from the canonical log.
* Neutral, because **D5 Build integrity**: normal docs checks work, but source parity requires additional verification.

### Fetch repository Markdown at browser runtime

* Good, because **D1 Single source of truth**: the browser can read canonical repository files directly.
* Neutral, because **D2 Merged publication**: fetching `main` selects merged content, but separate requests can observe different revisions unless pinned to a commit.
* Bad, because **D3 Static operation**: readers depend on runtime network access and browser-side Markdown rendering.
* Neutral, because **D4 Navigable records**: custom browser code can implement navigation and links, with additional loading and error states.
* Bad, because **D5 Build integrity**: content can change independently of the application build and runtime failures surface to readers.

### Publish documentation with the product application container

* Good, because **D1 Single source of truth**: the container build can consume the canonical records.
* Neutral, because **D2 Merged publication**: publishing `main` is possible, but documentation updates follow product release timing.
* Bad, because **D3 Static operation**: documentation availability becomes coupled to the application service and its deployment.
* Good, because **D4 Navigable records**: the same static rendering and link adaptation can run during the container build.
* Good, because **D5 Build integrity**: tests and validation can gate the container build.

## More Information

* Official references: [Astro deployment to GitHub Pages](https://docs.astro.build/en/guides/deploy/github/), [Starlight sidebar navigation](https://starlight.astro.build/guides/sidebar/).
* Related: [ADR-0013](0013-public-repository-for-github-security-features.md) establishes the public GitHub repository; this decision adds a documentation deployment target without changing the product deployment architecture.
* This remains a proposed record for review. The user explicitly requested implementation alongside the draft.
