---
status: planned
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/454
pr: []
adrs: ["0016", "0017", "0038"]
---

# 0040 Make `just doctor` require the GitHub CLI and jq

## Story

> As a contributor, I need `just doctor` to tell me when `gh` or `jq` is missing, so that I learn it from one clear message with an install hint instead of from a late failure in a tool, a hook or a CI script.

Tracked in issue #454.

## Background

`tools/doctor/doctor.sh` checks the .NET SDK (twice, for the backend pin and for the repo tools), Node, pnpm, Docker and `just`, and with `--infra` the Azure CLI and Bicep. `just doctor` and `just setup` run it ([ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md)).

Two more programs are needed for ordinary work and are not checked:

* **`gh`**: the repo tools `ci-timings`, `handover-watch` and `agent-hooks` call it, and the issue and pull request workflow in `AGENTS.md` assumes it.
* **`jq`**: CI runs `.github/ci-changes.jq` and `.github/ci-gate.jq` with it, and the delivery-guards tests do the same.

Without them the failure shows up inside a tool or hook, far from its cause.

### Agreed scope

* **Presence check:** `doctor.sh` reports `gh` and `jq` as problems when they are not on `PATH`, and as passed checks with their version when they are. The exit code is non-zero if either is missing.
* **Install hints:** the message for `gh` points to the GitHub CLI install page and mentions `gh auth login`; the one for `jq` gives the `apt` command and the download page.
* **Always checked:** both checks run in the ordinary `just doctor`, not only with `--infra`, because both are used in local development.
* **Documentation:** the Prerequisites table in the root `README.md` lists both tools.

### Not in this story

* **Version pins:** neither tool has a pinned version in the repo, so doctor does not compare versions.
* **Authentication:** doctor does not run `gh auth status`; it stays offline and does not depend on the state of a login.
* **Installing the tools:** doctor reports and hints; it does not install anything.

### Acceptance criteria

1. **Given** `gh` is not on `PATH`, **when** I run `tools/doctor/doctor.sh`, **then** it prints `gh not found` with an install hint and exits non-zero.
2. **Given** `jq` is not on `PATH`, **when** I run `tools/doctor/doctor.sh`, **then** it prints `jq not found` with an install hint and exits non-zero.
3. **Given** both tools are installed and everything else passes, **when** I run `just doctor`, **then** it lists the `gh` and `jq` versions and ends with `Toolchain OK.`.
4. **Given** I read the Prerequisites table in `README.md`, **when** I look for what I must install, **then** `gh` and `jq` are listed.
5. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0016](../decisions/0016-local-database-provisioning.md) | `just doctor` checks that Docker is available | This story extends the same check list |
| [0017](../decisions/0017-dotnet-file-based-apps-for-repo-tooling.md) | Repo tooling is .NET file-based apps; `doctor.sh` is the one shell exception | The doctor tests are an xUnit file run by `just tools test` |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` is the task runner | `just doctor` and `just setup` run the script |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Presence only:** no version comparison, because the repo pins neither tool and an offline script cannot judge `gh` authentication.
* **Tests use fakes:** the doctor tests put stub executables on `PATH`, so the new checks are tested without the real tools.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| The checks | `tools/doctor/doctor.sh` |
| Tests | `tools/doctor/tests/doctor.tests.cs` |
| Prerequisites table | `README.md` |

### API

No changes.

### Testing

* One test per missing tool, asserting the message, the hint and a non-zero exit; the shared baseline of fakes gains `gh` and `jq` so the existing tests still pass.

### Lessons learned, known issues and follow-ups

*To be completed on delivery.*

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Check your setup

Run `just doctor` (or `./tools/doctor/doctor.sh` before `just` is installed). It lists each required program with a tick or a cross. If **gh** or **jq** is missing, follow the hint under it, then run the command again until it ends with **Toolchain OK.**.
