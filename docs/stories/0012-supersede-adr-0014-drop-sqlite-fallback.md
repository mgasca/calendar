---
status: implemented
date: 2026-11-01
issue: https://github.com/mgasca/calendar/issues/145
pr:
  - https://github.com/mgasca/calendar/pull/166
adrs: ["0014", "0015", "0031", "0037"]
---

# 0012 Supersede ADR-0014: drop the SQLite fallback

## Story

> As the maintainer, I need the SQLite budget fallback dropped from the architecture records, so that the docs, the PR template and the code agree that PostgreSQL is the only engine.

Tracked in issue #145. This card records work that was already delivered, so the card PR closes the issue.

## Background

[ADR-0014](../decisions/0014-postgresql-database-engine.md) chose PostgreSQL but kept "SQLite on a persistent volume with Litestream" as a budget fallback for production. The fallback was never used, production went to Azure PostgreSQL Flexible Server ([ADR-0031](../decisions/0031-azure-postgresql-flexible-server.md)), and the backend relies on PostgreSQL-only features (generated range columns with GiST indexes, partial indexes, `AT TIME ZONE`, `xmin`).

### Agreed scope

* A new ADR supersedes ADR-0014: PostgreSQL only, no SQLite fallback.
* Follow-ups from the issue: remove the fallback rule from the PR template, update the README backing services table, update the `adr-draft` skill, and decide whether ADR-0015 needs a note on driver D5.

### Not in this story

* Any change to the backend code or the database.

### Acceptance criteria

1. **Given** the issue asks for a superseding ADR, **when** I read the decisions, **then** [ADR-0037](../decisions/0037-postgresql-only-no-sqlite-fallback.md) is `accepted` and ADR-0014 is marked `superseded by` it. Delivered in PR [#146](https://github.com/mgasca/calendar/pull/146). Checked by hand on `main`; `make adr-check` validates the status and index.
2. **Given** the PR template carried a SQLite-impact item, **when** I read `.github/pull_request_template.md`, **then** it no longer mentions SQLite. Checked by hand (a search of `.github/` finds no "sqlite").
3. **Given** the README backing services table, **when** I read the PostgreSQL row (`README.md:118`), **then** it links ADR-0037. Checked by hand.
4. **Given** the `adr-draft` skill named the fallback, **when** I read `.claude/skills/adr-draft/SKILL.md`, **then** no SQLite wording remains. Checked by hand (a search of the skill finds no "sqlite"). The remaining "fallback" wording on line 82 is generic guidance about options.
5. **Given** ADR-0015's driver D5 (provider portability) referred to the fallback, **when** I read ADR-0015, **then** a note (line 102) says D5 no longer applies and the decision is unchanged.
6. **Given** the issue asked the owner to confirm the managed PostgreSQL cost (about $23 a month per environment), **when** I read ADR-0037, **then** it records that the owner confirmed on PR #146 that the cost is accepted, with no pre-agreed fallback (line 90).

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0014](../decisions/0014-postgresql-database-engine.md) | PostgreSQL, with a SQLite fallback | Superseded by ADR-0037. |
| [0015](../decisions/0015-ef-core-data-access.md) | EF Core code-first on Npgsql | Driver D5 no longer applies; a note says so. |
| [0031](../decisions/0031-azure-postgresql-flexible-server.md) | Azure PostgreSQL Flexible Server | Production went to managed PostgreSQL. |
| [0037](../decisions/0037-postgresql-only-no-sqlite-fallback.md) | PostgreSQL only, no SQLite fallback | The decision this story delivered. |

No new ADR is needed.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Superseding ADR | `docs/decisions/0037-postgresql-only-no-sqlite-fallback.md` |
| README table | `README.md` (PostgreSQL row) |
| PR template | `.github/pull_request_template.md` |

### API

No changes.

### Testing

* Docs only. `make adr-check` and the docs-site tests validate the ADR status and index. The follow-up edits were checked by reading and searching `origin/main`.

### Lessons learned, known issues and follow-ups

* ADR-0014 and ADR-0015 keep their SQLite wording as history. That is intended.
* None outstanding.

## User guide

Not applicable: this story has no user-facing behaviour.
