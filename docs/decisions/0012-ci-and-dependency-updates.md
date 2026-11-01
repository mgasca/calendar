---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# GitHub Actions CI, security scanning and Dependabot

## Context and Problem Statement

The repository is hosted on GitHub (`mgasca/calendar`). Every change should be verified automatically, security issues found early, and dependencies across NuGet, npm and Actions kept current. Which CI platform, dependency-update tool and action-pinning policy should we use?

## Decision Drivers

* **D1 GitHub integration**: results appear natively on PRs and can be enforced by branch rulesets.
* **D2 Cost**: free for this public repository.
* **D3 Setup & maintenance**: little configuration, with toolchain versions read from the repo rather than duplicated.
* **D4 Ecosystem coverage**: handles .NET (NuGet with CPM), pnpm and GitHub Actions in one place.
* **D5 Supply-chain security**: scanning code and dependencies, and resisting compromised third-party actions.
* **D6 Signal-to-noise**: update and scan output is grouped and actionable, not a flood of PRs or alerts.

## Considered Options

### CI platform

* GitHub Actions
* Azure Pipelines
* GitLab CI (mirrored)

### Dependency updates

* Dependabot
* Renovate

### Action pinning

* GitHub-owned actions on major tags, third-party actions on commit SHAs
* Every action on major tags
* Every action on commit SHAs

## Decision Outcome

**CI platform:** GitHub Actions, because it is native to the repository and rulesets (D1) and free for public repos (D2).

| Driver | **GitHub Actions (chosen)** | Azure Pipelines | GitLab CI (mirrored) |
| --- | :---: | :---: | :---: |
| D1 GitHub integration | ★★★ | ★★☆ | ★☆☆ |
| D2 Cost | ★★★ | ★★☆ | ★★☆ |
| D3 Setup & maintenance | ★★★ | ★☆☆ | ★☆☆ |
| D5 Supply-chain security | ★★★ | ★★☆ | ★★☆ |

**Dependency updates:** Dependabot, because it needs no app installation (D3), is integrated with security alerts (D1, D5), and covers all three ecosystems (D4).

| Driver | **Dependabot (chosen)** | Renovate |
| --- | :---: | :---: |
| D1 GitHub integration | ★★★ | ★★☆ |
| D3 Setup & maintenance | ★★★ | ★★☆ |
| D4 Ecosystem coverage | ★★★ | ★★★ |
| D6 Signal-to-noise | ★★☆ | ★★★ |

**Action pinning:** GitHub-owned actions on major tags and third-party actions on SHAs. This guards against the largest risk (third-party tag hijacking, D5), keeps workflows readable (D3), and satisfies CodeQL `actions/unpinned-tag`.

| Driver | **Mixed: GitHub tags, third-party SHAs (chosen)** | All major tags | All SHAs |
| --- | :---: | :---: | :---: |
| D3 Setup & maintenance | ★★★ | ★★★ | ★★☆ |
| D5 Supply-chain security | ★★☆ | ★☆☆ | ★★★ |
| D6 Signal-to-noise | ★★★ | ★★☆ | ★★☆ |

Implementation:

* `.github/workflows/ci.yml` runs parallel `backend` and `frontend` jobs: locked/frozen restore, build, format check, lint, tests with coverage (uploaded as artifacts), and a check that `contracts/` is up to date. A `tooling` job tests and lints repo tooling and validates ADRs with `check-adr.cs` ([ADR-0000](0000-use-markdown-architectural-decision-records.md), [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)). An aggregate **`CI result`** job is the single required status check. It also runs on `merge_group` for a future merge queue.
* `.github/workflows/codeql.yml` runs CodeQL (`security-extended`) for `csharp` (manual build), `javascript-typescript` and `actions` on pushes, PRs and weekly.
* `.github/workflows/dependency-review.yml` fails PRs that introduce dependencies with known vulnerabilities of moderate severity or higher.
* `.github/dependabot.yml` covers `nuget` (/backend), `npm` (/frontend) and `github-actions`, with minor/patch updates grouped and labelled by area. Majors arrive as individual PRs.
* `.github/rulesets/main.json` is the versioned ruleset for `main`: PR required, `CI result` must pass, no high+ CodeQL alerts, no force-push or deletion. It's applied with `gh api` (see `.github/rulesets/README.md`).
* Repository settings applied via the API: Dependabot alerts and security updates, secret scanning with push protection, private vulnerability reporting, squash/rebase merges only, auto-merge allowed, and head branches deleted on merge. These rely on the repository being public ([ADR-0013](0013-public-repository-for-github-security-features.md)).
* Every workflow uses least-privilege `permissions` (default `contents: read`), and superseded PR runs are cancelled. Toolchain versions come from `global.json`, `.node-version` and `packageManager`.
* `CODEOWNERS`, a PR template and issue forms standardize contributions.

