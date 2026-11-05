---
status: implemented
date: 2026-11-05
pr:
  - https://github.com/mgasca/calendar/pull/246
adrs: ["0012", "0022", "0025", "0039"]
---

# 0022 Make the architecture diagrams easier to read: rounded, shadowed boxes and labels off the arrows

## Story

> As a contributor reading the **Architecture** section of the documentation site, I need the diagrams' boxes to stand out from the page and their relationship labels to sit clear of the arrows, so that I can read who talks to whom without untangling text from lines.

Requested in a working session rather than an issue; the card was written with the delivery, in one PR. It follows stories [0012](0012-architecture-visualization-on-the-documentation-site.md) (the Architecture section) and [0016](0016-colour-the-architecture-flow-diagrams-by-ownership.md) (ownership colours on every diagram).

## Background

The Architecture section renders three kinds of Mermaid diagram from the CALM model ([ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md)): the **Overview** (system context, a left-to-right flowchart whose arrows carry a short relationship description), **Containers and deployment** (a top-to-bottom flowchart with nested subgraphs and protocol labels such as HTTPS), and one sequence diagram per **flow**. Story 0016 gave every diagram the ownership colours. Apart from those colours, the diagrams used Mermaid's defaults: square boxes flat on the page, tight padding, and edge labels drawn on a grey patch in the middle of their arrow.

The request was four improvements: rounded corners, a slight drop shadow, more padding around the text in each box, and relationship labels that do not overlap the arrows they describe in the Overview and the Containers diagram. Mermaid has no setting that moves a flowchart label off its arrow: it always draws the label at the arrow's midpoint. So the options were compared on screenshots of the real diagrams, rendered with the site's Mermaid version at the site's content width, in both themes, before choosing:

* **A:** more spacing between boxes and a solid, padded label background in the page colour, which cleanly interrupts the arrow instead of drawing it through the text.
* **B:** as A, with the ELK layout engine, which places labels as part of the layout and routes arrows at right angles around them.
* **C:** Mermaid's `neo` look, which looked almost identical to A on these diagrams.
* **D:** numbered arrows with a key under the diagram.
* **Transparent label backgrounds:** compared on request and rejected, because the arrows then run through the label text.

The choice was solid label backgrounds everywhere, with ELK on the Overview only. The Containers diagram keeps Mermaid's default layout (dagre): ELK made it much taller than wide. ELK cannot lay out the flows, which are sequence diagrams.

### Agreed scope

* **Rounded corners** on every component box, subgraph and flow participant, with one radius (8 px) for all of them.
* **A slight drop shadow** under every box, subgraph and flow participant, darker in the dark theme so it still reads.
* **More padding** inside flowchart boxes, and more room between boxes for the edge labels.
* **Edge labels on a solid, padded patch of the page background** in both themes, sized by Mermaid so the text is never clipped.
* **The Overview is laid out with ELK.** The Containers diagram and the flows keep their current layouts, and so does any hand-written Mermaid elsewhere on the site.
* **Tests** that pin the generated diagram text, and a build check that ELK actually ships.

### Not in this story

* **Moving a label off its arrow.** Mermaid has no setting for it, and a CSS offset would break as the model changes.
* **Fixing the Containers diagram's layout faults under dagre:** one arrow ends in empty space above the Azure resource group, and one HTTPS label is partly hidden behind Ops Key Vault. ELK fixed both in the comparison, but the diagram stays on dagre by choice (see the follow-ups).
* **The faint arrows inside the light-violet subgraphs of the Containers diagram in the dark theme.** They looked the same before this story.
* **Changing the ownership colours, the legend or the text tables** (stories 0012 and 0016).
* **Rendering diagrams at build time or committing images.** ADR-0039 keeps browser-side Mermaid.

### Acceptance criteria

1. **Given** the Overview or the Containers page, **when** I look at a component box, **then** it has rounded corners, while people keep their pill shape, the database its cylinder and data assets their double-edged box.
   [The generator emits the rounded shape](../../frontend/apps/docs/src/lib/architecture.test.ts) (`collapses the context diagram onto the view nodes …` and `nests the container diagram by deployment …`, both asserting `app("App #40;web#41;"):::ours` next to the unchanged actor and database shapes). The radius itself (8 px) and the rounded subgraphs and flow participants were checked by eye on screenshots of the built site in both themes; no automated test renders Mermaid.
