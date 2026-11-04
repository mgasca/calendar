---
status: implemented
date: 2026-11-02
issue: https://github.com/mgasca/calendar/issues/184
pr:
  - https://github.com/mgasca/calendar/pull/185
adrs: ["0000", "0017", "0023", "0039", "0040"]
---

# 0013 Derive the decision log from the ADR files

## Story

> As a contributor, whether a person or an agent, I need an ADR pull request to touch only its own record, so that several decisions can be in flight at once without their branches conflicting on a shared index table, and without a hand resolution ever dropping a record from the log.

Tracked in issue #184. Card, [ADR-0040](../decisions/0040-derive-the-decision-log-from-the-adr-files.md) and the change itself ship in one PR: [#185](https://github.com/mgasca/calendar/pull/185).

## Background

`docs/decisions/README.md` carried a hand-maintained table with one row per ADR (number, title, status), introduced by [ADR-0000](../decisions/0000-use-markdown-architectural-decision-records.md) and made the ordered log of the documentation site by [ADR-0023](../decisions/0023-static-adr-log-publication.md). Every ADR PR added a row and every status change edited one; `just tools adr` and the docs build both compared each ADR file with its row. Of the 112 merges on `main`, 25 touched the table. Story [0010](0010-sweep-pending-adrs-to-a-decided-status.md), which changed four ADR statuses in parallel PRs, hit a conflict whose hand resolution dropped a row, caught only in review.

The table had stopped carrying information of its own. The documentation site lists every ADR with its status badge in the **Architecture decisions** navigation, the file name gives the number, the `# Title` gives the title and the front matter gives the status, and the architecture model ([ADR-0039](../decisions/0039-architecture-model-and-visualization-tooling.md)) lists every ADR with its status too.

### Agreed scope

* **Remove the table** from `docs/decisions/README.md`, keeping the conventions text and saying where the log is browsed.
* **The log is derived from the files.** The docs site orders the `NNNN-*.md` files by number, takes the title from the H1 and the status from the front matter, and builds the left navigation from them. The site has no ADR Log page since PR #183 removed it; the navigation is the log.
* **The checks stay strict.** The docs build fails on a duplicate number, a file name that is not `NNNN-kebab-title.md`, a record without a single H1 or without a `status`, and on an architecture model entry whose file, title or status differs from the ADR file. `just tools adr` drops only the index-row rule.
* **An ADR records the decision** ([ADR-0040](../decisions/0040-derive-the-decision-log-from-the-adr-files.md)), because it changes a clause of [ADR-0023](../decisions/0023-static-adr-log-publication.md) and of [ADR-0000](../decisions/0000-use-markdown-architectural-decision-records.md).
* **Guidance follows:** `AGENTS.md`, the `adr-draft` and `story-draft` skills, and the architecture model.

### Not in this story

* **The story, runbook and benchmark indexes.** Their tables and list carry information the documents do not (delivery order, summaries, harness paths), and they stay as they are.
* **Deriving the architecture model's `metadata.adrs` list from the files.** It stays a per-ADR edit by the decision in story [0012](0012-architecture-visualization-on-the-documentation-site.md); ADR-0040 names it as the revisit trigger.
* **A link from a `superseded by` status to the superseding record in the navigation.** The badge says `superseded`; the record's own page keeps the link.

### Acceptance criteria

1. **Given** `docs/decisions/README.md`, **when** I read it, **then** it has no table of records, and it says where to browse the log.
   Checked by reading the file. The site no longer reads it at all, and no test asserts the absence of the table.
2. **Given** the `NNNN-*.md` files, **when** the docs site is built, **then** the **Architecture decisions** navigation lists every record in number order with its status.
   [`adr.test.ts`](../../frontend/apps/docs/src/lib/adr.test.ts) (`orders by number whatever the order of the sources`); [`build.test.ts`](../../frontend/apps/docs/tests/build.test.ts) (`published ADRs`: each page's sidebar lists every record in log order).
3. **Given** two files with the same number, a file name outside the convention, or a record without a title or a status, **when** the docs build runs, **then** it fails and names the file.
   [`adr.test.ts`](../../frontend/apps/docs/src/lib/adr.test.ts) (`rejects duplicate number`, `unsafe filename`, `uppercase filename`, `missing status`, `empty status`, `two titles`, `no title`).
4. **Given** an ADR whose title or status changes without its architecture model entry, **when** the docs build runs, **then** it fails.
   Already enforced by [`architecture.test.ts`](../../frontend/apps/docs/src/lib/architecture.test.ts) (`rejects …` for ADR file, title and status drift) and `corpus.test.ts` on the real model; unchanged by this story.
5. **Given** `just tools adr`, **when** it runs with no table in `README.md`, **then** it passes, and it still rejects a numbering gap, a stray file and every structural fault.
   [`check-adr.tests.cs`](../../.claude/skills/adr-draft/tests/check-adr.tests.cs) (`ReadmeWithoutAnIndexTable_IsNotAnAdrAndNotStray`, `NumberingGapAndStrayFiles_AreReported`, `BrokenRule_IsReported`). The validator could not run on the implementing agent's machine (its SDK rejects `#:include`); the CI `Tooling` job is the check.
6. **Given** the change is complete, **when** `just check` runs, **then** it passes.
   CI runs every part of `just check` on the PR. Locally the agent ran the frontend gates (`format:check`, `lint`, `typecheck`, `test`) and `just docs build`; see the implementation notes for what did not run.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0000](../decisions/0000-use-markdown-architectural-decision-records.md) | MADR ADRs in `docs/decisions`, validated by `just tools adr` | The validator's index rule is the one this story removes; every other rule stays. |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling scripts are .NET file-based apps | The validator change is made in `AdrValidator.cs` and its xUnit tests, not in a new tool. |
