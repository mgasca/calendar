---
status: implemented
date: 2026-11-02
issue: https://github.com/mgasca/calendar/issues/187
pr:
  - https://github.com/mgasca/calendar/pull/188
adrs: ["0022", "0023", "0025", "0028", "0039"]
---

# 0016 Colour the architecture flow diagrams by ownership, with the legend

## Story

> As a contributor reading the **Architecture** section of the documentation site, I need the flow diagrams to use the same ownership colours and legend as the system-context and container diagrams, so that I can tell at a glance which parts of a flow are people, built in this repository, hosting we configure or external services, without re-learning the colour code on every page.

Tracked in issue #187. A follow-up to story [0012](0012-architecture-visualization-on-the-documentation-site.md), delivered in one PR with this card.

## Background

Story [0012](0012-architecture-visualization-on-the-documentation-site.md) added the Architecture section, rendered at build time from the FINOS CALM model in `docs/architecture/` ([ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md)). Its last PR coloured the **system-context** and **container** diagrams by ownership: a node is a person, built in this repository, hosting or tooling we configure (Azure, GitHub) or an external service we only use (Google). A one-line legend with swatches sits under each of those diagrams, and the element tables carry an **Ownership** column so that colour is never the only carrier.

The seven **flow** pages (Google sign-in, viewing today's agenda, adding an event, ticking a task off, overdue triage, applying database migrations and publishing the decision log) are sequence diagrams produced by the same renderer, but they got neither the colours nor the legend. The same participant, for example Google Identity, was grey and dashed on the context view and plain on every flow, so the visualizations were not standardised across the section. This story closes that gap.

### Agreed scope

* **Every flow diagram colours its participants by ownership,** with the same four colours as the context and container diagrams, resolved from the model the same way (`metadata.ownership`, or derived for actors and members of a composition).
* **The same legend line under every flow diagram,** listing only the ownerships present in that flow, with the same swatches and labels as the other diagrams.
* **A text alternative that carries the ownership:** each flow page lists its participants with their type, ownership and description, before the existing **Steps** table, so that the colour is never the only carrier.
* **Tests** for the generated diagram text, the legend and the participants table, and the existing build test keeps checking every flow page.
* **Documentation:** `docs/architecture/README.md` and this card say that every diagram, flows included, carries the ownership colours and the legend.

### Not in this story

* **Changing the ownership palette, the ownership values or how they are declared** in the model. The flows reuse what story 0012 defined.
* **Any change to the context or container diagrams.**
* **Rendering diagrams at build time or committing images.** [ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md) keeps browser-side Mermaid.
* **A dashed border for external services on the flows.** Mermaid sequence diagrams have no per-participant border style (see the decisions below); the legend swatch keeps the dash because the same legend serves every diagram.

### Acceptance criteria

1. **Given** any flow page in the Architecture section, **when** I look at its sequence diagram, **then** each participant is coloured by its ownership with the same colours as the context and container diagrams.
   [The participants are wrapped in boxes filled with the ownership colours](../../frontend/apps/docs/src/lib/architecture.test.ts) (`colours the participants of a flow by ownership in boxes, with the legend and a table`, `writes a hex colour in the rgba() form a sequence-diagram box accepts`). The rendered colours were checked by eye on screenshots of the built site in both themes (see the implementation notes); no automated test renders Mermaid.
2. **Given** any flow page, **when** I look under the diagram, **then** a legend lists the ownerships present in that flow with the same swatches and labels as the other diagrams, and nothing else.
   [Same test](../../frontend/apps/docs/src/lib/architecture.test.ts) (`colours the participants of a flow …`): the fixture flow has a person and two of our nodes, and the legend names those two ownerships and not the platform node that is outside the flow.
3. **Given** any flow page, **when** I read it without the picture, **then** a table names every participant with its type and ownership.
   [Same test](../../frontend/apps/docs/src/lib/architecture.test.ts) (`## Participants` table, in order of first appearance, before `## Steps`) and [every built page with a diagram has a table](../../frontend/apps/docs/tests/build.test.ts) (`published architecture`).
4. **Given** a model where a flow's participant has no resolvable ownership, **when** the docs build runs, **then** it fails and names the node.
   [`resolveOwnership` rejects a node without ownership](../../frontend/apps/docs/src/lib/architecture.test.ts) (`rejects … a node that declares no ownership and is neither an actor nor part of a composition`), unchanged by this story: the flow renderer uses the same resolution, so the rule reaches flows without a new check.
5. **Given** the change is complete, **when** `just check` runs, **then** it passes.
   CI runs every part of `just check` on the PR. Locally the implementing agent ran the docs tests, ESLint, `typecheck`, `format:check`, `validate:architecture` and `just docs build`; `just tools adr` could not run on that machine (its SDK rejects the `#:include` directive), so the Tooling job is the check for it.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0022](../decisions/0022-astro-starlight-documentation-ui.md) | Astro and Starlight for the documentation UI | The flow pages are Starlight Markdown; the legend is inline HTML the site already accepts. |
