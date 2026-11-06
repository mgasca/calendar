---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/329
pr: ["https://github.com/mgasca/calendar/pull/330", "https://github.com/mgasca/calendar/pull/331"]
adrs: ["0028"]
---

# 0029 Preserve independent perspectives on our work

## Story

> As a calendar maintainer, I need independent agent perspectives on our work preserved alongside it, so that other people can understand its purpose and value and we can revisit our assumptions as the project develops.

Tracked in issue #329. The maintainer accepted this docs-only scope in conversation.

## Background

Calendar is primarily an exploration of AI-assisted engineering, with the idea of delivering a planning application providing meaningful delivery work. Its stories record agreed intent and delivery, while its decision records explain choices. An independent reading adds something different: an account of what the accumulated work communicates to someone encountering it afresh, including strengths, tensions and limits in the evidence.

The first assessment was requested for other people learning about the project. After reading it, the maintainer asked to preserve the full report, bringing architecture and documentation to positions 12–13 and reusable assets to 14 in its ordered table. Keeping that perspective in the repository makes it reviewable, discoverable and available for comparison with later assessments, rather than leaving it in a conversation.

This complements [0018](0018-preserve-transcript-insights.md) and [0025](0025-consolidate-what-agent-sessions-learned-into-guidance.md): those stories recover operational lessons; this one preserves an interpretive assessment. Independent perspective means a separate reading of the work, informed by the maintainer's stated motivation, not an external audit or an assertion of impartiality.

### Agreed scope

* **First report:** preserve the full agreed report as `docs/agent-thoughts/0001-repository-purpose-and-value.md`, with a title, date, author attribution, reviewed revision and assessment limitations.
* **Agreed ordering:** retain all 25 highlights, with architecture at 12, documentation at 13 and reusable assets at 14.
* **Discoverability:** add a short folder README explaining the purpose, numbered filenames and an index of reports; link the folder from the root README.
* **Repository purpose:** put a "Why does this repo exist?" section below the root README title, initially with literal `<Replace me>` for the maintainer's thoughts, followed by a direct attributed quote from the report. During review, replace the placeholder with the maintainer's welcome and original assessment prompt, preserving their wording, and keep the quotation aligned with the reviewed report.
* **Historical context:** keep the report's findings anchored to revision `914a6d15`; distinguish observations, interpretation and maintainer-supplied motivation. Adjust relative links for the report's location.
* **Docs-only delivery:** add this card and its index/model entries first, followed by a stacked report-delivery PR and completed card. Reports remain repository Markdown.

### Not in this story

* Publishing a new documentation-site collection or changing its implementation.
* Product changes, dependencies, tools, scheduled reviews or agent automation.
* Claiming an external audit, proven productivity gains, production reliability or user adoption.

### Acceptance criteria

1. **Given** a reader browsing the repository, **when** they open the agent-thoughts index, **then** they can find the first report and understand why perspectives are being captured.
2. **Given** the first report, **when** its table is read, **then** it contains 25 consecutively numbered highlights with architecture, documentation and reusable assets at positions 12, 13 and 14 respectively.
3. **Given** a reader assessing the report's claims, **when** they read its context and limitations, **then** they can identify its author, date, reviewed revision, maintainer-supplied motivation and checks that were not performed for the assessment.
4. **Given** the report in its new directory, **when** its repository links are followed, **then** they resolve to the intended existing documents.
5. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md) | Publish stories from their canonical Markdown | The story follows existing publication and link conventions; the reports remain repository documents linked from it. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Dated perspectives:** reports are snapshots, so later understanding can be compared without silently rewriting historical conclusions.
* **Separate collection:** the report is commentary, while this story records accepted scope and delivery. Separating them keeps their roles clear.
* **Provenance:** identify Codex as the author and record the maintainer's motivation and ordering requests; independence does not mean the report was written without input.

## Implementation notes

The report, collection index and repository navigation are delivered together in the documentation PR after the card PR #330. The report preserves the agreed prose and ordering, adding a title/provenance note and correcting links for its new location. Review on #331 revised its closing description to "the idea of delivering a planning application" and replaced the README placeholder with the maintainer's own welcome and original prompt. The README quotation matches that reviewed description, and the report's provenance records the editorial input.

### Where things live

| Area | Location |
| --- | --- |
| Report and index | `docs/agent-thoughts/` |
| Repository navigation | `README.md` |
| Story and index | `docs/stories/` |
| Story model entry | `docs/architecture/calendar.architecture.json` |

### API

No changes.

### Testing

Acceptance criteria 1–4 are checked by source review of the [collection index](../agent-thoughts/README.md), [report](../agent-thoughts/0001-repository-purpose-and-value.md) and [repository navigation](../../README.md): all 25 rows are consecutive, positions 12–14 match the request, the provenance and assessment limitations are explicit, and all four report links resolve to existing files. No new automated tests were added for static prose and navigation.

The card-only tree with PR #330 recorded passed `just docs test` (150 tests) and `JUST_TEMPDIR=/tmp just docs build` (120 pages; 9 publication checks). Final delivery-tree validation and the full `just check` result for criterion 5 are recorded in the delivery PR; the card-only result does not establish them.

### Lessons learned, known issues and follow-ups

The report's assessment limitations remain part of the preserved document. Later delivery checks do not retroactively turn that assessment into a runtime audit.

## User guide

Open **Agent thoughts** from the repository's layout table, then choose **Repository purpose and value**. Read the assessment date and revision before treating its observations as current. The report explains what the author found valuable and where the evidence remains limited.
