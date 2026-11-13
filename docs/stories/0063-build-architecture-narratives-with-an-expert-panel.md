---
status: planned
date: 2026-11-13
issue: https://github.com/mgasca/calendar/issues/705
pr:
  - https://github.com/mgasca/calendar/pull/713
adrs: ["0042", "0044", "0058", "0059", "0060"]
---

# 0063 Build architecture narratives with an interviewing agent and an expert panel

## Story

> As a maintainer who explains systems to review boards, teams and kata panels, I need an agent skill that interviews me and drafts a three-act Architecture Narrative, challenged by a panel of expert agents, so that I get a published narrative and a deck whose solution is justified by the forces stated before it, with no unstated assumptions.

Tracked in epic #705, with slices #706 to #711.

## Background

An Architecture Narrative tells the story of an architectural solution with a beginning, a middle and an end, supported by architecture characteristics, diagrams and decision records. The format here is the maintainer's adaptation of Mark Richards and Neal Ford's teaching (their Architecture Katas material judges clarity of narrative, organisation and supporting documentation); it is not presented as an official template. The acts are causal:

* **Act 1, Setup:** the business problem, its context, why the business is doing this and why now, the stakeholders and major players, and a common vocabulary.
* **Act 2, Confrontation:** business and technical constraints, unique challenges, the driving architecture characteristics tied to business requirements, and the alternatives considered with their trade-offs.
* **Act 3, Resolution:** the proposed architecture with diagrams, the major decisions, and the risks of the solution. Both the solution and its risks are required.

A first draft of the skill was written in a Claude Desktop conversation. It was used only as a reference: the design below was settled with the maintainer in a Claude Code interview on 2026-11-13, and differs from the draft in how the panel runs, where narratives live and how they are stored.

Today the repository has no narrative documents and no slides tooling. The docs site renders Mermaid already. Repository tooling is moving to TypeScript on Deno ([0059](0059-run-repository-tooling-on-typescript-and-deno.md)), and agent automation under `.claude/` may be Claude Code only.

### Agreed scope

* **Generic skill:** `architecture-narrative-builder` narrates any system (Calendar, a kata, another system). The interview starts from scratch and reads repository material only when the user points at it.
* **Interview:** questions by AskUserQuestion in batches of 1 to 4 with concrete options; a gap ledger per act; follow-ups on adjectives without numbers, unnamed people, missing motive, unstated constraints and decisions without alternatives; contradictions named; unanswerable points recorded as labelled assumptions that carry into the risks; a confirmed summary after each act. The skill does not leave an act until its gaps are closed or recorded as assumptions.
* **Driving characteristics:** proposed from a longer candidate list, narrowed to about three and never more than five, each tied to a stated business requirement and a measurable target, and confirmed by the user.
* **Expert panel:** one expert per driving characteristic, plus an End-User and a Business expert, each with a concern, a voice, a standing question, the evidence it wants and what it pushes back on. They run in parallel through a saved workflow (`questions`, `alternatives` and `review` phases) as a read-only expert agent on Sonnet. The facilitator turns their output into question batches and never dumps it raw.
* **Synergy and conflict map:** once the panel is named, the facilitator proposes which expert pairs are in synergy, in conflict or neutral, with a reason, and the user confirms it. After each parallel round, one rebuttal round sends each expert only the verdicts of the experts the map relates it to.
* **Decisions:** Act 3 decisions are short inline ADR summaries (context, decision, consequences, status, rejected alternative); an equivalent ADR in `docs/decisions/` is linked, and `adr-draft` is offered for a decision worth a real record.
* **Part files and stitching:** per [ADR-0059](../decisions/0059-publish-architecture-narratives-stitched-from-part-files.md), each confirmed act is written to its own part under `docs/narratives/<system>/`, with one file per Mermaid diagram, a never-stitched `ledger.md` and an optional panel appendix. A Deno stitcher assembles `docs/narratives/<system>-narrative.md`; its `--check` fails `just check` and CI on drift.
* **Modes:** build (interview, stitch, remove parts), keep-parts, stitch-only, and slides.
* **Publication:** the docs site publishes stitched narratives with validated front matter, and never the part directories.
* **Decks:** per [ADR-0060](../decisions/0060-build-narrative-decks-with-slidev.md), the slides mode drafts `slides.md` from the parts; `frontend/apps/slides` builds it with Slidev; the Pages build publishes it under `/slides/<system>/`, linked from the narrative.
* **Quality checks before stitching:** every characteristic traces to a business requirement and a target; every major decision records a rejected alternative; Act 3 has the solution and its risks with likelihood, impact and mitigation; every expert's concern appears somewhere, if only as an accepted risk; every assumption is labelled; the Act 1 vocabulary is used consistently.
* **Evidence:** evals for the skill's modes, and a first real narrative of the Calendar system produced by interviewing the maintainer.

