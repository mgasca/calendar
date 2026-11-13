---
status: proposed
date: 2026-11-13
decision-makers: mgasca, Claude (AI assistant)
---

# Build narrative decks with Slidev as a frontend workspace app, published with the docs site

## Context and Problem Statement

Architecture narratives are presented as well as read: the maintainer walks a review board, a team or a kata panel through the three acts. Epic [#705](https://github.com/mgasca/calendar/issues/705) asks for a slides export from the narratives that [ADR-0059](0059-publish-architecture-narratives-stitched-from-part-files.md) publishes, using well-regarded Markdown-to-slides tooling. Repository tooling is TypeScript on Deno ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)), while the frontend apps are a pnpm workspace on Node. Which tool builds the decks, where does it live, and are the decks published?

## Decision Drivers

* **D1 Markdown source**: a deck should be Markdown drafted from the narrative's parts, reviewable in a pull request like the narrative itself.
* **D2 Diagrams**: the narrative's Mermaid diagrams must render in the deck without redrawing them.
* **D3 Presentation quality**: layouts, speaker notes and code or diagram slides good enough to present to a review board.
* **D4 Toolchain rules**: Node is allowed for frontend apps in the pnpm workspace, not for repository tooling ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)); dependencies are exact or locked and installed frozen ([ADR-0010](0010-toolchain-version-pins.md)).
* **D5 Reproducible and published**: the deck builds the same way locally and in CI, and the Pages build can publish it next to its narrative.
* **D6 Footprint**: the dependency weight and maintenance added to the frontend workspace.

## Considered Options

* Slidev as a pnpm workspace app, `frontend/apps/slides`
* Marp CLI as a pnpm workspace app
* Slidev run on demand with `npx`, nothing committed
* A claude.ai Slides artifact, outside the repository

## Decision Outcome

Chosen option: "Slidev as a pnpm workspace app, `frontend/apps/slides`", because Slidev renders Mermaid natively and offers the strongest presentation features from a Markdown source (D1, D2, D3), and as a workspace app it is locked by `pnpm-lock.yaml`, builds in CI and is published by the existing Pages workflow (D4, D5). Its weight in the workspace is the accepted cost (D6).

| Driver | **Slidev workspace app (chosen)** | Marp CLI workspace app | Slidev via npx | Slides artifact |
| --- | :---: | :---: | :---: | :---: |
| D1 Markdown source | ★★★ | ★★★ | ★★★ | ☆☆☆ |
| D2 Diagrams | ★★★ | ★☆☆ | ★★★ | ★★☆ |
| D3 Presentation quality | ★★★ | ★★☆ | ★★★ | ★★★ |
| D4 Toolchain rules | ★★★ | ★★★ | ☆☆☆ | ★★☆ |
| D5 Reproducible and published | ★★★ | ★★★ | ★☆☆ | ★☆☆ |
| D6 Footprint | ★☆☆ | ★★☆ | ★★★ | ★★★ |

### Conventions

* **App:** `frontend/apps/slides`, with `@slidev/cli` and its theme at exact versions in its `package.json`, locked in `frontend/pnpm-lock.yaml`. PDF export needs `playwright-chromium`, a peer dependency; it is added only if PDF export is delivered.
* **Source:** `docs/narratives/<system>/slides.md`, drafted by the skill's slides mode from the parts (one section per act, diagrams reused from the `.mmd` files). It is a part file, so the site does not publish it as a page.
* **Build:** a `just docs` recipe builds one deck locally; the Pages build builds every deck with a base path and publishes it under `/slides/<system>/`. The narrative's front matter links its deck.
* **Theme:** the deck follows the site's light and dark themes ([ADR-0047](0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md)) as far as Slidev's theming allows.

### Consequences

