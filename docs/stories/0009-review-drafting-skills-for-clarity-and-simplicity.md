---
status: planned
date: 2026-10-30
issue: https://github.com/mgasca/calendar/issues/139
pr:
  - https://github.com/mgasca/calendar/pull/140
adrs: ["0017"]
---

# 0009 Review the adr-draft and story-draft skills for clarity and simplicity

## Story

> As a maintainer who relies on the drafting skills, I need the `adr-draft` and `story-draft` skills to be clear and simple to follow, so that an agent or a person can draft an ADR or a story card correctly without guessing or reading text that changes nothing they do.

Tracked in issue #139. Card PR: [#140](https://github.com/mgasca/calendar/pull/140).

## Background

The two skills, `.claude/skills/adr-draft/SKILL.md` (190 lines) and `.claude/skills/story-draft/SKILL.md` (134 lines), were written and extended one fix at a time. They have not had a pass focused on readability. The same kind of review has already been done for the runbooks ([0008](0008-review-runbooks-for-clarity-and-simplicity.md)); this story reuses that approach, through the `tech-doc-review` skill where it fits.

Clarity and simplicity can compete. More explanation makes a step clearer but the skill longer; fewer words and steps can leave gaps that an agent fills with a guess. This story reviews each `SKILL.md` with both goals in mind and records the trade-offs.

### Agreed scope

* **Two files under review:** `.claude/skills/adr-draft/SKILL.md` and `.claude/skills/story-draft/SKILL.md`.
* **Both goals:** each file is read as a first-time user of the skill and updated for clarity and for simplicity. Each time the goals conflict, the trade-off and how it was resolved are recorded on the issue, and then in this card.
* **One review PR per skill:** each PR is published as soon as that skill's review finishes, so the reviewer can start early. Before a PR merges, only the updated `SKILL.md` remains, under its original name.
* **Rules stay the same:** every convention the skills encode (for example the ADR star-rating table, driver-tagged pros and cons, the stories index update, the front matter rules) stays, and so do the validation commands and the PR flow.
* **Trigger behaviour is kept:** the `description` in each skill's front matter still makes the skill trigger for the same requests, unless the reviewer approves a change.

### Not in this story

* Changes to the ADR or story conventions themselves, to `docs/stories/story-template.md`, to existing ADRs, or to the validation tooling (`adr.ts`, the `adr-draft` scripts). A rule that turns out to be wrong gets its own issue.
* Changes to the `tech-doc-review` skill, or to other skills.
* New skills.

### Dependencies

None. The review should come after PR [#138](https://github.com/mgasca/calendar/pull/138) (the `tech-doc-review` skill) merges, if the skill's approach is used.

### Open questions (to confirm in review of this card)

* **Writing style (proposed):** the skills are instructions for an agent, so use plain, short, direct sentences, but do not apply the full `simple-english` rules. A skill's rationale ("why") sentences are kept where an agent would otherwise get a rule wrong.
* **Shared text (proposed):** where the two skills repeat the same text (the PR flow, validation, the "never push to `main`" rule), keep each skill self-contained, but make the wording match. Do not extract a shared file.

### Acceptance criteria

1. **Given** a skill under review, **when** its PR is opened, **then** the PR shows the original and the updated `SKILL.md` as a reviewable diff, and the PR description lists the trade-offs between clarity and simplicity and how each was resolved.
2. **Given** an updated `SKILL.md`, **when** it is compared with the original, **then** every rule, command, path and validation step in the original is still present, or the PR description lists it as removed with the reason.
3. **Given** an updated `SKILL.md`, **when** it is compared with the original, **then** it is not longer than the original unless the PR description explains each addition.
4. **Given** each updated skill, **when** it is used on a sample request (an ADR draft for `adr-draft`, a story card draft for `story-draft`), **then** the result passes the same validation as before (`just adr-check` for ADRs, the docs-site tests for story cards).
5. **Given** the `description` front matter of an updated skill, **when** it is read, **then** it still names the same triggering requests, or the PR description says what changed and why.
6. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling is .NET file-based apps, with analyzers and tests per folder | The `adr-draft` folder holds scripts and tests next to `SKILL.md`. Edits to the skill must keep the paths and commands those scripts use correct. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Rules are fixed:** only wording, order, structure and explanation change. A change to what a skill requires is out of scope.
* **Review drafts are temporary:** any extra draft files exist only while a PR is in review, as in story 0008.
* **One skill per PR:** this keeps each diff small enough to review, and lets the first skill's lessons inform the second.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| ADR skill | `.claude/skills/adr-draft/SKILL.md` |
| Story skill | `.claude/skills/story-draft/SKILL.md` |
| Review approach | `.claude/skills/tech-doc-review/SKILL.md` |

### API

No changes.

### Testing

* The docs-site tests (`corepack pnpm --dir frontend --filter @calendar/docs test`) and `just adr-check` still pass.
* A sample ADR and a sample story card are drafted with each updated skill and validated (criterion 4). The samples are not committed.
* There is no automated test of the skill text itself; criteria 1, 2, 3 and 5 are checked by reading the diff.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### The task the user performs

Ask for an ADR or a story card as before ("draft an ADR for X", "write a story from issue N"). The skills behave the same way; their instructions are shorter and clearer, so the result should need fewer corrections.
