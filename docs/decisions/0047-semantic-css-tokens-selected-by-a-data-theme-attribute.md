---
status: proposed
date: 2026-11-07
decision-makers: mgasca, Claude (AI assistant)
---

# Theme the web app with semantic CSS custom-property tokens selected by a data-theme attribute

## Context and Problem Statement

The web app is styled by one plain stylesheet, `frontend/apps/web/src/index.css`, with a handful of custom properties (`--accent`, `--danger`, `--border`) that follow the operating system through `prefers-color-scheme`. [Story 0039](../stories/0039-switchable-light-and-dark-themes.md) (epic #428) adds two complete themes, **Paper & Sage** (light) and **Midnight Studio** (dark), that differ in colour, heading typeface and shape, and a **Light / Dark / System** control whose choice is saved per browser. Every existing view and any new one must inherit both themes without its own light/dark styling. How should the themes be represented and selected?

## Decision Drivers

* **D1 Manual switching**: the user's choice must override the operating system, and System must follow it live, without a reload or a flash of the wrong theme.
* **D2 More than colour**: the themes differ in heading typeface, corner radius and panel treatment as well as palette, so the mechanism must switch any design value, not only colours.
* **D3 Inherit by default**: a view written against the shared foundations gets both themes with no palette values or theme conditionals of its own (epic #428 criteria 10 and 11).
* **D4 No new runtime dependency**: the stack is React, TanStack Router and Query with plain CSS ([ADR-0010](0010-toolchain-version-pins.md) pins the toolchain); a styling framework would be a large, lasting change for two themes.
* **D5 Testable**: jsdom tests ([ADR-0008](0008-frontend-testing-stack.md)) must be able to assert the active theme and catch a palette value outside the token layer.
* **D6 Cheap to switch**: a switch should restyle the page without re-rendering React components or losing form input.

## Considered Options

* Semantic custom-property tokens in plain CSS, selected by `data-theme` on `<html>`
* `light-dark()` colour tokens driven by the `color-scheme` property
* A utility-class framework (Tailwind CSS) with a dark variant
* CSS-in-JS with a React theme provider (for example styled-components or Emotion)

## Decision Outcome

Chosen option: "Semantic custom-property tokens in plain CSS, selected by `data-theme` on `<html>`", because it switches every design value, not only colours (**D2**), lets the saved choice override the operating system before first paint (**D1**), restyles without React re-rendering (**D6**), adds no runtime dependency (**D4**) and is easy to assert in jsdom (**D5**). Views that use only semantic tokens inherit both themes (**D3**).

| Driver | **Custom-property tokens + `data-theme` (chosen)** | `light-dark()` + `color-scheme` | Tailwind dark variant | CSS-in-JS provider |
| --- | :---: | :---: | :---: | :---: |
| D1 Manual switching | ★★★ | ★★☆ | ★★☆ | ★★☆ |
| D2 More than colour | ★★★ | ☆☆☆ | ★★☆ | ★★★ |
| D3 Inherit by default | ★★★ | ★★☆ | ★☆☆ | ★★★ |
| D4 No new runtime dependency | ★★★ | ★★★ | ★☆☆ | ☆☆☆ |
| D5 Testable | ★★★ | ★★☆ | ★★☆ | ★★☆ |
| D6 Cheap to switch | ★★★ | ★★★ | ★★★ | ★☆☆ |

### Conventions

* **Token layer**: one file (for example `src/styles/tokens.css`) holds every palette value. It defines semantic tokens: surfaces, text, borders, accent, focus ring, and the status tokens for current, completed, overdue, loading, empty, stale and error; plus typography (`--font-heading`, `--font-body`, sizes), spacing, radius and shadow scales.
* **Selection**: `:root[data-theme='light']` and `:root[data-theme='dark']` define the two token sets, and each sets `color-scheme` so native controls match. Without the attribute, `@media (prefers-color-scheme: dark)` picks the dark set, so the page is themed even before script runs.
* **One owner of theme logic**: a single theme module resolves the stored choice (`light`, `dark` or `system`) and writes the attribute; a small inline script in `index.html` applies it before first paint. No component reads the theme to choose a colour.
* **Consumers**: shared component and view styles reference semantic tokens only, never raw colours or `[data-theme]` selectors. A per-view exception is named and justified in its PR.

### Consequences

* Good, because a new view styled from the shared classes and tokens is themed with no extra work.
* Good, because a switch is one attribute change: the browser restyles, React state and form input are untouched.
* Bad, because plain CSS gives no compile-time check that a token exists; a misspelt `var(--…)` silently falls back, so the guard test below and review carry that.
* Bad, because the inline start-up script must stay tiny and in step with the theme module's storage key.
* Neutral, because the existing `index.css` must be reorganised into tokens, shared styles and view styles (story 0039, issues #431 and #433).

### Confirmation

* A Vitest test reads the web app's stylesheets and fails when a colour literal (hex, `rgb()`, `hsl()`, named colour) appears outside the token file, or a `[data-theme]` selector appears outside it.
* Theme-module unit tests cover the stored choice, the OS preference, System following a live change, and unavailable storage.
* Review checks new view styles against the contributor theme guide (issue #434).

## Pros and Cons of the Options

### Semantic custom-property tokens in plain CSS, selected by `data-theme` on `<html>`

* Good, because **D1 Manual switching**: the attribute set by the saved choice wins over the media query, and the inline script sets it before first paint.
* Good, because **D2 More than colour**: any value (font family, radius, shadow) can be a token that differs per theme.
* Good, because **D3 Inherit by default**: views reference names like `--color-surface`, never theme-specific values.
* Good, because **D4 No new runtime dependency**: plain CSS, which the app already uses.
* Good, because **D5 Testable**: tests read `document.documentElement.dataset.theme` and scan the stylesheets as text.
* Good, because **D6 Cheap to switch**: one DOM attribute; no component re-renders.
* Bad, because **D3 Inherit by default**: nothing stops a contributor typing a raw colour, so the guard test is needed.

### `light-dark()` colour tokens driven by the `color-scheme` property

* Good, because **D4 No new runtime dependency** and **D6 Cheap to switch**: native CSS; setting `color-scheme: light` or `dark` on the root switches every `light-dark()` value.
* Neutral, because **D1 Manual switching**: setting `color-scheme` from script overrides the OS, but the choice still needs the same start-up script and storage.
* Bad, because **D2 More than colour**: `light-dark()` accepts only colours, so typeface, radius and panel differences need a second mechanism anyway.
* Bad, because **D3 Inherit by default**: both palettes are written inline in every token, which mixes the two themes rather than keeping each one readable as a set.
* Bad, because **D5 Testable**: each token holds both palettes in one value, so a test cannot check one theme's set on its own.

### A utility-class framework (Tailwind CSS) with a dark variant

* Good, because **D6 Cheap to switch**: a class or attribute on the root switches the variant.
* Neutral, because **D1 Manual switching**: a selector-based dark variant supports a manual choice, with the same start-up script.
* Bad, because **D2 More than colour**: theme-specific fonts and radii need custom configuration beyond the dark variant.
* Bad, because **D3 Inherit by default**: `dark:` utilities are written per element, so every view carries its own dark styling, the opposite of the epic's requirement.
* Bad, because **D4 No new runtime dependency**: a build dependency, a rewrite of every component's markup, and a new convention for all contributors.
* Bad, because **D5 Testable**: utility classes are hard to audit for palette values with a simple test.

### CSS-in-JS with a React theme provider (for example styled-components or Emotion)

* Good, because **D2 More than colour** and **D3 Inherit by default**: a theme object can hold any value, and styled components read it.
* Neutral, because **D1 Manual switching**: the provider can follow a stored choice, but the first paint waits for JavaScript unless styles are extracted.
* Bad, because **D4 No new runtime dependency**: adds a runtime library and rewrites every stylesheet.
* Bad, because **D5 Testable**: generated class names make style assertions indirect.
* Bad, because **D6 Cheap to switch**: changing the provider value re-renders every styled consumer.

## More Information

* Story: [0039](../stories/0039-switchable-light-and-dark-themes.md); epic #428; delivery issues #431 (tokens), #432 (switch), #433 (views), #434 (guide), #435 (verification).
* Fonts for the two themes are a separate decision: [ADR-0048](0048-self-host-theme-fonts-with-fontsource-packages.md).
* [ADR-0043](0043-form-validation-red-borders-and-bubble.md) (form errors as red borders and a bubble) stays in force; its colours become status tokens.
* Revisit if a third theme or per-user server-side preference is requested, or if a component library with its own theming is adopted.

### Open questions for the reviewer

1. Token names: the draft uses a `--color-*`, `--font-*`, `--space-*`, `--radius-*` prefix scheme. Acceptable, or do you prefer shorter names?
