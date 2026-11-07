---
status: implemented
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/458
pr:
  - https://github.com/mgasca/calendar/pull/471
  - https://github.com/mgasca/calendar/pull/487
  - https://github.com/mgasca/calendar/pull/470
  - https://github.com/mgasca/calendar/pull/486
  - https://github.com/mgasca/calendar/pull/489
  - https://github.com/mgasca/calendar/pull/493
  - https://github.com/mgasca/calendar/pull/494
  - https://github.com/mgasca/calendar/pull/498
  - https://github.com/mgasca/calendar/pull/491
adrs: ["0008", "0021", "0026", "0043", "0047"]
---

# 0042 Refine the Today view so it behaves predictably and lets me act on what I see

## Story

> As a calendar owner, I need the Today view to behave predictably and let me act on what I see, so that it stays the one place I manage my day.

Tracked in epic #458. This card covers the epic's bugs and smaller enhancements: #459, #460, #461, #462, #463, #464 and #465. Editing and deleting events (#466) and editing tasks (#467) add API endpoints and have their own cards, [0043](0043-edit-and-delete-events-from-the-today-view.md) and [0044](0044-edit-a-task-from-the-today-view.md).

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
  * it fades out after six seconds (proposed; not yet confirmed by the product owner), and the timer pauses while the pointer is over it or focus is inside it, and restarts when they leave (WCAG 2.2.1);
  * it has a **Dismiss** button that removes it at once;
  * it is announced once through a polite live region and never takes focus; focus still returns to the **Add** button that opened the dialog;
  * with reduced motion requested it appears and disappears without animating;
  * the event message names the event and its day, as today ("Dentist added for Thu 29 Oct."); the task message names the task ("“Book the dentist” added.") and, when the task is due on a day other than the one shown, its day ("“Book the dentist” added for Fri 13 Nov."). The old "You can find it in My tasks." is dropped, because the task is often in the list right below;
  * an event or a dated task saved for a day other than the one shown offers **Show day**, which opens that day;
  * it uses the theme tokens and meets WCAG AA contrast in both themes (ADR-0047);
  * the component is shared, so **My tasks** uses it for its **Add task** too, and the Week view can adopt it later.