### Not in this story

* **Other agents:** the skill, workflow and expert agent are Claude Code only during the period of [ADR-0044](../decisions/0044-claude-first-agent-automation.md).
* **Other exports:** PPTX, Claude artifacts or hosted documents. PDF export of decks is an open question on ADR-0060.
* **Regenerating decks automatically:** a deck is drafted from the parts and can lag behind later edits; the drift check covers narratives only.
* **Prefilling from this repository's stories, ADRs or architecture model:** the skill is generic; the user may point it at material.

### Dependencies

The slices follow the dependency map on epic #705. This card and both ADRs come first; the docs-site and stitcher slices define and write the same front matter, so they coordinate it.

### Acceptance criteria

1. **Given** I start the skill for a new system, **when** it interviews me, **then** each round asks 1 to 4 questions with concrete options, follows up an answer such as "fast" with a request for a target, and does not move to Act 2 until Act 1's gaps are closed or recorded as assumptions that I agreed to.
2. **Given** two of my answers contradict each other, **when** the next round is asked, **then** the skill names the contradiction and asks which holds.
3. **Given** Act 1 is confirmed, **when** the driving characteristics are chosen, **then** there are at most five, each linked to a business requirement I stated and a measurable target, and I confirm the list before the panel is convened.
4. **Given** the panel is named, **when** the skill proposes the synergy/conflict map, **then** I confirm or correct it, it is saved in `ledger.md`, and in each rebuttal round an expert receives only the verdicts of the experts the map relates it to.
5. **Given** the Act 3 draft, **when** the panel reviews it, **then** each expert signs off or objects, and every objection becomes a revision, a risk or an open question that the narrative shows.
6. **Given** an interview stopped after Act 2, **when** I resume it in a new session, **then** the skill reads the parts and the ledger and continues at Act 3 without re-asking confirmed answers.
7. **Given** a narrative kept with its parts, **when** I edit `02-confrontation.md` and run the stitch-only mode, **then** the published narrative reflects the edit; **when** I edit the published file instead, **then** the stitcher's check fails in `just check`.
8. **Given** a narrative built without keep-parts, **when** the build finishes, **then** only `docs/narratives/<system>-narrative.md` remains and the docs site publishes it with its front matter validated.
9. **Given** a narrative, **when** I run the slides mode and build the deck, **then** the deck shows each act with its Mermaid diagrams, the Pages build publishes it under `/slides/<system>/`, and the narrative links it.
10. **Given** the finished narrative, **when** the quality checks run, **then** each characteristic traces to a requirement and target, each major decision names a rejected alternative, and Act 3 holds both the solution and its risks with likelihood, impact and mitigation.
11. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0042](../decisions/0042-layered-agent-guidance-and-hooks.md) | Agent guidance is layered: `AGENTS.md`, skills, agents and hooks | The narrative builder is a skill with its own agent and workflow, not a rule in `AGENTS.md`. |
| [0044](../decisions/0044-claude-first-agent-automation.md) | Automation under `.claude/` may be Claude Code only | The skill, the panel workflow and the expert agent are Claude Code only for now. |
| [0058](../decisions/0058-typescript-on-deno-for-repository-tooling.md) | Repository tooling is TypeScript on Deno | The stitcher is a Deno script in the skill folder with its own configuration and lockfile. |
| [0059](../decisions/0059-publish-architecture-narratives-stitched-from-part-files.md) | Narratives live in `docs/narratives/`, stitched from part files with a drift check | Defines the layout, the modes and the stitcher. New, proposed. |
| [0060](../decisions/0060-build-narrative-decks-with-slidev.md) | Decks are built with Slidev in `frontend/apps/slides` and published with the site | Defines the slides export. New, proposed. |

