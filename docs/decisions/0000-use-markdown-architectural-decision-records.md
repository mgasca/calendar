---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Use Markdown Architectural Decision Records

## Context and Problem Statement

We want to record the architectural and tooling decisions made in this project, together with their reasons, so that later contributors (human or AI) understand why things are the way they are. Which format should we use?

## Considered Options

* MADR 4.0 (Markdown Architectural Decision Records)
* Michael Nygard's ADR template
* No formal records (rely on commit messages and README)

## Decision Outcome

Chosen option: "MADR 4.0", because it is lean, structured (context, options, pros and cons, consequences), stored as plain Markdown next to the code, and widely used.

### Consequences

* Good, because decisions are versioned and reviewed with the code they affect.
* Bad, because records must be written and kept current. A superseded decision gets a new record, and the old one's status changes to "superseded by ADR-NNNN".

### Confirmation

New significant decisions arrive in PRs as `docs/decisions/NNNN-title-with-dashes.md`, copied from [`adr-template.md`](adr-template.md).

## More Information

* <https://adr.github.io/madr/>
