---
status: implemented
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/332
pr:
  - https://github.com/mgasca/calendar/pull/335
  - https://github.com/mgasca/calendar/pull/336
  - https://github.com/mgasca/calendar/pull/337
adrs: ["0028", "0040"]
---

# 0031 Open the docs site on why the repository exists

## Story

> As someone opening the documentation site, I need it to start with why the repository exists and to list the agent thoughts beside the architecture, so that I understand the purpose of the work before its details.

Requested by the owner in conversation and recorded on issue #332.

## Background

[Story 0029](0029-preserve-independent-perspectives-on-our-work.md) added `docs/agent-thoughts/`: dated, attributed agent perspectives on the repository, starting with the report on its purpose and value. That story kept the reports as repository Markdown and left publishing them on the site out of scope. Today the site opens on the architecture overview, and a reader who never opens the repository never sees the reports.

The owner asked for the agent thoughts to be published the same way as the other docs folders, with their own group in the left nav just after **Architecture**, and for the first report, which explains why the repository exists, to be the site's landing page. Agent thoughts have no template.

### Agreed scope

* **A collection like the others:** the site publishes `docs/agent-thoughts/`, with the folder's `README.md` as the index page at `agent-thoughts/` and each report at `agent-thoughts/NNNN/`. Each report page shows its date, author and reviewed revision from the index, and its **Edit page** link points at the Markdown.
* **The index is checked:** the build fails on a report missing from the index, an index row without its file, link text that differs from the report's single `#` title, a malformed date, a duplicate, rows out of number order, or a link to a report that is not published, as it does for the benchmark records.
* **Navigation:** an **Agent thoughts** group directly after **Architecture**, with "All agent thoughts" and one entry per report in index order. **Architecture** stays first.
* **Landing page:** the site root redirects to the first report in the index instead of the architecture overview. The target comes from the folder, not from a hard-coded number.
* **Guidance:** the agent-thoughts README says the reports are published and how the index is checked; the root `AGENTS.md`, the docs app `README.md`, the site description and the architecture model's docs-site entry list the folder.

### Not in this story

* A template for agent thoughts, or `XXXX` placeholders for unscheduled reports.
* Changes to the reports themselves, or a second report.
* A favicon, or changes to the header's GitHub link: Starlight already shows GitHub's mark at the top right, linking to the repository, and the owner accepted it.

### Acceptance criteria

1. **Given** the agent thoughts in `docs/agent-thoughts/`, **when** the site is built, **then** the index is published at `agent-thoughts/` and every report at `agent-thoughts/NNNN/`, with its date, author and reviewed revision, its links resolved to site routes, and an **Edit page** link to its Markdown.
2. **Given** any page of the site, **when** the left nav is read, **then** **Agent thoughts** is the group directly after **Architecture**, and lists "All agent thoughts" and every report in index order.
3. **Given** a report missing from the index, an index row without a file, a title that differs from its link text, a malformed date, a duplicate or rows out of order, **when** the site is built or the docs tests run, **then** they fail and name the file.
4. **Given** a reader opening the site root, **when** the page loads, **then** it redirects to the first report in the index.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md) | Publish stories from their canonical Markdown, validated against their index | Agent thoughts follow the same pattern, as the runbooks and benchmark records did |
| [0040](../decisions/0040-derive-the-decision-log-from-the-adr-files.md) | Derive the decision log from the files | The landing page is derived from the folder too, not hard-coded |

No new ADR is expected: the site gains one more folder in an established pattern.

### Other decisions (not ADR-worthy)

* **The index table is the source of order:** rows must be in number order, so "the first report" means the same thing in the index, the nav and the landing page.
* **A redirect, not a copy:** the root redirects to the report's own page, so the report has one URL and the page keeps its nav, as the root redirect to the architecture overview did.

## Implementation notes

Delivered in the PRs listed in the front matter: the card, the collection with its nav group, then the landing page. All three were stacked on #331, which added the folder and its first report.

### Where things live

| Area | Location |
| --- | --- |
| Index parser and its rules | `frontend/apps/docs/src/lib/adr.ts` (`parseAgentThoughts`, and the unpublished-link rule) |
| Pages, routes and edit links | `frontend/apps/docs/src/lib/docs-loader.ts` (`readAgentThoughts`, the `agent-thoughts` entries) |
| Nav group and landing redirect | `frontend/apps/docs/astro.config.ts` |
| Conventions and index | [`docs/agent-thoughts/README.md`](../agent-thoughts/README.md) |

### API

No changes.

### Testing

* **Criterion 1:** the publication check "renders every report with navigation, its date, author, revision and edit link" in `frontend/apps/docs/tests/build.test.ts`, derived from the folder; the corpus test "reads every report in number order" in `src/lib/corpus.test.ts`; link routing in "agent thought links" in `src/lib/adr.test.ts`.
* **Criterion 2:** "puts the Agent thoughts group directly after Architecture in the sidebar". Negative control: with the group moved to the end of the sidebar it failed with `expected '/adr/0000/' to be '/agent-thoughts/'`, and passed once the saved config was restored.
* **Criterion 3:** the rejection cases of "canonical agent thoughts index" in `src/lib/adr.test.ts`: missing table, empty index, missing file, unlisted report, duplicate, rows out of order, title differing from the index, title without the number, two titles, malformed row, `XXXX` placeholder, malformed date, missing author and a revision that is not a commit.
* **Criterion 4:** "redirects to the first agent thought and lists Architecture first in the sidebar", checked at the root path and at a project subpath. Negative control: with the old redirect to the architecture overview it failed, and passed once the saved config was restored.

### Lessons learned, known issues and follow-ups

* **A negative control must rebuild what it tests.** The first control of the redirect ran against a build left at a project subpath, after a failed edit had skipped the rebuild, and failed for that reason instead. It was redone with a rebuild at the root path; check the built output, not only the test result.
* **Read only what a check needs.** The performance review found the two new publication checks reading the whole corpus to get the report list, about half a second each. They use `readAgentThoughts()` instead; measured on one build, the publication checks took 3.6 s instead of 4.0 to 4.5 s (alternating A, B, A, B). CI runs them three times per Docs site job.
* **Stacked on another story's open PR.** The folder and its first report arrived with #331 (story 0029), so this story's PRs were stacked on it and are retargeted as it merges.

## User guide

### Reading the agent thoughts

Open the documentation site: it starts on the first agent thought, which explains why the repository exists. The **Agent thoughts** group, just below **Architecture** in the left nav, lists every report; **All agent thoughts** shows each one's date, author and the revision it reviewed. Read the date and revision before treating a report's observations as current.
