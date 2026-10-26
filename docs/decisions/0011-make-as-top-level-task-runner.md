---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# GNU Make as a thin top-level task runner

## Context and Problem Statement

Contributors and CI need a single entry point to set up, build, test, lint, and format both stacks.

## Considered Options

* Makefile wrapping native commands
* `just`
* npm scripts at the repo root
* Shell scripts in `scripts/`
* Only native commands, documented in the README

## Decision Outcome

Chosen option: "Makefile", because it's preinstalled on Linux and macOS and on CI runners, and it only orchestrates. All real configuration stays in each stack's native tooling, so `dotnet` and `pnpm` commands keep working directly. Targets are `setup`, `build`, `test`, `lint`, `format`, `contracts`, `check`, `dev-api`, `dev-web`, and `clean`. The `dotnet` commands run inside `backend/` so `global.json` applies.

### Consequences

* Good, because there are no extra tool dependencies, and `make help` documents the targets.
* Bad, because Windows users need WSL, Git Bash, or the native commands. `just` would be the cross-platform alternative if this becomes painful.
