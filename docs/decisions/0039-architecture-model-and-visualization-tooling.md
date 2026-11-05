---
status: accepted
date: 2026-11-02
decision-makers: mgasca, Claude (AI assistant)
---

# Architecture model and visualization tooling for the documentation site

## Context and Problem Statement

The documentation site publishes the ADR log and the story cards ([ADR-0022](0022-astro-starlight-documentation-ui.md), [ADR-0023](0023-static-adr-log-publication.md), [ADR-0028](0028-publish-user-stories-on-the-documentation-site.md)) but has no view of the system as a whole. Story [0012](../stories/0012-architecture-visualization-on-the-documentation-site.md) asks for an Architecture section generated from a model that is validated in CI, shows the components, the business flows and the non-functional controls, and links every element to its ADRs. Which tool should hold that model and produce the diagrams?

## Decision Drivers

* **D1 Validatable model**: the architecture is a machine-checkable model that CI validates and the diagrams are derived from, so that a picture cannot drift from its source or from the code it describes.
* **D2 Traceability**: elements can link to ADRs and carry non-functional requirements (controls) and business flows, so that decisions and requirements are visible in the diagrams rather than only in prose.
* **D3 Toolchain fit**: the tool runs with the Node/pnpm or .NET toolchains the repository already pins ([ADR-0010](0010-toolchain-version-pins.md), [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)), its version is pinned and checkable by `just doctor`, and it needs no Java or Docker just to render.
* **D4 Starlight rendering**: the tool produces Markdown, Mermaid or SVG that the existing Astro Starlight build publishes with the ADRs and stories, including the pull-request previews ([ADR-0025](0025-github-pages-pr-previews.md)), rather than a second site.

## Considered Options

* FINOS CALM
* C4 with the Structurizr DSL
* Hand-written Mermaid in Markdown
* LikeC4
* PlantUML or D2 diagrams as code

## Decision Outcome

Chosen option: "FINOS CALM", because it is the only option that is a schema-validated model (D1) with first-class controls, flows and metadata that carry the non-functional requirements and the ADR links (D2), and it runs as an npm package inside the pinned Node toolchain (D3). It is not the easiest to render in Starlight (D4): LikeC4 and hand-written Mermaid need less glue, but neither gives a validated model with traceability. The maintainer chose it in review of the neutral draft (pull request [#179](https://github.com/mgasca/calendar/pull/179)).

| Driver | **FINOS CALM (chosen)** | C4 with the Structurizr DSL | Hand-written Mermaid in Markdown | LikeC4 | PlantUML or D2 diagrams as code |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Validatable model | ★★★ | ★★☆ | ☆☆☆ | ★★☆ | ☆☆☆ |
| D2 Traceability | ★★★ | ★★☆ | ★☆☆ | ★☆☆ | ☆☆☆ |
| D3 Toolchain fit | ★★★ | ☆☆☆ | ★★★ | ★★★ | ★☆☆ |
| D4 Starlight rendering | ★★☆ | ★★☆ | ★★★ | ★★☆ | ★★☆ |

### Implementation

* The model is `docs/architecture/calendar.architecture.json` (CALM 1.3), with the control requirement schemas in `docs/architecture/controls/` and a `url-mapping.json` that maps their canonical URLs to the local files, so validation works offline and before a branch merges. Diagrams are generated during the docs build and never committed as images.
* `@finos/calm-cli` is a `devDependency` of `frontend/apps/docs`, so pnpm pins it in the lockfile and Dependabot updates it ([ADR-0012](0012-ci-and-dependency-updates.md)). No separate binary, so no `just doctor` check.
* `just lint` runs `calm validate --architecture docs/architecture/calendar.architecture.json --url-to-local-file-mapping docs/architecture/url-mapping.json --strict` through a pnpm script of the docs app, so `just check` and CI fail on an invalid model.
* A content loader next to the ADR and story loaders in `frontend/apps/docs/src/lib/` reads the model and produces the Starlight pages: context and container views and flow sequence diagrams as Mermaid, controls as tables, and a table under every diagram as its text alternative. Its tests check that every ADR and story the model links exists and that every flow references existing relationships, independently of the CLI. Any glue outside the docs app is a .NET file-based app ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)), not a shell or Node script.
* Mermaid renders in the browser through `astro-mermaid`, which keeps the docs build free of a headless browser; build-time rendering with `rehype-mermaid` is the fallback if browser-side rendering proves unreliable.