### Consequences

* Good, because CI runs the same commands as local development (`just check`).
* Good, because adding or renaming CI jobs doesn't require ruleset changes; only `CI result` is required.
* Bad, because Dependabot can't group across ecosystems or schedule as flexibly as Renovate. Switch if update noise becomes a problem.
* Neutral: GitHub-owned actions on major tags trust GitHub's tag hygiene. Pin them by SHA too if the threat model requires it.

### Confirmation

PR #1 ran CI, CodeQL and dependency review green under the active ruleset. Workflows are validated with actionlint.

## Pros and Cons of the Options

### GitHub Actions

* Good, because **D1 GitHub integration**: checks, annotations, code-scanning upload and ruleset enforcement are native.
* Good, because **D2 Cost**: unlimited minutes for public repositories.
* Good, because **D3 Setup & maintenance**: `setup-dotnet` / `setup-node` / `pnpm/action-setup` read versions from repo files.
* Good, because **D5 Supply-chain security**: CodeQL, dependency review and OIDC are first-party.
* Bad, because **D5 Supply-chain security**: the third-party action marketplace is an attack surface (mitigated by SHA pinning).

### Azure Pipelines

* Good, because **D2 Cost**: free tier for public projects.
* Bad, because **D1 GitHub integration**: needs a GitHub App and a separate Azure DevOps project.
* Bad, because **D3 Setup & maintenance**: a second system to administer.
* Neutral, because **D5 Supply-chain security**: CodeQL would still need GitHub Actions or GHAS for Azure DevOps.

### GitLab CI (mirrored)

* Bad, because **D1 GitHub integration**: requires repository mirroring; status reported back via an integration.
* Bad, because **D3 Setup & maintenance**: two platforms to keep in sync.
* Neutral, because **D2**, **D5**: has its own free tier and scanners, duplicating GitHub's.

### Dependabot

* Good, because **D3 Setup & maintenance**: built in; one YAML file.
* Good, because **D1 GitHub integration** and **D5 Supply-chain security**: security updates are driven by Dependabot alerts.
* Good, because **D4 Ecosystem coverage**: nuget (with CPM), npm/pnpm and github-actions.
* Bad, because **D6 Signal-to-noise**: grouping and scheduling are less flexible than Renovate's.

### Renovate

* Good, because **D6 Signal-to-noise**: very flexible grouping, scheduling, automerge and a dependency dashboard.
* Good, because **D4 Ecosystem coverage**: broad manager support.
* Bad, because **D3 Setup & maintenance**: a GitHub App installation and a larger configuration surface.
* Neutral, because **D1 GitHub integration**: security updates still come from GitHub's advisory data.

### Mixed pinning (GitHub-owned tags, third-party SHAs)

* Good, because **D5 Supply-chain security**: third-party actions, the most likely hijack target, are immutable.
* Good, because **D3 Setup & maintenance**: most `uses:` lines stay readable (`@v7`).
* Neutral, because **D6 Signal-to-noise**: Dependabot updates both styles.

### All major tags

* Good, because **D3 Setup & maintenance**: simplest to read.
* Bad, because **D5 Supply-chain security**: a compromised third-party tag runs immediately, and CodeQL flags it.

### All SHAs

* Good, because **D5 Supply-chain security**: fully immutable.
* Bad, because **D3 Setup & maintenance**: every line needs a SHA and a version comment.
* Bad, because **D6 Signal-to-noise**: more Dependabot churn.
