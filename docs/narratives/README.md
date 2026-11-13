# Architecture narratives

An architecture narrative tells the story of one system's architecture in three acts: **Setup** (the business problem, its context, why now, the people involved and a shared vocabulary), **Confrontation** (constraints, challenges, the driving architecture characteristics and the alternatives weighed) and **Resolution** (the proposed architecture with its diagrams, decisions and risks). The format is the maintainer's adaptation of Mark Richards and Neal Ford's Architecture Katas teaching, not an official template. Narratives are drafted with the `architecture-narrative-builder` skill ([story 0063](../stories/0063-build-architecture-narratives-with-an-expert-panel.md)); the layout is decided in [ADR-0059](../decisions/0059-publish-architecture-narratives-stitched-from-part-files.md).

This page holds the conventions only. The site lists the narratives themselves in the sidebar, discovered from the files.

## Layout

* **Published file:** `docs/narratives/<system>-narrative.md`, one per system, revised in place. `<system>` is lower-case letters, digits and single hyphens (`calendar`, `ticket-kata`); the page is published at `narratives/<system>/`.
* **Parts:** `docs/narratives/<system>/` holds the narrative's parts when they are kept: `00-front-matter.md`, `01-setup.md`, `02-confrontation.md`, `03-resolution.md`, `04-assumptions.md`, an optional `05-panel.md`, `ledger.md` (the gap ledger and the experts' synergy and conflict map), one `.mmd` file per Mermaid diagram and `slides.md` when a deck exists. **The site never publishes a part directory**, and a link to a Markdown part fails the build.
* **Generated file:** when the parts are kept, the published file is stitched from them and says so in a note under its front matter. Edit the parts and restitch; an edit made to the published file is overwritten by the next stitch, and the stitcher's check fails until the edit is moved to the parts. The page's "Edit page" link opens the part directory.
* **Decks:** a narrative with a deck is built from `docs/narratives/<system>/slides.md` and published at `slides/<system>/` ([ADR-0060](../decisions/0060-build-narrative-decks-with-slidev.md)).

## Front matter

```yaml
---
system: Calendar
audience: Architecture review board and new contributors
date: 2026-11-13
status: draft
slides: slides/calendar/
---
```

* **`system`** (required): the narrated system's display name. Two narratives of the same system (ignoring case) fail the build.
* **`audience`** (required): who the narrative is written for.
* **`date`** (required): the date of the last revision, `YYYY-MM-DD`.
* **`status`** (required): `draft` while the interview or its review is open, `final` once the narrative is confirmed.
* **`slides`** (optional): only when a deck exists, exactly `slides/<system>/`, the deck's path under the site.

Any other key fails the build. The document has exactly one `#` title, which is the page title; the site shows the system, audience, date, status and deck link beneath it.
