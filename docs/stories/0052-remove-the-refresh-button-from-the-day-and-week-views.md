---
status: planned
date: 2026-11-09
issue: https://github.com/mgasca/calendar/issues/554
pr: []
adrs: ["0020", "0047"]
---

# 0052 Remove the Refresh button from the day and week views, because they keep themselves up to date

## Story

> As a calendar editor, I need the day and week views to stay up to date without a manual **Refresh** button, so that the header has one less control and I never wonder whether I am looking at old data.

Tracked in issue #554. The wording is derived from the issue and is to be confirmed by the product owner.

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

1. **Given** the day view, **when** it loads, **then** there is no **Refresh** button and no "Refreshing…" text in it.
2. **Given** the week view, **when** it loads, **then** there is no **Refresh** button and no "Refreshing…" text in it.
3. **Given** the day view or the week view is open and visible, **when** five minutes pass, **then** it reloads its agenda.
4. **Given** the day view or the week view has data more than 30 seconds old, **when** the window regains focus, **then** it reloads its agenda; with fresher data it does not.
5. **Given** the day view or the week view is open, **when** the connection drops and comes back, **then** it reloads its agenda.
6. **Given** a reload of the day view or the week view fails while data is shown, **when** I select **Try again** in the error message, **then** the agenda reloads and the message goes once it succeeds.
7. **Given** the day view or the week view, **when** I see its header at desktop and phone widths, in light and dark, **then** no gap is left where **Refresh** was and the page never scrolls sideways.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes.

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

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Day header | `frontend/apps/web/src/features/day/DayView.tsx` |
| Week header | `frontend/apps/web/src/features/week/WeekView.tsx` |
| Agenda queries and polling interval | `frontend/apps/web/src/features/day/useDayAgenda.ts`, `frontend/apps/web/src/features/week/useWeekAgenda.ts`, `frontend/apps/web/src/features/agenda/agendaQuery.ts` |
| Query defaults (staleness, retries) | `frontend/apps/web/src/queryClient.ts` |
| Refresh styles and their tests | `frontend/apps/web/src/index.css` (`.refresh`), `frontend/apps/web/dev/styles.test.ts` |

### API

No changes.

### Testing

* Component tests with MSW in `DayView.test.tsx` and `WeekView.test.tsx`: no Refresh button; reload after five minutes, on focus once stale, and on reconnect; **Try again** after a failed reload.
* The test `refreshes on demand and shows when it is fetching` and the Refresh style tests go with the button.
* The reflowed headers are checked in the running app at desktop and phone widths, in both themes, with before and after screenshots in the PR.

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Keeping the day and week up to date

The day and week views keep themselves up to date. They reload every five minutes while you are looking at them, when you come back to the window, and when your connection returns. Anything you change in the app shows straight away in every view.

If a reload fails, you keep seeing what was last loaded, with a *"Couldn't refresh"* message. Select **Try again** to reload. To force a reload at any other time, use your browser's reload.
