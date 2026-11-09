---
status: implemented
date: 2026-11-09
issue: https://github.com/mgasca/calendar/issues/554
pr:
  - https://github.com/mgasca/calendar/pull/584
adrs: ["0020", "0047"]
---

# 0052 Remove the Refresh button from the day and week views, because they keep themselves up to date

## Story

> As a calendar editor, I need the day and week views to stay up to date without a manual **Refresh** button, so that the header has one less control and I never wonder whether I am looking at old data.

Tracked in issue #554. The wording is derived from the issue; the product owner accepted it by merging the card (#584).

## Background

The day view ([0001](0001-today-view.md), refined in [0042](0042-refine-the-today-view.md)) and the week view ([0002](0002-week-view.md)) each show a **Refresh** button in their header. It reloads the agenda and reads "Refreshing…" while it works. The button predates most of the automatic refresh both views now have.

On 2026-11-08 the code on `main` (11cebe08d) was read to check whether anything still depends on the button. Both views already reload on their own:

* **Every five minutes** while the page is visible (the shared agenda polling interval).
* **When the window regains focus**, once the data is more than 30 seconds old.
* **When the connection comes back**, by the query library's default, which nothing overrides.
* **After every change made in the app**: ticking, adding, editing or deleting a task; adding, editing or deleting an event; and triage. Each reloads every agenda view.

Nothing relies on **Refresh** to recover: when loading or reloading fails, the error message has its own **Try again** button. The dimmed "stale" look while another day or week loads clears by itself when it arrives.

What is missing is test coverage. The day view has tests for polling and focus but not for reconnect. The week view has none of the three. This story adds those tests before the button goes, so every automatic path is pinned once the manual one is gone.

The product owner agreed on #554 to take the week view's button out in the same story, since it sits on the same automatic refresh.

### Agreed scope

* **No Refresh button** in the day view header or the week view header, and so no "Refreshing…" label.
* **Automatic refresh is unchanged:** every five minutes while visible, on returning to the window after 30 seconds, on reconnecting, and after every change made in the app.
* **Errors keep their recovery:** the "Couldn't load" and "Couldn't refresh; showing the last loaded …" messages keep their **Try again** button, in both views.
* **The header reflows:** the summary line and the controls that sat beside **Refresh** take its place, with no gap left behind, at desktop and phone widths, in both themes.
* **Tests for every automatic path in both views:** polling, focus and reconnect, each with a test that fails if that path stops reloading.
* **Docs that mention the button are updated:** the user guides of [0001](0001-today-view.md) and [0042](0042-refine-the-today-view.md), and the styles and style tests that exist only for the button.

### Not in this story

* **My tasks** has no Refresh button and keeps its own refresh as it is.
* **Changing the refresh timing** (the five-minute interval or the 30-second staleness), or adding live updates pushed from the server.
* **A visible "last updated" time** or a live-region announcement when a reload finishes.
* **Pull-to-refresh** or a keyboard shortcut to reload; the browser's own reload still works.

### Acceptance criteria

1. **Given** the day view, **when** it loads, **then** there is no **Refresh** button and no "Refreshing…" text in it. [Day view](../../frontend/apps/web/src/features/day/DayView.test.tsx) (`has no Refresh button, since the agenda refreshes itself (story 0052)`); [no Refresh rules left](../../frontend/apps/web/dev/styles.test.ts) (`has no Refresh button rules left, …`).
2. **Given** the week view, **when** it loads, **then** there is no **Refresh** button and no "Refreshing…" text in it. [Week view](../../frontend/apps/web/src/features/week/WeekView.test.tsx) (`has no Refresh button, since the week refreshes itself`).
3. **Given** the day view or the week view is open and visible, **when** five minutes pass, **then** it reloads its agenda. [Day view](../../frontend/apps/web/src/features/day/DayView.test.tsx) and [week view](../../frontend/apps/web/src/features/week/WeekView.test.tsx) (`refetches every five minutes to pick up changes from other devices`).
4. **Given** the day view or the week view has data more than 30 seconds old, **when** the window regains focus, **then** it reloads its agenda; with fresher data it does not. [Day view](../../frontend/apps/web/src/features/day/DayView.test.tsx) and [week view](../../frontend/apps/web/src/features/week/WeekView.test.tsx) (`refetches when the window regains focus once the data is stale`).
5. **Given** the day view or the week view is open, **when** the connection drops and comes back, **then** it reloads its agenda. [Day view](../../frontend/apps/web/src/features/day/DayView.test.tsx) and [week view](../../frontend/apps/web/src/features/week/WeekView.test.tsx) (`refetches when the connection comes back once the data is stale`). As with focus, the reload happens once the data is more than 30 seconds old.
6. **Given** a reload of the day view or the week view fails while data is shown, **when** I select **Try again** in the error message, **then** the agenda reloads and the message goes once it succeeds. [Day view](../../frontend/apps/web/src/features/day/DayView.test.tsx) (`keeps the last agenda when an automatic refresh fails, and Try again recovers`); [week view](../../frontend/apps/web/src/features/week/WeekView.test.tsx) (`keeps the last week when an automatic refresh fails, and Try again recovers`).
7. **Given** the day view or the week view, **when** I see its header at desktop and phone widths, in light and dark, **then** no gap is left where **Refresh** was and the page never scrolls sideways. Checked by hand in the running app, with before and after screenshots on the delivery PR; at 390 px the page measured 390 px wide in both views. Not covered by an automatic test, because the web tests run without layout.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes. CI on the delivery PR.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0020](../decisions/0020-aggregate-day-agenda-endpoint-as-read-model.md) | Resource endpoints for writes, the agenda as a read model | Every write is followed by a reload of the agenda read model; that reload is what makes a manual Refresh unnecessary after changes made in the app. |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Styles use semantic CSS tokens, with light and dark themes | The reflowed headers must look right in both themes. |

