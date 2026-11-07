---
status: planned
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/458
pr:
  - https://github.com/mgasca/calendar/pull/471
adrs: ["0008", "0021", "0026", "0043", "0047"]
---

# 0042 Refine the Today view so it behaves predictably and lets me act on what I see

## Story

> As a calendar owner, I need the Today view to behave predictably and let me act on what I see, so that it stays the one place I manage my day.

Tracked in epic #458. This card covers the epic's bugs and smaller enhancements: #459, #460, #461, #462, #463, #464 and #465. Editing and deleting events (#466) and editing tasks (#467) add API endpoints and have their own cards, 0043 and 0044.

## Background

The Today view (`/` and `/day/:date`, story [0001](0001-today-view.md)) shows a day's all-day events, its schedule and its tasks, with **Add task** and **Add event** dialogs ([0004](0004-add-event-entries.md), [0006](0006-modal-dialogs-for-adding.md)), task completion and deletion ([0007](0007-overdue-triage-and-task-deletion.md)), and the two themes of [0039](0039-switchable-light-and-dark-themes.md).

On 2026-11-07 the view was inspected in the running app in Light and Dark, at desktop (1280×900) and phone (390×844) widths, on `main` at 52c667e65, together with a read of its code. The product owner had reported two problems: saving a task breaks the row of **Add** buttons, and save confirmations stay in the page for good. The same pass found a silent delete failure, a wrong **Next** badge, a cramped phone layout, debugging output in the footer, a **Refresh** button that changes width, uneven dialog spacing, and no quick way to step between days. Each is a child issue of #458; this card is their shared record.

### Agreed scope

