---
status: accepted
date: 2026-11-02
decision-makers: mgasca, Claude (AI assistant)
---

# Derive the decision log from the ADR files instead of an index table

## Context and Problem Statement

[ADR-0000](0000-use-markdown-architectural-decision-records.md) put a table in `docs/decisions/README.md` with one row per ADR (number, title, status), and [ADR-0023](0023-static-adr-log-publication.md) made that table the ordered log the documentation site renders and navigates by. Every ADR PR adds a row, every status change edits a row, and `just tools adr` and the docs build both compare each ADR file with its row. With several ADRs in flight the branches conflict on adjacent rows: of the 112 merges on `main`, 25 touched the table, and story [0010](../stories/0010-sweep-pending-adrs-to-a-decided-status.md) records a hand-resolved conflict that silently dropped a row (issue #184). Meanwhile the site already lists every ADR with its status badge in the left navigation, so the table no longer carries anything the files do not. Where should the decision log come from?

## Decision Drivers

* **D1 No conflicts between ADRs in flight**: an ADR PR, or a status change, should touch only its own file, so parallel decisions merge without a hand resolution that can lose a row.
* **D2 One source of truth**: a record's number, title and status should each live in one place, so they cannot disagree.
* **D3 Navigable log**: people and agents can still see the whole log in order, with statuses, on GitHub and on the site ([ADR-0023](0023-static-adr-log-publication.md)'s "navigable records").
* **D4 Build integrity**: a duplicate number, a record without a title or a status, or a stale entry elsewhere fails `just check`, instead of a record quietly going missing.
* **D5 Little tooling change**: fits the existing validator ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)) and docs loader ([ADR-0023](0023-static-adr-log-publication.md)) without a new tool or a generated artifact to keep in step.

## Considered Options

* Derive the log from the files; `README.md` keeps only the conventions
* Keep the hand-maintained table
* Generate the table into `README.md` with a tool and commit it
* Move the log to a machine-readable list and render from it

## Decision Outcome

Chosen option: "Derive the log from the files; `README.md` keeps only the conventions", because it removes the one file every ADR PR had to edit (D1), leaves the number in the file name, the title in the H1 and the status in the front matter as the only copies (D2), keeps the log readable on the site and with `ls docs/decisions` (D3), lets the docs build fail on a duplicate number or a record without a status (D4), and removes code from both the validator and the loader instead of adding any (D5).

| Driver | **Derive the log from the files (chosen)** | Keep the hand-maintained table | Generate and commit the table | Machine-readable list |
| --- | :---: | :---: | :---: | :---: |
| D1 No conflicts between ADRs in flight | ★★★ | ☆☆☆ | ★☆☆ | ★☆☆ |
| D2 One source of truth | ★★★ | ★☆☆ | ★★☆ | ★☆☆ |
| D3 Navigable log | ★★☆ | ★★★ | ★★★ | ★★☆ |
| D4 Build integrity | ★★★ | ★★★ | ★★★ | ★★☆ |
| D5 Little tooling change | ★★★ | ★★★ | ★☆☆ | ★★☆ |

### What the log is

* The decision log is the set of `docs/decisions/NNNN-*.md` files, ordered by number. The file name gives the number, the single `# Title` gives the title and the front matter `status` gives the status, exactly as the validator already requires.
* `docs/decisions/README.md` holds the conventions and says where to browse the log. It has no list of records.
* The documentation site builds the **Any decision records** navigation from the files: every record in number order, with its status badge. Since PR #183 the site has no ADR Log page of its own; the navigation is the log.
* `just tools adr` keeps every rule except the index row: contiguous numbering, no stray files, front matter, section order, drivers, rating tables, pros and cons, and links.
* The architecture model ([ADR-0039](0039-architecture-model-and-visualization-tooling.md)) still lists every ADR in `metadata.adrs`, and the docs build still fails when an entry's file, title or status differs from the ADR file. That list stays a per-ADR edit, by the decision recorded in story [0012](../stories/0012-architecture-visualization-on-the-documentation-site.md), so a conflict there remains possible; it is a JSON array with one line per ADR, and the loss of a line fails the build instead of passing silently.

This replaces the first bullet of the "Source and navigation contract" in [ADR-0023](0023-static-adr-log-publication.md) and the words "and the index" in the confirmation of [ADR-0000](0000-use-markdown-architectural-decision-records.md). Both decisions otherwise stand.

### Consequences

* Good, because **D1 No conflicts between ADRs in flight**: a new ADR or a status change edits the ADR file and its model entry, and nothing that another ADR PR edits in the same place.
* Good, because **D2 One source of truth**: the validator and the loader have one less cross-check to perform, because there is one less copy.
* Good, because **D5 Little tooling change**: the change removes the index rule from the validator and the table parser from the loader.
* Bad, because **D3 Navigable log**: GitHub's rendering of `docs/decisions/README.md` no longer lists the records. The folder listing, sorted by number, and the site's navigation take its place.
* Bad, because **D3 Navigable log**: the hand-written row linked a `superseded by` status to the superseding record; the navigation badge only says `superseded`. The record's own **Status** line carries the link.
* Neutral: the story, runbook and benchmark indexes keep their tables, because they carry information the documents do not (delivery order, one-line summaries, harness paths).

