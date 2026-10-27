---
status: proposed
date: 2026-10-26
decision-makers: mgasca, Codex (AI assistant)
---

# Astro and Starlight for the developer documentation UI

## Context and Problem Statement

The repository's architectural decisions need a browsable web UI whose ADR log provides navigation to the selected record. The product UI uses React, Vite and TypeScript ([ADR-0003](0003-react-vite-typescript-web-ui.md)), but documentation has different rendering and navigation requirements. The user has selected Astro with Starlight; why should documentation use this stack, and how does it fit the existing frontend workspace?

## Decision Drivers

* **D1 Documentation experience**: provide navigation, readable Markdown, search, heading links and responsive layouts without building a documentation system from scratch.
* **D2 Content-first delivery**: serve ADR pages as static HTML that readers can navigate directly and bookmark.
* **D3 Repository integration**: retain the existing Node, TypeScript and pnpm toolchain and per-stack layout.
* **D4 Independent deployment**: documentation must build and publish without the product API or database.
* **D5 Maintenance effort**: minimize custom UI infrastructure and unnecessary documentation features for the initial ADR log.

## Considered Options

* Astro with Starlight
* Docusaurus
* Custom React documentation UI using the product stack
* GitHub Markdown only

## Decision Outcome

Chosen option: "Astro with Starlight", because it supplies the documentation experience (D1) and static content delivery (D2), fits the existing frontend toolchain (D3), and keeps the documentation independent of product deployment (D4) with limited custom UI work (D5).

| Driver | **Astro with Starlight (chosen)** | Docusaurus | Custom React documentation UI using the product stack | GitHub Markdown only |
| --- | :---: | :---: | :---: | :---: |
| D1 Documentation experience | ★★★ | ★★★ | ★☆☆ | ★☆☆ |
| D2 Content-first delivery | ★★★ | ★★★ | ★☆☆ | ★★☆ |
| D3 Repository integration | ★★★ | ★★★ | ★★★ | ★★★ |
| D4 Independent deployment | ★★★ | ★★★ | ★★☆ | ★★★ |
| D5 Maintenance effort | ★★★ | ★★☆ | ★☆☆ | ★★★ |

### Integration

* Place the documentation application in `frontend/apps/docs`, within the pnpm workspace defined by [ADR-0001](0001-monorepo-layout.md) and [ADR-0005](0005-pnpm-workspace-for-frontend.md).
* Use Starlight's documentation layout: the ADR log is persistent navigation on larger screens and available through the navigation menu on small screens; the selected ADR renders in the content area.
* Preserve a separate URL for every ADR, active navigation state, accessible links, Markdown tables, code blocks and heading navigation.
* Keep the product React/Vite application and its decision unchanged. This record scopes Astro to developer documentation.
* Use the repository's frontend quality checks, including Astro-aware type checking and formatting. Keep dependencies in the existing lockfile.
* Record content sourcing and publication separately in [ADR-0019](0019-static-adr-log-publication.md).

### Consequences

* Good, because readers get a documentation UI without depending on the running application.
* Good, because existing Markdown remains the authoring format and Starlight supplies common documentation behavior.
* Bad, because contributors maintain an additional framework and its integration with frontend checks.
* Neutral, because Docusaurus's built-in documentation versioning is not required for the initial chronological ADR collection.

### Confirmation

The documentation build must render every indexed ADR, and checks must verify navigation, direct page URLs and readable record content. Frontend lint, format, type checks, tests and production build must include the docs application. Review confirms that documentation does not introduce a dependency on the product API.

## Pros and Cons of the Options

### Astro with Starlight

* Good, because **D1 Documentation experience**: Starlight supplies sidebar navigation, search and documentation layouts that can present the ADR log and selected record.
* Good, because **D2 Content-first delivery**: Astro generates static pages and adds browser JavaScript where features need it.
* Good, because **D3 Repository integration**: the application fits the existing TypeScript frontend workspace and lockfile.
* Good, because **D4 Independent deployment**: the static build needs no backend service.
* Good, because **D5 Maintenance effort**: the initial UI can use Starlight's standard components with limited adaptation.
* Bad, because **D5 Maintenance effort**: Astro-specific configuration and checks add another framework to maintain.

### Docusaurus

* Good, because **D1 Documentation experience**: it supplies a mature documentation layout, navigation and Markdown support.
* Good, because **D2 Content-first delivery**: it generates static HTML pages with React-powered client navigation.
* Good, because **D3 Repository integration**: its JavaScript ecosystem fits the existing Node and pnpm workflow.
* Good, because **D4 Independent deployment**: it can publish a static site separately from the product.
* Neutral, because **D5 Maintenance effort**: it is a viable alternative, but versioned documentation features add no benefit to the initial ADR log and do not justify departing from the user's Astro choice.

### Custom React documentation UI using the product stack

* Good, because **D3 Repository integration**: it reuses the existing application framework and familiar tooling.
* Bad, because **D1 Documentation experience**: documentation navigation, Markdown presentation and search require custom implementation or further libraries.
* Bad, because **D2 Content-first delivery**: the existing SPA architecture needs additional work to deliver complete static HTML for each record.
* Neutral, because **D4 Independent deployment**: a separate React application can deploy independently, but sharing the product application would couple the release processes.
* Bad, because **D5 Maintenance effort**: the team owns documentation behavior already provided by purpose-built frameworks.

### GitHub Markdown only

* Bad, because **D1 Documentation experience**: repository file browsing does not provide the requested persistent ADR navigation and selected-record layout.
* Neutral, because **D2 Content-first delivery**: GitHub renders Markdown with stable file links, but the project does not control the documentation pages.
* Good, because **D3 Repository integration**: the existing repository already hosts the content.
* Good, because **D4 Independent deployment**: no application deployment is required.
* Good, because **D5 Maintenance effort**: there is no documentation application to maintain.

## More Information

* Official references: [Starlight authoring content](https://starlight.astro.build/guides/authoring-content/), [Starlight sidebar navigation](https://starlight.astro.build/guides/sidebar/), [Astro GitHub Pages deployment](https://docs.astro.build/en/guides/deploy/github/), [Docusaurus versioning](https://docusaurus.io/docs/versioning/).
* This remains a proposed record for review. The user explicitly requested implementation alongside the draft.
