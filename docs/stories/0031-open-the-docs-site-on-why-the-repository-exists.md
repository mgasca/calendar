---
status: in-progress
date: 2026-11-06
issue: https://github.com/mgasca/calendar/issues/332
pr:
  - https://github.com/mgasca/calendar/pull/335
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

*Planned. This section is completed as the story is built.*

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Reading the agent thoughts

Open the documentation site: it starts on the first agent thought, which explains why the repository exists. The **Agent thoughts** group, just below **Architecture** in the left nav, lists every report; **All agent thoughts** shows each one's date, author and the revision it reviewed. Read the date and revision before treating a report's observations as current.
