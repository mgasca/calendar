---
status: accepted
date: 2026-10-31
decision-makers: mgasca, Claude (AI assistant)
---

# PostgreSQL only: drop the SQLite budget fallback

## Context and Problem Statement

[ADR-0014](0014-postgresql-database-engine.md) chose PostgreSQL but kept "SQLite on a persistent volume with Litestream" as an agreed budget fallback for production, to be dropped or adopted when hosting was chosen. Hosting is now chosen: [ADR-0031](0031-azure-postgresql-flexible-server.md) uses Azure Database for PostgreSQL Flexible Server, and the infrastructure and runbooks are built around it. The backend also relies on PostgreSQL-only features (generated `tstzrange` and `daterange` columns with GiST indexes, partial indexes, `AT TIME ZONE` translation, `xmin`), so the fallback could not be adopted without rewriting queries. Should the SQLite fallback and its review rules stay?

## Decision Drivers

* **D1 Operational simplicity**: one engine, one migration set and one query dialect to build, test and run, with no second path that must be kept viable. Infrastructure can use PostgreSQL features (ranges, GiST, partial indexes) freely (see `AGENTS.md`, backend practices).
* **D2 Review overhead**: contributors and reviewers carry no recurring checklist cost for a path that is not used.
* **D3 Production cost**: running cost at small scale stays under control, and there is a plan if it does not.
* **D4 Production security and durability**: database authentication, least-privilege roles, TLS, backups and point-in-time restore ([ADR-0031](0031-azure-postgresql-flexible-server.md)).

## Considered Options

* PostgreSQL only (supersede [ADR-0014](0014-postgresql-database-engine.md), drop the fallback)
* Keep the SQLite fallback as in [ADR-0014](0014-postgresql-database-engine.md)
* PostgreSQL only, with a self-hosted PostgreSQL container as the cost fallback

## Decision Outcome

Chosen option: "PostgreSQL only (supersede [ADR-0014](0014-postgresql-database-engine.md), drop the fallback)", because the fallback was never exercised and is no longer adoptable, so one engine is simpler to build and run (D1), it taxes every PostgreSQL-specific change (D2), and production already runs on managed PostgreSQL with the security and backup properties we want (D4). The cost risk (D3) is accepted; see Consequences.

| Driver | **PostgreSQL only (chosen)** | Keep SQLite fallback | Self-hosted PostgreSQL fallback |
| --- | :---: | :---: | :---: |
| D1 Operational simplicity | ★★★ | ★☆☆ | ★★☆ |
| D2 Review overhead | ★★★ | ★☆☆ | ★★★ |
| D3 Production cost | ★★☆ | ★★★ | ★★☆ |
| D4 Production security and durability | ★★★ | ★☆☆ | ★★☆ |

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

* Good, because **D1 Operational simplicity**: one engine, one migration set and one query dialect; PostgreSQL features are used freely in Infrastructure.
* Good, because **D1 Operational simplicity**: matches what the code and infrastructure already are, with no unbuilt second path to keep viable.
* Good, because **D2 Review overhead**: removes one checklist item from every relevant PR.
* Good, because **D4 Production security and durability**: managed PostgreSQL gives roles, TLS, backups and PITR.
* Bad, because **D3 Production cost**: a paid server per environment, with no cheaper agreed path.

### Keep the SQLite fallback as in [ADR-0014](0014-postgresql-database-engine.md)

* Good, because **D3 Production cost**: nominally the cheapest production path (a volume and object storage).
* Bad, because **D1 Operational simplicity**: it cannot be adopted without rewriting queries, as [ADR-0015](0015-ef-core-data-access.md) already admits, so it is a second path that only looks viable.
* Bad, because **D1 Operational simplicity**: each new PostgreSQL feature needs a SQLite equivalent or degradation note.
* Bad, because **D2 Review overhead**: a recurring checklist item for a path that was never used.
* Bad, because **D4 Production security and durability**: no database authentication or roles, a single writer, and backup relies on Litestream.

### PostgreSQL only, with a self-hosted PostgreSQL container as the cost fallback

* Good, because **D1 Operational simplicity** and **D2 Review overhead**: same engine, so no extra rules.
* Neutral, because **D1 Operational simplicity**: adoptable, but not built or tested, so it is still a promise and one more thing to operate.
* Neutral, because **D3 Production cost**: possibly cheaper than managed, but it adds our own operating time.
* Bad, because **D4 Production security and durability**: we would own patching, backups and restore testing.

## More Information

* Related: [ADR-0014](0014-postgresql-database-engine.md) (superseded), [ADR-0015](0015-ef-core-data-access.md), [ADR-0016](0016-local-database-provisioning.md), [ADR-0031](0031-azure-postgresql-flexible-server.md).
* The owner confirmed on PR #146 that managed PostgreSQL cost is accepted, with no pre-agreed fallback.
* Revisit when the monthly database cost is no longer acceptable. The trigger is recorded here only; the PR template no longer carries a database-cost item.
