---
status: planned
date: 2026-11-08
issue: https://github.com/mgasca/calendar/issues/553
pr:
  - https://github.com/mgasca/calendar/pull/555
adrs: ["0047"]
---

# 0050 Rearrange the day view buttons so the page starts with content sooner

## Story

> As a calendar editor, I need the day view's buttons beside the controls they belong with, so that the page uses its width and the agenda starts higher on the screen.

Tracked in issue #553. The wording is derived from an annotated screenshot and is to be confirmed by the product owner.

## Background

Today the day view stacks four rows above the agenda: the **Calendar date** picker, a row with **Add task** and **Add event**, the day heading, and a row with **Previous day**, **Today** and **Next day** ([0044](0044-edit-a-task-from-the-today-view.md) and the Today view epic built these rows one at a time). Each row uses a small part of the page width, so the agenda starts low, which hurts most on a phone.

The product owner marked up a screenshot of the view: the **Add task** and **Add event** buttons should sit to the right of the date picker, and the day navigation to the right of the heading. This is a layout change only; no behaviour changes.

### Agreed scope

* **Add task and Add event** share a row with the **Calendar date** picker, to its right, in the same order as today.
* **Day navigation** (**Previous day**, **Today** when shown, **Next day**) shares a row with the day heading, right-aligned, in the same order as today.
* **Narrow screens:** each group sits beside its neighbour when it fits and wraps below it when it does not, so the page never scrolls sideways on a phone. A group that wraps keeps its own internal order.
* **Behaviour is unchanged:** accessible names, the `Day` navigation landmark, focus handling after following a link, and the notifications for a saved task or event (which appear outside the page flow, so they never move the buttons).

### Not in this story

* **The Refresh button** stays where it is. Removing it, once automatic refresh covers everything, is issue #554.
* **The week and My tasks views** keep their current layout.
* **New or renamed controls**, and any change to what the buttons do.

### Acceptance criteria

1. **Given** a screen wide enough for both, **when** I open a day, **then** **Add task** and **Add event** are on the same row as the **Calendar date** picker, to its right, in that order.
2. **Given** a screen wide enough for both, **when** I open a day, **then** the day navigation is on the same row as the day heading, aligned to the right edge, in the order **Previous day**, **Today** (only on another day), **Next day**.
3. **Given** a phone-width screen, **when** I open a day, **then** each group wraps below its neighbour and the page has no horizontal scrollbar.
4. **Given** I follow **Previous day** or **Next day** with the keyboard, **when** the new day loads, **then** focus returns to the same control as before.
5. **Given** I add a task or an event, **when** it is saved, **then** the confirmation appears without moving the buttons.
6. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Styles use semantic CSS tokens, with light and dark themes | The new rules use the existing spacing tokens and must look right in both themes. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Wrap, not scroll:** each group wraps below its neighbour on narrow screens, because a sideways scrollbar is worse on a phone than one extra row.
* **Right-aligned navigation:** the navigation sits at the right edge of the heading row, so the heading keeps its left position and the buttons stay in one predictable place across days of different heading length.
* **Refresh deferred:** left alone here so this change stays a pure layout change; its removal depends on automatic refresh, tracked in #554.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Date picker and add buttons | `frontend/apps/web/src/features/day/DayPage.tsx` |
| Heading and day navigation | `frontend/apps/web/src/features/day/DayView.tsx` (`DayNav`) |
| Styles | `frontend/apps/web/src/index.css` (`.actions`, `.day-nav`, `.day-header`) |

### API

No changes.

### Testing

* Existing Testing Library tests in `DayView.test.tsx` and `App.test.tsx` keep passing, since names and roles do not change.
* The layout itself is checked in the running app at desktop and phone widths, with before and after screenshots in the PR.

### Lessons learned, known issues and follow-ups

* Follow-up: remove the Refresh button, issue #554.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Finding the day view buttons

**Add task** and **Add event** are next to the **Calendar date** picker. **Previous day**, **Today** and **Next day** are on the right of the day's heading. On a narrow screen they move below the control they sit beside.
