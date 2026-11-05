---
status: proposed
date: 2026-11-05
decision-makers: mgasca, Claude (AI assistant)
---

# Show form errors as red borders with a bubble, from the forms' own on-submit validation

## Context and Problem Statement

The **Add task** and **Add event** dialogs ([story 0006](../stories/0006-modal-dialogs-for-adding.md)) show validation errors in two different ways. The task form relies on the HTML `required` attribute, so the browser draws its own bubble under the first empty field and moves focus there, while anything the browser cannot check (a daylight-saving time that does not exist, a server failure) is plain text under the buttons. The event form opts out of browser validation, runs its own checks on submit and prints a plain sentence under every failing field ([story 0004](../stories/0004-add-event-entries.md)). Both stories left the difference in place on purpose; now that both forms live in one shared dialog, the product owner wants one style. Which validation mechanism and which visual treatment should every form in the web app use?

## Decision Drivers

* **D1 Consistency**: both dialogs, and any later form, must validate and show errors the same way, so the two cannot drift apart again.
* **D2 Polish**: the owner prefers the compact look of the browser bubble, where the message appears beside the field and nothing in the layout moves; the result should look finished in both colour schemes.
* **D3 Accessibility**: every error must reach keyboard, touch and screen-reader users (WCAG 3.3.1 error identification), not only pointer users who hover.
* **D4 All problems visible**: when several fields fail, the user should see every one at once, and cross-field rules such as "end after start" must be expressible.
* **D5 Browser independence**: the look and behaviour must be the same in Chrome, Firefox and Safari and follow the app's theme, rather than each browser's native styling.
* **D6 Effort and maintenance**: one shared field component and a few CSS rules, with no form library and no change to the API or the contract.

## Considered Options

