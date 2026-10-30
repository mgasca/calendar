---
status: in-progress
date: 2026-10-30
issue: https://github.com/mgasca/calendar/issues/132
pr:
  - https://github.com/mgasca/calendar/pull/133
  - https://github.com/mgasca/calendar/pull/134
  - https://github.com/mgasca/calendar/pull/135
  - https://github.com/mgasca/calendar/pull/136
adrs: ["0033", "0034"]
---

# 0008 Review the runbooks for clarity and simplicity

## Story

> As an operator who may be new to Azure, I need runbooks that are clear and simple to follow, so that I can deploy and maintain the app without guessing or asking for help.

Tracked in issue #132. Review PRs: [#134](https://github.com/mgasca/calendar/pull/134) (database), [#135](https://github.com/mgasca/calendar/pull/135) (infrastructure), [#136](https://github.com/mgasca/calendar/pull/136) (bootstrap).

## Background

The three runbooks in `docs/runbooks/` (`azure-bootstrap.md`, `azure-database.md`, `azure-infrastructure.md`) were written while the Azure deployment was built. They have not had a pass focused on readability. The runbooks index lists only `azure-bootstrap.md`.

Clarity and simplicity can compete. More explanation makes a step clearer but the runbook longer; fewer words and steps can leave gaps for a newcomer. This story reviews each runbook with both goals in mind and records the trade-offs.

### Agreed scope

* **Two drafts per runbook:** one reviewed for clarity, for readers who may be brand new to the technology (`clear-<name>.md`), and one reviewed for simplicity in the `simple-english` writing style (`simple-<name>.md`).
* **One combined draft per runbook:** a review of the original and both drafts that weighs the trade-off and produces `combined-<name>.md`.
* **Review PRs, one per runbook:** each PR holds the original and the three new versions, and is published as soon as that runbook's review finishes, so the reviewer can start early.
* **Guidance, then one document:** the reviewer gives guidance. Before a PR merges, only one document remains for that runbook, under the original filename.
* **Complete index:** `docs/runbooks/README.md` lists every runbook.

### Not in this story

* Changes to deployment behaviour, infrastructure or ADRs.
* New runbooks.

### Acceptance criteria

1. **Given** a runbook under review, **when** its PR is opened, **then** the PR contains the original and the `simple-`, `clear-` and `combined-` versions side by side.
2. **Given** a PR is ready to merge, **when** it is merged, **then** each runbook has exactly one document, under its original filename, and no `simple-`, `clear-` or `combined-` files remain.
3. **Given** the runbooks index, **when** it is read, **then** it links every runbook.
4. **Given** each trade-off between clarity and simplicity, **when** it is resolved, **then** the decision is recorded in the PR or in this card.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0033](../decisions/0033-bicep-for-infrastructure-as-code.md) | Bicep for infrastructure as code | The infrastructure runbook describes it; its commands must stay correct. |
| [0034](../decisions/0034-github-actions-oidc-deployment.md) | GitHub Actions deployment with OIDC | The bootstrap runbook describes it; its commands must stay correct. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Technical content is fixed:** every command, name and value stays correct; only wording, order and explanation change.
* **Review drafts are temporary:** the `simple-`, `clear-` and `combined-` files exist only while a PR is in review.

## Implementation notes

*Planned. This section is completed as the story is built.*

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### The task the user performs

Follow a runbook in `docs/runbooks/` from the top. Each step says what to do and how to check that it worked.
