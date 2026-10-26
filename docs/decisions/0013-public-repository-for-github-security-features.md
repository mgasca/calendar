---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Public GitHub repository to enable branch rules and security scanning

## Context and Problem Statement

The repository was created private on a free GitHub plan. The automation from [ADR-0012](0012-ci-and-dependency-updates.md) depends on features GitHub withholds from free private repositories. The API confirmed each one: rulesets and branch protection (HTTP 403, "Upgrade to GitHub Pro or make this repository public"), code scanning ("Code scanning is not enabled"), and secret scanning (HTTP 422). How do we get these protections?

## Decision Drivers

* **D1 Cost**: no paid GitHub plan or add-ons.
* **D2 Branch protection**: rulesets can enforce PRs and required checks on `main`.
* **D3 Security scanning**: CodeQL, dependency review and secret scanning with push protection.
* **D4 Source confidentiality**: whether the code and history stay private.

## Considered Options

* Make the repository public
* Keep it private and adapt (drop CodeQL and dependency review, gitleaks in CI, no branch protection)
* Upgrade to GitHub Pro
* Upgrade to GitHub Pro + GitHub Code Security and Secret Protection

## Decision Outcome

Chosen option: "Make the repository public", because it unlocks all branch protection (D2) and security scanning (D3) at no cost (D1). Source confidentiality (D4) was judged unnecessary for this project.

| Driver | **Public repository (chosen)** | Private, adapted | GitHub Pro | Pro + Code Security + Secret Protection |
| --- | :---: | :---: | :---: | :---: |
| D1 Cost | ★★★ | ★★★ | ★★☆ | ☆☆☆ |
| D2 Branch protection | ★★★ | ☆☆☆ | ★★★ | ★★★ |
| D3 Security scanning | ★★★ | ★☆☆ | ★☆☆ | ★★★ |
| D4 Source confidentiality | ☆☆☆ | ★★★ | ★★★ | ★★★ |

Before publishing, the full history was scanned with gitleaks (no findings). The only personal data in history is the commit author's name and email.

### Consequences

* Good, because `main` is protected (the ruleset from [ADR-0012](0012-ci-and-dependency-updates.md)) and every PR is security-scanned.
* Good, because Actions minutes are free for public repositories.
* Bad, because the source code and commit history are publicly readable. Secrets must never be committed; push protection enforces this.
* Bad, because going private again would lose these features unless paid plans are bought.
* Neutral: `SECURITY.md` directs vulnerability reports to private advisories rather than public issues.

### Confirmation

`gh api repos/mgasca/calendar -q .visibility` returns `public`. `security_and_analysis` shows secret scanning and push protection enabled. Ruleset `main` is active.

## Pros and Cons of the Options

### Public repository

* Good, because **D1 Cost**: every feature used is free for public repos.
* Good, because **D2 Branch protection**: rulesets are available.
* Good, because **D3 Security scanning**: CodeQL, dependency review, secret scanning and push protection are all available.
* Bad, because **D4 Source confidentiality**: code, issues and history are visible to everyone.

### Private, adapted

* Good, because **D1 Cost** and **D4 Source confidentiality**: free, and the code stays private.
* Bad, because **D2 Branch protection**: no rulesets, so anyone with write access can push directly to `main`.
* Bad, because **D3 Security scanning**: only Dependabot alerts and a gitleaks CI job; no CodeQL or push protection.

### GitHub Pro

* Good, because **D2 Branch protection**: rulesets on private repos.
* Good, because **D4 Source confidentiality**: stays private.
* Bad, because **D3 Security scanning**: Pro doesn't include CodeQL code scanning or secret scanning for private repos.
* Bad, because **D1 Cost**: a monthly subscription.

### Pro + Code Security + Secret Protection

* Good, because **D2**, **D3**, **D4**: full protection while staying private.
* Bad, because **D1 Cost**: per-committer monthly charges for each security product on top of Pro.
