---
status: implemented
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/345
pr:
  - https://github.com/mgasca/calendar/pull/408
adrs: ["0038"]
---

# 0036 Preserve arguments passed to recipes

## Story

> As a contributor, I need recipe arguments preserved as I enter them, so that job names containing spaces work.

Tracked in issue #345.

## Background

The `ci-timings` recipe splits a quoted job name before the tool receives it. Story [0033](0033-review-how-long-delivery-automation-makes-us-wait.md) records a direct invocation as a workaround.

### Agreed scope

* **Preserve arguments:** pass each argument to the underlying tool intact, including names with spaces.
* **Audit:** check other module recipes that forward variadic arguments and correct the same defect where present.
* **Regression coverage:** exercise recipe argument forwarding and confirm the test fails against the old recipe.

### Not in this story

* Changes to the timing tool's analysis or command-line interface.

### Acceptance criteria

1. **Given** a job name containing a space, **when** I pass it to `just tools ci-timings`, **then** the tool receives it as one argument ([regression test](../../tools/doctor/tests/doctor.tests.cs)).
2. **Given** another variadic forwarding recipe, **when** it receives arguments containing spaces, **then** it forwards each argument intact ([regression test](../../tools/doctor/tests/doctor.tests.cs); infrastructure deploy and what-if require their real prerequisites and are not exercised by this test).
3. **Given** the change is complete, **when** I run `just check`, **then** it passes (the delivery PR reports the check result).

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | Use just as a thin task runner | Recipes continue to wrap native tools. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Recipe boundary:** verify the arguments at the forwarding boundary, including spaces and shell-sensitive characters.

## Implementation notes

Variadic recipes use positional arguments so that the shell receives the original argument boundaries. Infrastructure recipes retain their named environment and phase arguments; the docs test recipe retains its default of `src`.

### Where things live

| Area | Location |
| --- | --- |
| Recipes | `tools/mod.just` and other module files |

### API

No changes.

### Testing

The doctor test app invokes recipes with fake native commands and checks spaced and shell-sensitive arguments. Restoring the old tools recipes made the four tools cases fail; restoring the fix made them pass.

### Lessons learned, known issues and follow-ups

The root doctor and the infrastructure deploy and what-if recipes also forward positional arguments, but are not exercised by the automated forwarding test because they invoke real prerequisite checks.

## User guide

Quote a job name containing spaces, for example `just tools ci-timings --job "Docs site"`.
