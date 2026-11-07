---
order: 4
---

# Style a web view in both themes

Use this guide when you add or change a view, dialog or control in the web app (`frontend/apps/web`), whether you are a person or a coding agent. A view built as described here is light and dark with no theme code of its own. The decision is [ADR-0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md), the fonts are [ADR-0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md), and the story is [0039](../stories/0039-switchable-light-and-dark-themes.md).

Terms used here:

- **Token**: a CSS custom property such as `--color-surface` whose value depends on the theme. Tokens have meanings ("the page background"), not appearances ("ivory").
- **Shared class**: a class defined once in `src/styles/components.css`, such as `.panel` or `.items`.
- **Theme**: a complete token set. **Paper & Sage** is light, **Midnight Studio** is dark.

## Before you start

- Run `just frontend install` once per checkout or worktree.
- Read `frontend/AGENTS.md` for the checks, then this guide for the styling rules.
- All paths below are relative to `frontend/apps/web/`.

## How the theme system works

| File | Owns |
| --- | --- |
| `../../packages/theme/src/tokens.css` (`@calendar/theme`, shared with the docs site) | Every colour value, the per-theme fonts, shadows and radii, and the only `[data-theme]` and `prefers-color-scheme` selectors. |
| `src/styles/base.css` | Element defaults: `body`, headings, links, the focus ring, the page width. |
| `src/styles/components.css` | Shared classes and the default look of buttons and fields. |
| `src/index.css` | Imports the three files above, then holds the view-specific rules (day, week, tasks, triage, shell), written with tokens only. |
| `src/theme/` | The theme switch: `theme.ts` (storage and attribute), `useTheme.ts`, `ThemeControl.tsx` (Light, Dark, System, a native radio group in the header). |
| `index.html` | A small inline script that applies the saved theme before the first paint. |

How a theme gets chosen:

1. The choice is **Light**, **Dark** or **System**, saved in `localStorage` under `calendar.theme`. Without a saved value the choice is System.
2. `src/theme/theme.ts` is the only code that writes `data-theme="light"` or `data-theme="dark"` on `<html>`. System resolves to the operating system's preference and follows it while the page is open.
3. `tokens.css` defines the two token sets under `:root[data-theme='light']` and `:root[data-theme='dark']`. Each sets `color-scheme`, so native controls, scrollbars and form widgets match.
4. Without the attribute (script blocked), `@media (prefers-color-scheme: dark)` selects the dark set, so the page is themed even before script runs. That block repeats the dark set, and a test fails when the two differ.

The consequence for your code: **no component reads the theme to choose a colour.** If you find yourself writing `isDark`, a `data-theme` selector, a `prefers-color-scheme` query or a second palette in a view, stop and use a token instead.

## Token meanings

Pick a token by what the thing is, not by how it looks today. All colour tokens are `--color-*`.

| Token | Use it for |
| --- | --- |
| `bg` | The page background (`body`). |
| `surface` | Cards, panels and rows that sit on the page. |
| `surface-raised` | Something above a surface: dialogs, popovers, sticky headers. |
| `surface-sunken` | Something set into a surface: text fields, wells. |
| `text`, `text-muted` | Body text; secondary text (times, metadata, helper text). Both meet 4.5:1 on every surface and status background. |
| `border` | Decorative separators and card outlines. |
| `border-strong` | A boundary that identifies a control (field and button borders). Meets 3:1. |
| `accent`, `accent-hover`, `accent-soft`, `on-accent` | The one brand colour: primary actions, links, today. `accent-soft` is a tinted fill (pressed toggle, today column). Put `on-accent` text on `accent` and `accent-hover` only. |
| `focus` | The keyboard focus ring. `base.css` applies it to every `:focus-visible`. |
| `current-bg`, `current-border` | Happening now or selected: the current event, week event blocks. |
| `completed-text` | Done items (combined with a line-through). |
| `overdue-bg`, `overdue-text` | Past-due items. Text on `overdue-bg` is `text`; `overdue-text` is for the flag. |
| `error`, `error-soft`, `on-error` | Failures and invalid input. Put `on-error` text on `error` only. |
| `loading-text`, `empty-text` | The text of a loading or an empty state. |
| `now-line` | The current-time line. |
| `backdrop` | The scrim behind a modal dialog. |