No new ADR is expected.

### Other decisions (not ADR-worthy)

* **Both views in one story:** the week view's button sits on the same automatic refresh, so judging the two separately would repeat the same check; agreed on #554.
* **Tests before removal:** the reconnect and week view tests land with the removal, in the same PR, so there is never a revision where a path is neither tested nor backed by a manual button.
* **Keep Try again:** an error is the one case where waiting for the next automatic reload is not good enough, so the error message keeps its own retry.
* **Rely on the library defaults:** reload on focus and on reconnect stay the query library's defaults rather than being set explicitly; the new tests pin them, so a change of default or an accidental override fails a test.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Day header (button removed) | `frontend/apps/web/src/features/day/DayView.tsx` |
| Week header (button removed) | `frontend/apps/web/src/features/week/WeekView.tsx` |
| Agenda queries and polling interval (unchanged) | `frontend/apps/web/src/features/day/useDayAgenda.ts`, `frontend/apps/web/src/features/week/useWeekAgenda.ts`, `frontend/apps/web/src/features/agenda/agendaQuery.ts` |
| Query defaults: 30-second staleness, focus and reconnect reload by default (unchanged) | `frontend/apps/web/src/queryClient.ts` |
| Styles | the `.refresh` rules left `frontend/apps/web/src/index.css`; `frontend/apps/web/dev/styles.test.ts` now checks none remain |

### API

No changes.

### Testing

* Day view (`DayView.test.tsx`, `clock` block): reconnect, no Refresh button, and a failed automatic refresh that keeps the last agenda and recovers with **Try again** are new; polling and focus were already tested.
* Week view (`WeekView.test.tsx`, `refreshing (story 0052)` block): no Refresh button, polling, focus, reconnect and **Try again** after a failed automatic refresh, all new.
* Removed with the button: `refreshes on demand and shows when it is fetching` and the two Refresh style tests (#464, #521). The `.summary-part` check from the first of those is kept as its own test.
* Negative controls, in a scratch worktree of `main` at df403f6a3 with the new test files copied in: the three "no Refresh" tests failed against the old views and styles. With `refetchOnWindowFocus: false` and `refetchOnReconnect: false` in the query defaults, the six focus, reconnect and **Try again** tests failed; without the week polling interval, the week polling test failed.
* In the running app (throwaway stack, both `main` and this branch on one API), both views at 1280×900 and 390×844 in Light and Dark: no gap where **Refresh** was, no `.refresh` element, the page 390 px wide at 390 px, and no console or HTTP errors.

### Lessons learned, known issues and follow-ups

* **Reconnect reloads only stale data**, like focus: a connection that drops and returns within 30 seconds of the last load does not reload. That is the query library's behaviour and was left as it is; the five-minute poll still catches anything missed.
* **No manual reload in the app.** A user who wants one uses the browser's reload. If that proves to be missed, a follow-up can add one without bringing back a permanent button.

## User guide

### Keeping the day and week up to date

The day and week views keep themselves up to date. They reload every five minutes while you are looking at them, when you come back to the window, and when your connection returns. Anything you change in the app shows straight away in every view.

If a reload fails, you keep seeing what was last loaded, with a *"Couldn't refresh"* message. Select **Try again** to reload. To force a reload at any other time, use your browser's reload.