* Good, because a narrative and its deck come from the same parts and are reviewed together.
* Good, because published decks give a stable link to present from.
* Bad, because Slidev brings Vue, its own Vite and many transitive packages into the workspace, with more Dependabot and audit traffic, and pnpm overrides may be needed as they were for Mermaid's KaTeX.
* Bad, because the Pages build gets slower by one Slidev build per deck.
* Neutral, because a deck is drafted, not generated: it can lag behind later narrative edits, and the stitcher's drift check does not cover it.

### Confirmation

* CI installs the workspace frozen and builds every deck; a deck that fails to build fails the docs-site job.
* The site build fails if a narrative links a deck that was not built.

## Pros and Cons of the Options

### Slidev as a pnpm workspace app, frontend/apps/slides

* Good, because **D1 Markdown source**: Slidev decks are Markdown with front matter per slide.
* Good, because **D2 Diagrams**: Mermaid code blocks render natively.
* Good, because **D3 Presentation quality**: layouts, presenter mode, speaker notes and Vue components when needed.
* Good, because **D4 Toolchain rules**: a Node app inside the frontend workspace, where Node is allowed, locked and installed frozen.
* Good, because **D5 Reproducible and published**: `slidev build` produces a static site that the Pages workflow can publish.
* Bad, because **D6 Footprint**: the heaviest option in dependencies and build time.

### Marp CLI as a pnpm workspace app

* Good, because **D1 Markdown source**: plain Markdown with slide separators, closest to the narrative text.
* Bad, because **D2 Diagrams**: Mermaid is not rendered by Marp out of the box; diagrams would need pre-rendering to SVG or a plugin.
* Neutral, because **D3 Presentation quality**: clean themes and PDF/PPTX export, but fewer layouts and no presenter tooling beyond notes.
* Good, because **D4 Toolchain rules**: same workspace placement as the chosen option.
* Good, because **D5 Reproducible and published**: locked and builds static HTML.
* Neutral, because **D6 Footprint**: lighter than Slidev, but still a new app and dependency tree.

### Slidev run on demand with npx, nothing committed

* Good, because **D1 Markdown source**: the same Slidev Markdown.
* Good, because **D2 Diagrams**: the same Mermaid support.
* Good, because **D3 Presentation quality**: the same features.
* Bad, because **D4 Toolchain rules**: an unlocked, network-fetched Node tool run outside the workspace, the kind of tooling the repository rules out.
* Bad, because **D5 Reproducible and published**: versions float unless pinned by hand, and CI publication would need the same unlocked call.
* Good, because **D6 Footprint**: nothing added to the workspace.

### A claude.ai Slides artifact, outside the repository

* Bad, because **D1 Markdown source**: the deck is data in a hosted artifact, not reviewable Markdown in a pull request.
* Neutral, because **D2 Diagrams**: diagrams must be supplied in the artifact's own format.
* Good, because **D3 Presentation quality**: polished output with PPTX and PDF download.
* Neutral, because **D4 Toolchain rules**: no repository tooling, but the deck depends on a service outside the repository.
* Bad, because **D5 Reproducible and published**: not built by CI and not part of the docs site.
* Good, because **D6 Footprint**: nothing added to the workspace.

## More Information

* Versions at the time of writing (2026-11-13, `npm view`): `@slidev/cli` 53.1.0, with peer dependencies `playwright-chromium ^1.10.0` and `vite-plugin-pwa ^1.0.0`. The delivery slice pins the version it tests.
* Related: [ADR-0059](0059-publish-architecture-narratives-stitched-from-part-files.md) (narratives and parts), [ADR-0025](0025-github-pages-pr-previews.md) (Pages publication and previews), [ADR-0010](0010-toolchain-version-pins.md) (pins).
* Story: [0063](../stories/0063-build-architecture-narratives-with-an-expert-panel.md).
* Open questions for the reviewer: whether PDF export (Playwright Chromium) is in scope for the first slice, or local HTML and the published deck are enough.
* Revisit if Slidev's dependency tree conflicts with the pinned TypeScript or Vite versions of the other apps, or if a deck format beyond the browser is needed.
