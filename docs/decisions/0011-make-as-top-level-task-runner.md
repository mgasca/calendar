---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# GNU Make as a thin top-level task runner

## Context and Problem Statement

Contributors, AI agents and CI need a single entry point to set up, build, test, lint and format both stacks. Development happens on Linux / WSL.

## Decision Drivers

* **D1 Linux/WSL support**: works out of the box on the supported developer platform and CI runners.
* **D2 Zero extra install**: no additional tool to install or version.
* **D3 Thin over native tools**: all real configuration stays in `dotnet` / pnpm, so native commands keep working directly.
* **D4 Discoverability**: one obvious place listing the common tasks (`make help`), easy for agents to find and run.
* **D5 Expressiveness**: handles multi-step tasks, working directories and dependencies between tasks cleanly.

## Considered Options

* GNU Make
* `just`
* npm/pnpm scripts at the repo root
* Shell scripts in `scripts/`
* Only native commands, documented in the README

## Decision Outcome

Chosen option: "GNU Make", because on the supported platform (D1) it needs no install (D2) and gives a discoverable, thin layer over native tools (D3, D4).

| Driver | **GNU Make (chosen)** | `just` | Root npm/pnpm scripts | `scripts/` shell scripts | Native commands only |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Linux/WSL support | ★★★ | ★★★ | ★★★ | ★★★ | ★★★ |
| D2 Zero extra install | ★★★ | ★☆☆ | ★★☆ | ★★★ | ★★★ |
| D3 Thin over native | ★★★ | ★★★ | ★★☆ | ★★★ | ★★★ |
| D4 Discoverability | ★★★ | ★★★ | ★★☆ | ★☆☆ | ★☆☆ |
| D5 Expressiveness | ★★☆ | ★★★ | ★☆☆ | ★★★ | ☆☆☆ |

Targets are `doctor` (verifies dotnet, Node and pnpm against the repo pins; `setup` runs it first), `setup`, `build`, `test`, `lint`, `tooling` (tests and lints repo tooling, see [ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)), `tool-versions`, `adr-check`, `format`, `contracts`, `check`, `dev-api`, `dev-web` and `clean`. The `dotnet` commands run inside `backend/` so `global.json` applies.

### Consequences

* Good, because `make check` reproduces CI locally in one command.
* Bad, because Make syntax (tabs, `$$`) is quirky. Targets are kept to short command lists.
* Neutral: native Windows is not a supported dev platform. If it becomes one, revisit `just`.

### Confirmation

The README's task table maps to Makefile targets, and `make check` passed locally before the first push.

## Pros and Cons of the Options

### GNU Make

* Good, because **D1 Linux/WSL support** and **D2 Zero extra install**: preinstalled on Linux, WSL and GitHub runners.
* Good, because **D3 Thin over native**: each target is a few `dotnet`/`pnpm` commands.
* Good, because **D4 Discoverability**: `make help` lists the targets; agents know Make conventions well.
* Bad, because **D5 Expressiveness**: tab and escaping quirks; each recipe line runs in its own shell (hence `cd backend && dotnet`).

### `just`

* Good, because **D5 Expressiveness**: cleaner syntax, parameters, per-recipe working directory.
* Good, because **D4 Discoverability**: `just --list`.
* Bad, because **D2 Zero extra install**: must be installed on every machine and CI runner.

### Root npm/pnpm scripts

* Good, because **D2 Zero extra install**: Node is already required.
* Bad, because **D3 Thin over native**: puts .NET orchestration inside a Node `package.json`, blurring the stack boundary ([ADR-0001](0001-monorepo-layout.md)).
* Bad, because **D5 Expressiveness**: long one-line JSON strings; hard to read for multi-step tasks.

### `scripts/` shell scripts

* Good, because **D5 Expressiveness**: full bash.
* Bad, because **D4 Discoverability**: no built-in listing; many small files.

### Native commands only

* Good, because **D2**, **D3**: nothing added.
* Bad, because **D4 Discoverability** and **D5 Expressiveness**: every contributor or agent must learn and remember the per-stack command sequences, including `cd` requirements.
