---
status: accepted
date: 2026-10-28
decision-makers: mgasca, Claude (AI assistant)
---

# Publish user stories on the documentation site alongside the ADR log

## Context and Problem Statement

The documentation site publishes the ADR log from `docs/decisions/` ([ADR-0023](0023-static-adr-log-publication.md)). User stories now live in `docs/stories/` and cite the ADRs they rely on, the other stories they follow, and the repository files they implement. Readers need the stories in the same place, with the same navigation, and every link between the two collections has to work on the published site. How should the site present the stories without creating a second copy of them?

## Decision Drivers

* **D1 Single source of truth**: authors edit the story Markdown in `docs/stories/`, without a web-only copy or navigation list.
* **D2 Navigable cross-links**: links between stories, from stories to ADRs, and from ADRs to stories work on the published site.
* **D3 Static operation**: the stories are published as static pages on the existing documentation deployment.
* **D4 Build integrity**: broken links, unlisted or missing stories, unknown ADR numbers and inconsistent metadata fail the build rather than publishing silently.

## Considered Options

* Publish stories from their canonical Markdown on the same documentation site
* Publish stories on a separate documentation site
* Keep stories as repository Markdown only

## Decision Outcome

Chosen option: "Publish stories from their canonical Markdown on the same documentation site", because it keeps one source (D1), resolves cross-links with the same rules as ADR links (D2), adds no deployment target (D3), and reuses the ADR log's validation pattern (D4).

| Driver | **Publish stories on the same documentation site (chosen)** | Publish stories on a separate documentation site | Keep stories as repository Markdown only |
| --- | :---: | :---: | :---: |
| D1 Single source of truth | ★★★ | ★★☆ | ★★★ |
| D2 Navigable cross-links | ★★★ | ★☆☆ | ★☆☆ |
| D3 Static operation | ★★★ | ★★☆ | ★★★ |
| D4 Build integrity | ★★★ | ★★☆ | ★☆☆ |

### Source and navigation contract

* `docs/stories/README.md` remains the ordered story index. Each story is published at `stories/NNNN/`, using its number as in [ADR-0023](0023-static-adr-log-publication.md)'s `adr/NNNN/` routes. A story that is not scheduled yet is published under its slug, and its URL changes when it is numbered.
* Stories cite ADRs through their front matter (`adrs`). Those numbers are quoted strings, because YAML reads an unquoted `0016` as a different number. The build rejects numbers that do not name a published ADR.
* Links are rewritten relative to the document that contains them. ADR, story and index links become site routes, while other repository links point to the repository, as ADR links already do.
* The site title becomes "Calendar · Docs". The ADR log remains the landing page.

### Consequences

* Good, because a merged story and its ADR links appear on the next documentation build, with no copies to maintain.
* Good, because ADRs and stories link to one another in both directions on the published site.
* Bad, because the story's front matter has its own rules (quoted ADR numbers, `YYYY-MM-DD` dates) that authors must follow.
* Bad, because an unscheduled story's URL changes when it is numbered, so external links to it break.
* Neutral, because the stories are public once merged, as the ADRs already are.

### Confirmation

`make adr-check` validates this record. The documentation tests cover story parsing and validation, link rewriting from both collections, and the published pages. The build verification crawls every generated page and fails on any broken internal link or anchor, and on any Markdown link left unrewritten. The build runs at the root path and at a project subpath.

## Pros and Cons of the Options

### Publish stories from their canonical Markdown on the same documentation site

* Good, because **D1 Single source of truth**: the story files and their index drive the published pages.
* Good, because **D2 Navigable cross-links**: the same rewriting rules apply to ADR and story links.
* Good, because **D3 Static operation**: stories are generated as static pages in the existing site.
* Good, because **D4 Build integrity**: the build validates story metadata, index rows and every link before publication.
* Bad, because **D4 Build integrity**: the story parser and the link rules need targeted tests as the conventions change.

### Publish stories on a separate documentation site

* Good, because **D1 Single source of truth**: the source files stay in `docs/stories/`.
* Neutral, because **D1 Single source of truth**: the separate site needs its own build and content configuration.
* Bad, because **D2 Navigable cross-links**: links from stories to ADRs cross two sites and need absolute URLs.
* Bad, because **D3 Static operation**: a second deployment target needs its own hosting and publication workflow.
* Good, because **D4 Build integrity**: each site can validate its own content independently.

### Keep stories as repository Markdown only

* Good, because **D1 Single source of truth**: the files are edited where they are read.
* Good, because **D3 Static operation**: nothing needs to be built or hosted.
* Bad, because **D2 Navigable cross-links**: readers see relative links that do not resolve outside GitHub, and there is no story navigation.
* Bad, because **D4 Build integrity**: broken links and metadata errors are never checked.

## More Information

* Extends [ADR-0022](0022-astro-starlight-documentation-ui.md) and [ADR-0023](0023-static-adr-log-publication.md) from the ADR log to the story collection. Their decisions on Astro, Starlight, the base path and publication from `main` are unchanged.
* The story conventions are in [`docs/stories/README.md`](../stories/README.md).