2. **Given** any architecture diagram, **when** I view it in the light or the dark theme, **then** its boxes, subgraphs and flow participants have a soft drop shadow.
   Checked by eye on screenshots of the built site (Overview, Containers, Google sign-in flow), light and dark. Not covered by an automated test.
3. **Given** the Overview or the Containers diagram, **when** I read an edge label, **then** it sits on a solid patch of the page background, all of its text is visible, and no arrow is drawn through it.
   Checked by eye on the same screenshots. A first version that padded the label from the page stylesheet clipped the last line of long labels and the end of "HTTPS"; the label rules now go through Mermaid's own CSS, and the screenshots show every label whole. Not covered by an automated test.
4. **Given** the Overview, **when** it renders, **then** it is laid out with ELK, and the Containers diagram and the flows are not.
   [The Overview carries the ELK frontmatter and the Containers diagram does not](../../frontend/apps/docs/src/lib/architecture.test.ts) (`collapses the context diagram …`, `nests the container diagram …`), and [the built site ships the ELK layout](../../frontend/apps/docs/tests/build.test.ts) (`ships the ELK layout the overview asks for`), which fails when the package is missing, because Mermaid would otherwise fall back to its default layout without a word. Both new assertions were run against the old generator, and the build check against a build without the package; all three failed.
5. **Given** the change is complete, **when** `just check` runs, **then** it passes.
   Locally: the docs unit tests (141), `just docs build` with its build checks (8), `just frontend typecheck`, `just frontend lint` and `format:check`. CI runs the rest of `just check` on the PR.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | FINOS CALM for the architecture model, rendered with browser-side Mermaid | Fixes the engine: every change had to be something Mermaid 11 or page CSS can do in the browser. The ELK package is recorded there as a note. |
| [0012](../decisions/0012-ci-and-dependency-updates.md) | CI and Dependabot dependency updates | The ELK layout is a pinned `devDependency` of the docs app, so Dependabot updates it with Mermaid. |
| [0022](../decisions/0022-astro-starlight-documentation-ui.md) | Astro and Starlight for the documentation UI | The diagram styling uses Starlight's page background colour and its light and dark themes. |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Pull-request previews of the site | The restyled diagrams are reviewed on the PR preview. |

No new ADR is needed. The ELK package is a rendering add-on of the Mermaid integration that ADR-0039 already chose, not a new tool.

### Other decisions (not ADR-worthy)

* **ELK on the Overview only, per diagram.** The Overview opts in through Mermaid frontmatter (`config: layout: elk`) instead of a site-wide setting, so the Containers diagram, the flows and any hand-written Mermaid keep the default layout. ELK drew the Containers diagram correctly but tall and narrow, and it does not apply to sequence diagrams.
* **Rounded corners through Mermaid's rounded shape, not CSS.** Plain components are emitted as `id("name")`, whose radius is Mermaid's `radius` theme variable. Arrows still meet the box edge exactly, and the shape works in every browser. Subgraphs and flow participants have no rounded variant, so CSS rounds those with the same radius.
* **Label styling in Mermaid's `themeCSS`, shadows in the page stylesheet.** Mermaid measures each label before page CSS reaches it, so label padding in the page stylesheet made the text wrap past its box and clipped it. `themeCSS` applies during the measurement. Its rules need `!important` to beat Mermaid's label rules, which are scoped by the SVG's id. Shadows and corner radii are not measured, so they stay in the page stylesheet, where the shadow colour can follow Starlight's theme.
* **The label patch is the page background (`--sl-color-bg`),** so it matches the page in either theme. On the Containers diagram's violet subgraphs it reads as a small tag in the page colour.
* **No `neo` look.** It looked the same as option A on these diagrams and also changes Mermaid's padding, edges and sequence participants, which would make future Mermaid upgrades harder to review.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Mermaid settings: corner radius, padding, spacing, edge-label CSS | `frontend/apps/docs/astro.config.ts` (`mermaidConfig` of the `astro-mermaid` integration) |
| Switching off Mermaid's own render-on-load | `frontend/apps/docs/astro.config.ts` (`mermaidNoAutoStart`) |
| Drop shadows and rounded subgraphs and flow participants | `frontend/apps/docs/src/styles/docs.css` (the Mermaid section, `--diagram-shadow`) |
| Rounded node shape and the Overview's ELK frontmatter | `frontend/apps/docs/src/lib/architecture.ts` (`shape`, `elkLayout`, `Renderer.contextDiagram`) |
| The ELK layout package | `frontend/apps/docs/package.json` (`@mermaid-js/layout-elk`, a `devDependency`) |

