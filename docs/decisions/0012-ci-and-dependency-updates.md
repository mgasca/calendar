---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# GitHub Actions CI, security scanning and Dependabot

## Context and Problem Statement

Every change should be verified automatically, and dependencies across NuGet, npm, and Actions should stay current.

## Considered Options

* GitHub Actions + Dependabot
* GitHub Actions + Renovate
* Another CI (Azure Pipelines, GitLab CI)

## Decision Outcome

Chosen option: "GitHub Actions + Dependabot", the zero-setup default for GitHub-hosted repos.

* `.github/workflows/ci.yml` runs parallel `backend` and `frontend` jobs: locked/frozen restore, build, format check, lint, tests with coverage (uploaded as artifacts), and a check that `contracts/` is up to date. An aggregate **`CI result`** job is the single required status check, so adding or renaming jobs doesn't require ruleset changes. It also runs on `merge_group` for future merge-queue use.
* `.github/workflows/codeql.yml` runs CodeQL (`security-extended` queries) for `csharp` (manual build), `javascript-typescript`, and `actions` on pushes, PRs, and weekly.
* `.github/workflows/dependency-review.yml` fails PRs that introduce dependencies with known vulnerabilities of moderate severity or higher.
* `.github/dependabot.yml` covers `nuget` (/backend), `npm` (/frontend), and `github-actions`, with minor/patch updates grouped and labelled by area. Majors arrive as individual PRs so breaking changes are reviewed alone.
* `.github/rulesets/main.json` is the versioned branch ruleset for `main`: PR required, `CI result` must pass, no high+ CodeQL alerts, no force-push or deletion. GitHub doesn't read it automatically; it's applied with `gh api` (see `.github/rulesets/README.md`).
* Repository settings applied via the API: Dependabot alerts and security updates, secret scanning with push protection, private vulnerability reporting, squash and rebase merges only (merge commits disabled), auto-merge allowed, and head branches deleted on merge. These rely on the repository being public (ADR-0013).
* `CODEOWNERS`, a PR template, and issue forms standardize contributions.
* Every workflow uses least-privilege `permissions` (default `contents: read`), and PR runs cancel superseded runs.
* Toolchain versions come from the repo (`global.json`, `.node-version`, `packageManager`), not duplicated in workflows. Actions are pinned to major tags and kept current by Dependabot.

### Consequences

* Good, because CI uses the same commands as local development.
* Bad, because Dependabot groups less flexibly than Renovate. Switch if update noise becomes a problem.
* Neutral: actions are pinned to major-version tags rather than commit SHAs. That's simpler to read, but trusts the action maintainers. Switch to SHA pinning if the threat model requires it.
