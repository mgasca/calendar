---
status: implemented
date: 2026-11-02
issue: https://github.com/mgasca/calendar/issues/178
pr:
  - https://github.com/mgasca/calendar/pull/179
  - https://github.com/mgasca/calendar/pull/180
adrs: ["0000", "0010", "0017", "0022", "0023", "0025", "0028", "0039"]
---

# 0012 Architecture visualization on the documentation site

## Story

> As a contributor, whether a person or another agent, I need an **Architecture** section on the documentation site that shows the system's parts, how they connect, the business flows that cross them and the non-functional controls they carry, each linked to the ADRs behind it, so that I can understand the system from one place and trust that the pictures match the code and the decisions.

Tracked in issue #178. Card and ADR PR: [#179](https://github.com/mgasca/calendar/pull/179); implementation PR: [#180](https://github.com/mgasca/calendar/pull/180).

## Background

The documentation site ([ADR-0022](../decisions/0022-astro-starlight-documentation-ui.md), [ADR-0023](../decisions/0023-static-adr-log-publication.md)) publishes the ADR log and, since [ADR-0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md), the story cards. Pull requests from this repository get a preview of the site ([ADR-0025](../decisions/0025-github-pages-pr-previews.md)). Nothing on the site showed the system as a whole: which components exist, how the web app, the API, the database, the Azure resources and CI relate, or where the 39 decisions apply. `AGENTS.md` describes the architecture in prose, and readers reconstructed the picture from the code and the ADRs every time.

The system is small enough to draw completely (a web app and an API in one container, a PostgreSQL database, a migrator, Google Identity, the Azure resources of one environment, GitHub Actions and the docs site), and its non-functional requirements are already written down: the session-cookie rules in [ADR-0027](../decisions/0027-google-oidc-bff-session.md), the least-privilege database roles in [ADR-0014](../decisions/0014-postgresql-database-engine.md) and [ADR-0031](../decisions/0031-azure-postgresql-flexible-server.md), the client-defined day in [ADR-0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md), the single read snapshot in [ADR-0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md), the limits and concurrency rules in the story cards, and the performance rules in `AGENTS.md`. A model that carries those requirements next to the components makes them visible instead of scattered.

A first machine-readable model of the whole system was drafted in FINOS CALM (nodes, relationships, controls for the non-functional requirements, seven business flows and every ADR linked) while this story was being written. It was a candidate input, not a decision: the tooling was chosen by [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md), drafted as a neutral comparison in PR 0 and accepted there when the maintainer chose CALM.

### Agreed scope

* **A model file under `docs/` is the source of truth.** Every diagram on the site is derived from it at build time. Nothing is drawn by hand and left to drift from the code or the decisions.
* **An Architecture section on the documentation site,** built from the model and published with the ADRs and the stories, including the pull-request previews. It holds:
  * a system-context view: the people, the calendar system, Google Identity, GitHub and Azure;
  * a container and deployment view: web app, API, database, migrator, the single container image, the Container Apps environment, the Key Vaults, the registry, monitoring and the docs site;
  * sequence diagrams of a few business flows: Google sign-in, viewing today, adding an event, ticking a task off, overdue triage, applying database migrations and publishing the decision log;
  * the non-functional controls (authentication, least-privilege data access, time correctness, read consistency, concurrency, request limits, observability, secrets, durability, query and client performance, accessibility) shown on the elements they apply to;
  * a link from every element to the ADRs it depends on, using the stable `adr/NNNN/` routes, and from each flow to its story card.
* **Validation is a gate.** The model is validated in `just check` and in CI, and the docs build fails on an invalid model (a schema error, a dangling reference, an ADR number that does not exist). The tool is pinned like the rest of the toolchain ([ADR-0010](../decisions/0010-toolchain-version-pins.md)); if it is a separate binary, `just doctor` checks it.
* **An ADR chooses the tooling.** [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md) weighs FINOS CALM, C4 with the Structurizr DSL, hand-written Mermaid in Markdown, LikeC4 and PlantUML or D2 against four drivers: a validatable model rather than pictures, traceability to ADRs and non-functional requirements, fit with the pinned toolchain, and rendering inside the Starlight site. It was drafted as a neutral comparison and accepted in PR 0 when the maintainer chose FINOS CALM.

