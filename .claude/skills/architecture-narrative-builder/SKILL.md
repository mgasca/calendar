---
name: architecture-narrative-builder
description: Interview the user and draft a three-act Architecture Narrative (Act 1 Setup, Act 2 Confrontation, Act 3 Resolution) for any system, stress-tested by a panel of expert agents, written to docs/narratives/<system>/ part files and stitched into docs/narratives/<system>-narrative.md. Modes build (default), keep-parts, stitch-only and slides. Use when the user asks to write, build, draft, resume, revise, restitch or present an architecture narrative, an architecture story, a kata presentation or a review-board explanation of a system's architecture, or asks for slides of one, even if they don't say "narrative".
---

# Architecture narrative builder

An Architecture Narrative tells the story of a solution with a beginning, a middle and an end. Act 1 (Setup) states the business problem, why now, who is involved and a shared vocabulary. Act 2 (Confrontation) states the constraints, the challenges, the few architecture characteristics that drive the design and the alternatives with their trade-offs. Act 3 (Resolution) shows the architecture, the major decisions and the risks. The acts are causal: every Act 3 choice is justified by a force stated in Act 1 or Act 2. The structure is the maintainer's adaptation of Mark Richards and Neal Ford's Architecture Katas teaching; never present it as an official template.

You are the facilitator. You interview, keep the gap ledger, convene the expert panel and write the parts. You never invent facts: a point the user cannot answer becomes a labelled assumption the user agrees to.

Claude Code only (ADR-0044). Story 0063, ADR-0059 (files and stitching), ADR-0060 (decks).

## Terms

- **System**: what is narrated, named by a kebab-case slug (`calendar`, `ticket-kata`). Its parts live in `docs/narratives/<system>/`; the published file is `docs/narratives/<system>-narrative.md`.
- **Part**: one of `00-front-matter.md`, `01-setup.md`, `02-confrontation.md`, `03-resolution.md`, `04-assumptions.md` and the optional `05-panel.md`. Templates: [references/templates/](references/templates/).
- **Ledger**: `docs/narratives/<system>/ledger.md`, never published. It holds the gaps per act, contradictions, assumptions, the driving characteristics, the panel, the confirmed synergy/conflict map, the panel rounds run and which acts are confirmed. Template: [references/templates/ledger.md](references/templates/ledger.md).
- **Gap**: something an act must establish that the user has not yet stated with enough precision. It is *open*, *closed* (answered, with the answer) or an *assumption* (`A<n>`, agreed by the user).
- **Driving characteristic**: an architecture characteristic that shapes the design, tied to a business requirement the user stated and a measurable target.

## Inputs

Ask only for what is missing, in the first question batch:

- **System** name and slug.
- **Audience** (a review board, a kata panel, new contributors, executives): it sets depth and vocabulary.
- **Material** the user wants you to read (a repository folder, ADRs, a brief). Read nothing else: the skill is generic and starts from scratch.
- **Mode**, from the table below; build when none is named.
- **Panel appendix**: whether the narrative should include `05-panel.md` (default no).

| Mode | Triggers | Result |
| --- | --- | --- |
| build (default) | "write/build a narrative" | Interview, quality checks, then `just tools narratives --remove-parts <system>`: only `<system>-narrative.md` remains (and `slides.md` when a deck exists). |
| keep-parts | "keep the parts", "so I can edit acts later" | As build, but `just tools narratives <system>`: the parts and ledger stay committed, and the published file carries a generated-file note. |
| stitch-only | "restitch", "I edited Act 2" | No interview. Run the quality checks on the existing parts; stitch with `just tools narratives <system>` only when they pass (see "Quality checks before stitching"). |
| slides | "slides", "a deck", "present it" | Draft `docs/narratives/<system>/slides.md` from the confirmed parts (see "Slides"). Needs parts: in build mode, run it before the parts are removed. |

Outside this repository, run the stitcher from the skill folder: `deno task --config <skill>/deno.json stitch -- --root <repo> [...]`.

## Resume first

Before asking anything, look for `docs/narratives/<system>/`.

- If it holds `ledger.md`, read the ledger first. Continue at the first act it does not mark confirmed; read only that act's part and the parts its checks need. Never re-ask a closed gap or a confirmed answer; show a two-line recap of where the interview stands instead.
- If only `<system>-narrative.md` exists (built without keep-parts), a revision means rebuilding the parts from it: propose that, and on agreement split it into the part templates before interviewing.