`astro-mermaid` registers ELK by itself when `@mermaid-js/layout-elk` resolves from the docs app (it logs "Enabling ELK support" during the build). The package was already in the lockfile as an optional peer of `astro-mermaid`, so the lockfile gains only the importer entry.

### API

No changes.

### Testing

* [`architecture.test.ts`](../../frontend/apps/docs/src/lib/architecture.test.ts): the Overview's diagram starts with the ELK frontmatter, the Containers diagram starts directly with `flowchart TB` and has no `layout: elk`, and plain components use the rounded shape next to the unchanged actor and database shapes.
* [`build.test.ts`](../../frontend/apps/docs/tests/build.test.ts) (`ships the ELK layout the overview asks for`): the built Overview asks for ELK, and the ELK chunk is in the built assets. (`turns off Mermaid's own render-on-load in the page script`): the shipped page script switches Mermaid's auto-render off (see the lessons below).
* The rendered result was checked on screenshots of the built site taken with headless Chromium: the Overview, the Containers diagram and the Google sign-in flow, each in the light and the dark theme, with no console errors.

### Lessons learned, known issues and follow-ups

* **Mermaid sizes a label before page CSS applies.** Anything that changes a label's size (padding, font, wrapping) belongs in `themeCSS` or the Mermaid config, never in the page stylesheet.
* **A missing layout fails silently.** A diagram that names an unregistered layout is drawn with dagre and no warning, hence the build check.
* **Loading ELK opened a race with Mermaid's own render-on-load** (found on the PR preview). Mermaid adds a window `load` listener that renders every `.mermaid` element unless `startOnLoad` is false. `astro-mermaid` sets that only after it has also downloaded the ELK layout, and before ELK there was no such gap. When `load` landed in the gap, Mermaid drew the diagrams itself: with its default config, under a timestamp id (`mermaid-1793875505573`), and without the diagram source that `astro-mermaid` keeps for re-rendering. The next theme switch then re-rendered the SVG's own text and showed "Error rendering diagram" in place of the diagram. A page script in `astro.config.ts` (`mermaidNoAutoStart`) now sets `mermaid.startOnLoad = false` as soon as the module loads, before any `load` task can run. The race was reproduced in headless Chromium by slowing the ELK download and running Mermaid's listener during the gap; with the fix, all three diagram kinds render through `astro-mermaid` and switch themes without error. A [build check](../../frontend/apps/docs/tests/build.test.ts) (`turns off Mermaid's own render-on-load in the page script`) fails without the script; the race itself needs a browser and has no automated test.
* **Known issue:** on the Containers diagram, dagre still ends one arrow in empty space above the Azure resource group, and still partly hides one HTTPS label behind Ops Key Vault. ELK fixes both. If those faults matter more than the diagram's proportions, adding the ELK frontmatter to `Renderer.containerDiagram` is a one-line change, and the test that pins its absence would change with it.
* **Known issue:** in the dark theme, the Containers diagram's arrows are faint over the light-violet subgraphs, as they were before this story.

## User guide

### Reading the architecture diagrams

Open the documentation site and choose **Architecture** in the sidebar. On **Overview**, **Containers and deployment** and every flow page, each part of the system is a box with rounded corners and a soft shadow, filled with its ownership colour from the **Legend**. People are drawn as pills, the database as a cylinder.

On **Overview** and **Containers and deployment**, the text on an arrow says what the relationship is (on the Overview) or which protocol it uses (on the Containers page). It sits on a small patch of the page colour, so the arrow stops at the text instead of running through it. The Overview draws its arrows at right angles, which keeps each description on its own arrow.

The diagrams follow the site's light or dark theme. The tables under each diagram say the same thing in words.