| [0023](../decisions/0023-static-adr-log-publication.md) | Static site built from the canonical Markdown, published from `main` | The diagrams are rebuilt from the model on every publication. |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Pull-request previews of the site | The coloured flows are reviewed on the PR preview. |
| [0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md) | Stories published with the ADRs | This card is published next to the flows it describes. |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | FINOS CALM for the architecture model, rendered with browser-side Mermaid | Fixes the diagram engine: the colour mechanism must be one Mermaid sequence diagrams support. |

No new ADR is needed: the story applies an existing presentation rule to the remaining diagram kind.

### Other decisions (not ADR-worthy)

* **Coloured participant boxes, not a theme override.** Mermaid sequence diagrams take no `classDef`, so the renderer wraps participants in `box rgb(…)` groups filled with the ownership colour. The alternative, an `%%{init}%%` theme override, colours every participant the same, which cannot encode ownership.
* **Boxes follow the order of first appearance, one per run of the same ownership,** rather than one box per ownership. Reordering participants by ownership would move the participants away from the order the messages flow in and make the arrows cross. A flow such as the database migration therefore shows five boxes for three ownerships.
* **Colours are the legend's fills, written as half-transparent `rgba(r,g,b,0.5)`,** because the Mermaid box parser accepts a named, `rgb()` or `hsl()` colour but not a `#rrggbb` one, and because an opaque pastel lane left the light message text of the dark theme unreadable. At half opacity the lane tints the page background in either theme and the text keeps its contrast. A small helper converts the legend's fill, so the palette stays defined once.
* **The participants table reuses the element-table columns** (Participant, Type, Ownership, Description) so that the flow page reads like the context and container pages.
* **No dashed border for external services on the flows.** Boxes have a fill only. The legend keeps its dashed swatch for external services because one legend serves every diagram, and the ownership label in the table is the carrier that matters.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Participant order, the coloured boxes and the sequence diagram | `frontend/apps/docs/src/lib/architecture.ts` (`Renderer.participants`, `participantBoxes`, `sequenceDiagram`) |
| The `rgba()` form of a legend colour | `frontend/apps/docs/src/lib/architecture.ts` (`rgba`) |
| The flow page: legend and Participants table | `frontend/apps/docs/src/lib/architecture.ts` (`Renderer.flows`, reusing `legend` and `elementRows`) |
| The ownership rule in the model's documentation | `docs/architecture/README.md` |

No change to the model: the ownership of every node a flow crosses was already declared or derived for story 0012.

### API

No changes.

### Testing

* [`architecture.test.ts`](../../frontend/apps/docs/src/lib/architecture.test.ts): the fixture flow's diagram text (the box lines, the participant order and the step arrows), the legend naming only the ownerships in the flow, the Participants table and its position before the Steps, and the hex-to-`rgba()` helper. The earlier flow test (reversed steps, the Steps table, the story link) is unchanged.
* [`build.test.ts`](../../frontend/apps/docs/tests/build.test.ts) (`published architecture`): every flow page is built with its Mermaid block and a table, and links its ADRs and story.
* The rendered diagrams were checked by eye on screenshots of the built site taken with a headless browser (Edge), with the theme forced to light and to dark. No browser extension was available for an interactive check.

### Lessons learned, known issues and follow-ups

* **Mermaid's `box` colour must be `rgb()`, `hsl()` or a named colour.** The parser's regular expression (`(?:rgba?|hsla?)\s*\(.*\)|\w*`) does not match a `#` hex value, which would silently become the box title with a transparent fill. The helper and its test exist for that reason.
* **The box is a lane, not a border.** It fills the whole column behind the participant from top to bottom, with the participant's own box drawn over it in the theme's actor colours, and the message text runs across it. With opaque pastel fills the first screenshots of the dark theme showed near-white text on a light lane; half-transparent fills fixed it in both themes (measured on screenshots, light and dark). Mermaid sets the text colour from the theme and a box cannot override it, unlike the flowchart classes.
* **Measured:** the docs unit tests went from 130 to 134 and still take about 1 s; the page count is unchanged.
* **Follow-up:** if Mermaid gains per-participant styling for sequence diagrams, the boxes can become classes and the external services can get their dashed border on the flows too.

## User guide

### Reading a flow

Open the documentation site, choose **Architecture** in the sidebar and then a flow under **Flows**, such as **Google sign-in** or **Apply database migrations to an environment**. The sequence diagram shows the participants along the top and the numbered steps between them. Each participant stands on a coloured lane: amber for a person, blue for a part built in this repository, violet for hosting and tooling we configure, grey for an external service we only use. The same colours mean the same thing on the **Overview** and **Containers and deployment** pages. The **Legend** line under the diagram names the colours that appear on it.

Below the legend, **Participants** lists every part the flow crosses with its type, its ownership and a short description, each linked to its component page, and **Steps** lists the numbered steps with their source and target. Both tables say in words what the colours show, so the page can be read without the picture.
