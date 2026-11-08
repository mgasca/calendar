---
status: in-progress
date: 2026-11-07
issue: https://github.com/mgasca/calendar/issues/514
pr:
  - https://github.com/mgasca/calendar/pull/523
  - https://github.com/mgasca/calendar/pull/525
  - https://github.com/mgasca/calendar/pull/526
  - https://github.com/mgasca/calendar/pull/527
  - https://github.com/mgasca/calendar/pull/529
  - https://github.com/mgasca/calendar/pull/536
adrs: ["0012", "0023", "0025", "0045", "0046", "0047", "0048"]
---

# 0046 Apply the Calendar light and dark themes to the published docs site

## Story

> As a docs reader, I need the published documentation to use the same switchable Paper & Sage (light) and Midnight Studio (dark) themes as the calendar app, so that I read it comfortably in my preferred appearance and the two sites feel like one product.

Tracked in epic #513 and issue #514 (this card), delivered through issues #515 (shared tokens and fonts), #516 (docs styling and theme control), #517 (search, badges, code and diagrams), #518 (shared-theme previews) and #519 (verification, publication and the card's completion).

## Background

The web app has two complete themes and a **Light / Dark / System** control ([0039](0039-switchable-light-and-dark-themes.md), [ADR-0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md), [ADR-0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md)). The palette, type scale, radii and shadows live in one app-owned file, `frontend/apps/web/src/styles/tokens.css`, and the heading and body typefaces come from two pinned Fontsource packages that the app imports. Story 0039 left the docs site out on purpose: "the Astro Starlight site keeps its own theme".

The docs site (Astro Starlight, `frontend/apps/docs`; [ADR-0022](../decisions/0022-astro-starlight-documentation-ui.md)) is published to GitHub Pages ([ADR-0023](../decisions/0023-static-adr-log-publication.md)). Today it shows Starlight's default colours and its own Dark / Light / Auto picker, with a few diagram rules in `src/styles/docs.css`. Its Mermaid diagrams are re-rendered by `astro-mermaid` when `data-theme` changes. The app and the docs site are different origins, so a choice in one is invisible to the other.

The maintainer approved the scope on epic #513 on 2026-11-07. This card is the epic's PR 0: it records what was agreed and its observable criteria, and its merge gates every delivery PR. It contains no implementation.

### Agreed scope

* **Two themes, throughout**: the docs site uses Paper & Sage as its light theme and Midnight Studio as its dark theme on every page: header, navigation and sidebars, typography, links, tables, controls, focus states, surfaces and shapes, while its reading layout and routing stay as they are.
* **The app's control**: a native **Light / Dark / System** segmented control drawn like the app's, operable by keyboard and screen reader, replacing Starlight's own picker so that one controller owns the theme. It adds no React to the docs site.
* **Default and System**: until the visitor chooses, the site follows the operating system (light when unknown); **System** follows later changes of the operating system without a reload.
* **Independent preferences per origin**: each origin remembers its own choice in that browser. The docs site never reads or writes the app's storage and the app never reads the docs site's; there is no cross-origin synchronisation. Production and PR previews share the Pages origin, so they share one docs preference.
* **No wrong-theme flash**: the saved choice is applied before first paint. If storage is unavailable or holds an invalid value, the site still renders in the System theme and the control still works for the visit.
* **Shared tokens and fonts**: the canonical tokens (palettes, typography, spacing, radius and shadow scales) and the self-hosted Fontsource fonts move into one small frontend workspace package consumed by the web app and the docs site. There remains exactly one place that holds colours and `[data-theme]` selectors. The app's appearance and behaviour do not change.
* **Complete docs experience**: the search dialog and results; ADR and story status badges (keeping their text labels and any non-colour signal); inline code, fenced code and syntax highlighting; and the Mermaid architecture and sequence diagrams, whose colours come from the canonical palette rather than a second copy.
* **Previews for shared-theme changes**: a trusted same-repository pull request that changes the shared theme package gets a docs preview, through an explicit, bounded eligibility rule ([ADR-0025](../decisions/0025-github-pages-pr-previews.md), [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md)). Forks, artifact validation, current-head checks and deployment controls are unchanged.
* **Published and verified**: the delivered `main` revision is published to Pages and both themes and the switching are checked on the live site before the epic closes.