### Consequences

* Good, because the architecture becomes a reviewed, versioned artefact next to the ADRs and the stories, with diagrams that cannot drift from it.
* Good, because a model with controls and flows makes the non-functional requirements already recorded in ADRs and story cards visible in one place.
* Bad, because a model is more verbose than a diagram: a JSON or DSL file of several hundred lines must be kept in step with the code and the decision log by hand.
* Bad, because the docs build gains a dependency (and, for diagram rendering, possibly a headless browser) that the frontend checks must keep working.
* Neutral, because the choice is reversible: the model is text, and the other tools can import or be regenerated from it if the ecosystem moves.

### Confirmation

* `just lint` runs `calm validate --strict`; CI fails on an invalid model. A docs-site test proves that a deliberately broken fixture fails.
* The docs-site tests check that every ADR and story the model links exists and that flows reference existing relationships, and the docs build checks the generated pages' links at the root path and at a project subpath.
* The CLI version is pinned by `pnpm install --frozen-lockfile`.
* Review checks that the model changes with the code: a PR that adds a component, an endpoint, an Azure resource or an ADR updates the model, and the PR preview shows it.

## Pros and Cons of the Options

### FINOS CALM

* Good, because **D1 Validatable model**: the architecture is JSON validated against the published CALM 1.3 schema by `calm validate`, with `--strict` turning warnings into failures.
* Good, because **D2 Traceability**: controls (requirement schema plus configuration), flows over named relationships, metadata on every element, and decorators and timeline moments with ADR links are first-class concepts, so non-functional requirements and decisions sit on the elements they govern.
* Good, because **D3 Toolchain fit**: `@finos/calm-cli` is an npm package (Apache-2.0) that needs Node 22.13 or later, which the pinned Node 24 satisfies; it can be a workspace `devDependency` with no Java, Docker or extra binary.
* Neutral, because **D4 Starlight rendering**: `calm docify` emits a Markdown site with Mermaid diagrams aimed at a generic static-site generator, so a `calm template` bundle or a small loader is needed to produce Starlight pages, and Mermaid still needs an integration.
* Bad, because **D1 Validatable model**: the model is verbose JSON (the draft of this system is about 900 lines) and the schema does not validate control configurations unless the requirement schemas are supplied and mapped.
* Bad, because **D3 Toolchain fit**: the CLI releases often (the npm version moved to 1.67.0 in October 2026) and the project is still young, so breaking changes between minor versions are a risk Dependabot will surface.

### C4 with the Structurizr DSL

* Good, because **D1 Validatable model**: the DSL is parsed into a model with views, so a dangling element or relationship fails the build.
* Neutral, because **D2 Traceability**: the DSL can attach ADRs with the `!adrs` directive and properties to elements, but it has no concept of controls, requirements or business flows beyond dynamic views.
* Bad, because **D3 Toolchain fit**: the tooling needs Java 21 or the `structurizr/structurizr` Docker image, neither of which the repository pins, and the standalone CLI repository was archived on 4 February 2026 with a notice to migrate to the consolidated tooling.
* Neutral, because **D4 Starlight rendering**: it exports Mermaid and PlantUML and a static site, so diagrams can be embedded, but the export runs outside the docs build and styles are not fully carried over.

### Hand-written Mermaid in Markdown

* Bad, because **D1 Validatable model**: there is no model, only pictures; nothing checks that a diagram names real components or that two diagrams agree.
* Bad, because **D2 Traceability**: links to ADRs and any mention of requirements are written by hand in prose next to each diagram, and nothing checks them beyond the existing link checker.
* Good, because **D3 Toolchain fit**: Mermaid and an Astro integration are npm packages in the existing workspace; nothing else is installed.
* Good, because **D4 Starlight rendering**: the diagrams are Markdown code blocks that Starlight renders through the integration, including in previews.

### LikeC4

