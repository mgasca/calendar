---
status: implemented
date: 2026-10-31
issue: https://github.com/mgasca/calendar/issues/157
pr:
  - https://github.com/mgasca/calendar/pull/158
  - https://github.com/mgasca/calendar/pull/163
  - https://github.com/mgasca/calendar/pull/160
  - https://github.com/mgasca/calendar/pull/162
  - https://github.com/mgasca/calendar/pull/161
  - https://github.com/mgasca/calendar/pull/165
adrs: ["0000", "0022", "0023", "0025", "0028"]
---

# 0010 Sweep pending ADRs to a decided status

## Story

> As the maintainer, I need every ADR that has merged to `main` to carry a decided status, so that the decision log shows which decisions were taken instead of leaving shipped decisions `proposed`.

Tracked in issue #157. Card PR: [#158](https://github.com/mgasca/calendar/pull/158).

## Background

[ADR-0000](../decisions/0000-use-markdown-architectural-decision-records.md) and `AGENTS.md` say that an ADR becomes `accepted` when the user approves the decision, in the same PR and before it merges, and never waits for delivery. Four ADRs reached `main` still `proposed` (the table shows their status before this story), and the work they describe has since been delivered (the documentation site in PR #16, the stories on the site in PR #71):

| ADR | Title | Status before |
| --- | --- | --- |
| [0022](../decisions/0022-astro-starlight-documentation-ui.md) | Astro and Starlight for the developer documentation UI | proposed |
| [0023](../decisions/0023-static-adr-log-publication.md) | Build the canonical ADR log as a static site and publish main to GitHub Pages | proposed |
| [0025](../decisions/0025-github-pages-pr-previews.md) | GitHub Pages pull-request previews alongside production using a retained static snapshot | proposed |
| [0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md) | Publish user stories on the documentation site alongside the ADR log | proposed |

A first read of the code and workflows (`frontend/apps/docs`, `.github/workflows/pages.yml`) found nothing that contradicts any of the four, and none looks superseded. Whether each is accepted, rejected or superseded is the maintainer's decision. The agent proposed `accepted` in one PR per ADR, and the maintainer decided in the PR comments, not on the issue.

### Agreed scope

* **A decided status for each of the four ADRs:** `accepted`, rejected or superseded, as the maintainer decides per ADR in its PR. No ADR is set to `accepted` before that approval.
* **Index kept in step:** each ADR's row in `docs/decisions/README.md` is changed in the same PR as its front matter.
* **Delivery in several PRs, in this order:**
  1. PR 0: this card and its index row (`Refs #157`, does not close the issue).
  2. One PR per ADR (0022, 0023, 0025, 0028), each changing that ADR's status and index row.
  3. A final PR for the card update and any docs updates, such as `AGENTS.md`, carrying `Closes #157`.
* **One PR per ADR so that each decision is reviewed and merged alone:** a rejected or contested ADR does not hold back the others.

### Not in this story

* **Changing the decisions themselves.** A change of direction is a new ADR that supersedes the old one (`adr-draft`), as its own story or issue.
* **Other ADRs.** At the time of writing no other ADR is `proposed`. The ones that are `superseded` already have a decided status.
* **A new automated rule against stale `proposed` ADRs.** If the maintainer wants one, it is a follow-up issue.

### Acceptance criteria

1. **Given** `main` after the last ADR PR has merged, **when** I search `docs/decisions/` for `status: proposed`, **then** no ADR matches. Checked by hand after the last ADR PR merged: the only `status: proposed` left in `docs/decisions/` is the example in `adr-template.md`. Not covered by an automated test.
2. **Given** each of ADR 0022, 0023, 0025 and 0028, **when** its PR has merged, **then** its front matter status is the one the maintainer chose in its PR, and the ADR was not set to `accepted` without that approval. ADR PRs [#160](https://github.com/mgasca/calendar/pull/160) (0022), [#161](https://github.com/mgasca/calendar/pull/161) (0023), [#162](https://github.com/mgasca/calendar/pull/162) (0025) and [#163](https://github.com/mgasca/calendar/pull/163) (0028). Each was approved as `accepted` by the maintainer in a PR comment before it merged.
3. **Given** each ADR and its row in `docs/decisions/README.md`, **when** I compare them, **then** the statuses are identical. Enforced by `just adr-check` and the docs tests in [`adr.test.ts`](../../frontend/apps/docs/src/lib/adr.test.ts), which compare each ADR file with the index.
4. **Given** each ADR PR branch, **when** CI runs, **then** `just adr-check` and the docs tests pass. CI ran on every ADR PR; each merged only after its checks passed.
5. **Given** the story is delivered, **when** I read this card, **then** its status is `implemented`, its `pr` list holds every PR, and each criterion above is linked to its check or says it is checked by hand. This card, in the final PR.
6. **Given** the change is complete, **when** I run `just check`, **then** it passes. CI on the final PR.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0000](../decisions/0000-use-markdown-architectural-decision-records.md) | ADRs are Markdown records with a status | Defines the statuses and who may set them |
| [0022](../decisions/0022-astro-starlight-documentation-ui.md) | Astro and Starlight for the documentation UI | Status to decide |
| [0023](../decisions/0023-static-adr-log-publication.md) | Static ADR log published from `main` to GitHub Pages | Status to decide |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Pull-request previews from a retained static snapshot | Status to decide |
| [0028](../decisions/0028-publish-user-stories-on-the-documentation-site.md) | Stories published on the documentation site | Status to decide |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Status follows approval, not delivery:** `AGENTS.md` says acceptance never waits for the implementation, so the fact that the work shipped is a reason to ask now, not a reason to accept without asking.
* **One PR per ADR:** requested by the maintainer on the issue, so that each decision can be reviewed and merged on its own.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| ADR status | `docs/decisions/0022-*.md`, `0023-*.md`, `0025-*.md`, `0028-*.md` (front matter `status`) |
| ADR index | `docs/decisions/README.md` |
| Validation | `just adr-check`, docs tests in `frontend/apps/docs` |

### API

No changes.

### Testing

* `just adr-check` validates the ADR front matter against the index.
* The docs tests read the ADR corpus, so a mismatch between a file and its index row fails them.

### Lessons learned, known issues and follow-ups

* **Parallel ADR PRs conflict in the index.** The four PRs each edited adjacent rows of `docs/decisions/README.md`, so after the first merged the others needed their branch updated and one hit a conflict. Resolving it by hand dropped a row once; it was caught in review of the diff and restored. Update each branch from `main` and check the diff against `main` before pushing.
* **Decisions happened in the PRs.** The maintainer asked for each status change to be a PR discussed in its comments rather than answered on the issue.
* **`AGENTS.md` unchanged.** The open question of whether to add a line about sweeping `proposed` ADRs was not answered, so no docs change was made. A follow-up issue can add one.
* **Verification limits.** The docs tests were run locally on Node 22 with the engine check bypassed (Node 24 is not installed in the agent environment); CI ran the real check. `just build-docs` was not run locally.

## User guide

This story changes the project's records only, so it has no end-user behaviour. The published decision log now shows `accepted` for ADR-0022, 0023, 0025 and 0028.