### Confirmation

* `just tools adr` passes with no table in `README.md` and still rejects a numbering gap, a stray file and every structural fault (its tests in `.claude/skills/adr-draft/tests/`).
* The docs tests (`frontend/apps/docs/src/lib/adr.test.ts`) show that `parseLog` orders records by number from the files alone and rejects a duplicate number, an unsafe file name, a missing title and a missing status; `corpus.test.ts` loads the real `docs/decisions` through the loader.
* The build test (`frontend/apps/docs/tests/build.test.ts`, `published ADRs`) checks that each record's page carries the sidebar in log order.
* A reviewer confirms that the **Any decision records** navigation of the pull-request preview lists every record with its status.

### Amendment, 2026-11-06: discover all document collections from files

Approved by the maintainer in [issue #346](https://github.com/mgasca/calendar/issues/346). The same conflict-avoidance and single-source drivers now apply to every documentation area. This supersedes the earlier consequence that story, runbook and benchmark indexes retain tables, and the index requirements for those collections in [ADR-0023](0023-static-adr-log-publication.md). README files contain conventions only. Stories use their existing title and front matter; benchmarks store `subject` and `harness` in front matter; agent thoughts store `date`, `author` and `revision`; runbooks store a unique positive integer `order` to preserve the operational sequence. Numbered collections sort by filename. The site still publishes conventions pages and derives its navigation from the discovered files. Validation retains duplicate-number, metadata, harness-existence and broken-link checks without requiring a shared inventory row.

## Pros and Cons of the Options

### Derive the log from the files; `README.md` keeps only the conventions

* Good, because **D1 No conflicts between ADRs in flight**: no shared file is edited per ADR.
* Good, because **D2 One source of truth**: file name, H1 and front matter are the only copies, and they are already what the validator checks.
* Good, because **D4 Build integrity**: the loader fails on a duplicate number, a file without a title or a status, and the model check fails on a stale entry.
* Good, because **D5 Little tooling change**: the validator loses one rule and the loader loses one parser.
* Bad, because **D3 Navigable log**: the GitHub view of the folder's `README.md` no longer lists the records; the folder listing and the site do.

### Keep the hand-maintained table

* Good, because **D3 Navigable log**: the table is readable on GitHub, with a link per record and a link in each `superseded by` status.
* Good, because **D4 Build integrity**: the validator and the loader cross-check every row against its file.
* Good, because **D5 Little tooling change**: nothing changes.
* Bad, because **D1 No conflicts between ADRs in flight**: every ADR PR and every status change edits adjacent rows of one file; 25 of 112 merges touched it, and one hand resolution dropped a row.
* Bad, because **D2 One source of truth**: title and status exist twice, and the cross-checks exist only to catch the disagreement.

### Generate the table into `README.md` with a tool and commit it

* Good, because **D3 Navigable log**: GitHub keeps the table.
* Good, because **D4 Build integrity**: CI can fail when the committed table is stale, as it does for `contracts/openapi.json`.
* Neutral, because **D2 One source of truth**: the table is derived, but a committed copy can still be stale until CI says so.
* Bad, because **D1 No conflicts between ADRs in flight**: the generated file still changes in every ADR PR, so the conflicts remain, even if they are resolved by regenerating.
* Bad, because **D5 Little tooling change**: a new file-based app ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)), a `just` recipe and a staleness check in CI, for a table nobody edits.

### Move the log to a machine-readable list and render from it

* Neutral, because **D3 Navigable log**: the site renders the list, but a JSON or YAML file is not a readable log on GitHub.
* Neutral, because **D4 Build integrity**: the list can be validated against the files, as the architecture model's `metadata.adrs` already is.
* Neutral, because **D5 Little tooling change**: the architecture model already has such a list, but the loader would still need to be pointed at it.
* Bad, because **D1 No conflicts between ADRs in flight**: a list with one entry per ADR is the same shared file under another name.
* Bad, because **D2 One source of truth**: title and status would again exist outside the ADR file.

## More Information

* Issue #184 and story [0013](../stories/0013-derive-the-decision-log-from-the-adr-files.md) track the change; the removal, the validator and loader changes and this record ship in one PR, where the maintainer accepted the decision on 2026-11-02.
* Related: [ADR-0000](0000-use-markdown-architectural-decision-records.md) (format and validator), [ADR-0023](0023-static-adr-log-publication.md) (the site builds the log from the canonical files), [ADR-0028](0028-publish-user-stories-on-the-documentation-site.md) (the story index keeps its table), [ADR-0039](0039-architecture-model-and-visualization-tooling.md) (the model's ADR list).
* The counts above were measured with `git log --first-parent` and `git log -- docs/decisions/README.md` on 2026-11-02.
* Revisit if the architecture model's `metadata.adrs` list turns out to conflict as often as the table did; the remedy would be to derive that list from the files too, and keep only the per-element references in the model.
* **Amendment, 2026-11-06:** every document collection, not only the decision log, is discovered from its files, and the README files keep only their conventions; approved in issue #346 and delivered by PR #353. The chosen option is unchanged and its scope is wider, so this ADR was amended, not superseded.
