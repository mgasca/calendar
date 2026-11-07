---
status: accepted
date: 2026-11-07
decision-makers: mgasca, Claude (AI assistant)
---

# Self-host the theme fonts from Fontsource variable-font packages

## Context and Problem Statement

[Story 0039](../stories/0039-switchable-light-and-dark-themes.md) (epic #428) gives each theme its own heading voice: **Paper & Sage** uses editorial serif headings and **Midnight Studio** bold sans-serif headings. The web app today uses `system-ui`, so the look differs by operating system. The product owner chose self-hosted web fonts over system font stacks on 2026-11-07 (recorded on issue #428). [ADR-0047](0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) makes typefaces theme tokens; this record decides where the font files come from and which typefaces are used.

## Decision Drivers

* **D1 Same look everywhere**: headings must look the same on Windows, macOS, Linux, Android and iOS, so the two themes are recognisable.
* **D2 No third-party requests**: the app handles a signed-in user's calendar; loading fonts must not send requests or IP addresses to another origin.
* **D3 Load cost**: font files add to first load; only the weights and subsets used should ship, with text visible while they load.
* **D4 Maintained like other dependencies**: versions are pinned in the lock file and updated through the normal dependency process, not by hand-copied files.
* **D5 Licence**: the fonts must be free to bundle and serve in this app.

## Considered Options

* Fontsource variable-font npm packages, bundled by Vite
* Font files committed to the repository by hand
* Google Fonts stylesheet from the Google CDN
* System font stacks only

## Decision Outcome

Chosen option: "Fontsource variable-font npm packages, bundled by Vite", because Vite serves the files from the app's own origin (**D2**), the same typefaces render on every platform (**D1**), the packages are pinned in `pnpm-lock.yaml` and updated like any other dependency (**D4**), and both fonts are under the SIL Open Font License 1.1 (**D5**). Importing only the Latin subset of each variable font keeps the cost to a few files (**D3**).

| Driver | **Fontsource packages (chosen)** | Files committed by hand | Google Fonts CDN | System font stacks |
| --- | :---: | :---: | :---: | :---: |
| D1 Same look everywhere | ★★★ | ★★★ | ★★★ | ☆☆☆ |
| D2 No third-party requests | ★★★ | ★★★ | ☆☆☆ | ★★★ |
| D3 Load cost | ★★☆ | ★★☆ | ★★☆ | ★★★ |
| D4 Maintained like other dependencies | ★★★ | ☆☆☆ | ★★☆ | ★★★ |
| D5 Licence | ★★★ | ★★★ | ★★★ | ★★★ |

### Typefaces

* **Paper & Sage headings**: Fraunces, `@fontsource-variable/fraunces` (5.3.0 at the time of writing, OFL-1.1), an editorial serif with optical sizes.
* **Midnight Studio headings and body text in both themes**: Plus Jakarta Sans, `@fontsource-variable/plus-jakarta-sans` (5.3.0 at the time of writing, OFL-1.1).
* Each `--font-*` token ends in a system fallback stack (`Georgia, serif` and `system-ui, sans-serif`), and the font faces use `font-display: swap`, so text renders before the files arrive.

### Consequences

* Good, because the themes look as designed on every platform, and no request leaves the app's origin.
* Good, because the fonts go through the same lock file, audit and update flow as the rest of the frontend.
* Bad, because first load grows by the subset font files; issue #431 measures the `vite build` output before and after, as `frontend/AGENTS.md` asks for bundle changes.
* Bad, because a font swap can shift heading layout briefly on a cold load.
* Neutral, because Dependabot's weekly npm entry for `/frontend` (`.github/dependabot.yml`, [ADR-0012](0012-ci-and-dependency-updates.md)) proposes updates to the font packages like the other frontend dependencies, grouped with them as `frontend-prod` for minor and patch releases. *Amended 2026-11-07:* this line said Dependabot did not watch the frontend and the packages were updated by hand, which was already wrong when it was written (#475).

### Confirmation

* The built app's network requests for fonts go only to its own origin (checked in the screenshots of issue #435).
* The `vite build` size before and after is recorded in the PR for issue #431.
* The token-layer guard of [ADR-0047](0047-semantic-css-tokens-selected-by-a-data-theme-attribute.md) keeps font families in the token file.

## Pros and Cons of the Options

### Fontsource variable-font npm packages, bundled by Vite

* Good, because **D1 Same look everywhere**: the same font files on every platform.
* Good, because **D2 No third-party requests**: Vite copies the files into the build and serves them from the app.
* Good, because **D4 Maintained like other dependencies**: exact versions in `pnpm-lock.yaml`, installed with `--frozen-lockfile` in CI.
* Good, because **D5 Licence**: both packages are OFL-1.1.
* Neutral, because **D3 Load cost**: the subset import loads only Latin glyphs, but the variable files carry every weight.

### Font files committed to the repository by hand

* Good, because **D1 Same look everywhere** and **D2 No third-party requests**: same result as the packages.
* Good, because **D5 Licence**: the same OFL fonts.
* Neutral, because **D3 Load cost**: the files can be trimmed by hand to exactly the glyphs needed.
* Bad, because **D4 Maintained like other dependencies**: binary files with no version, no lock entry and no update path.

### Google Fonts stylesheet from the Google CDN

* Good, because **D1 Same look everywhere** and **D5 Licence**: same typefaces.
* Neutral, because **D3 Load cost**: Google serves per-browser subsets, but a second origin adds a connection.
* Neutral, because **D4 Maintained like other dependencies**: no package to update, but the served files can change without a commit.
* Bad, because **D2 No third-party requests**: every page load sends the visitor's IP address to Google.

### System font stacks only

* Good, because **D2 No third-party requests**, **D3 Load cost** and **D4 Maintained like other dependencies**: nothing to load or update.
* Good, because **D5 Licence**: nothing is bundled.
* Bad, because **D1 Same look everywhere**: the serif and sans fall back to whatever each platform has, so the themes look different by device; the product owner chose against this.

## More Information

* Story: [0039](../stories/0039-switchable-light-and-dark-themes.md); epic #428; implemented in issue #431.
* Versions and licences checked with `npm view <package> version license` on 2026-11-07.
* Revisit if the bundle-size measurement for issue #431 shows a first-load cost the product owner considers too high, or if a typeface is replaced.
* **Amendment, 2026-11-07:** the Dependabot consequence was corrected: `.github/dependabot.yml` configures npm for `/frontend`, so the font packages get Dependabot updates, not hand updates; see the note under Consequences. Approved by the maintainer on issue #475, who confirmed that no driver or weight changed, so the ratings stand. The decision itself is unchanged, so this ADR was amended, not superseded.

### Open questions for the reviewer

1. Typefaces: Fraunces for Paper & Sage headings and Plus Jakarta Sans for everything else. Keep these, or name others?