### Not in this story

* **Generating the model from the code** (reverse engineering). The model is written by hand and reviewed like an ADR.
* **Diagrams of cost, capacity or runtime telemetry.** The section describes structure, flows and requirements, not operations.
* **Changing the ADR or story-card formats,** or how they are published. The Architecture section is added next to them.
* **A pattern library or reuse of the model outside this repository.** If the chosen tool supports patterns or a shared hub, that is a later story.
* **Keeping the model and the ADR index in step automatically.** The model lists the ADRs it links; a test that every linked ADR exists is in scope, a tool that updates the model when an ADR changes status is not.

### Dependencies

* [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md) was `accepted` in PR 0 before the model and the rendering were merged (PR 1).

### Acceptance criteria

1. **Given** the published documentation site, **when** I open the **Architecture** section, **then** I see a system-context view, a container and deployment view, sequence diagrams of the business flows listed in the scope, and the controls on the elements they apply to.
   [Pages rendered from the model](../../frontend/apps/docs/src/lib/architecture.test.ts) (`renders an overview, the container view, …`, `collapses the context diagram …`, `nests the container diagram …`, `draws a flow as a sequence diagram …`) and [every page built with a Mermaid block and its table](../../frontend/apps/docs/tests/build.test.ts) (`published architecture`). The diagrams were not rendered in a browser by the implementing agent (no browser was available); the PR preview is where that was checked.
2. **Given** any element or flow in the Architecture section, **when** I look for the decisions behind it, **then** it links to the ADRs it depends on at their `adr/NNNN/` routes, and a flow links to its story card.
   [Built pages carry the ADR and story hrefs](../../frontend/apps/docs/tests/build.test.ts) (`published architecture`); [component and flow bodies link decisions and stories](../../frontend/apps/docs/src/lib/architecture.test.ts) (`gives a component its interfaces, relationships, controls and decisions`, `draws a flow …`).
3. **Given** a pull request from this repository that changes the model, **when** CI runs, **then** the model is validated and the pull-request preview shows the regenerated diagrams.
   The Frontend job runs `pnpm --filter @calendar/docs validate:architecture` before the tests and build (`.github/workflows/ci.yml`), and the existing preview publication covers the generated pages. Checked on PR 1's **ADR preview**; no automated test exercises the preview.
4. **Given** a model with a schema error, a dangling reference or an ADR number that does not exist, **when** `just check` runs, **then** it fails and names the problem.
   [`calm validate` fails on a broken fixture](../../frontend/apps/docs/src/lib/architecture.test.ts) (`calm validate gate`) and [the loader rejects every dangling reference](../../frontend/apps/docs/src/lib/architecture.test.ts) (`rejects …`, 22 cases). `just lint` runs the first through `just architecture-check`; the docs tests and build run the second.
5. **Given** the chosen tool, **when** `just doctor` runs on a machine where the pinned version is missing or different, **then** it says so, unless the tool is a workspace dependency installed by `pnpm install`.
   `@finos/calm-cli` is a `devDependency` of `frontend/apps/docs`, pinned by `frontend/pnpm-lock.yaml` and installed by `pnpm install --frozen-lockfile`, so `just doctor` has nothing to check. No test.
6. **Given** the Architecture section, **when** it is read on a phone or with a screen reader, **then** every diagram has a text alternative (a table or list of the same elements and relationships), and the pages pass the site's existing accessibility lint.
   [Every built page with a diagram also has a table](../../frontend/apps/docs/tests/build.test.ts) (`published architecture`). The docs app has no accessibility lint (jsx-a11y applies to `apps/web` only), so that part of the criterion is not checked; the pages are plain Starlight Markdown.