### Not in this story

* **Syncing the theme across origins or accounts**: no shared storage, cookie, query parameter or API. Each origin decides for itself.
* **New themes or user-defined colours**, and any change to the app's palette, fonts, layout or theme behaviour. The extraction must be behaviour-preserving.
* **Sharing the app's page layout or `components.css` with the docs site**: only tokens, fonts and the storage contract are shared.
* **A new docs layout, navigation or content**, or a React island in the docs site.
* **Previews for arbitrary application changes**: eligibility grows by one named package path, not by "anything under `frontend/`".
* **The Pages publication defect #429 and the deployment collisions of #285**: they are owned elsewhere. #518 and #519 only check their current state.
* **Third-party hosting of fonts** and any request to another origin for fonts or scripts.

### Dependencies

Every delivery issue waits for this card to merge. After that:

```mermaid
flowchart LR
  C["#514 Story card (PR 0)"] --> T["#515 Shared tokens, fonts, guards"]
  T --> D["#516 Docs adapter and control"]
  D --> S["#517 Search, badges, code, diagrams"]
  S --> V["#519 Verification, publication, card"]
  T --> P["#518 Shared-theme previews"]
  P --> V
```

* **#515 → #516 → #517** are one stack: `docs.css` and `astro.config.ts` are edited by all three, so each builds on the previous one rather than racing it.
* **#518** needs only the package boundary from #515 (the path it names); it can proceed beside #516 and #517.
* **#519** comes last and owns the card's final update, the integrated evidence and the post-merge publication check.
* **Per child, who owns what**: #515 the package, the app imports, manifests and the guard tests; #516 the docs adapter stylesheet, Starlight configuration and the control; #517 the specialised rules and their tests; #518 `.github` change rules, workflows and their tests; #519 the card, runbook and evidence.

### Acceptance criteria

Each criterion names the issue that delivers it. Criteria 1 to 5 belong to #515, 6 to 11 to #516, 12 to 15 to #517, 16 and 17 to #518, and 18 to 21 to #519.

