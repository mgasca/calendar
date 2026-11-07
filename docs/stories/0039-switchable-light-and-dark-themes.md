---
status: planned
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/428
pr:
  - https://github.com/mgasca/calendar/pull/436
adrs: ["0008", "0026", "0043", "0047", "0048"]
---

# 0039 Switchable light and dark themes across the whole calendar

## Story

> As a calendar owner, I need a cohesive visual design with switchable light and dark themes, so that I can understand my day at a glance and use the app comfortably in my preferred appearance.

Tracked in epic #428, delivered through issues #431 (foundations), #432 (theme switch), #433 (every view and state), #434 (contributor and agent guide) and #435 (verification and this card's completion).

## Background

The web app has Today and date-specific day agendas ([0001](0001-today-view.md)), current and date-specific Week ([0002](0002-week-view.md)), My tasks ([0003](0003-add-todo-tasks.md)), Triage ([0007](0007-overdue-triage-and-task-deletion.md)), Google sign-in ([0005](0005-google-sign-in.md)), the add and edit dialogs ([0006](0006-modal-dialogs-for-adding.md)) and invalid-date and not-found pages. They share one plain stylesheet with a few colour variables that follow the operating system's light or dark setting. There is no consistent typography, spacing or surface treatment, and the user cannot choose an appearance.

Two working prototypes on the epic show the retained directions: **Paper & Sage** (light: warm ivory surfaces, forest-green accents, softer corners, editorial serif headings) and **Midnight Studio** (dark: deep navy surfaces, lilac accents, crisp panels, bold sans-serif headings). The product owner chose to keep both and let the user switch. The screenshots are starting points, not final designs for every view.