Other tokens, in `tokens.css`:

- Effects: `--shadow-panel`, `--shadow-popover`, `--opacity-stale` (data being refreshed).
- Type: `--font-body`, `--font-heading`, `--font-heading-weight`, `--font-heading-tracking` (the two themes differ here: Paper & Sage uses a serif, Midnight Studio a bold sans-serif), `--text-xs` to `--text-3xl`, `--leading`.
- Space and shape: `--space-1` to `--space-8`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill`, `--control-height` (the minimum height of any control, which keeps touch targets large enough).

The spacing and type scales are the same in both themes; shapes (radius), fonts and shadows differ. Use `--radius-*` and never a literal `border-radius` on a surface, so a theme's character carries through.

## Use the shared styles first

`base.css` already styles headings, links, buttons, inputs, selects and focus, so plain `<h1>`, `<a>`, `<button>`, `<input>` need no class. `components.css` provides:

| Class | Use |
| --- | --- |
| `.panel` | A bordered, shadowed surface for a block of content. |
| `.items` and `.item` | A list and its rows. Inside a row: `.item-title`, `.item-time`, `.item-meta` (a full-width secondary line). |
| `.eyebrow`, `.summary`, `.count` | The small uppercase label above a heading; a muted line under it; a muted count inside a heading. |
| `.badge`, `.badge-current`, `.badge-next`, `.badge-past` | A small pill. The words are the information, the colour only supports them. |
| `.notice`, `.notice-error` | An inline message; the error variant is tinted with `error-soft`. Give an error `role="alert"`. |
| `.flag` | Inline emphasis for an overdue marker. Keep its words ("Past due"). |
| `.empty` | The empty state paragraph. |
| `.button-primary`, `.button-danger` | The main action; a destructive action. Plain `<button>` is the default. |
| `.theme-control` | The theme switch: a native radio group drawn as one segmented control; the template for any small choice of one among few. |
| `a.button-primary`, `a.button-danger` | A link styled as a button (sign-in). |
| `[role='status']` | Every status paragraph is styled with `loading-text` by `components.css`; no class is needed. |
| `.actions` | A wrapping row of buttons and labelled fields. |
| `.field`, `.field-bubble`, `.field-mark` | Form validation (ADR-0043): the control is `aria-invalid`, the message is its description. |
| `.modal-dialog` | A modal `<dialog>`; use the `ModalDialog` component rather than the class. |
| `.visually-hidden` | Text for assistive technology only. |

Rules:

1. **Compose before you write CSS.** Most views are `<section>`, a heading, shared classes and a few layout rules.
2. **View rules hold layout and state hooks, not look.** Grid, flex, widths, positions and the status rules below belong to the view. Palette, fonts, shadows and radii come from tokens.
3. **Reference only tokens and `var(--…)`.** No hex, `rgb()`, `hsl()`, `color()` or named colours (including `white`, `black` and system colours such as `Canvas`) outside `tokens.css`. A literal inside `color-mix()` counts too. Use `color-mix(in srgb, var(--color-accent) 20%, transparent)` if you need a tint, though a token usually exists.
4. **No `!important`, no `[data-theme]` selectors, no `prefers-color-scheme` outside `tokens.css`.**
5. **Class names are prefixed by the view** (`.reading-…`), so a rule cannot leak into another view.
6. **Check that every token you use exists.** A misspelt `var(--color-surfce)` is silently ignored by the browser; the guard test (below) catches it.

## Responsive rules

- Design for a narrow screen first and widen with `min-width` queries. The page is a centred column (`40rem` in `base.css`); `body` padding grows at `40rem`. A view that needs more room widens its `main` (the week view does it with `body:has(.week) main`) instead of fixing the page width.
- Use `rem` and the `--space-*` scale. No pixel font sizes.
- Wrap rows: `flex-wrap: wrap` with a `gap`, as `.item` and `.actions` do. Long text needs `overflow-wrap: anywhere`.
- Wide content (a grid, a table) scrolls inside its own container, as `.week-scroll` does, and the page never scrolls sideways.
- Every control is at least `--control-height` tall. Dense variants (like the week's task rows) stay at least `1.75rem` and keep a large clickable label.
- Check at 360 px, at about 800 px and on a wide window.

## Accessibility rules

- **Never colour alone.** Every state also has text, a shape, a line style or a weight (see the next section).
- **Keep contrast by construction.** Text pairs reach 4.5:1 and borders, the focus ring, error and the now line reach 3:1 against `bg` and `surface`, in both themes (`dev/styles.test.ts` checks the pairs). Combine tokens only as the table above says: `on-accent` on `accent`, `on-error` on `error`, `text` or `text-muted` on surfaces and on `current-bg`, `overdue-bg` and `accent-soft`. A new combination needs a row in the test.
- **Do not remove or restyle the focus ring.** `:focus-visible` is set once in `base.css`.
- **Use native elements.** A `<button>` for actions, `<a>` for navigation, `<label>` with a control, `<dialog>` through `ModalDialog`. `aria-pressed`, `aria-current` and `aria-invalid` are the style hooks for state, so the styled state and the announced state cannot diverge.
- **Announce changes.** `role="status"` for loading, `role="alert"` for errors and failed actions.
- **Respect motion.** If you animate, wrap it in `@media (prefers-reduced-motion: no-preference)`.

## State styling

Style a state in two parts: a **meaning** that does not depend on colour, plus the token that reinforces it.

| State | Meaning (always present) | Reinforced by |
| --- | --- | --- |
| Current | The `Now` or `Current` text or `.badge-current`, and a thick `border-left` | `current-bg`, `current-border` |
| Completed | `text-decoration: line-through` and a checked checkbox | `completed-text` |
| Overdue | The words "Past due" in a `.flag` | `overdue-bg`, `overdue-text` |
| Past (finished) | The `.badge-past` label | `text-muted` for the title (never faded with opacity, which fails contrast) |
| Loading | `role="status"` text such as "Loading…" | `loading-text`, applied to every `[role='status']` |
| Empty | A sentence that says why and what to do | `.empty` (`empty-text`) |
| Error | A message with `role="alert"`, a retry button when retrying helps | `.notice .notice-error` (`error`) |
| Invalid input | `aria-invalid`, the message as the control's description, and the `.field-mark` glyph | `.field` (`error`) |
| Refreshing | The existing data stays visible | `.is-stale` and `--opacity-stale` |
| Selected or pressed | `aria-pressed` or `aria-current`, a heavier border or font weight | `accent`, `accent-soft` |

An opacity or colour change is never the only signal. If you add a state that has no row here, write its non-colour meaning first.

## When to add a token or a shared class

- **A new token** is justified when a new meaning exists that no token carries (a new status), or two themes need different values for it. It is not justified for one view's convenience, or because a colour "looks off": adjust the existing token's value in `tokens.css` if the meaning is shared, or compose existing tokens. Add the token to both themes **and** the OS-fallback block, keep the three blocks in the same order, and add its contrast pairs to `dev/styles.test.ts`. Name it for its role.
- **A new shared class** is justified at the second concrete use, when two views need the same presentation. Until then, keep it in `src/index.css` under the view's prefix. When it moves, put it in `components.css`, list it in the table above and delete the duplicate.
- **A per-view exception** (a rule that needs a one-off value) is allowed only for layout, never for palette or theme logic. Name and justify it in the PR description.

## Worked example: a Reading list view

This adds a view that lists reading items with the states above. It uses only shared classes, tokens and a few small view rules, and it has no theme code. The code is a pattern to copy, shown in full so you can compare it with what you write.

Views live in feature folders (`src/features/reading/`) and their rules in `src/index.css`; there are no per-feature stylesheets yet. A component renders the structure and uses shared classes:

```tsx
// src/features/reading/ReadingList.tsx
interface Item {
  id: string;
  title: string;
  due: string;
  done: boolean;
  overdue: boolean;
}

