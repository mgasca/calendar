---
status: implemented
date: 2026-11-05
issue: https://github.com/mgasca/calendar/issues/262
pr:
  - https://github.com/mgasca/calendar/pull/266
  - https://github.com/mgasca/calendar/pull/268
adrs: ["0043"]
---

# 0024 One way to show what to fix in Add task and Add event

## Story

> As a calendar editor, I need **Add task** and **Add event** to tell me what to fix in the same way, so that I recognise a problem at a glance in either dialog and do not have to learn two behaviours.

Tracked in issue #262. The product owner chose the style on mock-ups in a conversation outside GitHub; the choice and the answers to the open questions are recorded on the issue.

## Background

Since [0006](0006-modal-dialogs-for-adding.md) both forms open in the same modal dialog, but each still validated the way its own story left it. **Add task** ([0003](0003-add-todo-tasks.md)) relied on the browser: the title, due date and due time carried the HTML `required` attribute, so submitting with an empty title showed the browser's own bubble ("Please fill out this field.") under the field and moved focus there. Anything the browser could not check, such as a daylight-saving time that does not exist or a failed save, was a plain sentence under the buttons. **Add event** ([0004](0004-add-event-entries.md)) turned browser validation off, checked the values itself when the form was submitted, and printed a plain sentence in the ordinary text colour under every failing field, while focus stayed on **Save event**. Story 0006 deliberately left both as they were.

Five styles were compared on screenshots and mock-ups built with the app's own stylesheet: the browser bubble everywhere, plain inline text everywhere, styled inline text, styled inline text with an error summary, and red borders with a bubble. The owner chose the last one, and the reasons are in [ADR-0043](../decisions/0043-form-validation-red-borders-and-bubble.md). This story delivered it.

### Agreed scope

* **One mechanism:** both forms validate when **Save** is pressed, with their own checks, and no field keeps a browser check (no `required`, `min` or `max`), so the browser never shows its own bubble. Messages keep today's wording: "Enter a title.", "Enter a due date.", "Enter a due time.", "End must be after the start.", "This local time does not exist. Choose another time.", "Choose which occurrence of this time you mean." and the length limits.
* **Every invalid field is marked:** its border and focus ring turn the app's danger colour, all at once, and stay so until the field is edited.
* **One bubble at a time:** the message appears in a small bubble under the field while that field is focused or hovered. On **Save**, focus moves to the first invalid field, so its bubble shows immediately. Editing a field clears its error, its border and its bubble.
* **Everyone gets the message:** the text is always linked to its field as the accessible description and the first error is announced on submit, so keyboard, touch and screen-reader users do not depend on hover.
* **Form-level failures stay at the bottom:** a server or network failure that is not about one field stays as a single message under the buttons, in the existing error-notice style, with what was typed kept and **Save** available again.
* **One shared component:** both forms render their fields through one component that owns the label, the marking, the bubble and the accessibility wiring, so they cannot drift apart again.
* **Dark mode and every browser:** the style comes from the app's colour tokens and looks the same in Chrome, Firefox and Safari, in light and dark schemes.

### Not in this story

