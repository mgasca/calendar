---
status: planned
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/345
pr: []
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

1. **Given** a job name containing a space, **when** I pass it to `just tools ci-timings`, **then** the tool receives it as one argument.
2. **Given** another variadic forwarding recipe, **when** it receives arguments containing spaces, **then** it forwards each argument intact.
3. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | Use just as a thin task runner | Recipes continue to wrap native tools. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Recipe boundary:** verify the arguments at the forwarding boundary, including spaces and shell-sensitive characters.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Recipes | `tools/mod.just` and other module files |

### API

No changes expected.

### Testing

Exercise forwarding through the recipes and test the old form as a negative control.

### Lessons learned, known issues and follow-ups

To be recorded on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

Quote a job name containing spaces when passing it to the timing command.