* Good, because **D1 Validatable model**: a C4-style DSL with a language server; the model is checked when it is built, and relationships must reference declared elements.
* Bad, because **D2 Traceability**: elements carry descriptions, technology, links and metadata, but there is no concept of controls, requirement schemas or business flows beyond dynamic views, so non-functional requirements stay in prose.
* Good, because **D3 Toolchain fit**: it is an npm package (MIT) with a CLI, a Vite plugin, React and Web Components, so it fits the Node workspace with no extra runtime.
* Neutral, because **D4 Starlight rendering**: the Vite plugin and Web Components can embed interactive diagrams in an Astro page and `likec4 build` exports a static site, but there is no Astro integration documented at the time of writing and the interactive viewer adds client-side JavaScript to the docs.

### PlantUML or D2 diagrams as code

* Bad, because **D1 Validatable model**: both describe single diagrams, not a model; the same component drawn in two files is two unrelated boxes.
* Bad, because **D2 Traceability**: links and requirements are free text in each diagram.
* Bad, because **D3 Toolchain fit**: PlantUML needs a Java runtime, and D2 is a Go binary (an npm wrapper exists), so either adds a runtime the repository does not pin.
* Neutral, because **D4 Starlight rendering**: both render SVG that a page can embed, but the render step runs outside the docs build or needs a wrapper integration.

## More Information

* Versions and facts checked on 2026-11-02: `@finos/calm-cli` 1.67.0 on npm (Apache-2.0, `engines.node` `^22.13.0 || >=23.5.0`), matching the "CLI v1.67.0" release on GitHub; `likec4` 1.60.0 (MIT); `astro-mermaid` 2.2.0 (peer `mermaid` ^10–^12) and `rehype-mermaid` 3.0.0; `@terrastruct/d2` 0.1.33; the Structurizr CLI repository archived on 4 February 2026, with the current binaries (2026.09.19) requiring Java 21 or Docker. Whether `likec4 build` fails on model errors, and the licences of PlantUML and D2, were not verified on the vendors' pages for this draft.
* FINOS CALM core concepts: <https://calm.finos.org/core-concepts/>; CLI: <https://calm.finos.org/working-with-calm/cli>. Structurizr DSL: <https://docs.structurizr.com/dsl/language>. LikeC4: <https://likec4.dev/>.
* A draft CALM model of this system (nodes, relationships, controls, seven flows, every ADR linked) was validated with `calm validate --strict` while this ADR was drafted. It is the starting point of story [0012](../stories/0012-architecture-visualization-on-the-documentation-site.md)'s implementation.
* Questions settled in review of pull request [#179](https://github.com/mgasca/calendar/pull/179): the maintainer chose FINOS CALM. The draft had asked whether D3 should count a headless browser against Mermaid-based options (answer taken: browser-side rendering is acceptable, so the ratings stand) and whether `calm validate` in `just lint` is enough (answer taken: yes, with the docs-site tests checking the references the CLI does not, so a CLI upgrade cannot silently change what passes).
* The acceptance was committed two minutes after #179 had merged, so it never reached `main`, and the ADR read `proposed` until 2026-11-05, when the maintainer confirmed it and the same text was applied. The decision itself dates from the review of #179.
* Note, 2026-11-05: the docs app also depends on `@mermaid-js/layout-elk` 0.2.3, Mermaid's ELK layout engine, which `astro-mermaid` registers by itself when the package resolves. Only the Overview opts into it, to keep its relationship labels on their own arrows ([story 0022](../stories/0022-make-the-architecture-diagrams-easier-to-read.md)). Rendering stays in the browser; nothing above changes.
* Note, 2026-11-05 (later): the docs app moved to Mermaid 12, which bundles ELK and makes it the default layout, so `@mermaid-js/layout-elk` was removed from it ([#258](https://github.com/mgasca/calendar/issues/258)). Its 0.2.3 build shipped a vendored KaTeX 0.16.47 (GHSA-238p-pmpm-9mq7) into the site bundle. `astro.config.ts` sets `layout: dagre` and `look: classic` so that only the Overview uses ELK, as before. Rendering stays in the browser; nothing above changes.
* Revisit when the chosen tool stops releasing, when the docs site moves off Starlight ([ADR-0022](0022-astro-starlight-documentation-ui.md)), or when a second consumer of the model appears (for example a pattern library or a hub). The trigger is recorded here only.