* Native browser validation everywhere (the task form's style)
* Plain inline text everywhere (the event form's style)
* Styled inline text under each field
* Styled inline text plus an error summary at the top of the form
* Red borders plus a bubble shown on focus or hover

## Decision Outcome

Chosen option: "Red borders plus a bubble shown on focus or hover", because it is the only option that keeps the compact bubble the owner prefers (D2) while marking every invalid field at once (D4), working the same in every browser (D5) and keeping the message in the accessibility tree whether or not the bubble is visible (D3). The product owner reviewed mock-ups of the last three options, built with the app's own stylesheet, and chose this combination in a conversation outside GitHub; the answer is recorded on [issue #262](https://github.com/mgasca/calendar/issues/262).

| Driver | **Red borders plus a bubble (chosen)** | Native browser validation | Plain inline text | Styled inline text | Styled inline text plus summary |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Consistency | ★★★ | ★☆☆ | ★★★ | ★★★ | ★★★ |
| D2 Polish | ★★★ | ★★☆ | ☆☆☆ | ★★☆ | ★☆☆ |
| D3 Accessibility | ★★☆ | ★☆☆ | ★★★ | ★★★ | ★★★ |
| D4 All problems visible | ★★☆ | ☆☆☆ | ★★★ | ★★★ | ★★★ |
| D5 Browser independence | ★★★ | ☆☆☆ | ★★★ | ★★★ | ★★★ |
| D6 Effort and maintenance | ★★☆ | ★★☆ | ★★☆ | ★★☆ | ★☆☆ |

### The style

* **Mechanism:** every form sets `noValidate` and runs its own `validate()` on submit, returning one message per failing field plus an optional form-level message. No field keeps a native check (`required`, `min`, `max`), so the browser never shows its own bubble. Messages keep their current wording ("Enter a title.", "End must be after the start.", "This local time does not exist. Choose another time.").
* **Marking:** an invalid control gets a 2px border in `--danger`, and its focus ring turns `--danger` too. Every invalid field is marked at the same time.
* **Bubble:** the message sits in a small bubble anchored under its control: `Canvas` background, `--border` outline, a light shadow, a pointer at the top left and a `--danger` square with a white "!" before the text. It is visible while the field is focused or hovered, one bubble at a time. On submit, focus moves to the first invalid field, so its bubble appears at once, as the native one does today.
* **Accessibility:** the message is always rendered and linked to the control with `aria-describedby`, and the control carries `aria-invalid`, so assistive technology reads the message whether or not the bubble is visible. The first error is announced on submit (`role="alert"`). Typing in a field clears its error, and with it the border and the bubble.
* **Form-level failures:** a server or network error that is not about one field stays as a single message at the bottom of the form, styled as the existing `.notice.notice-error`.
* **One component:** a shared field wrapper in `frontend/apps/web/src/components/` renders the label, the control, the ARIA attributes and the bubble; both forms use it, so neither can diverge.

### Consequences

* Good, because both dialogs validate and look the same, and a future form gets the style by using the shared component.
* Good, because the layout never shifts when an error appears, which the owner preferred over the inline text of the mock-ups.
* Good, because the style is defined by the app's CSS tokens and renders the same in every browser and in dark mode.
* Bad, because only one message is readable at a time; the red borders say *where* the other problems are, but a user has to focus or hover each field to read *what* is wrong. The accessible description carries the text regardless.
* Bad, because the bubble is positioned absolutely, so the dialog's `overflow: auto` can clip a bubble under the last field; the implementation has to leave room below the last control or flip the bubble above it.
* Neutral, because the task form gives up the browser's built-in checks for date and time presence and re-implements them in `validate()`, which the event form already does.

### Confirmation

* Both forms render every field through the shared field component; a review rejects a form that renders its own error text.
* A test per form (in `features/events/EventForm.test.tsx` and `features/tasks/Tasks.test.tsx`) submits with a blank title and asserts that the message is the title field's accessible description, that the field is marked invalid and that it has focus; the event form keeps its existing tests for an end before the start, a skipped time, a repeated time, a server 400 and a network error, and the task form gains equivalents.
* `just check` passes, including the frontend lint, type-check and tests.

## Pros and Cons of the Options

### Native browser validation everywhere

* Good, because **D2 Polish**: the browser draws a bubble that looks finished, with no CSS of our own.
* Good, because **D6 Effort and maintenance**: a `required` attribute per field is all the presence checks need.
* Bad, because **D1 Consistency**: cross-field rules and daylight-saving checks still need custom messages, so two styles coexist inside one form, which is the problem today.
* Bad, because **D3 Accessibility**: the bubble disappears after a few seconds or on any click, and screen readers announce it inconsistently.
* Bad, because **D4 All problems visible**: the browser reports one field at a time.
* Bad, because **D5 Browser independence**: the bubble's look differs per browser and cannot be themed; Firefox and Safari show something different from Chrome.

### Plain inline text everywhere

* Good, because **D1 Consistency**: one mechanism in both forms.
* Good, because **D3 Accessibility**: the text is in the page, linked to the control, and visible to everyone.
* Good, because **D4 All problems visible**: every failing field shows its message at once.
* Good, because **D5 Browser independence**: plain text renders the same everywhere.
* Bad, because **D2 Polish**: body text in the default colour under the field, with nothing marking the field itself and no focus move, looks unfinished; the owner rejected it on the screenshot.
* Neutral, because **D6 Effort and maintenance**: the event form has it already; the task form must still migrate.

### Styled inline text under each field

* Good, because **D1 Consistency**, **D3 Accessibility**, **D4 All problems visible** and **D5 Browser independence**: the same mechanics as plain inline text, with the field marked and focus moved to the first problem.
* Good, because **D2 Polish**: a red border, a red message with a warning mark and the focus move make it look deliberate.
* Bad, because **D2 Polish**: each message adds a line under its field, so the form grows and shifts when an error appears, which the owner did not want.
* Neutral, because **D6 Effort and maintenance**: a shared field component and two CSS rules, the same as the chosen option without the positioning.

### Styled inline text plus an error summary at the top of the form

* Good, because **D3 Accessibility**: a summary that lists every problem as a link to its field is the strongest pattern for screen-reader users on long forms.
* Good, because **D1 Consistency**, **D4 All problems visible** and **D5 Browser independence**: as for styled inline text.
* Bad, because **D2 Polish**: these dialogs have five to seven fields, so the summary repeats what is already visible and pushes the first field down.
* Bad, because **D6 Effort and maintenance**: the summary, its links and its focus management are extra code and tests for little gain on short forms.

### Red borders plus a bubble shown on focus or hover

* Good, because **D1 Consistency**: one mechanism and one component for both forms.
* Good, because **D2 Polish**: the compact bubble the owner liked in the task form, now with the app's colours, and nothing in the layout moves.
* Good, because **D5 Browser independence**: the bubble is ours, drawn from the theme tokens, identical in every browser and colour scheme.
* Good, because **D4 All problems visible**: every invalid field is bordered at once, and cross-field rules are ordinary messages.
* Bad, because **D4 All problems visible**: only one message is readable at a time.
* Bad, because **D3 Accessibility**: a bubble shown on hover or focus must not be the only carrier of the message; the always-present accessible description and the focus move on submit cover keyboard, touch and screen-reader users, and that wiring has to be tested.
* Neutral, because **D6 Effort and maintenance**: the same shared component as styled inline text plus the positioning CSS and the overflow care noted above.

## More Information

* Decided on [issue #262](https://github.com/mgasca/calendar/issues/262), which records the five options, the screenshots' descriptions and the owner's answers. Delivered by story [0024](../stories/0024-one-way-to-show-what-to-fix-in-add-task-and-add-event.md).
* Related: [story 0003](../stories/0003-add-todo-tasks.md) (the task form), [story 0004](../stories/0004-add-event-entries.md) (the event form's field errors), [story 0006](../stories/0006-modal-dialogs-for-adding.md) (the shared dialog), [ADR-0003](0003-react-vite-typescript-web-ui.md) (the web UI stack) and [ADR-0008](0008-frontend-testing-stack.md) (how the confirmation tests run).
* This record is not about architecture. The repository reads the "A" in ADR as **Any**: any decision the team considers significant gets a record ([`docs/decisions/README.md`](README.md)).
* Revisit if a form grows past about ten fields or if usability testing shows people missing the second and later errors; the summary option is the natural next step then.
