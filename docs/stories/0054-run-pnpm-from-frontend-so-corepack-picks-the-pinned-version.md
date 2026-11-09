---
status: in-progress
date: 2026-11-09
issue: https://github.com/mgasca/calendar/issues/592
pr:
  - https://github.com/mgasca/calendar/pull/634
adrs: ["0005", "0038"]
---

# 0054 Run pnpm from the frontend folder so Corepack picks the pinned version

## Story

> As a contributor (human or agent), I need the documented frontend commands to work when I paste them from the repository root, so that a command that fails because of tooling never looks like a failed check.

Tracked in issue #592. The wording is derived from the issue, to be confirmed by the product owner.

## Background

`frontend/package.json` pins pnpm in `packageManager`, and Corepack only honours that pin when it finds the file by starting in `frontend/` or below. Run from the repository root, `corepack pnpm --dir frontend …` has no `package.json` to read, so Corepack starts its own default pnpm. That pnpm then reads `frontend/package.json`, sees a different version pinned and stops with `ERR_PNPM_BAD_PM_VERSION`. While delivering [0052](0052-remove-the-refresh-button-from-the-day-and-week-views.md) this had two effects:

* **Vite never started**, because the run-calendar skill starts it with `corepack pnpm --dir frontend/apps/web exec vite …`; the health wait then timed out.
* **A formatting check looked like a formatting failure**, because `corepack pnpm --dir frontend format:check` (in `frontend/AGENTS.md`) exits 1 without checking anything.

The same commands work from inside `frontend/`. The `just` recipes are not affected, because the frontend module runs in `frontend/` ([0019](0019-split-the-justfile-into-modules.md)). The one thing no recipe does is check formatting without rewriting files, which `frontend/AGENTS.md` calls out as a gap.

### Agreed scope

* **A `just frontend format-check` recipe** that runs `pnpm format:check` in `frontend/`, so the formatting check has a recipe and no longer needs a raw `pnpm` command.
* **Documented commands that work from the root:** every place that gives `corepack pnpm --dir frontend …` uses the new recipe where one exists, and otherwise `(cd frontend && corepack pnpm …)`. The places are `frontend/AGENTS.md`, the run-calendar skill (prerequisites, "Start the stack" step 4, "Test"), the story-draft skill (validation step), `docs/architecture/README.md` and `docs/runbooks/web-theme-and-styling.md`.
* **A guard against the form coming back**, if a cheap one fits the existing tests (for example a docs or tooling test that fails on `pnpm --dir frontend` in guidance files); otherwise the card records why not.

### Not in this story

* **Changing the pnpm pin** or the Corepack setup ([0005](../decisions/0005-pnpm-workspace-for-frontend.md)).
* **Rewriting history in finished cards:** [0009](0009-review-drafting-skills-for-clarity-and-simplicity.md) and [0019](0019-split-the-justfile-into-modules.md) quote the old form as a record of what was done and stay as they are.
* **New recipes for other pnpm commands** (for example one for a single package's tests); the `(cd …)` form covers them.

### Acceptance criteria

1. **Given** a clean checkout, **when** I run `just frontend format-check` from any folder, **then** it runs `prettier --check` over the frontend and exits 0 when everything is formatted and non-zero when a file is not.
2. **Given** the guidance files in scope, **when** I search them for `pnpm --dir frontend`, **then** none is left, and each replaced command works when pasted at the repository root.
3. **Given** the run-calendar skill, **when** an agent starts the throwaway stack from the repository root, **then** Vite starts and the health wait succeeds.
4. **Given** a guidance file that reintroduces `corepack pnpm --dir frontend`, **when** the tests run, **then** a test fails (or the card says why no such guard was added).
5. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0005](../decisions/0005-pnpm-workspace-for-frontend.md) | The frontend is a pnpm workspace with a pinned pnpm | The pin in `packageManager` is what Corepack must find; the fix keeps it and changes only where commands are run from. |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` is the task runner over native tooling | The new formatting check is a recipe in the frontend module, like the others. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **`cd` into the folder instead of a pnpm option:** the problem is which pnpm Corepack starts, and only the working folder decides that. No `--dir` form fixes it.
* **A recipe for formatting only:** it is the one raw command with a frequent caller (the checks CI runs). Other commands are rare enough for `(cd frontend && …)`.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| New recipe | `frontend/mod.just` |
| Guidance to update | `frontend/AGENTS.md`, `.claude/skills/run-calendar/SKILL.md`, `.claude/skills/story-draft/SKILL.md`, `docs/architecture/README.md`, `docs/runbooks/web-theme-and-styling.md` |

### API

No changes.

### Testing

* The recipe is run once passing and once against a deliberately unformatted file.
* The replaced commands are run from the repository root. Failure of the old form is reproduced first, for the record.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Checking the formatting of the frontend

This story changes contributor tooling only, so there is nothing for end users of the calendar. Contributors run `just frontend format-check` to check formatting without changing files, and `just frontend format` to fix it.
