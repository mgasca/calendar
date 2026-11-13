---
status: proposed
date: 2026-11-13
decision-makers: mgasca, Claude (AI assistant)
---

# Publish architecture narratives from docs/narratives, stitched from per-system part files

## Context and Problem Statement

Epic [#705](https://github.com/mgasca/calendar/issues/705) adds an `architecture-narrative-builder` skill that interviews the maintainer and drafts a three-act Architecture Narrative (setup, confrontation, resolution) for any system, not only Calendar. An interview runs over several acts and sometimes several sessions, a panel of expert agents reads the narrative in every round, and the result is meant to be read and shared beside the other records on the documentation site ([ADR-0022](0022-astro-starlight-documentation-ui.md), [ADR-0028](0028-publish-user-stories-on-the-documentation-site.md)). Where do narratives live, and in what file shape, so that they are published, cheap to work on in context, editable over time and never out of step with what the site shows?

## Decision Drivers

* **D1 Published and shareable**: the maintainer wants narratives on the documentation site, discovered from the filesystem and validated like the other folders.
* **D2 Context cost**: the interview, the expert panel and later edits should load only the part of a narrative they work on, not the whole document every round.
* **D3 Editable and resumable**: people and agents must be able to revise a narrative over time and resume an unfinished interview from the files, across sessions and machines.
* **D4 No drift**: what the site publishes must match the source the skill and its users edit; a stale published file should fail a check, not be discovered by a reader.
* **D5 Fits repository conventions**: filesystem discovery, metadata validation, Mermaid diagrams already rendered by the site, tooling in TypeScript on Deno ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)).
* **D6 Any system**: the folder must hold narratives of Calendar, of an Architecture Kata or of another system, without assuming this repository's components.

## Considered Options

* `docs/narratives/` with per-system part files and a Deno stitcher that has a drift check
* One narrative file per system in `docs/narratives/`, edited in place
* Part files in the git-ignored `.plan/`, only the stitched file committed
* Narratives outside the repository (a hosted document or artifact)

## Decision Outcome

Chosen option: "`docs/narratives/` with per-system part files and a Deno stitcher that has a drift check", because it is the only option that publishes narratives with the other records (D1, D5) while keeping each act in its own small file for the interview and later edits (D2, D3), and its check makes drift a build failure rather than a surprise (D4). Nothing in the layout is specific to Calendar (D6).

| Driver | **docs/narratives with parts and stitcher (chosen)** | Single file in place | Parts in .plan/ | Outside the repository |
| --- | :---: | :---: | :---: | :---: |
| D1 Published and shareable | ★★★ | ★★★ | ★★★ | ★★☆ |
| D2 Context cost | ★★★ | ★☆☆ | ★★★ | ★☆☆ |
| D3 Editable and resumable | ★★★ | ★★☆ | ★☆☆ | ★★☆ |
| D4 No drift | ★★☆ | ★★★ | ★☆☆ | ★★★ |
| D5 Fits repository conventions | ★★☆ | ★★★ | ★★☆ | ☆☆☆ |
| D6 Any system | ★★★ | ★★★ | ★★★ | ★★★ |

### Layout