* **Polish (#464):**
  * no "API status: ok" line at the foot of every page; a failing API is already reported where the data fails to load;
  * **Refresh** keeps its size and position while a refresh runs, and assistive technology still learns that it is running (`aria-busy`, and the button's name changes to "Refreshing…"; no separate live region was added, see the implementation notes);
  * the **Add task** and **Add event** dialogs (and every dialog built on the same component) have the same space above the heading as on their other sides.
* **Day navigation (#465):** under the day heading:
  * **Previous day** and **Next day** open the adjacent day at `/day/:date`, so the URL and browser history follow (ADR-0026); they are links drawn as small buttons, because they navigate;
  * **Today** opens today and is shown only when another day is open;
  * the controls stay on screen while the next day loads, and keyboard focus stays on the control just used;
  * the existing **Calendar date** picker and **Week of …** link stay;
  * the client keeps deciding what today is (ADR-0021), and the controls work across month, year and daylight-saving boundaries and stop at the picker's limits (1900-01-01 and 2200-12-31);
  * every control has an accessible name, is reachable by keyboard, and reads well in both themes.

### Not in this story

* **Editing and deleting events (#466)** and **editing tasks (#467):** cards [0043](0043-edit-and-delete-events-from-the-today-view.md) and [0044](0044-edit-a-task-from-the-today-view.md), delivered by #488 and #491 (events) and #495 and #499 (tasks), because they add API endpoints and regenerate the contract.
* **Keyboard shortcuts for day navigation** (for example `←`, `→`, `t`): offered as optional on #465 and left out (proposed; not yet confirmed by the product owner). Single-key shortcuts must be switchable off or limited to focus to meet WCAG 2.1.4, and they compete with screen-reader keys; the buttons give the same navigation. A follow-up issue can add them with a way to turn them off.
* **The date picker's format:** the native picker follows the browser's locale (`11/07/2026` in an en-US browser) while the heading uses the app's format; restyling or replacing the native picker is not planned here.
* **Notifications for errors:** save and load errors stay inline (`role="alert"`) where they happen.
* **Notifications in the Week view and Triage:** the component is reusable, but adopting it there is later work.
* **Moving health elsewhere:** the line was removed, not moved (proposed; not yet confirmed by the product owner). If the product owner decides on #464 that the API's health must stay visible, where it goes is decided there first.
* **New task or event fields, or server changes:** none; the API is unchanged by this card.

### Dependencies

* #459 lands first and on its own, so the button-row fix does not wait for the notification.
* #463, #464 and #465 follow in that order, because they edit the same action row, day header and dialog.
* #461 is independent; #460 comes before #462, which restyles the same task row.
* #466 and #467 (cards 0043 and 0044) touch the schedule rows and the task row after #462. This card was completed after all of #459–#467 had merged.

### Acceptance criteria

1. **Given** the Today view, **when** I add a task, then an event (or the reverse), **then** **Add task** and **Add event** stay on one row in the same place, and no status element sits between them. [Button row](../../frontend/apps/web/src/App.test.tsx) (`keeps Add task and Add event in one row, with no confirmation between them (#459)`); same `top` measured in the browser in both themes and widths (#487).
2. **Given** a task on the Today view, **when** I confirm its deletion and the server fails, **then** the dialog stays open with an error and I can retry or cancel; **when** the delete succeeds, **then** the dialog closes as before; and the confirmation names the task. [Delete failure and retry](../../frontend/apps/web/src/features/agenda/TaskItem.test.tsx) (`keeps the dialog open with an error when the delete fails, and lets the user retry`, `clears the error when the dialog is cancelled and opened again`, `names the task in the confirmation`).
3. **Given** today has two not-yet-started events with the same start, earlier than any other future event, **when** the view shows them, **then** both are marked **Next**; **given** future events with different starts, **then** only the earliest is **Next**. [Equal starts](../../frontend/apps/web/src/features/agenda/dayTime.test.ts) (`marks every event at the earliest future start as next (#461)`); different starts by the existing `marks past, current, the first upcoming as next, and the rest upcoming`.
4. **Given** a 390 px wide viewport in either theme, **when** the Today view lists tasks and events, **then** **Delete** does not take a line of its own for every task, badges stay with the event's title or time, controls are at least 24×24 px, and there is no page-level horizontal overflow; the desktop layout is unchanged. [Row structure](../../frontend/apps/web/src/features/agenda/TaskItem.test.tsx) (`groups the badge and Notes as extras and Delete as the row actions, after the title`, `leaves out the extras when the task has no priority and no notes`). The layout itself is checked by hand only (jsdom has no layout): on #489, **Delete** 68×32 and **Notes** 65×32 px, no horizontal overflow, and desktop screenshots byte-identical to `main`'s.
5. **Given** the Today view, **when** I save a task or an event, **then** a notification confirms it naming the item, the page layout does not move, and the notification is gone after six seconds. [Fade timing](../../frontend/apps/web/src/components/Notification.test.tsx) (`shows the message in a live region outside the page flow, then fades it after six seconds`); [task and event wording, outside `main`](../../frontend/apps/web/src/App.test.tsx) (`creates a task on the shown day and displays it in the day view and in My tasks`, `saves a timed event, refreshes the agenda, and returns keyboard focus`). In the browser (#493), the day heading kept its `top` after a save, and the notification was closed 6.6 s later.
6. **Given** a notification is showing, **when** I hover over it or move focus into it, **then** it stays until I leave it; **when** I select **Dismiss**, **then** it disappears at once; **when** another save succeeds, **then** the new notification replaces it. [Pause, dismiss, replace](../../frontend/apps/web/src/components/Notification.test.tsx) (`stays while the pointer is over it and fades six seconds after it leaves`, `stays while focus is inside it and fades after focus leaves`, `disappears at once on Dismiss and returns focus to where it came from`, `announces once: the same live region gets one new message, which replaces the previous one`).
7. **Given** I save an event, or a task with a due date, for a day other than the one shown, **when** the notification appears, **then** it offers **Show day**, which opens that day. [Task](../../frontend/apps/web/src/App.test.tsx) (`offers Show day for a task due on another day, from the day view and from My tasks`); [event](../../frontend/apps/web/src/App.test.tsx) (`keeps the current day after saving elsewhere and Show day navigates`); [action dismisses](../../frontend/apps/web/src/components/Notification.test.tsx) (`runs its action and dismisses itself`).
8. **Given** a screen reader, **when** a save succeeds, **then** the confirmation is announced once, and focus returns to the **Add** button rather than moving to the notification. [One live region, one new node per message](../../frontend/apps/web/src/components/Notification.test.tsx) (`announces once: …`, `never takes focus`); focus return in the App tests above. Not checked with a real screen reader.
9. **Given** reduced motion is requested, **when** a notification appears or leaves, **then** it does not animate. [Style guard](../../frontend/apps/web/dev/styles.test.ts) (`%s animates only when reduced motion is not requested`: every animation and transition sits in a `prefers-reduced-motion: no-preference` block). Not checked with browser emulation.
10. **Given** either theme, **when** a notification is shown, **then** its text and controls meet WCAG AA contrast. The notification uses `text` on `surface-raised` and `border-strong`, pairs covered by the [token contrast tests](../../frontend/apps/web/dev/styles.test.ts) (`text %s on %s is at least 4.5:1`, `non-text %s on %s is at least 3:1`); looked at in both themes on #493.
11. **Given** the API is healthy, **when** any view is open, **then** no "API status" line is shown. [No footer, no health polling](../../frontend/apps/web/src/App.test.tsx) (`shows no API status line and does not poll the health endpoint (#464)`).
12. **Given** the Today view, **when** I press **Refresh**, **then** the button keeps its size and position, and assistive technology learns that a refresh is running. [Both labels, busy state](../../frontend/apps/web/src/features/day/DayView.test.tsx) (`refreshes on demand and shows when it is fetching`); [grid cell rules](../../frontend/apps/web/dev/styles.test.ts) (`keeps Refresh one width and each day-summary part on one line (#464)`); measured 105 px wide before and during a refresh on #494.
13. **Given** either add dialog, **when** it opens, **then** the space above its heading matches its padding on the other sides. [Style guard](../../frontend/apps/web/dev/styles.test.ts) (`gives dialog headings no top margin, so the gap above matches the padding (#464)`); measured 17 px above and 17 px to the left of the heading in both add dialogs on #494.
14. **Given** any day, **when** I select **Next day** or **Previous day**, **then** the adjacent day opens and the URL follows, including across a month, a year and a daylight-saving change. [Day navigation](../../frontend/apps/web/src/App.test.tsx) (`steps through the days around a daylight-saving change, and the URL follows`, `crosses %s` for month, year and leap-day boundaries, `stops at the %s supported day`).
15. **Given** a day other than today, **when** I select **Today**, **then** today's date opens; **given** today is open, **then** the **Today** control is not shown. [Today](../../frontend/apps/web/src/App.test.tsx) (`offers Today only on another day, and it opens today`).
16. **Given** keyboard-only use in either theme, **when** I tab through the day header, **then** **Previous day**, **Today** and **Next day** have accessible names, visible focus, and open their day with Enter, and focus stays on the control used. They are links, so Enter (not Space) follows them; the planned wording said "Enter and Space" and was corrected on delivery. [Names and keyboard](../../frontend/apps/web/src/App.test.tsx) (`names its links for assistive technology and keeps them reachable by keyboard`, `keeps the controls while the next day loads and keeps keyboard focus on the one used`); the 3 px focus ring was measured in the browser on #498.
17. **Given** the change is complete, **when** I run `just check`, **then** it passes, and the PRs show screenshots of the Today view in both themes at desktop and phone widths. `just check` passed locally on #498's head; every delivery PR carries Light and Dark screenshots at 1280×900 and 390×844 (#470's fix is a status rule and shows none).

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
* **Six seconds, paused on hover and focus (proposed, still open):** long enough to read a short message and reach **Show day**; pausing meets WCAG 2.2.1 without a setting. Shipped this way; the product owner has not answered on #463.
* **Task wording (proposed, still open):** "“Book the dentist” added." (plus the day and **Show day** for another day) instead of "Task added. You can find it in My tasks."; shipped, not yet confirmed on #463.
* **A polite live region that exists before the message:** the region is always in the page and only its content changes, so screen readers announce each confirmation once; the notification never takes focus, so the dialog's focus return is unaffected.
* **Remove the health line rather than move it (proposed, still open):** health is for operators and is already exposed by the API's health endpoint; data-load errors tell the user what failed. Shipped; not yet confirmed on #464.
* **Links, not shortcuts, for day navigation (proposed, still open):** the controls navigate, so they are links (the theme guide's rule of `<a>` for navigation), which also gives open-in-new-tab. Keyboard shortcuts were left out (see "Not in this story"); not yet confirmed on #465.
* **Targets from the URL, not the data:** the adjacent days are computed from the route's date, so pressing **Next day** twice while a day loads moves two days.

## Implementation notes

Delivered in nine PRs from three parallel groups (epic #458): the card (#471); the action row and header group, #487 (#459), #493 (#463), #494 (#464) and #465 (see below); the rows group, #470 (#461), #486 (#460) and #489 (#462). Editing went through cards [0043](0043-edit-and-delete-events-from-the-today-view.md) and [0044](0044-edit-a-task-from-the-today-view.md) (#488, #491, #495, #499). **#465 shipped through #491:** #498 implemented it, but #491's branch merged `feat/465-day-nav` to settle a `DayView.tsx` conflict between the two and then merged first, so its squash 37a8446 carries all of #498 except one combined `react` import line. #498 was closed unmerged, with that evidence in its closing comment and on #465.

### Where things live

| Area | Location |
| --- | --- |
| Day page and the **Add** action row | `frontend/apps/web/src/features/day/DayPage.tsx` (one `.actions` row holding only the two buttons) |
| **Add task** and **Add event** | `features/tasks/AddTask.tsx`, `features/events/AddEvent.tsx`; both call `useNotify()` after a save. `TaskForm`'s `onClose` reports `{ title, date? }` |
| Notification | `src/components/Notification.tsx` (`NotificationProvider`, wrapping `AppLayout` in `src/App.tsx`) and `src/components/notify.ts` (`useNotify`, `NOTIFICATION_MS` = 6000, `NOTIFICATION_FADE_MS` = 200); styles in the `/* Notifications */` block of `src/styles/components.css` |
| Short day in messages | `features/agenda/shortDay.ts` ("Thu 29 Oct", in the browser's locale as before) |
| Day header, **Refresh**, summary and day controls | `features/day/DayView.tsx` (`DayNav`, `summary()`); rules in `src/index.css` (`.refresh`, `.summary-part`, `.day-nav`) |
| Dialog heading spacing | `.modal-dialog > h2` in `src/styles/components.css` (all `ModalDialog`s) |
| Delete confirmation and its error | `components/ConfirmDialog.tsx` (`title` and `error` props), `features/agenda/TaskItem.tsx` |
| Event statuses (**Next**) | `features/agenda/dayTime.ts` (`eventStatuses`: the earliest future start first, then every event starting then) |
| Phone rows | `TaskItem` wraps badge and **Notes** in `.task-extras` and **Delete** in `.row-actions` (both `display: contents` on wide screens); the `@media (width < 40rem)` block in `src/styles/components.css` |
| Health footer | removed: `features/health/` and the `.app-footer` rules are gone; `GET /api/health` stays for operators |

### API

No changes. (#466 and #467 changed the API under their own cards.)

### Testing

* New test files: `src/components/Notification.test.tsx` (fake timers: fade, replacement, focus, pause, **Dismiss**, action) and `features/agenda/TaskItem.test.tsx` (delete failure with an MSW 500, naming, row structure).
* Extended: `src/App.test.tsx` (button row, notification wording and **Show day**, no health line, the `day navigation (#465)` block), `features/day/DayView.test.tsx` (summary parts, **Refresh** labels and `aria-busy`), `features/agenda/dayTime.test.ts` (equal starts), `dev/styles.test.ts` (dialog heading, **Refresh** grid and summary rules, reduced-motion guard for every stylesheet).
* Every fix was shown to fail first. #459, #460, #461, #463, #464 and #465 each record the failing run against the old code in their PR. For #465's focus return there is also a negative control: the test fails with only the `focus()` call removed.
* By hand with the `run-calendar` driver: Light and Dark at 1280×900 and 390×844 on each UI PR, with measurements and before/after screenshots in the PR bodies (images on the `screenshots` branch under 459–465).
* Not covered: reduced-motion emulation in a browser (the CSS guard stands in), a real screen reader, and layout in jsdom (phone rows, **Refresh** width and dialog spacing are pinned by structure and style tests and measured by hand).

### Lessons learned, known issues and follow-ups

* **A closing keyword anywhere in a PR body closes the issue.** #488's body said in prose that "the UI PR … closes #466"; the squash commit carried it and GitHub closed #466 before the UI had shipped (it was reopened). Only the delivering PR may contain "close(s)/fix(es)/resolve(s) #N", anywhere in its text; others use "Refs", "stacked on" or "will complete".
* **`main` requires up-to-date branches.** A PR that is BEHIND can't merge even with green checks, so stacks were updated by merging `main` into the branch (never force-pushing a reviewed branch). Squash merges then made the stack's next PR conflict with its own base's squash, which was resolved by keeping the branch's side after checking that `main`'s copies of the conflicting files matched the base PR's head.
* **Pairwise conflicts showed up only after one PR merged.** GitHub reported #491 and #498 (both in `DayView.tsx`) and #489 and #499 (both in `TaskItem.tsx`) as mergeable until the first of each pair landed. Comparing the files each open PR touches, not only their mergeable state, would have found them earlier.
* **Stacks outran their bases:** #493 and #494 merged while the next PR in the chain was being prepared, so #464 and #465 were moved onto fresh `main` (same trees, new branches) instead of being stacked.
* **Remounts lose focus:** `/` and `/day/:date` are different routes, so stepping between them mounts the day view again; the day controls remember the followed control and focus it again, and the loading and error states share the loaded header so the controls survive the data arriving.
* **Known issue, Refresh label sits high:** since #494, `.refresh` is `display: inline-grid`, and its label appears above the button's vertical centre on desktop and phone in both themes (seen in the #494 and #498 screenshots). Likely cause: a grid button loses native vertical centring; `align-items: center` would fix it. Not fixed here.
* **Reuse:** the edit dialogs of 0043 and 0044 confirm saves and deletes through the same `useNotify()`.
* **Not done:** the Week view's **Refresh** still changes width; the Week view and Triage don't use the notification yet; no live region announces a refresh (only `aria-busy` and the name change); keyboard shortcuts for day navigation; ADR-0026's "Where routes live" still mentions a footer in `App.tsx`.
* **Open product decisions** (shipped as proposed, no answer yet): the six-second notification, the task wording, removing (not moving) the health line, and leaving out keyboard shortcuts. If any answer differs, it is a follow-up change.

## User guide

### Moving between days

Under the day's heading, **‹ Previous day** and **Next day ›** step one day back or forward. When you are looking at another day, **Today** brings you back to today; on today it isn't shown. You can still pick any date with **Calendar date**, or open the week with **Week of …**. The address in the browser follows the day you are on, so Back and Forward work too, and you can open a day in a new tab. With the keyboard, Tab to a control and press Enter; focus stays on it on the new day.

### Adding a task or an event

Select **Add task** or **Add event**, fill in the form and save. A notification at the bottom of the screen confirms what was added, for example "“Book the dentist” added." or "Dentist added for Thu 29 Oct.", without moving anything on the page. If you added it to another day, the notification offers **Show day** to go there. It fades after about six seconds; it stays while you point at it or tab into it, and **Dismiss** closes it straight away. A newer save replaces it.

### Refreshing the day

**Refresh** reloads the day. While it works the button reads "Refreshing…" and keeps its size.

### Deleting a task

Select **Delete** on a task and confirm. The confirmation names the task ("Delete “Book the dentist”?"). If the delete fails, the dialog stays open and says so, and you can try again or cancel.

### On a phone

Each task keeps **Delete** on the title's line, with its priority and **Notes** under the title, and each event keeps its **Earlier**, **Now** or **Next** badge beside the title. The day's summary breaks only between its parts. When several events start at the same, earliest upcoming time, all of them are marked **Next**.

### Current limitations

Notifications confirm adding a task or an event, and saving or deleting from the edit dialogs on the Today view (stories [0043](0043-edit-and-delete-events-from-the-today-view.md) and [0044](0044-edit-a-task-from-the-today-view.md)). The Week view and Triage don't show them yet, and errors still appear where they happen rather than as notifications. There are no keyboard shortcuts for moving between days.