export function ReadingList({
  items,
  isPending,
  isError,
  onRetry,
}: {
  items: readonly Item[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="reading-heading">
      <p className="eyebrow">This week</p>
      <h1 id="reading-heading">
        Reading list <span className="count">({items.length})</span>
      </h1>
      <p className="summary">Things to read, soonest first.</p>

      {isPending && <p role="status">Loading reading list…</p>}
      {isError && (
        <div role="alert" className="notice notice-error">
          <p>Couldn’t load the reading list.</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!isPending && !isError && items.length === 0 && (
        <p className="empty">Nothing to read. Add something you want to get to.</p>
      )}

      <ul className="items">
        {items.map((item) => (
          <li
            key={item.id}
            className={`item${item.done ? ' reading-done' : ''}${item.overdue ? ' reading-overdue' : ''}`}
          >
            <span className="item-title">{item.title}</span>
            {item.done && <span className="badge badge-past">Read</span>}
            <span className="item-meta">
              Due {item.due}
              {item.overdue && !item.done && <strong className="flag"> · Past due</strong>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Append its rules to the view section of `src/index.css`. They add only what the shared styles do not give it, with tokens:

```css
/* Reading list view (src/index.css): tokens only. */

/* Completed: struck through, so it reads without colour. */
.reading-done .item-title {
  text-decoration: line-through;
  color: var(--color-completed-text);
}

/* Overdue: a tinted row; the "Past due" flag carries the meaning. */
.reading-overdue {
  background: var(--color-overdue-bg);
}

@media (min-width: 40rem) {
  .reading-overdue {
    border-radius: var(--radius-sm);
  }
}
```

What this example shows:

- The heading, link and button looks come from `base.css`; the list, rows, badge, notice, flag and empty state from `components.css`. The view adds two rules and a media query. Loading needs none: `[role='status']` is already styled.
- Completed is a line-through plus a "Read" badge, overdue is a "Past due" flag, and an error has a heading and a retry button. Remove every colour and the page still reads.
- Switching the theme restyles it with no React involvement, because the only colour sources are `var(--color-…)`.
- Data comes from the generated client and TanStack Query as in the other features (see `frontend/AGENTS.md`); the styling is independent of it.

Steps for your own view:

1. Create `src/features/<name>/<Name>.tsx` and add its rules to `src/index.css`, with every class prefixed by `<name>-` except the shared ones.
2. Build the structure from shared classes. Write a rule only for what they do not cover.
3. Handle loading, error, empty and, if it applies, refreshing states, each with text.
4. Add the route in `src/router.tsx` and a link in the navigation.
5. Verify both themes (next section).

## Verify both themes

Do all of these before opening the PR:

1. **Guards.** `just frontend test-web dev/styles.test.ts` and `corepack pnpm --dir frontend --filter @calendar/theme test` fail on a colour literal or a theme selector outside `tokens.css`, a `var(--token)` that nothing defines, light and dark sets that differ, the OS-fallback block drifting from the dark set, or a contrast pair below its threshold. It reads every `.css` file under `src/` (and `@calendar/theme` scans the app and the docs site), so `index.css` and any stylesheet you add are covered automatically.
2. **Component tests.** Test what the view says (roles, text, `aria-*`), not how it looks. jsdom has no CSS cascade, so a test cannot see colours; do not assert them.
3. **Full frontend checks.** `just frontend lint`, `just frontend typecheck`, `just frontend test` and `corepack pnpm --dir frontend format:check`.
4. **Look at it.** Run the app (the `run-calendar` skill describes the signed-in local setup), then switch the theme with the header control to Light, Dark and System. Check:
   - every state in the table above, in both themes, at a narrow width (360 px) and a wide one;
   - the keyboard focus ring on every control;
   - that nothing is unreadable when the control reads System and the operating system changes its setting;
   - that text selection, disabled controls and dialogs look right.
5. **Screenshots.** For a UI change, add before and after pictures in both themes to the PR with the `github-screenshots` skill.
6. **Docs.** If you added a token or a shared class, update the tables above in the same PR.

## Reviewing a view

A reviewer checks: no literals, theme selectors or `!important` in the view's CSS; the guard test passes; shared classes were used where one exists; every state has a non-colour signal; the view works at 360 px; a new token or shared class is justified with a second use or a new meaning; any exception is named in the PR.