7. **Given** [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md), **when** the maintainer approves the decision, **then** it is `accepted` in that same PR before it merges, and the implementation PR references it.
   Met on [#179](https://github.com/mgasca/calendar/pull/179): the maintainer chose FINOS CALM and the status changed to `accepted` in the commit "ADR-0039 accepted" before the merge. PR 1 references the ADR. No automated test.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the model validation.
   CI runs every part of `just check` on PR 1. Locally the implementing agent ran the frontend gates (`format:check`, `lint`, `typecheck`, `test`), `validate:architecture`, `build-docs` and `just --fmt --check`; `just adr-check` could not run on that machine (its SDK rejects the `#:include` directive), so the Tooling job is the check for it.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0000](../decisions/0000-use-markdown-architectural-decision-records.md) | MADR ADRs in `docs/decisions`, validated by `just adr-check` | The model links ADRs by number, so it depends on the numbering and the index staying valid. |
| [0010](../decisions/0010-toolchain-version-pins.md) | Pin toolchain versions | The CLI is pinned through the pnpm lockfile like the other frontend tools. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling scripts are .NET file-based apps | No new script was needed: the rendering is TypeScript inside the docs app and the validation is a pnpm script. |
| [0022](../decisions/0022-astro-starlight-documentation-ui.md) | Astro and Starlight for the documentation UI | The Architecture section is rendered by the Starlight site, not by a second site. |
| [0023](../decisions/0023-static-adr-log-publication.md) | Static site built from the canonical Markdown, published from `main` | The model lives in the repository and the site is built from it; the `adr/NNNN/` routes are the link targets. |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Pull-request previews of the site | A model change is reviewed on its preview. |
| [0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md) | Stories published with the ADRs | Flows link to story cards at `stories/NNNN/`. |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | FINOS CALM for the architecture model and its visualization | Chooses the tool this story implements: a CALM 1.3 model validated by `calm validate --strict` in `just lint`, rendered by a loader in the docs app with browser-side Mermaid. |

[ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md) is the new ADR this story needed. It was drafted with the `adr-draft` skill in the same PR as this card and accepted there.

### Other decisions (not ADR-worthy)

* **The model lives in `docs/architecture/`,** next to `docs/decisions/` and `docs/stories/`, because it is documentation that reviewers read and the site builds from, not product code.
* **Diagrams are generated at build time, never committed as images.** The model is reviewable text; a committed image would be a second source of truth. Mermaid renders in the browser (`astro-mermaid`), so the build needs no headless browser and previews and production render the same source.
* **Every diagram has a text alternative.** The same generation step emits a table of the diagram's elements and relationships, so the section is usable without the picture.
* **The Architecture section lists the ADRs it links in one place** (the Decisions table on the overview), so a reader can see which decisions the model covers and which elements depend on each.
* **Views are declared in the model's metadata** (`metadata.views.context` and `.containers`, each a list of node ids), because CALM has no view concept and the choice of what a diagram shows is a documentation decision, kept with the model rather than in code.
* **Colour encodes ownership, not node type.** Each node is a person, built in this repository, hosting or tooling we configure (Azure, GitHub), or an external service we only use (Google). Actors and the members of a composition get it by derivation; everything else declares `metadata.ownership`, and the docs build fails on a node with neither. A one-line legend with swatches sits under each diagram and the element tables carry the same label, so the colour is never the only carrier. The flow diagrams got the same treatment in story [0016](0016-colour-the-architecture-flow-diagrams-by-ownership.md).
* **Component pages are hidden from the sidebar.** Twenty-three entries would swamp the navigation; the Components index lists them and search finds them.
* **The model's ADR list must match the decision log exactly** (file, title, status, URL), checked by the docs build. The cost is one edit to the model when an ADR changes status; the benefit is that the Decisions table on the site can never lie.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| The model (CALM 1.3) | `docs/architecture/calendar.architecture.json` |
| Control requirement schemas and the URL mapping that lets validation run offline | `docs/architecture/controls/*.requirement.json`, `docs/architecture/url-mapping.json` |
| Parsing, reference checks and page rendering | `frontend/apps/docs/src/lib/architecture.ts` (`parseArchitecture`, `checkArchitecture`, `architecturePages`) |
| Loading into the site, link routes and the watcher | `frontend/apps/docs/src/lib/docs-loader.ts` (`readArchitecture`, `readDocuments`, `documentRoutes`) |
| Mermaid integration and the sidebar group | `frontend/apps/docs/astro.config.ts` (`astro-mermaid` before Starlight; `architectureSidebar`) |
| Schema validation | `frontend/apps/docs/package.json` (`validate:architecture`), `justfile` (`architecture-check`, part of `lint`), `.github/workflows/ci.yml` (Frontend job) |