### Other decisions (not ADR-worthy)

* **A saved workflow for the panel:** the experts fan out deterministically from one script with a phase argument, rather than ad hoc subagent calls, so each round is repeatable; invoking the skill is the workflow opt-in.
* **One expert agent definition on Sonnet:** a bounded critique per role, run several times per narrative; Opus would cost more for each of five to seven experts, Haiku would be too shallow for trade-off arguments. The role brief comes from the workflow, so one definition serves every expert.
* **Rebuttal only along the confirmed map:** sending every verdict to every expert grows with the square of the panel; the user-confirmed map keeps the debate to the pairs whose concerns actually meet.
* **One narrative per system, revised in place:** `<system>-narrative.md` rather than numbered captures, because a narrative is a living explanation of one system.
* **Panel appendix optional:** the experts' names stay out of the narrative unless the user asks for the appendix part.
* **The draft parts are the interview state:** no separate state file, so a resumed interview and a later edit read the same files.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| The skill | `.claude/skills/architecture-narrative-builder/SKILL.md` and `references/` |
| Stitcher | `.claude/skills/architecture-narrative-builder/` Deno script, configuration, lockfile and tests |
| Expert agent | `.claude/agents/narrative-expert.md` |
| Panel workflow | `.claude/workflows/narrative-panel.js` |
| Narratives | `docs/narratives/<system>-narrative.md`, parts in `docs/narratives/<system>/` |
| Docs-site loader | `frontend/apps/docs` |
| Decks | `frontend/apps/slides`, published by `.github/workflows/pages.yml` |
| Evals | `.claude/skills/architecture-narrative-builder/evals/` |
| Story card | `docs/stories/0063-build-architecture-narratives-with-an-expert-panel.md` |

### API

No changes.

### Testing

* Stitcher: Deno tests for part order, diagram inclusion, excluded files, the generated-file note and `--check` failing on drift; discovered by `just tools test`.
* Docs site: loader and build tests for narrative discovery, skipped part directories, front-matter validation and the deck link.
* Decks: CI builds every deck in the docs-site job.
* Skill and panel: evals for the modes and the quality checks; criteria 1 to 6 describe agent behaviour and are checked by the evals and the first real run.

### Lessons learned, known issues and follow-ups

To be completed on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Building a narrative

Ask the agent to build an architecture narrative for a system (for example "write an architecture narrative for the Calendar system"). It asks who the narrative is for and what material exists, then interviews you act by act, a few questions at a time, with suggested answers you can pick or replace. When an answer is vague ("it must be fast"), it asks for a number or for what failure looks like.

After the first act it proposes the few architecture characteristics that drive the design and a panel of experts: one per characteristic, plus an end user and the business. It shows which experts support or oppose each other; confirm or correct that. The experts' questions and objections come back to you as further questions, never as raw transcripts.

When the narrative is finished it appears on the docs site under **Narratives**. Ask to **keep the parts** if you want to edit acts later; after editing a part, ask the agent to **restitch** the narrative. Ask for **slides** to get a deck, published beside the narrative.

You can stop at any time: the acts you confirmed are saved, and the next session continues from there.
