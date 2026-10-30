---
status: implemented
date: 2026-10-30
issue: https://github.com/mgasca/calendar/issues/132
pr:
  - https://github.com/mgasca/calendar/pull/133
  - https://github.com/mgasca/calendar/pull/134
  - https://github.com/mgasca/calendar/pull/135
  - https://github.com/mgasca/calendar/pull/136
  - https://github.com/mgasca/calendar/pull/137
adrs: ["0033", "0034"]
---

# 0008 Review the runbooks for clarity and simplicity

## Story

> As an operator who may be new to Azure, I need runbooks that are clear and simple to follow, so that I can deploy and maintain the app without guessing or asking for help.

Tracked in issue #132 and delivered across the card PR ([#133](https://github.com/mgasca/calendar/pull/133)), three review PRs ([#134](https://github.com/mgasca/calendar/pull/134) database, [#135](https://github.com/mgasca/calendar/pull/135) infrastructure, [#136](https://github.com/mgasca/calendar/pull/136) bootstrap) and this card update ([#137](https://github.com/mgasca/calendar/pull/137)).

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
   *Met, checked on the PRs.* Each review PR (#134, #135, #136) has a first commit that copies the original to the three new names, and a second that adds the drafts, so the commit selector shows each draft against the original. No automated test covers this; it was checked by hand from the PR file lists.
2. **Given** a PR is ready to merge, **when** it is merged, **then** each runbook has exactly one document, under its original filename, and no `simple-`, `clear-` or `combined-` files remain.
   *Met, checked on `main`.* `docs/runbooks/` holds `README.md`, `azure-bootstrap.md`, `azure-infrastructure.md` and `azure-database.md`, and nothing else. Checked by listing the directory, not by a test.
3. **Given** the runbooks index, **when** it is read, **then** it links every runbook.
   *Met, checked on `main`.* `docs/runbooks/README.md` links all three runbooks, in the order to follow them. Added in #134. No automated test checks this.
4. **Given** each trade-off between clarity and simplicity, **when** it is resolved, **then** the decision is recorded in the PR or in this card.
   *Met in the PR descriptions.* Each PR records how the combined draft resolved the trade-offs and lists the changes that went beyond wording. The decisions are summarised under Implementation notes below.

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

### Where things live

| Area | Location |
| --- | --- |
| Runbooks | `docs/runbooks/azure-bootstrap.md`, `azure-infrastructure.md`, `azure-database.md` |
| Runbooks index | `docs/runbooks/README.md` |
| Review PRs (original, drafts, combined) | [#134](https://github.com/mgasca/calendar/pull/134), [#135](https://github.com/mgasca/calendar/pull/135), [#136](https://github.com/mgasca/calendar/pull/136) |

### How the review ran

Each runbook had two phase-1 drafts, one for clarity (`clear-`) and one for simplicity (`simple-`), written by separate agents in parallel. A combined draft (`combined-`) was then written from the original and both drafts. Each runbook's set went into its own PR as soon as it was ready. The reviewer chose the combined version for all three runbooks, so the drafts were removed before merge.

### Trade-offs and how they were resolved

* **Terms:** defined once in a short list at the top of each runbook. Clarity drafts defined terms inline, and the simplicity draft defined them throughout, so both made the steps longer. The combined draft keeps the list and short steps.
* **Prerequisites:** the clarity draft's "Before you start" list made implicit steps explicit (signing in, checking the subscription, getting the FQDN, keeping one shell). Kept.
* **Ordering:** the database runbook's live privilege checks now run straight after initialization, as the original's own text required. The separate `permission_probe` check was folded into them, because the app-role check proves the same thing.
* **Procedures:** the infrastructure runbook's what-if and deploy commands are separate blocks, with "read the preview" between them. Rotation, migration failure and firewall cleanup are numbered steps with an expected result.
* **Reference material:** the vault/role recovery cases, the secret-to-setting map and the cost breakdown are tables. Background (for example, why the password is a secure parameter) moved to a short subsection.
* **Left out:** the clarity drafts' longer explanations of how to find each value in Azure, and their repeated warnings.

### Changes beyond wording

These were checked against the repository, not only reworded:

* `make infra-db-start` and `make infra-db-stop` are named in place of "the tooling's start and stop commands" (checked against the `Makefile`).
* The "requires PR #113" lines were removed, because #113 is merged.
* The bootstrap's "once this workflow has merged" was removed, because `azure-oidc-check.yml` is on `main`.
* `az postgres flexible-server show` for the FQDN and the `make infra-init-roles` command were added as code blocks. Both were prose before.
* The database runbook's `Production restore point (UTC)` text was checked against `tools/infra/Database.cs`, and the workflow name and trigger against `migrate.yml`.

### Verification

* Every command in the original runbooks is in the combined version, unchanged, except the additions above. The bootstrap's ten code blocks match byte for byte. The other two differ only by the additions.
* The docs-site story and index tests (`frontend/apps/docs/src/lib/adr.test.ts`) check the card's front matter and index status. All 50 pass on this branch.
* No live Azure, GitHub or `psql` run was made. Nothing was deployed.

### Lessons learned and follow-ups

* **Open:** the infrastructure runbook's final section still says that, when it was written, nothing had been deployed or previewed against the subscription. It was not changed in review. Someone who owns the subscription should decide whether it still applies, and then update or remove it.
* **Open:** the owner-run checks in the runbooks (the bootstrap workflow with production approval, the first what-if and deploy, the live privilege checks, and TLS) have not been run. Track them against the stories that deliver the infrastructure.
* **Tooling:** the `simple-english` skill was not visible to the drafting agents' profile at first. They found it when pointed to its file, and one found it in another profile. A future run should check the skill is available before starting.
* **Process:** one commit that copies the original, then one that applies the draft, makes each leg reviewable in GitHub. Keep that pattern for future reviews.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### The task the user performs

Follow the runbooks in `docs/runbooks/README.md` in order:

1. **Azure bootstrap** creates the deployment identities for staging and production, and checks that GitHub can sign in to Azure.
2. **Azure infrastructure** creates the Azure resources for each environment.
3. **Azure PostgreSQL operations** sets up the database roles, runs migrations, and covers recovery and password rotation.

Each step says what to do, what to expect, and how to check it worked. Terms are defined at the top of each runbook. Before a live change, read the preview where the runbook gives one.
