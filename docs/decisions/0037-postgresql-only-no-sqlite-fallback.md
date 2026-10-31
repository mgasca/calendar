---
status: accepted
date: 2026-10-31
decision-makers: mgasca, Claude (AI assistant)
---

# PostgreSQL only: drop the SQLite budget fallback

## Context and Problem Statement

[ADR-0014](0014-postgresql-database-engine.md) chose PostgreSQL but kept "SQLite on a persistent volume with Litestream" as an agreed budget fallback for production, to be dropped or adopted when hosting was chosen. Hosting is now chosen: [ADR-0031](0031-azure-postgresql-flexible-server.md) uses Azure Database for PostgreSQL Flexible Server, and the infrastructure and runbooks are built around it. The backend also relies on PostgreSQL-only features (generated `tstzrange` and `daterange` columns with GiST indexes, partial indexes, `AT TIME ZONE` translation, `xmin`), so the fallback could not be adopted without rewriting queries. Should the SQLite fallback and its review rules stay?

## Decision Drivers

* **D1 Honest constraints**: the documented plan matches what the system can actually do, so no ADR promises an option that cannot be used.
* **D2 Use of PostgreSQL features**: Infrastructure may use ranges, GiST, partial indexes and similar features freely when measurements justify them (see `AGENTS.md`, backend practices).
* **D3 Review overhead**: contributors and reviewers carry no recurring checklist cost for a path that is not used.
* **D4 Production cost**: running cost at small scale stays under control, and there is a plan if it does not.
* **D5 Production security and durability**: database authentication, least-privilege roles, TLS, backups and point-in-time restore ([ADR-0031](0031-azure-postgresql-flexible-server.md)).

## Considered Options

* PostgreSQL only (supersede [ADR-0014](0014-postgresql-database-engine.md), drop the fallback)
* Keep the SQLite fallback as in [ADR-0014](0014-postgresql-database-engine.md)
* PostgreSQL only, with a self-hosted PostgreSQL container as the cost fallback

## Decision Outcome

Chosen option: "PostgreSQL only (supersede [ADR-0014](0014-postgresql-database-engine.md), drop the fallback)", because the fallback was never exercised and is no longer adoptable (D1), it taxes every PostgreSQL-specific change (D2, D3), and production already runs on managed PostgreSQL with the security and backup properties we want (D5). The cost risk (D4) is accepted; see Consequences.

| Driver | **PostgreSQL only (chosen)** | Keep SQLite fallback | Self-hosted PostgreSQL fallback |
| --- | :---: | :---: | :---: |
| D1 Honest constraints | ★★★ | ★☆☆ | ★★☆ |
| D2 Use of PostgreSQL features | ★★★ | ★☆☆ | ★★★ |
| D3 Review overhead | ★★★ | ★☆☆ | ★★★ |
| D4 Production cost | ★★☆ | ★★★ | ★★☆ |
| D5 Production security and durability | ★★★ | ★☆☆ | ★★☆ |

### What changes

* [ADR-0014](0014-postgresql-database-engine.md) becomes `superseded by` this ADR. Its engine choice (PostgreSQL 18, `timestamptz`, `tstzrange`, roles, TLS) still stands and is not repeated here; only the "Budget fallback" section and its rules are withdrawn.
* PostgreSQL-specific features are allowed anywhere in `Calendar.Infrastructure` without noting a SQLite equivalent. They stay out of `Calendar.Domain` and API code because of layering ([ADR-0015](0015-ef-core-data-access.md)), not because of portability.
* The "SQLite-fallback impact" item in `.github/pull_request_template.md` and the fallback wording in `README.md` are removed in the same PR.
* [ADR-0015](0015-ef-core-data-access.md) driver D5 (provider portability) no longer applies. A note is added to its More Information section; its decision is unchanged.

### If cost becomes a problem

There is no pre-agreed fallback. If managed PostgreSQL cost is no longer acceptable, write a new ADR then. The first candidates are a smaller or stopped staging server and a self-hosted PostgreSQL container on a volume, which keeps full engine parity at the price of operating backups and upgrades ourselves.

### Consequences

* Good, because the docs, the PR template and the code agree: PostgreSQL is the only engine.
* Good, because PostgreSQL-specific optimisations need no fallback note.
* Good, because the two-provider migration and query paths that were never built stay unbuilt.
* Bad, because a cost emergency has no ready-made cheap path. A switch would be a planned project and a new ADR.
* Neutral, because the owner accepts the managed PostgreSQL cost (the runbook estimates it in `docs/runbooks/azure-infrastructure.md`).

### Confirmation

* `make adr-check` validates the supersession: [ADR-0014](0014-postgresql-database-engine.md) status and the index row.
* `grep -ri sqlite` finds no live instruction to keep a fallback, only historical text in superseded ADRs.
* The PR template no longer asks for a SQLite impact note.

## Pros and Cons of the Options

### PostgreSQL only (supersede [ADR-0014](0014-postgresql-database-engine.md), drop the fallback)

* Good, because **D1 Honest constraints**: records what the code and infrastructure already are.
* Good, because **D2 Use of PostgreSQL features**: removes the pressure to avoid or isolate features.
* Good, because **D3 Review overhead**: removes one checklist item from every relevant PR.
* Good, because **D5 Production security and durability**: managed PostgreSQL gives roles, TLS, backups and PITR.
* Bad, because **D4 Production cost**: a paid server per environment, with no cheaper agreed path.

### Keep the SQLite fallback as in [ADR-0014](0014-postgresql-database-engine.md)

* Good, because **D4 Production cost**: nominally the cheapest production path (a volume and object storage).
* Bad, because **D1 Honest constraints**: it cannot be adopted without rewriting queries, as [ADR-0015](0015-ef-core-data-access.md) already admits.
* Bad, because **D2 Use of PostgreSQL features**: each new feature needs a SQLite equivalent or degradation note.
* Bad, because **D3 Review overhead**: a recurring checklist item for a path that was never used.
* Bad, because **D5 Production security and durability**: no database authentication or roles, a single writer, and backup relies on Litestream.

### PostgreSQL only, with a self-hosted PostgreSQL container as the cost fallback

* Good, because **D2 Use of PostgreSQL features** and **D3 Review overhead**: same engine, so no extra rules.
* Neutral, because **D1 Honest constraints**: adoptable, but not built or tested, so it is still a promise.
* Neutral, because **D4 Production cost**: possibly cheaper than managed, but it adds our own operating time.
* Bad, because **D5 Production security and durability**: we would own patching, backups and restore testing.

## More Information

* Related: [ADR-0014](0014-postgresql-database-engine.md) (superseded), [ADR-0015](0015-ef-core-data-access.md), [ADR-0016](0016-local-database-provisioning.md), [ADR-0031](0031-azure-postgresql-flexible-server.md).
* The owner confirmed on PR #146 that managed PostgreSQL cost is accepted, with no pre-agreed fallback.
* Revisit when the monthly database cost is no longer acceptable. The trigger is recorded here only; the PR template no longer carries a database-cost item.