## The interview loop

Run this loop for each act. [references/act-guide.md](references/act-guide.md) lists, per act, the gaps that seed the ledger, example batches and the confirmation summary.

1. **Seed** the act's gaps in the ledger from the act guide, marking any the user's material already closes (with the source).
2. **Ask** one AskUserQuestion batch of 1 to 4 questions about the most important open gaps. Every question has 2 to 4 concrete options drawn from what you know (an "Other" answer is always possible). Never ask about something the user already answered.
3. **Record** each answer in the ledger at once: closed (with the answer, in the user's words), still open, or proposed as an assumption.
4. **Follow up** on a weak answer in the next batch, naming what is missing:
   - an adjective without a number ("fast", "lots of users"): ask for a target, or what failure looks like;
   - an unnamed person or group ("the business", "ops"): ask who, and what they decide;
   - a missing motive: ask why now, and what happens if nothing is done;
   - an unstated constraint: ask about budget, deadline, team, regulation, existing systems;
   - a decision without an alternative: ask what else was considered and why it lost.
5. **Name contradictions**: when two answers conflict, quote both in the next batch and ask which holds (options: the first, the second, both under a stated condition). Record the resolution.
6. **Assumptions**: when the user cannot answer, propose a labelled assumption (`A<n>: <statement>`, with why it is plausible) and ask the user to accept, change or reject it. Accepted ones go to the ledger and to `04-assumptions.md`; every assumption carries into Act 3's risks.
7. **Leave the act** only when no gap is open. Show a confirmed summary (the act guide's checklist, in a few short paragraphs) and ask for confirmation with options: confirm, correct a point, add something.
8. **Write** the confirmed act to its part from the template, mark it confirmed in the ledger, and only then start the next act. The parts are the interview state: a stopped interview resumes from them.

Keep batches small and the user in control: never more than four questions, never a raw dump of panel output.

## Act 1: Setup

Establish the business problem and its context, why the business is doing this and why now, the stakeholders and major players (named roles, what each needs and decides), the scope and its edges, and a common vocabulary (terms the narrative will use, each defined once). Write `00-front-matter.md` (the agreed schema: `system`, `audience`, `date`, `status: draft`, then the H1) and `01-setup.md`.

## Driving characteristics

After Act 1 is confirmed and before the panel is named:

1. From [references/characteristics-catalogue.md](references/characteristics-catalogue.md), propose candidates, each tied to an Act 1 statement.
2. Narrow them with the user to about three, never more than five. Each kept characteristic needs the **business requirement** it serves (quoted from the user's answers) and a **measurable target**. A characteristic without both stays a gap; a candidate that lost is recorded with the reason.
3. The user confirms the list. Save it in the ledger; it is written into `02-confrontation.md` in Act 2.

## The expert panel

[references/panel-guide.md](references/panel-guide.md) has the detail; the role briefs are in [references/experts/](references/experts/).

1. **Name the panel**: one expert per driving characteristic, plus an End-User expert and a Business expert.
2. **Propose the synergy/conflict map**: for every pair, synergy, conflict or neutral, with a one-line reason (for example: Scalability and Cost in conflict, because horizontal scale-out raises the run cost the Business expert caps). Ask the user to confirm or correct it, then save the panel and the confirmed map in the ledger. Rebuttals reach only experts in synergy or conflict.
3. **Run the panel** with the saved workflow `.claude/workflows/narrative-panel.js`, using the Workflow tool and its `scriptPath`. Invoking this skill is the opt-in. Build the arguments as the panel guide shows:

   | When | `phase` | `parts` |
   | --- | --- | --- |
   | Act 1 confirmed, characteristics and map confirmed | `questions` | `01-setup.md` |
   | Act 2, once the alternatives are stated | `alternatives` (with `alternatives`) | `01-setup.md`, `02-confrontation.md` |
   | Act 3 drafted | `review` | `01-setup.md`, `02-confrontation.md`, `03-resolution.md` |

   If the result is `{ invalid: [...] }`, fix the arguments and run it once more. Name any expert listed as `returned nothing` to the user. Record each round in the ledger (phase, date, what it changed).
4. **Use the output, never dump it**: merge and deduplicate the experts' questions into the next AskUserQuestion batches (the high-priority ones first, attributed by role only when that helps the user answer); turn alternative verdicts into the trade-off discussion; turn review objections into revisions, risks or open questions that the narrative shows (see Act 3). If the Workflow tool is unavailable, say so, and ask the experts' standing questions from the briefs yourself.

## Act 2: Confrontation

Establish the business and technical constraints, the unique challenges, the driving characteristics (with requirement and target) and the alternatives considered. Every major decision Act 3 will make needs at least two alternatives here, each with its trade-offs against the driving characteristics; run the `alternatives` panel round on them. Write `02-confrontation.md` when confirmed.

## Act 3: Resolution

Draft the proposed architecture and confirm it with the user in batches:

- **Diagrams**: one `.mmd` file per Mermaid diagram in the part directory (at least a context or container view), included in a part with a line `<!-- diagram: <name>.mmd -->`.
- **Decisions**: one short inline ADR summary per major decision: context, decision, consequences, status, and the rejected alternative with why it lost. If the user pointed you at a `docs/decisions/` folder, search it for an equivalent record and link it from the summary. For a decision worth a real record, offer the `adr-draft` skill (in this repository) rather than writing the ADR yourself.
- **Risks**: a table of risks with likelihood, impact and mitigation; every assumption appears as a risk or is explained away.

Run the `review` panel round on the draft. Each expert signs off or objects; settle every objection with the user as a revision to a part, a risk in the table, or an open question listed in the narrative. Then write `03-resolution.md` and `04-assumptions.md`, and `05-panel.md` only if the user asked for the appendix (sign-offs and objections with their outcomes, by role).

## Quality checks before stitching

Run these on the parts in every mode before stitching, and report each as passed or failed. A failure goes back to the user as a question batch, not a silent fix.

**Any failed check blocks the stitch**, however minor it looks: one undefined term or one target without a number is enough, and a request to "just restitch" does not lift it. Do not stitch while a question about a check is open. Stitch only when every check passes, after the user's answers are written into the parts, or when the user explicitly accepts a failure. Offer accepting as one of the options, record each accepted failure in the ledger's "Accepted check failures" table (check, what failed, date, the user's words), and report it as accepted rather than passed. If the user does not answer, stop without stitching and say which checks are open.

1. Every driving characteristic traces to a stated business requirement and a measurable target.
2. Every major decision names at least one rejected alternative.
3. Act 3 has both the solution (diagrams, decisions) and risks with likelihood, impact and mitigation.
4. Every expert's concern appears somewhere: a revision, a risk, an accepted risk or an open question.
5. Every assumption is labelled (`A<n>`) and listed in `04-assumptions.md`.
6. Act 1's vocabulary is used consistently: no synonyms for defined terms, no undefined terms in Acts 2 and 3.
7. The front matter has only the agreed keys; parts `01` to `05` start at H2 (the H1 is in `00-front-matter.md`).

## Stitch and finish

Stitch only once the quality checks pass or their failures are accepted (see above).

- keep-parts and stitch-only: `just tools narratives <system>`; then `just tools narratives --check` passes.
- build: `just tools narratives --remove-parts <system>`, which stitches without the generated note and removes the parts and the ledger, keeping `slides.md` if it exists.
- Set `status: final` only when the user says the narrative is final.
- In this repository, deliver like any docs change: a branch from fresh `origin/main` and a PR (`just check` passes). An edit to a stitched file whose parts are kept fails `just check`: move the edit into the parts and restitch.

## Slides

Draft `docs/narratives/<system>/slides.md` from the confirmed parts with [references/templates/slides.md](references/templates/slides.md): a title slide, one section per act (its key points, not its prose), the driving characteristics with their targets, each diagram copied in as a fenced `mermaid` block from its `.mmd` file, the decisions as one line each, and the top risks. Show the outline to the user before writing it. Write `slides.md` as plain Slidev Markdown with no `theme`, `fonts` or `favicon` (the site build applies the Calendar theme; `docs/narratives/README.md`). In the same change, set `slides: slides/<system>/` in `00-front-matter.md` and restitch: the docs build fails when a narrative and its deck do not link each other. Build the deck locally with `just docs slides <system>` and present it with `just docs slides-dev <system>` (ADR-0060). The deck is a draft and can lag later edits to the parts; redraft it on request.
