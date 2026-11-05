# Architecture model (FINOS CALM)

This folder describes the Calendar system in the [FINOS Common Architecture Language Model](https://calm.finos.org/) (CALM 1.3), the tooling chosen in [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md) for story [0012](../stories/0012-architecture-visualization-on-the-documentation-site.md). The documentation site renders it as the **Architecture** section.

| File | What it is |
| --- | --- |
| [`calendar.architecture.json`](calendar.architecture.json) | The architecture: nodes, interfaces, relationships, controls, business flows, the views the site draws and the list of every ADR and story. |
| [`controls/*.requirement.json`](controls/) | JSON Schema 2020-12 documents that define what each control's inline `config` must contain. |
| [`url-mapping.json`](url-mapping.json) | Maps the requirement URLs to the local files, so validation works offline and before a branch is merged. |

## How the model is organised

- **Nodes** are the parts of the system: the web app, the API, the generated client and its contract, the database, the migrator, the infra tool, CI, the Azure resources, the decision log and the documentation site. Actors are the calendar user and the maintainer; Google Identity is the external identity provider.
- **Relationships** connect nodes through their interfaces (`connects`), group them (`composed-of`) and place them in their runtime containers (`deployed-in`: the single container image, the Container Apps environment, the per-environment resource group, GitHub Pages).
- **Controls** record the non-functional requirements found in the code, the story cards and the ADRs. Architecture-level controls cover the contract, the quality gates, supply-chain integrity and environment separation; node and relationship controls cover authentication, time correctness, read consistency, concurrency, request limits, observability, least-privilege database access, transport security, secrets, data durability, query performance, client performance and accessibility. Each control's `config` conforms to its `requirement-url` schema in `controls/`.
- **Flows** model business processes over the relationships: Google sign-in, viewing today's agenda, adding an event, ticking a task off, overdue triage, applying database migrations and publishing the decision log.
- **Views** (`metadata.views`) name the nodes the context and container diagrams show. CALM has no view concept, so the choice lives here, with the model.
- **Ownership** (`metadata.ownership` on a node: `person`, `ours`, `platform` or `external`) colours every diagram and fills the legend under it: the boxes of the context and container flowcharts, and the participant lanes of the flow sequence diagrams (story [0016](../stories/0016-colour-the-architecture-flow-diagrams-by-ownership.md)). Actors are people and composition members are ours without declaring it; every other node must declare it.

## ADR links

Every ADR in `docs/decisions` is listed once in `metadata.adrs` with its id, title, status (including `superseded-by` / `supersedes`), repository path and published URL (`https://mgasca.github.io/calendar/adr/NNNN/`, the stable route from ADR-0023). Nodes, relationships, flows and controls reference ADRs by id in their `metadata.adrs` (and by URL inside control configs), so a reader can go from any element to the decisions behind it.

The documentation build checks that every entry matches the decision log (file, title and status) and that every element references a listed ADR or story. When an ADR is added, superseded or re-statused, update its entry here in the same PR.

## Validate and render

`just docs architecture` validates the model against the CALM schema with the pinned `@finos/calm-cli` (a dev dependency of `frontend/apps/docs`); it is part of `just lint`, so `just check` and CI run it. The docs-site tests (`corepack pnpm --dir frontend --filter @calendar/docs test`) check the references, and `just docs build` renders the pages and checks their links.

After a change to how the diagrams render (the Mermaid configuration, ELK layout or diagram styles), open a page with a rendered diagram in `just docs dev` and switch the site theme light → dark → light before opening the PR: the theme switch re-renders every diagram (`autoTheme` in `frontend/apps/docs/astro.config.ts`), and a merged diagram change once failed only then.

To run the CLI directly from this folder:

```bash
../../frontend/apps/docs/node_modules/.bin/calm validate -a calendar.architecture.json -u url-mapping.json --strict -f pretty
```

The output must end with `Errors: no (0)` and `Warnings: no (0)`.