* **Published file:** `docs/narratives/<system>-narrative.md`, one per system, revised in place, with front matter for the system name, audience, date, status (`draft` or `final`) and, when a deck exists, its link. The site discovers and publishes these files only.
* **Parts:** `docs/narratives/<system>/` holds `00-front-matter.md`, `01-setup.md`, `02-confrontation.md`, `03-resolution.md`, `04-assumptions.md`, an optional `05-panel.md` (the expert panel's sign-offs and objections, stitched only when asked), `ledger.md` (the gap ledger and the confirmed synergy/conflict map of the experts, never stitched), one `.mmd` file per Mermaid diagram, and `slides.md` when a deck exists ([ADR-0060](0060-build-narrative-decks-with-slidev.md)). The site does not publish the part directory.
* **Interview state:** the skill writes each confirmed act to its part, so a resumed interview reads the files instead of a transcript.
* **Modes:** build (interview, stitch, then remove the parts), keep-parts (the parts stay committed for later edits) and stitch-only (restitch existing parts).

### Stitcher

* A TypeScript-on-Deno script inside the skill folder, with its own `deno.json` and frozen lockfile, as [ADR-0058](0058-typescript-on-deno-for-repository-tooling.md) prescribes for skills that carry scripts.
* It joins the parts in a fixed order, inlines each referenced `.mmd` file as a fenced Mermaid block and marks the result as generated from the parts.
* `--check` restitches every system that has parts and fails when the committed file differs. It runs in `just check` and CI.

### Consequences

* Good, because the narratives sit on the site beside the stories and decisions they often cite.
* Good, because an expert round or an edit to Act 2 loads `02-confrontation.md`, not the whole narrative.
* Good, because a narrative kept with its parts can be revised by anyone, and restitched with one command.
* Bad, because with keep-parts the published file is generated: an edit made directly to it is overwritten by the next stitch, and the check fails until the edit is moved to the parts.
* Bad, because the site loader needs a new folder with a rule to skip part directories, and CI gains a check.
* Neutral, because a narrative built without keep-parts is an ordinary single file, and can gain parts later only by being split again by hand or rebuilt.

### Confirmation

* The docs-site tests and build validate narrative front matter and fail on links to unpublished documents, as they do for the other folders.
* The stitcher's `--check`, run by `just check`, by the Tooling CI job and, for a change that runs no Tooling job, by a small Narratives job of its own, fails on drift; its own tests cover ordering, diagram inclusion, the excluded files and the check.

## Pros and Cons of the Options

### docs/narratives with per-system part files and a Deno stitcher that has a drift check

* Good, because **D1 Published and shareable**: stitched narratives are site documents like any other.
* Good, because **D2 Context cost**: each act, the ledger and each diagram are separate files that an agent reads alone.
* Good, because **D3 Editable and resumable**: the committed parts are the interview state and the edit surface, on any machine.
* Neutral, because **D4 No drift**: the generated file can drift, but the check catches it before merge.
* Neutral, because **D5 Fits repository conventions**: it follows filesystem discovery and Deno tooling, but adds a folder with a skip rule and a new check.
* Good, because **D6 Any system**: parts and front matter carry no Calendar-specific fields.

### One narrative file per system in docs/narratives, edited in place

* Good, because **D1 Published and shareable**: published like the chosen option.
* Bad, because **D2 Context cost**: every panel round and every edit loads the whole narrative, which grows with diagrams, decisions and risks.
* Neutral, because **D3 Editable and resumable**: a draft file can be resumed, but the gap ledger and expert map must live inside the published document or be lost.
* Good, because **D4 No drift**: there is only one file.
* Good, because **D5 Fits repository conventions**: the simplest form of a new site folder, with no tool.
* Good, because **D6 Any system**: no system-specific structure.

### Part files in the git-ignored .plan/, only the stitched file committed

* Good, because **D1 Published and shareable**: the stitched file is published.
* Good, because **D2 Context cost**: the same small parts as the chosen option.
* Bad, because **D3 Editable and resumable**: the parts exist on one machine only, so other agents, other worktrees and the maintainer elsewhere cannot edit and restitch them.
* Bad, because **D4 No drift**: nothing committed can be checked against the published file; edits to it and to local parts diverge silently.
* Neutral, because **D5 Fits repository conventions**: `.plan/` is the repository's place for local state, but it is not meant for documents that should last.
* Good, because **D6 Any system**: no system-specific structure.

### Narratives outside the repository (a hosted document or artifact)

* Neutral, because **D1 Published and shareable**: easy to share by link, but not beside the records the narrative cites, and not in the site's validation.
* Bad, because **D2 Context cost**: an agent reads and writes the whole hosted document through a connector each round.
* Neutral, because **D3 Editable and resumable**: editable by people in place; agents depend on a connector being available.
* Good, because **D4 No drift**: one hosted document.
* Bad, because **D5 Fits repository conventions**: outside discovery, validation, review in pull requests and the architecture model.
* Good, because **D6 Any system**: no system-specific structure.

## More Information

* Related: [ADR-0022](0022-astro-starlight-documentation-ui.md) (the site), [ADR-0028](0028-publish-user-stories-on-the-documentation-site.md) (publishing a docs folder), [ADR-0058](0058-typescript-on-deno-for-repository-tooling.md) (tooling and skill scripts on Deno), [ADR-0060](0060-build-narrative-decks-with-slidev.md) (decks), [ADR-0044](0044-claude-first-agent-automation.md) (the skill and panel are Claude Code only for now).
* Story: [0063](../stories/0063-build-architecture-narratives-with-an-expert-panel.md).
* A drift check written as a Vitest test in the docs app was rejected: it would re-implement the stitch rules in a second place.
* Open questions for the reviewer: none at the time of writing; the layout and modes were agreed in conversation on 2026-11-13.
* Revisit when narratives need per-section publication (one page per act) or a second output format beyond Slidev.