| [0023](../decisions/0023-static-adr-log-publication.md) | The site builds the log from the canonical Markdown | Its first contract bullet named the README rows as the log; ADR-0040 replaces that bullet, the rest stands. |
| [0039](../decisions/0039-architecture-model-and-visualization-tooling.md) | FINOS CALM model with every ADR listed | The model's ADR list becomes the only per-ADR entry outside the record, and the build keeps checking it against the files. |
| [0040](../decisions/0040-derive-the-decision-log-from-the-adr-files.md) | Derive the decision log from the ADR files | The decision this story implements. |

[ADR-0040](../decisions/0040-derive-the-decision-log-from-the-adr-files.md) is the new ADR this story needed. It was drafted in the same PR as this card.

### Other decisions (not ADR-worthy)

* **No generated table on the site.** A first version rendered the log as a table on the ADR Log landing page, but PR #183 removed that page while this PR was open (the site now opens on Architecture), so the navigation is the only list and the loader stops reading `README.md` altogether.
* **`README.md` stays in `docs/decisions`** as the conventions page and the landing page body. The validator still knows the name only to exclude it from the stray-file check.
* **ADR-0039 was added to the architecture model** while adding ADR-0040, because the model is meant to list every ADR and it did not.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Conventions page, without the table | `docs/decisions/README.md` |
| Log derived from the files | `frontend/apps/docs/src/lib/adr.ts` (`parseLog`) |
| Navigation | `frontend/apps/docs/src/lib/docs-loader.ts` (`readLog`) |
| Validator without the index rule | `.claude/skills/adr-draft/scripts/check-adr/AdrValidator.cs`, `check-adr.cs`, `tests/` |
| Guidance | `AGENTS.md`, `.claude/skills/adr-draft/SKILL.md` (step 7 is now the architecture model entry), `.claude/skills/story-draft/SKILL.md` |
| Model entries for ADR-0039 and ADR-0040 | `docs/architecture/calendar.architecture.json` (`metadata.adrs`) |

### API

No changes.

### Testing

* [`adr.test.ts`](../../frontend/apps/docs/src/lib/adr.test.ts): the log from the files alone, ordering by number, the normalized `superseded by` status, and eight rejected inputs.
* [`corpus.test.ts`](../../frontend/apps/docs/src/lib/corpus.test.ts) and [`build.test.ts`](../../frontend/apps/docs/tests/build.test.ts) run against the real `docs/decisions` and the built site, unchanged.
* [`check-adr.tests.cs`](../../.claude/skills/adr-draft/tests/check-adr.tests.cs): the two index tests were removed and one test added for a `README.md` without a table.

### Lessons learned, known issues and follow-ups

* **Measured:** 25 of the 112 merges on `main` had touched the index table before this change (`git log -- docs/decisions/README.md`).
* **Not verified by the implementing agent:** `just tools adr` and the validator tests, because the local .NET SDK (10.0.114) rejects the `#:include` directive the tools use; the C# was compiled in a scratch project instead, and the CI `Tooling` job runs the real tests.
* **Follow-up:** if the architecture model's `metadata.adrs` list conflicts as the table did, derive it from the files too (the revisit trigger in ADR-0040).

## User guide

### Finding a decision

Open the documentation site and choose **Architecture decisions** in the sidebar. Every decision is listed in number order with its status badge; choose one to read it. In the repository, the decisions are the numbered files in `docs/decisions`, and `README.md` there explains the conventions.

### Adding or changing a decision

Add the record as `docs/decisions/NNNN-short-title.md` (the `adr-draft` skill does this) and add its entry to the architecture model. There is no index row to add or update: the number comes from the file name, the title from the `# Title` line and the status from the front matter, and the site and the checks read them from there.