* **Add buttons stay together (#459):** **Add task** and **Add event** sit side by side in one action row, and no confirmation, error or dialog is rendered between them, so saving a task or an event never moves either button.
* **A failed task delete is reported (#460):** when deleting a task fails, the confirm dialog stays open with an error inside it (`role="alert"`), and **Delete** retries or **Cancel** closes it. The confirmation names the task ("Delete “Book the dentist”?").
* **Every event at the earliest future start is Next (#461):** on today, when several not-yet-started events share the earliest future start time, all of them show **Next**; later ones are upcoming as before.
* **Compact rows on a phone (#462):** at 390 px wide, a task's **Delete** no longer takes a line of its own under every task, schedule badges (**Earlier**, **Now**, **Next**) stay with the event's title or time consistently, the header summary does not split a phrase across lines beside **Refresh**, controls stay at least 24×24 px (WCAG 2.5.8), and the page never scrolls sideways. Desktop is unchanged.
* **Save confirmations as a fading notification (#463):** after a task or an event is saved, a notification ("toast") outside the page flow confirms it, so the layout never shifts:
  * one notification at a time: a newer one replaces the older one;
  * it fades out after about six seconds (proposed), and the timer pauses while the pointer is over it or focus is inside it, and restarts when they leave (WCAG 2.2.1);
  * it has a **Dismiss** button that removes it at once;
  * it is announced once through a polite live region and never takes focus; focus still returns to the **Add** button that opened the dialog;
  * with reduced motion requested it appears and disappears without animating;
  * the event message names the event and its day, as today ("Dentist added for Thu 29 Oct."); the task message names the task ("“Book the dentist” added.") and, when the task is due on a day other than the one shown, its day ("“Book the dentist” added for Fri 13 Nov."). The old "You can find it in My tasks." is dropped, because the task is often in the list right below;
  * an event or a dated task saved for a day other than the one shown offers **Show day**, which opens that day;
  * it uses the theme tokens and meets WCAG AA contrast in both themes (ADR-0047);
  * the component is shared, so **My tasks** uses it for its **Add task** too, and the Week view can adopt it later.
* **Polish (#464):**
  * no "API status: ok" line at the foot of every page; a failing API is already reported where the data fails to load;
  * **Refresh** keeps its size and position while a refresh runs, and assistive technology still learns that it is running (`aria-busy` and an accessible status);
  * the **Add task** and **Add event** dialogs (and every dialog built on the same component) have the same space above the heading as on their other sides.
* **Day navigation (#465):** beside the day heading:
  * **Previous day** and **Next day** buttons open the adjacent day at `/day/:date`, so the URL and browser history follow (ADR-0026);
  * a **Today** button opens today's date and is shown only when another day is open;
  * the existing **Calendar date** picker and **Week of …** link stay;
  * the client keeps deciding what today is (ADR-0021), and the controls work across month, year and daylight-saving boundaries and stop at the picker's limits (1900-01-01 and 2200-12-31);
  * every control has an accessible name, is reachable by keyboard, and reads well in both themes.

### Not in this story

* **Editing and deleting events (#466)** and **editing tasks (#467):** cards 0043 and 0044 (written separately; linked here when they merge), because they add API endpoints and regenerate the contract.
* **Keyboard shortcuts for day navigation** (for example `←`, `→`, `t`): offered as optional on #465 and left out (proposed). Single-key shortcuts must be switchable off or limited to focus to meet WCAG 2.1.4, and they compete with screen-reader keys; the buttons give the same navigation. A follow-up issue can add them with a way to turn them off.
* **The date picker's format:** the native picker follows the browser's locale (`11/07/2026` in an en-US browser) while the heading uses the app's format; restyling or replacing the native picker is not planned here.
* **Notifications for errors:** save and load errors stay inline (`role="alert"`) where they happen.
* **Notifications in the Week view and Triage:** the component is reusable, but adopting it there is later work.
* **Moving health elsewhere:** if the product owner decides on #464 that the API's health must stay visible, where it goes is decided there first; this card assumes it is removed.
* **New task or event fields, or server changes:** none; the API is unchanged by this card.

### Dependencies

* #459 lands first and on its own, so the button-row fix does not wait for the notification.
* #463, #464 and #465 follow in that order, because they edit the same action row, day header and dialog.
* #461 is independent; #460 comes before #462, which restyles the same task row.
* #466 and #467 (cards 0043 and 0044) touch the schedule rows and the task row after #462. This card is completed after all of #459–#465 have merged.

### Acceptance criteria

1. **Given** the Today view, **when** I add a task, then an event (or the reverse), **then** **Add task** and **Add event** stay on one row in the same place, and no status element sits between them.
2. **Given** a task on the Today view, **when** I confirm its deletion and the server fails, **then** the dialog stays open with an error and I can retry or cancel; **when** the delete succeeds, **then** the dialog closes as before; and the confirmation names the task.
3. **Given** today has two not-yet-started events with the same start, earlier than any other future event, **when** the view shows them, **then** both are marked **Next**; **given** future events with different starts, **then** only the earliest is **Next**.
4. **Given** a 390 px wide viewport in either theme, **when** the Today view lists tasks and events, **then** **Delete** does not take a line of its own for every task, badges stay with the event's title or time, controls are at least 24×24 px, and there is no page-level horizontal overflow; the desktop layout is unchanged.
5. **Given** the Today view, **when** I save a task or an event, **then** a notification confirms it naming the item, the page layout does not move, and the notification is gone after about six seconds.
6. **Given** a notification is showing, **when** I hover over it or move focus into it, **then** it stays until I leave it; **when** I select **Dismiss**, **then** it disappears at once; **when** another save succeeds, **then** the new notification replaces it.
7. **Given** I save an event, or a task with a due date, for a day other than the one shown, **when** the notification appears, **then** it offers **Show day**, which opens that day.
8. **Given** a screen reader, **when** a save succeeds, **then** the confirmation is announced once, and focus returns to the **Add** button rather than moving to the notification.
9. **Given** reduced motion is requested, **when** a notification appears or leaves, **then** it does not animate.
10. **Given** either theme, **when** a notification is shown, **then** its text and controls meet WCAG AA contrast.
11. **Given** the API is healthy, **when** any view is open, **then** no "API status" line is shown.
12. **Given** the Today view, **when** I press **Refresh**, **then** the button keeps its size and position, and assistive technology learns that a refresh is running.
13. **Given** either add dialog, **when** it opens, **then** the space above its heading matches its padding on the other sides.
14. **Given** any day, **when** I select **Next day** or **Previous day**, **then** the adjacent day opens and the URL follows, including across a month, a year and a daylight-saving change.
15. **Given** a day other than today, **when** I select **Today**, **then** today's date opens; **given** today is open, **then** the **Today** button is not shown.
16. **Given** keyboard-only use in either theme, **when** I tab through the day header, **then** **Previous day**, **Today** and **Next day** have accessible names, visible focus, and work with Enter and Space.
17. **Given** the change is complete, **when** I run `just check`, **then** it passes, and the PRs show screenshots of the Today view in both themes at desktop and phone widths.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0021](../decisions/0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's IANA time zone and local date define "today" | **Today** and the adjacent days are computed on the client; the **Next** badge uses the client's clock |
| [0026](../decisions/0026-client-side-routing-with-tanstack-router.md) | Client-side routing with TanStack Router | Day navigation and **Show day** go to `/day/:date`, so the URL and history follow |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic CSS tokens selected by `data-theme` | The notification, the navigation controls and the phone rows use tokens and shared classes only, and are checked in both themes |
| [0043](../decisions/0043-form-validation-red-borders-and-bubble.md) | Form errors as red borders with a bubble | Unchanged; only the success confirmation moves to a notification |
| [0008](../decisions/0008-frontend-testing-stack.md) | Vitest, Testing Library and MSW | Where the layout, timer, live-region and failure tests live |

No new ADR is expected. A notification component and its timing are a local UI choice, not a cross-cutting one.

### Other decisions (not ADR-worthy)

* **One card for the epic:** the seven issues are small and touch the same view, so one card records them, as [0039](0039-switchable-light-and-dark-themes.md) did for epic #428. The two issues that add endpoints keep their own cards.
* **The button row is the parent's layout:** the page that shows the **Add** buttons owns the row they sit in, and confirmations leave the buttons' components, so no message can land between the buttons again.
* **One notification, replaced rather than stacked:** the view never produces more than one save at a time, so a stack would only hold stale messages.
* **Six seconds, paused on hover and focus (proposed):** long enough to read a short message and reach **Show day**; pausing meets WCAG 2.2.1 without a setting. To be confirmed by the product owner on #463.
* **A polite live region that exists before the message:** the region is always in the page and only its content changes, so screen readers announce each confirmation once; the notification never takes focus, so the dialog's focus return is unaffected.
* **Remove the health line rather than move it (proposed):** health is for operators and is already exposed by the API's health endpoint; data-load errors tell the user what failed. To be confirmed on #464.
* **Buttons, not shortcuts, for day navigation (proposed):** see "Not in this story".

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Day page, action row and date picker | `frontend/apps/web/src/features/day/DayPage.tsx` |
| Day header, **Refresh**, schedule and task sections | `frontend/apps/web/src/features/day/DayView.tsx` |
| **Add task** and **Add event** buttons | `frontend/apps/web/src/features/tasks/AddTask.tsx`, `frontend/apps/web/src/features/events/AddEvent.tsx` |
| Notification component | new, under `frontend/apps/web/src/components/` |
| Dialog shell and confirm dialog | `frontend/apps/web/src/components/ModalDialog.tsx`, `ConfirmDialog.tsx` |
| Task row and its delete | `frontend/apps/web/src/features/agenda/TaskItem.tsx`, `useDeleteTask.ts` |
| Event statuses (**Next**) | `frontend/apps/web/src/features/agenda/dayTime.ts` (`eventStatuses`) |
| Health footer | `frontend/apps/web/src/features/health/ApiStatus.tsx`, rendered by `AppLayout` in `src/App.tsx` |
| Shared styles | `frontend/apps/web/src/styles/components.css`, each issue in its own commented block |

### API

No changes.

### Testing

* Component tests (Vitest, Testing Library, MSW): the action row after a task and an event save; the notification's text, replacement, timer, pause on hover and focus, **Dismiss**, **Show day** and single announcement (fake timers); the delete failure with an MSW handler answering 500; the **Refresh** button's label and busy state; day navigation and **Today**.
* Unit tests: `eventStatuses` with equal start times in `dayTime.test.ts`; the adjacent-day computation across month, year and daylight-saving boundaries.
* Each bug fix comes with a test that fails on the old code, confirmed before the fix.
* By hand in the running app (`run-calendar` skill): Light and Dark at 1280×900 and 390×844, with before and after screenshots on each PR; reduced motion with the browser's emulation.

### Lessons learned, known issues and follow-ups

* To be written when the story is delivered.

### Delivery plan

PR 0 is this card. Then one PR per issue: #459, #463, #464 and #465 in that order (they share the action row and the header); #461; #460, then #462. Cards 0043 (#466) and 0044 (#467) follow their own PR 0s. This card is completed in the last delivery PR.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Moving between days

The day's heading has **Previous day** and **Next day** buttons that step one day back or forward. When you are looking at another day, **Today** brings you back to today. You can still pick any date with **Calendar date**, or open the week with **Week of …**. The address in the browser follows the day you are on, so Back and Forward work too.

### Adding a task or an event

Select **Add task** or **Add event**, fill in the form and save. A short notification appears at the edge of the screen to confirm what was added, without moving anything on the page. If you added it to another day, the notification offers **Show day** to go there. The notification fades after a few seconds; it stays while you point at it or tab into it, and **Dismiss** closes it straight away.

### Deleting a task

Select **Delete** on a task and confirm. The confirmation names the task. If the delete fails, the dialog says so and you can try again or cancel.

### On a phone

Each task and event takes one compact row: the title gets the space, and the status badges (**Earlier**, **Now**, **Next**) stay with their event.
