---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# Public GitHub repository to enable branch rules and security scanning

## Context and Problem Statement

The repository was created private on a free GitHub plan. The automation from ADR-0012 depends on features GitHub withholds from free private repositories. The API confirmed each one: rulesets and branch protection (HTTP 403, "Upgrade to GitHub Pro or make this repository public"), code scanning ("Code scanning is not enabled"), and secret scanning (HTTP 422). How do we get these protections?

## Considered Options

* Make the repository public
* Keep it private and adapt: drop CodeQL and dependency review, scan for secrets with gitleaks in CI, and leave `main` unprotected
* Upgrade to GitHub Pro (unlocks rulesets on private repos, but not CodeQL or secret scanning, which need paid Code Security and Secret Protection)

## Decision Outcome

Chosen option: "Make the repository public", because it unlocks every planned control at no cost: rulesets, CodeQL code scanning, dependency review, secret scanning with push protection, and private vulnerability reporting.

Before publishing, the full history was scanned with gitleaks (no findings). The only personal data in history is the commit author's name and email.

### Consequences

* Good, because `main` is protected (ADR-0012 ruleset) and every PR is security-scanned.
* Good, because Actions minutes are free for public repositories.
* Bad, because the source code and commit history are publicly readable. Secrets must never be committed; push protection enforces this. Switching back to private later would lose these features again.
* Neutral: `SECURITY.md` directs vulnerability reports to private advisories rather than public issues.