* Changing which values are valid, the messages' wording, or the daylight-saving rules. Those stay as 0003 and 0004 defined them.
* Validating while typing or on leaving a field. Errors appear on **Save** and clear as the field is edited.
* An error summary at the top of the dialog. ADR-0043 names it as the next step if a form grows long.
* The **All day** checkbox rendering above its label in **Add event** (#259), which was fixed on its own first.
* Editing existing tasks or events, and creating from the week view ([XXXX](XXXX-create-events-and-tasks-from-week-view.md)).

### Dependencies

* #259 merged first, because its fix touches the same label styles in the modal dialog.

### Acceptance criteria

1. **Given** either dialog is open, **when** I press **Save** with an empty title, **then** the form does not submit, the title field is outlined in the danger colour, focus moves to it, and a bubble under it says "Enter a title.". [Task](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L130) (`marks a blank title, describes it, moves focus there, and clears it once edited`); [event](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L87) (`shows field errors for a blank title and an end before the start`) and [focus](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L104). The outline and the bubble are CSS, which jsdom does not apply: they were checked by hand in the running app (screenshots on the issue and the PR).
2. **Given** the event dialog has an empty title and an end before the start, **when** I press **Save**, **then** both fields are outlined, focus is on the title with its bubble, and hovering or focusing the end field shows "End must be after the start." in its bubble. [Both fields marked, focus on the title](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L104); the hover itself was checked by hand.
3. **Given** a field is marked invalid, **when** I edit it, **then** its outline and bubble disappear without pressing **Save** again. [Task](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L130), [event](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L104), [the helper](../../frontend/apps/web/src/components/Field.test.tsx#L28).
4. **Given** either dialog, **when** I use the keyboard or a screen reader, **then** each invalid field is reported as invalid with its message as the field's description, and the first message is announced when I press **Save**. [Component](../../frontend/apps/web/src/components/Field.test.tsx#L7) (`aria-invalid`, accessible description, `role="alert"`); [task](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L130); [event](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L87). Every bubble is an alert, so a screen reader hears each message as it appears, the first one first; a real screen reader was not run.
5. **Given** the task dialog with **Exact date and time**, **when** I save a local time that does not exist, or one that occurs twice without choosing an occurrence, **then** the message appears in the bubble of the time or occurrence field, not under the buttons. [Skipped time](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L157), [repeated time](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L172), [pure checks](../../frontend/apps/web/src/features/tasks/taskForm.test.ts#L27); the event form's occurrence selects likewise: [repeated start and end](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L147).
6. **Given** either dialog, **when** the server rejects a field (400) or the save fails for another reason, **then** a field error shows on its field and any other failure shows as one message under the buttons; what I typed is kept and I can save again. [Task 400 on the title](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L59), [task network failure](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L187), [mapping](../../frontend/apps/web/src/features/tasks/taskForm.test.ts#L65); [event 400](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L62), [event network failure](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L179).
7. **Given** either dialog, **when** no field has a browser `required`, `min` or `max` attribute, **then** no browser validation bubble ever appears, in any browser. [Task](../../frontend/apps/web/src/features/tasks/Tasks.test.tsx#L122), [event](../../frontend/apps/web/src/features/events/EventForm.test.tsx#L126) (the form carries `novalidate` and no field carries those attributes); only Chromium was run by hand.
8. **Given** the change is complete, **when** I run `just check`, **then** it passes, with tests for criteria 1 to 6 in both forms. Recorded in the delivery PR: frontend lint, type-check, the web and docs test suites and the format check passed locally on the delivered revision, and CI passed on the PR.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0043](../decisions/0043-form-validation-red-borders-and-bubble.md) | Errors are shown as red borders with a bubble on focus or hover, from the forms' own on-submit validation | Defines the mechanism, the look and the accessibility rules this story implements |
| [0003](../decisions/0003-react-vite-typescript-web-ui.md) | React, Vite and TypeScript for the web UI | The shared field component is a React component with no form library |
| [0008](../decisions/0008-frontend-testing-stack.md) | Vitest, Testing Library and MSW | The confirmation tests assert accessible descriptions, focus and server responses |

ADR-0043 is the new record for this story, accepted by the product owner on 2026-11-05 in the PR that added this card.

### Other decisions (not ADR-worthy)

* **Where the task form's messages go:** "Enter a due date." and "Enter a due time." are new only in the sense that the browser used to say them; the daylight-saving messages moved from under the buttons to the time or occurrence field. Nothing else changed wording.
* **Bubble placement:** under the field, left-aligned, with a pointer, like the browser's. The dialog scrolls, but the last field is **Notes**, whose bubble sits over the buttons rather than past the dialog's edge, so no flipping was needed.
* **Focus on the first invalid field:** in document order, so the user reads the form top to bottom. After a failed save the focus waits one render, because the controls are still disabled when the error arrives.
* **The message is hidden like `.visually-hidden`, not with `display: none`:** a `display: none` element leaves the accessibility tree and would break the description and the announcement; the bubble is clipped to a pixel until the field is focused or hovered.
* **Every message is an alert:** each bubble carries `role="alert"`, so assistive technology hears every message as it appears instead of only the first. Simpler than tracking which one is first, and the first still comes first.
* **No change to the API or the generated client.**

## Implementation notes

Delivered in one PR after the card ([#266](https://github.com/mgasca/calendar/pull/266) added the card and ADR-0043).

### Where things live

| Area | Location |
| --- | --- |
| Shared field component, error helpers | `frontend/apps/web/src/components/Field.tsx` (`Field`, `withoutError`, `focusFirstInvalid`) |
| Border, bubble and mark styles | `frontend/apps/web/src/index.css` (`.field`, `.field-bubble`, `.field-mark`) |
| Task form checks, request body, server-error mapping | `frontend/apps/web/src/features/tasks/taskForm.ts` (`validate`, `requestBody`, `serverErrors`, `SaveTaskError`) |
| Task form | `frontend/apps/web/src/features/tasks/TaskForm.tsx` |
| Event form checks | `frontend/apps/web/src/features/events/eventForm.ts` (occurrence errors now on `startOccurrence` and `endOccurrence`) |
| Event form | `frontend/apps/web/src/features/events/EventForm.tsx` |
| Tests | `components/Field.test.tsx`, `features/tasks/taskForm.test.ts`, `features/tasks/Tasks.test.tsx`, `features/events/EventForm.test.tsx` |

### API

No changes.

### Testing

* Pure tests for the task form's `validate()`, `requestBody()` and `serverErrors()` (blank title, missing date or time, skipped and repeated times, length limits, field mapping) next to the event form's existing ones.
* Component tests with Testing Library for both forms: `aria-invalid` and the accessible description on the failing field, focus on the first invalid field (including after a server 400), the error clearing on edit, the occurrence message on the occurrence select, and that the form carries `novalidate` and no field carries `required`, `min` or `max`.
* MSW tests for a server 400 mapped to a field and for a network failure shown as the form-level message, with the values kept.
* Negative control: with the old `TaskForm.tsx` and `EventForm.tsx` restored from `main`, nine of the tests fail (the blank-title, deadline, skipped-time, occurrence, network, no-native-attribute and focus cases); all pass with the change.
* By hand in the running app (Chromium through the `run-calendar` driver): both dialogs after **Save** with an empty title, the end-before-start case, and the hover on a second invalid field; screenshots are on the issue and the PR. Not run by hand: Firefox, Safari, dark mode and a screen reader.

### Lessons learned, known issues and follow-ups

* **Focus after a failed save has to wait a render.** The mutation's `onError` runs while the `<fieldset>` is still disabled, so `focus()` is ignored; a flag checked in an effect after the next render fixes it, and the task test for a server 400 caught it.
* **Hiding the message with `display: none` would silence it.** The accessible description and the alert need the element in the accessibility tree, so the bubble is clipped off-screen until shown, like `.visually-hidden`.
* **Known limits:** the bubble shows one message at a time, as decided; the other invalid fields show only their border until focused or hovered. The task form no longer limits the date input to 1900 to 2200 in the browser; the server still validates the date.
* **Follow-ups:** none opened. ADR-0043 names an error summary as the step to take if a form grows past about ten fields.

## User guide

### Fixing a problem before saving

When you press **Save task** or **Save event** and something is missing or wrong, the dialog stays open. Every field with a problem gets a red outline, and the cursor moves to the first one, with a small note under it saying what to fix, for example "Enter a title.". Point at or move to any other outlined field to read its note. As soon as you correct a field, its outline and note go away. If saving fails for a reason that is not about one field, a message appears under the buttons, what you typed is kept, and you can try again.