1. **Given** the shared theme package, **when** the web app and the docs site are built, **then** both take their tokens and font files from it, and neither holds a second copy of a colour, type, spacing, radius or shadow value. (#515) Evidence: [Token guards](../../frontend/packages/theme/tests/tokens.test.ts) (`is the font-family source: fonts.css only imports the pinned Fontsource packages`); [Starlight adapter](../../frontend/apps/docs/src/theme/adapter.test.ts) (`maps every colour variable to a shared token`, `references only tokens the token file defines`); [app stylesheet guards](../../frontend/apps/web/dev/styles.test.ts) (`defines every token that a stylesheet uses`).
2. **Given** the app after the extraction, **when** I use it in Light, Dark and System, **then** its appearance, saved-choice behaviour (`calendar.theme`), live System following and no-flash start-up are unchanged and its existing theme and component tests pass. (#515) Evidence: [Web theme tests](../../frontend/apps/web/src/theme/theme.test.tsx), [control](../../frontend/apps/web/src/theme/ThemeControl.test.tsx) and [start-up script](../../frontend/apps/web/src/theme/startupScript.test.ts), all unchanged by the extraction, and the [storage contract](../../frontend/packages/theme/tests/storage.test.ts) (`is the key the web app's inline start-up script reads`). In the running app (#519) 15 of 18 screenshots (Today, Week and My tasks, Light, Dark and System, at 1280 and 390 px) are byte-identical to the build before the extraction; the three 1280 px Week views differ only in the event blocks and the all-day label, which story 0047 (#531) changed, and their theme colours match.
3. **Given** the package and its two consumers, **when** the style guard tests run, **then** they fail if a colour literal, system colour or `[data-theme` / `prefers-color-scheme` selector appears outside the package's token file, in either consumer's own stylesheets, and they fail if the OS-fallback dark block differs from the `data-theme='dark'` block. (#515) Evidence: [Guard scanners and fallback block](../../frontend/packages/theme/tests/tokens.test.ts) (`finds colour literals, system colours and literals inside color-mix, but not token references`, `finds theme selectors and colour-scheme queries`, `keeps the OS-fallback dark block identical to the data-theme dark block`, `defines the same token names in both themes`).
4. **Given** JavaScript is unavailable, **when** a page of either consumer loads, **then** it is themed by the operating system's preference through the package's fallback block. (#515) Evidence: Package side: the OS-fallback block is guarded by `keeps the OS-fallback dark block identical to the data-theme dark block` ([tokens.test.ts](../../frontend/packages/theme/tests/tokens.test.ts)). **Not met on the docs site:** Starlight ships `data-theme="dark"` in the HTML, so with JavaScript off and a light operating system the docs render dark. Found by #519 and tracked as [#534](https://github.com/mgasca/calendar/issues/534); this card does not claim the criterion until that is fixed and checked on the published site.
5. **Given** the package, **when** the web app is built, **then** its font requests still go only to its own origin and the packages are the pinned Fontsource versions in the lock file, updated through package tooling. (#515) Evidence: [Font source test](../../frontend/packages/theme/tests/tokens.test.ts) (`is the font-family source: fonts.css only imports the pinned Fontsource packages`). In the browser (#519), every request of a docs page and of a preview page went to its own origin and the fonts loaded under the base path (Fraunces Variable and Plus Jakarta Sans Variable). The web app's own font requests were not re-measured in #519.
6. **Given** Light is chosen, **when** any docs page is shown, **then** it displays Paper & Sage, and **given** Dark is chosen, **then** it displays Midnight Studio, including header, navigation, sidebars, headings, body text, links, tables, controls, focus rings, surfaces and shapes. (#516) Evidence: [Adapter](../../frontend/apps/docs/src/theme/adapter.test.ts) (`maps every colour variable to a shared token`, `maps the greys so text reaches AA on the page in both themes`); looked at in both themes at three widths (screenshots below).
7. **Given** System is chosen, **when** the operating system's preference changes while the page is open, **then** the page follows it without a reload. (#516) Evidence: [Controller](../../frontend/apps/docs/src/theme/theme.test.ts) (`follows OS changes only while the choice is System`); in the browser (#519), switching the emulated OS from dark to light changed `data-theme` with System selected and no reload.
8. **Given** I chose Light or Dark, **when** I reload or navigate to another docs page, **then** the choice is retained and the page never paints the other theme first. (#516) Evidence: [Start-up script and controller](../../frontend/apps/docs/src/theme/theme.test.ts) (`applies the saved Dark choice even when the OS is light (no wrong-theme flash)`, `retains the saved choice on the next page`). In the browser (#519), on every page of the matrix the background at the first animation frame already equalled the final background, and reload and navigation kept Dark.
9. **Given** storage is blocked or holds an invalid value, **when** I open and use the docs site, **then** it renders in the System theme, the control applies my choice for this visit and no error appears. (#516) Evidence: [Start-up script and controller](../../frontend/apps/docs/src/theme/theme.test.ts) (`still themes the page when storage throws`, `applies the choice for this visit when storage refuses writes or reads`). In the browser (#519), with `localStorage` throwing and with an invalid saved value the page rendered the System theme, Light applied for the visit, System followed the OS, and there was no console error.
10. **Given** the segmented control, **when** I use the keyboard or a screen reader, **then** the group has an accessible name, its current selection is announced, focus is visible, it is one tab stop and the arrow keys change the choice, as in the app. (#516) Evidence: [Built page](../../frontend/apps/docs/tests/build.test.ts) (`renders the Calendar radio group and start-up script, and no Starlight picker, on every page`). In the browser (#519) the group is named "Theme", is reached by Tab, shows a visible focus ring (3 px outline) and an arrow key changes the choice. That Tab leaves the group in one stop was not counted separately; the native radio group provides it. Not checked with a real screen reader.
11. **Given** widths of 360 px, about 800 px and a wide desktop in both themes, **when** I read a docs page, **then** the reading layout is preserved, there is no page-level horizontal scrolling, and the app and the docs site keep independent saved choices. (#516) Evidence: In the browser (#519), 36 page loads (3 pages × Light, Dark, System in a light and a dark OS × 360, 800 and 1440 px) had no page-level horizontal scroll. The app and the docs site keep independent choices because they are different origins and neither reads the other's storage; this was not tested across two real origins.
12. **Given** either theme, **when** I open search, type, move through results and press Escape, **then** the dialog, input, results, highlighted match and focus ring are readable and operate and close by keyboard. (#517) Evidence: In the browser (#519), in both themes at all three widths, Ctrl+K opened the dialog, typing "theme" listed 20 results, and Escape closed it. Screenshots below. **The input is not focused when the dialog opens** (the focus is on the dialog, or on its Cancel button at 360 px); the build before the theme work behaves the same, so it is Starlight's behaviour and not a regression. The highlighted match and arrow-key movement through results were looked at only in the screenshot, not asserted.
13. **Given** ADR and story pages in either theme, **when** a status badge is shown, **then** its text label and non-colour signal are kept and its text meets WCAG AA contrast against its background. (#517) Evidence: [Badge styles](../../frontend/apps/docs/src/lib/theme-content.test.ts) (`status badges`). In the browser (#519), all 24 badge kinds on ADR and story pages (accepted, superseded, planned, in-progress, in both themes) have a contrast ratio of 4.5 or more (lowest 5.83), keep their text label and have a solid 1 px border.
14. **Given** inline and fenced code in either theme, **when** it is shown, **then** it is readable with correct syntax highlighting, and long lines scroll inside the block rather than the page. (#517) Evidence: [Built page](../../frontend/apps/docs/tests/build.test.ts) (`ships no colour literal in the page CSS and styles code blocks by data-theme`); looked at in both themes (screenshots below). The runbook pages with code blocks and tables had no page-level horizontal scroll at 360, 800 and 1440 px; inner scrolling of one long line was not measured separately.
15. **Given** a page with Mermaid architecture and sequence diagrams, **when** I switch Light, Dark and System repeatedly, **then** each diagram re-renders in the canonical palette without losing its source and without console errors, and a slow network does not defeat the existing start-up race protection. (#517) Evidence: [Mermaid theme CSS](../../frontend/apps/docs/src/lib/theme-content.test.ts) (`holds no colour value, only token references that exist`, `paints every ownership class and its sequence-box marker from that ownership tokens`). In the browser (#519), six switches (Dark, Light, System, Dark, Light, Dark) on a sequence-diagram page kept one rendered diagram each time, with a different render in Dark and Light and no console error. The slow-network start-up race was not re-tested in #519.
16. **Given** pull requests from this repository, **when** the Changes job classifies them, **then** a docs-only change and a change confined to the shared theme package qualify for the docs build and preview, a mixed change qualifies only through a file the rule names, and a change to an unrelated frontend package or the web app alone does not; a fork PR gets no preview. (#518) Evidence: [Changes-job rules](../../tools/delivery-guards/tests/delivery-guards.tests.cs) (`AThemeOnlyChange_RunsTheDocsSite`, `ARenameOutOfTheThemePackage_RunsTheDocsSite`, `ThemeAndAppFilesTogether_RunTheDocsSiteThroughTheNamedFile`, `UnrelatedFrontendFilesTogether_DoNotRunTheDocsSite`). The fork case is the publisher's existing rule and was not re-run in #519.
17. **Given** an eligible PR, **when** its CI run succeeds, **then** its preview is published at its project base path and its pages, search, fonts and theme switching work there, with the publisher's validation, current-head and deployment controls unchanged. (#518) Evidence: Locally (#519) the site built for `/calendar/pr-preview/pr-999/` passes `verify:build`, serves every asset and font under that base path from its own origin and switches themes. This PR's own preview is linked from the PR once its checks finish; it is reported there, not here.
18. **Given** the finished change, **when** the evidence is reviewed, **then** before-and-after screenshots of the docs site in both themes, and the behavioural checks for initial paint, reload, navigation, keyboard focus, search, badges, code, tables, diagrams and storage failure at the three widths, are linked from the PR and the card. (#519) Evidence: This card and the screenshots below; the behavioural checks are the ones listed under each criterion and under "Evidence from #519".
19. **Given** the finished change, **when** I use the calendar app, **then** it has not regressed after the extraction. (#519) Evidence: See criterion 2: the calendar app's Today, Week and My tasks views, Light, Dark and System, 1280 and 390 px, with no console error, and its test suite (441 web tests) pass on the merged `main`.
20. **Given** the maintainer has merged the delivery PRs, **when** the delivered `main` revision has been published, **then** the successful Pages publication for that revision is confirmed and both themes and switching are checked on the live docs site; the epic does not close while a required publication fails. (#519) Evidence: **Pending:** checked after the maintainer merges this PR. The revision, its CI and Publish ADR site runs, and the inspection of the published site are recorded on #519 and added here.
21. **Given** the change is complete, **when** I run `just check`, **then** it passes, including the regenerated contract if the API changed (not expected). (#519) Evidence: `just check` exited 0 on `3a576a629` (`main` at the time): backend 478 of 478 tests, web 441, docs 209, theme 110, api-client 1, and the tools suites; shellcheck is not installed in this environment, so that step was skipped locally (CI runs it). The contract did not change.

### Verification and publication criteria

These are what #519 reports, per [AGENTS.md](../../AGENTS.md) ("Report what verification covered"): the revision, the exact command, its effective configuration and the files it covered, never one passing suite generalised to "all checks passed".

* **Commands**: `just frontend run` the web tests and the docs tests; `just docs build` at the root path and at a project subpath (`verify:build`); `just tools test` and `just tools adr`; `just check`. Name any check that was skipped or could not run (for example no Docker).
* **Local inspection**: both themes and System at 360 px, about 800 px and a wide size; initial paint, reload, navigation, keyboard focus, search, badges, code, tables, diagrams and failing storage. Screenshots via the `github-screenshots` skill.
* **Preview**: a qualifying PR's preview opened at `/calendar/pr-preview/pr-N/`, with assets and fonts under that base path and switching working.
* **Publication**: after the maintainer's merges, the `main` revision under test, the successful CI and Publish ADR site runs for that exact revision, and an inspection of the published site in both themes. Local passes, previews and CI on a PR head are reported separately from this.

## Design decisions

### Any Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0047](../decisions/0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) | Semantic CSS tokens selected by `data-theme` on `<html>` (accepted) | The mechanism both sites use; amended: the token layer and its guard move into a shared package with a second consumer |
| [0048](../decisions/0048-self-host-theme-fonts-with-fontsource-packages.md) | Self-host the theme fonts from Fontsource packages (accepted) | The fonts the docs site must also self-host; amended: the package owns the imports |
| [0025](../decisions/0025-github-pages-pr-previews.md) | Previews alongside production, published by a trusted `workflow_run` publisher (accepted) | Preview eligibility gains one named shared-theme path; the trust boundaries stay |
| [0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md) | Each CI job runs only for the paths it checks, from one jq rules file (accepted) | The rules file is where the shared-theme path is listed; amended to say so |
| [0045](../decisions/0045-run-time-regression-gates-for-ci-jobs.md) | Run-time regression gates for CI jobs (accepted) | Running the docs job for more changes must be checked against the recorded baseline, not silently reclassified |
| [0023](../decisions/0023-static-adr-log-publication.md) | Production is published from `main` | Publication is the final acceptance evidence |
| [0012](../decisions/0012-ci-and-dependency-updates.md) | CI and Dependabot | Dependency updates for the shared package and fonts follow the usual flow |

No new ADR is expected. The agreed mechanism (`data-theme` tokens, Fontsource fonts, trusted previews) does not change; what changes is where the token layer lives, who consumes it and one preview-eligibility path. Those are amendments, recorded the way ADR-0025's earlier eligibility changes were, with the maintainer's approval of this card as the approval of the amendment text. The amendments are in this PR and take effect with the delivery.

### Other decisions (not ADR-worthy)

* **Package**: `@calendar/theme` in `frontend/packages/theme/`, exporting the tokens stylesheet, the fonts stylesheet and the storage contract (key `calendar.theme`; values `light`, `dark`, `system`). The name and path were agreed on #514 and are fixed; #518 relies on the path.
* **The app keeps its theme module and inline script**: the extraction moves the stylesheet and font imports, not the app's runtime, so its behaviour cannot drift. A test asserts that the app's key and values agree with the package.
* **One controller in docs**: Starlight's own theme provider and picker are replaced by one start-up script and one native radio group, with no React, so two controllers never race on `data-theme`. Starlight and the app use the same attribute and values.
* **Same storage key, different origins**: the docs site uses the key `calendar.theme` in its own origin. Independence comes from the origins, not from a different key; nothing crosses origins.
* **Tokens map to Starlight's `--sl-*` variables** in the docs adapter; the docs site adds no palette of its own.
* **Diagram colours are derived from the package**, not copied into `astro.config.ts`; the way (build-time read of the tokens or a render-time read of computed styles) is chosen in #517 under that constraint.
* **Docs preview eligibility is a path, not a pattern**: `frontend/packages/theme/` is named in `.github/ci-changes.jq` and tested; `frontend/packages/api-client` and `frontend/apps/web` are not eligible by themselves.
* **Finding about #515's own preview**: since ADR-0025's amendment of 2026-11-07 a same-repository PR is eligible when the Changes job's Docs site output is true, and any file directly under `frontend/` (`package.json`, `pnpm-lock.yaml`) already sets it. The extraction PR is therefore expected to qualify through its lock-file change although it also edits the web app; #518 verifies this on the actual PR and records it, and the extraction is also verified locally.
* **Story 0039's exclusion is superseded**: its line "the docs site keeps its own theme" now points here.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Shared tokens, fonts and storage contract | `frontend/packages/theme/` (new; moved from `frontend/apps/web/src/styles/tokens.css` and the web app's Fontsource imports) |
| Web app consumer | `frontend/apps/web/src/index.css`, `src/main.tsx`, `dev/styles.test.ts` (guard relocation) |
| Docs adapter | `frontend/apps/docs/src/styles/docs.css`, `frontend/apps/docs/astro.config.ts` (Starlight `customCss`, component overrides, Expressive Code themes) |
| Theme control and start-up script | `frontend/apps/docs/src/components/` (new; native radio group, no React) |
| Mermaid | `frontend/apps/docs/astro.config.ts` (`mermaid()` configuration, `mermaidNoAutoStart`), `docs.css` |
| Preview eligibility | `.github/ci-changes.jq`, `tools/delivery-guards` tests, [ADR-0025](../decisions/0025-github-pages-pr-previews.md), [ADR-0046](../decisions/0046-run-ci-jobs-only-for-the-paths-they-check.md), the docs app `README.md` |
| Guidance | [`docs/runbooks/web-theme-and-styling.md`](../runbooks/web-theme-and-styling.md) (a docs-site section added by #519), `frontend/AGENTS.md` |
| Architecture model | `docs/architecture/calendar.architecture.json` (story entry added with this card; its status follows the card) |

### API

No changes.

### Testing

Layers, as built: package and guard tests (Vitest) for the tokens, fonts and storage contract; docs unit tests for the Starlight adapter, the start-up script, the controller and the Mermaid and badge styles; `verify:build` checks of the built site at the root path and at a project subpath; jq-rule tests in `tools/delivery-guards` for preview eligibility. Each criterion above links its tests. Layout, first paint, focus, search and the published site cannot be checked in jsdom, so they were checked in a browser by hand.

### Evidence from #519

Revision under test: `3a576a629` (`main`; its docs, frontend and backend files equal those of `6f254c406`, where the docs were built and inspected). The "before" build is `145105bc0`, the commit that merged this card and the last one before any theme code.

| Check | Command or method | Result |
| --- | --- | --- |
| Frontend | `just frontend run lint typecheck test` (the first run, at `2118e1c`), and the web, docs, theme and api-client suites inside `just check` at `3a576a629` | pass; web 441, docs 209, theme 110, api-client 1 tests |
| Formatting | `pnpm format:check` run directly in `frontend/` at `2118e1c`; the `corepack pnpm` form fails here only on a pnpm version mismatch (12.18.0 installed, 12.15.0 pinned) | pass; also inside `just check` at `3a576a629` |
| Docs | `just docs test`, then `just docs build` (with `verify:build`, 17 tests) at the root path and with `DOCS_SITE_URL` set to a `/calendar/pr-preview/pr-999/` subpath, at `6f254c406` | pass |
| Tooling | `just tools test`, `just tools adr` at `2118e1c`; again inside `just check` at `3a576a629` | pass |
| `just check` | at `3a576a629`, after `just backend restore` (the first run failed only because the new worktree had no NuGet restore) | exit 0; backend 478 of 478 with Docker available; shellcheck skipped (not installed locally, CI runs it) |
| Browser, docs | headless Chromium on the built site at `6f254c406`, 119 checks: three widths, Light, Dark and System in a light and a dark OS, three pages, first-frame theme, horizontal scroll, control keyboard use, blocked and invalid storage, live OS change, reload and navigation, search, diagram switching, and the preview base path | 119 of 119 pass; no console or network errors (the missing `favicon.svg` is known and ignored by `verify:build`) |
| Browser, no JavaScript | same site, JavaScript off | **fails**, light OS shows dark: [#534](https://github.com/mgasca/calendar/issues/534) |
| Calendar app | the `run-calendar` stack, the build before the extraction and the current one side by side, 18 screenshots each | 15 identical; three Week views differ by story 0047's change only |

Not run: a real screen reader, a real second origin for the independent-choice check, a throttled network for the Mermaid start-up race, other browsers than Chromium, and the published site (it comes after the merge).

Screenshots (before is the default Starlight theme):

| | Before | After |
| --- | --- | --- |
| Story page, Light, wide | ![Story page in Light before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-wide-light-before.png) | ![Story page in Light after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-wide-light-after.png) |
| Story page, Dark, wide | ![Story page in Dark before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-wide-dark-before.png) | ![Story page in Dark after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-wide-dark-after.png) |
| Story page, Light, 360 px | ![Story page in Light at 360 before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-360-light-before.png) | ![Story page in Light at 360 after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-360-light-after.png) |
| Story page, Dark, 360 px | ![Story page in Dark at 360 before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-360-dark-before.png) | ![Story page in Dark at 360 after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-story-360-dark-after.png) |
| Status badges, Light | ![Badges in Light before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-adr-badges-wide-light-before.png) | ![Badges in Light after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-adr-badges-wide-light-after.png) |
| Status badges, Dark | ![Badges in Dark before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-adr-badges-wide-dark-before.png) | ![Badges in Dark after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-adr-badges-wide-dark-after.png) |
| Code and tables, Light, 800 px | ![Code and tables in Light before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-code-table-800-light-before.png) | ![Code and tables in Light after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-code-table-800-light-after.png) |
| Code and tables, Dark, 800 px | ![Code and tables in Dark before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-code-table-800-dark-before.png) | ![Code and tables in Dark after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-code-table-800-dark-after.png) |
| Diagram, Light | ![Diagram in Light before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-diagram-wide-light-before.png) | ![Diagram in Light after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-diagram-wide-light-after.png) |
| Diagram, Dark | ![Diagram in Dark before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-diagram-wide-dark-before.png) | ![Diagram in Dark after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-diagram-wide-dark-after.png) |

Search and focus, after: ![Search in Light](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-search-wide-light-after.png) ![Search in Dark](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-search-wide-dark-after.png) ![Search at 360 in Dark](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-search-360-dark-after.png) ![Theme control focus ring](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/docs-control-focus-dark-after.png). The calendar app, before and after the extraction (Week view, 1280 px): ![Week in Dark before](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/app-week-dark-before.png) ![Week in Dark after](https://raw.githubusercontent.com/mgasca/calendar/17ac6484154c3ba3e13798ff18a2001863735282/519/app-week-dark-after.png).

### Delivery plan

Delivered as planned: PR 0 ([#523](https://github.com/mgasca/calendar/pull/523), the card and the ADR amendments), then #515 ([#526](https://github.com/mgasca/calendar/pull/526)), #516 ([#527](https://github.com/mgasca/calendar/pull/527)) and #517 ([#529](https://github.com/mgasca/calendar/pull/529)) as one stack, #518 ([#525](https://github.com/mgasca/calendar/pull/525)) beside it, then #519 ([#536](https://github.com/mgasca/calendar/pull/536), this PR). The maintainer merged each.

### Lessons learned, known issues and follow-ups

* **Known issue, [#534](https://github.com/mgasca/calendar/issues/534):** Starlight writes `data-theme="dark"` into the HTML, so with JavaScript off a light-OS visitor gets the dark theme instead of the OS preference (criterion 4 on the docs site). The fallback block only applies when the attribute is absent. Found by checking the page with JavaScript disabled, which no unit test did; the fix and a test for it belong to #516's area. After it merges, re-check on the published site.
* **Search does not focus its input on open.** Starlight's default: the pre-theme build behaves the same. It is not part of this story; the keyboard can still reach the input and close the dialog with Escape.
* **A trace of `data-theme` is not a first-paint check.** The static `data-theme="dark"` makes a mutation trace show dark then light on a light page, although the start-up script runs in the head before the first frame. The check that matters is the background at the first animation frame, which #519 used.
* **A fresh worktree needs `just backend restore` before `just check`**, and `corepack pnpm` can fail on a pnpm version mismatch where `pnpm` run directly does not; neither is a defect of this story.
* **The docs site still has no favicon.** `verify:build` ignores the missing `favicon.svg`; every page requests it and gets a 404.
* **After the merge** the published site is inspected in both themes and with switching, and the card's criterion 20 and status are updated from "in progress" accordingly.

## User guide

### Choose light or dark on the docs site

1. In the docs site header, find the **Light / Dark / System** control (a group named "Theme").
2. Choose **Light** for Paper & Sage, **Dark** for Midnight Studio, or **System** to follow your device.

The page changes at once and you stay where you are. The docs site remembers your choice in this browser, separately from the calendar app: choosing a theme in one does not change the other. With the keyboard, Tab to the control and use the arrow keys to move between the options. If your browser does not allow the site to store the choice, it still applies for your visit and the site follows your device next time. Until [#534](https://github.com/mgasca/calendar/issues/534) is fixed, a browser with JavaScript turned off shows the dark theme whatever your device prefers.