The pages are: `architecture/` (overview with the system-context diagram, the views, the flows and the Decisions table), `architecture/containers/`, `architecture/components/` plus one page per node, `architecture/controls/` and one page per flow under `architecture/flows/`. Page bodies are Markdown with Mermaid code blocks; links to ADRs, stories and other architecture pages are written as repository-relative paths and rewritten to site routes by the existing `remarkDocLinks` plugin, so the same link checker applies.

### API

No changes.

### Testing

* [`architecture.test.ts`](../../frontend/apps/docs/src/lib/architecture.test.ts): parsing of every element kind; 22 rejected mutations (dangling nodes, interfaces, relationships and views, out-of-order steps, ADR file/title/status/URL drift, unknown stories, unmapped requirements); diagram text helpers; the rendered pages; and the `calm validate` gate on a broken fixture (`src/lib/fixtures/invalid.architecture.json`, 30 s timeout because the CLI takes seconds to start).
* [`corpus.test.ts`](../../frontend/apps/docs/src/lib/corpus.test.ts) loads the real model with the real ADRs and stories through `readDocuments`, so any drift between them fails the unit tests before the build.
* [`build.test.ts`](../../frontend/apps/docs/tests/build.test.ts) (`published architecture`): every page is built, the sidebar lists the section and the flows but not the component pages, every page with a diagram has a `<pre class="mermaid">` and a table, and component and flow pages carry the ADR and story hrefs. The existing link test covers every generated link at the root path and at a project subpath.
* CI: `validate:architecture` in the Frontend job, the unit tests, the build and the post-build verification.

### Lessons learned, known issues and follow-ups

* **The reference check earned its keep immediately:** it found two ADR titles in the model that had drifted from the decision log (0017 and 0019) before the first build.
* **`astro-mermaid` and a custom `unified()` processor coexist:** the integration recreates the processor with its own plugins added, so `remarkDocLinks` kept working. Place it before Starlight in `integrations`.
* **The Mermaid client bundle is large:** Vite warns about a 660 kB chunk; the heavy renderers (Cytoscape, KaTeX) are split into separate lazy chunks that flowcharts and sequence diagrams do not load. Measured on the build output, not profiled in a browser.
* **Measured:** the docs build went from 56 to 89 pages (33 architecture pages) and takes about 25 s on the implementing agent's machine; the docs unit tests take under 5 s including the CLI test.
* **`erasableSyntaxOnly`** is on in the frontend TypeScript config, so classes cannot use constructor parameter properties; assign fields explicitly.
* **Not verified by the implementing agent:** diagram rendering in a browser (no browser was available), the preview workflow on this PR before it ran, and `just adr-check` locally (SDK mismatch; CI runs it).
* **Follow-ups:** a story for keeping the model current could add a CI check that every node named in `AGENTS.md`'s architecture section exists in the model; the model's `metadata.adrs` must be edited by hand when an ADR changes status (deliberately, see the decision above).

## User guide

### Reading the architecture

Open the documentation site and choose **Architecture** in the sidebar. The **Overview** shows who uses the calendar and which outside services it depends on, with a table of the same elements beneath the diagram, and ends with a table of every decision (ADR) and the parts that depend on it. Choose **Containers and deployment** to see the parts that run (the web app and API in their container, the database, the migrator, the Azure resources and the documentation site) and how they connect. Choose **Components** for the list of every part; each part's page gives its interfaces, its relationships, the **controls** it must satisfy, such as the sign-in rules or the limits on a request, and links to the decisions and stories behind it. **Controls** lists every non-functional requirement and where it applies. Under **Flows**, choose an activity such as **Google sign-in** or **Triage all overdue tasks** to follow it step by step across the parts, as a sequence diagram with a numbered table of the same steps. Every diagram has a table beneath it with the same information, so the pages can be read without the pictures.

To change the architecture, edit `docs/architecture/calendar.architecture.json` (the **Edit page** link on every architecture page opens it). Run `just architecture-check` to validate it against the CALM schema and `just build-docs` to rebuild the pages; both run in `just check`.