The product owner settled the planning details on 2026-11-07 (recorded on #428): the first visit follows the operating system; the choice is saved per browser; the control offers **Light**, **Dark** and **System**; fonts are self-hosted.

### Agreed scope

* **Two themes**: Paper & Sage as the light theme and Midnight Studio as the dark theme, each with consistent typography, spacing, surfaces, navigation, buttons, form fields and status indicators.
* **Theme control**: a **Light / Dark / System** choice in the app header, reachable and operable by keyboard, with an accessible name and a visible current selection.
* **Default**: until the user chooses, the app follows the operating system's light or dark preference, and light when it is unknown. **System** keeps following the operating system when it changes, without a reload.
* **Persistence**: the choice is remembered in this browser across reloads and browser sessions. If the browser refuses storage, the control still works for the visit and falls back to System next time.
* **No flash**: the saved theme is applied before the page first paints.
* **Switching keeps state**: the current view, its date and any unsaved dialog input survive a switch.
* **Every existing view**: Today and date-specific day agendas, current and date-specific Week, My tasks, Triage, sign-in, invalid-date and not-found pages, the shared shell, the add/edit and confirm dialogs, and their loading, empty, stale, validation and error states; current, completed and overdue items. The inventory is reconciled against the routes and components when #433 is delivered.
* **Narrow screens**: no page-level horizontal scrolling; the week grid keeps its own horizontal scroll.
* **Accessibility**: text and controls meet WCAG AA contrast in both themes; keyboard focus is visible; state meaning is never carried by colour alone.
* **Shared foundations**: semantic tokens for surfaces, text, borders, accents and statuses, with typography, spacing and shape scales, defined once per theme ([ADR-0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md)); repeated controls styled once and reused; view layout kept apart from shared styling.
* **Fonts**: self-hosted typefaces for each theme's headings ([ADR-0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md)), with system fallbacks.
* **Guidance**: a contributor and coding-agent guide to the theme system, with a worked example of styling a new view, linked from contributor documentation and `frontend/AGENTS.md`.
* **Evidence**: a coverage record of every view and state in both themes at desktop and narrow widths, and representative screenshots including Day, Week, My tasks and Triage.

### Not in this story

* **New calendar or task features**: none; behaviour stays as it is.
* **Saving the theme to the account**: the choice is per browser; following the user across devices would need an API and a migration and is not planned.
* **A third theme or user-defined colours**: the token layer makes it possible later, but it is not requested.
* **Treating the prototype screenshots as approved layouts**: they set the direction; each view's details are reviewed in its delivery PR.
* **The docs site**: the Astro Starlight site keeps its own theme.

### Dependencies

* The tokens and shared styles (#431) come first; the view migration (#433) and the guide (#434) build on their names.
* The theme switch (#432) relies only on the `data-theme` contract of ADR-0047, so it proceeds in parallel with #431.
* Verification and card completion (#435) come last.

### Acceptance criteria

1. **Given** either theme is active, **when** I select the other in the theme control, **then** the app shows the selected theme without leaving the current view or losing unsaved dialog input.
2. **Given** I have never chosen a theme, **when** I open the app, **then** it uses my operating system's light or dark preference, and with **System** selected it follows a change of that preference without a reload.
3. **Given** I chose **Light** or **Dark**, **when** I reload or come back in a new browser session, **then** the app opens in that theme with no flash of the other one.
4. **Given** the browser refuses storage, **when** I choose a theme, **then** it applies for this visit and no error is shown.
5. **Given** either theme, **when** I move between Today, a dated day, Week, My tasks and Triage, **then** navigation, typography, spacing, colours and shared controls are consistent.
6. **Given** either theme, **when** I open sign-in, the invalid-date or not-found page, or an add, edit or confirm dialog, **then** its fields, actions and validation messages follow that theme, with form errors as in ADR-0043.
7. **Given** a narrow viewport in either theme, **when** I use any view, **then** content and actions are readable and reachable without page-level horizontal scrolling, and the week grid scrolls on its own.
8. **Given** keyboard navigation, **when** I reach the theme control, **then** its name and current selection are announced, focus is visible, and I can select each option with the keyboard.
9. **Given** normal, current, completed, overdue, empty, loading, stale and error states in either theme, **when** each is shown, **then** its meaning is readable and not carried by colour alone, and text and controls meet WCAG AA contrast.
10. **Given** the restyled app, **when** I create, edit or complete an item and then navigate or refresh, **then** behaviour and saved data are unchanged.
11. **Given** the web app's stylesheets, **when** the tests run, **then** they fail if a colour value or theme selector appears outside the token layer.
12. **Given** a contributor or coding agent adding a view, **when** they follow the guide linked from contributor docs and `frontend/AGENTS.md`, **then** the worked example gives them both themes with no palette values or theme logic of their own, and lists the checks to run for both themes.
13. **Given** the coverage record, **when** I read it, **then** every view and state is marked for light and dark at desktop and narrow widths, with screenshots including Day, Week, My tasks and Triage.
14. **Given** the change is complete, **when** I run `just check`, **then** it passes.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic CSS custom-property tokens selected by `data-theme` on `<html>` (accepted) | The theme mechanism, the token layer and its guard test |
| [0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md) | Self-host the theme fonts from Fontsource packages (accepted) | The heading typefaces and their delivery |
| [0043](../decisions/0043-form-validation-red-borders-and-bubble.md) | Form errors as red borders with a bubble | Kept; its colours become status tokens |
| [0026](../decisions/0026-client-side-routing-with-tanstack-router.md) | TanStack Router | Switching must not change the route |
| [0008](../decisions/0008-frontend-testing-stack.md) | Vitest, Testing Library and MSW | Where the theme and guard tests live |

### Other decisions (not ADR-worthy)

* **Per-browser storage**: `localStorage` holds `light`, `dark` or `system`; no API change, chosen by the product owner.
* **System as the default**: an absent choice means System, so the operating system decides until the user does.
* **Control placement**: the app header, next to the navigation, so it is available on every view.

## Implementation notes

*Planned. This section is completed as the story is built.*

### Where things live

| Area | Location |
| --- | --- |
| Token layer and both themes | `frontend/apps/web/src/styles/` (`tokens.css`, `base.css`, `components.css`, guards in `styles.test.ts`), imported by `src/index.css` |
| Theme choice and storage | a theme module and hook under `frontend/apps/web/src/` (forecast) |
| Start-up script | `frontend/apps/web/index.html` |
| Header control | the app shell in `frontend/apps/web/src/App.tsx` |
| Views | `frontend/apps/web/src/features/*` |
| Contributor and agent guide | under `docs/` (forecast, #434), linked from `frontend/AGENTS.md` |

### API

No changes expected.

### Testing

* Theme module unit tests: stored choice, OS preference, live System change, refused storage.
* Component tests: the control's name, selection and keyboard operation; switching with an open dialog keeps its input.
* A guard test over the stylesheets for colour values and theme selectors outside the token layer.
* Contrast of the token pairs checked and recorded (#431); the coverage record and screenshots by hand in the running app (#435).

### Lessons learned, known issues and follow-ups

* To be filled in on delivery.

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Choose light or dark

1. In the header, find the theme control.
2. Choose **Light** for Paper & Sage, **Dark** for Midnight Studio, or **System** to follow your device.

The app changes at once and keeps you where you are, including anything you were typing in a dialog. Your choice is remembered in this browser. On another browser or device, the app starts by following that device's setting.
