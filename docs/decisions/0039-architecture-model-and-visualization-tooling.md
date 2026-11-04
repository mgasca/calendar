---
status: proposed
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

Chosen option: to be decided in review. This draft is a neutral comparison: the ratings below favour "FINOS CALM" on D1, D2 and D3, with LikeC4 as the nearest alternative and hand-written Mermaid as the cheapest. The ADR validator requires one column to be marked as chosen, so the column the ratings favour carries the mark; the reviewer sets the real choice, rewrites this paragraph and the status, and the implementation PR follows.

| Driver | **FINOS CALM (chosen)** | C4 with the Structurizr DSL | Hand-written Mermaid in Markdown | LikeC4 | PlantUML or D2 diagrams as code |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Validatable model | ★★★ | ★★☆ | ☆☆☆ | ★★☆ | ☆☆☆ |
| D2 Traceability | ★★★ | ★★☆ | ★☆☆ | ★☆☆ | ☆☆☆ |
| D3 Toolchain fit | ★★★ | ☆☆☆ | ★★★ | ★★★ | ★☆☆ |
| D4 Starlight rendering | ★★☆ | ★★☆ | ★★★ | ★★☆ | ★★☆ |

### Implementation sketch, whichever option is chosen

* The model lives in `docs/architecture/` as reviewable text. Diagrams are generated during the docs build and never committed as images.
* A Node-based tool is a `devDependency` of `frontend/apps/docs`, so pnpm pins it in the lockfile and Dependabot updates it ([ADR-0012](0012-ci-and-dependency-updates.md)). A tool shipped as a separate binary gets a pin in `tools/` and a `just doctor` check.
* The docs app's own TypeScript (a content loader next to the ADR and story loaders in `frontend/apps/docs/src/lib/`) turns the tool's output into Starlight pages, with a text alternative for every diagram. Any glue outside the docs app is a .NET file-based app ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)), not a shell or Node script.
* Validation runs in `just lint` (and so in `just check` and CI), and the docs build fails on an invalid model, a dangling reference or an unknown ADR number.
* Mermaid in Starlight needs an integration (at the time of writing `astro-mermaid`, which renders in the browser, or `rehype-mermaid`, which renders at build time through a headless browser). Every option except LikeC4 relies on it for diagrams.

### Consequences

* Good, because the architecture becomes a reviewed, versioned artefact next to the ADRs and the stories, with diagrams that cannot drift from it.
* Good, because a model with controls and flows makes the non-functional requirements already recorded in ADRs and story cards visible in one place.
* Bad, because a model is more verbose than a diagram: a JSON or DSL file of several hundred lines must be kept in step with the code and the decision log by hand.
* Bad, because the docs build gains a dependency (and, for diagram rendering, possibly a headless browser) that the frontend checks must keep working.
* Neutral, because the choice is reversible: the model is text, and the other tools can import or be regenerated from it if the ecosystem moves.

### Confirmation

* `just lint` runs the chosen tool's validation; CI fails on an invalid model. A docs-site test proves that a deliberately broken fixture fails.
* The docs-site tests check that every ADR and story the model links exists, and the docs build checks the generated pages' links at the root path and at a project subpath.
* `just doctor` verifies a separately installed binary's version; a workspace dependency is verified by `pnpm install --frozen-lockfile`.
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
* A draft CALM model of this system (nodes, relationships, controls, seven flows, every ADR linked) exists on a local branch and was validated with `calm validate --strict`. It is the candidate input for story [0012](../stories/0012-architecture-visualization-on-the-documentation-site.md) if CALM is chosen, and a source of element names for the other options otherwise.
* Open questions for the reviewer:
  1. Which option is chosen? The ratings favour CALM; the cheapest path is hand-written Mermaid; LikeC4 is the nearest model-based alternative within the Node toolchain.
  2. Should D3 count the headless-browser requirement of build-time Mermaid rendering against every option that uses Mermaid, or is browser-side rendering (`astro-mermaid`) acceptable for the docs site?
  3. If CALM is chosen, is `calm validate` in `just lint` enough, or should the docs-site tests also validate the model with the schema directly, so that a CLI upgrade cannot change what passes?
* Revisit when the chosen tool stops releasing, when the docs site moves off Starlight ([ADR-0022](0022-astro-starlight-documentation-ui.md)), or when a second consumer of the model appears (for example a pattern library or a hub). The trigger is recorded here only.
