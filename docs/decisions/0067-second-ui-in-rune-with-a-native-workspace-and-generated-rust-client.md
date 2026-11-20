---
status: proposed
date: 2026-11-20
decision-makers: mgasca, Claude (AI assistant)
---

# A second UI in Rune, in a separate native/ Cargo workspace with a Rust client generated from the contract

## Context and Problem Statement

Calendar has one UI, the React single-page app ([ADR-0003](0003-react-vite-typescript-web-ui.md)), which consumes `contracts/openapi.json` through a generated TypeScript client ([ADR-0004](0004-openapi-contract-and-generated-client.md)). Epic [#998](https://github.com/mgasca/calendar/issues/998) adds a second UI that runs as a native desktop app on Linux, macOS and Windows and as a WASM build in the browser, reaches parity with the web app, consumes the contract through a generated Rust client and never depends on backend crates. The maintainer chose [Rune](https://github.com/anomalyco/rune), a pre-release GPU-rendered Rust UI framework, and agreed the layout, CI and hosting on 2026-11-20. Rune pins Rust 1.99.1 while the backend pins 1.100.0 ([ADR-0053](0053-cargo-workspace-dependency-management.md)), and the contract is OpenAPI 3.1.1. Which framework builds the second UI, and how are its workspace, client generation, CI and browser hosting set up?

## Decision Drivers

* **D1 One codebase on four targets**: the same Rust code runs on the Linux, macOS and Windows desktop and in the browser as WASM.
* **D2 Headless testability**: CI and the end-to-end stack can render the app with no display and assert on its element tree and on images ([story 0064](../stories/0064-test-every-user-flow-end-to-end-and-prove-it-is-observable.md)).
* **D3 Isolation from the backend**: its own toolchain pin, lockfile and lint gates, the contract as the only coupling, and no slowdown of backend or web CI when `native/` is untouched.
* **D4 Stability and supply chain**: published releases, a registry source, a permissive licence and a maintainer who takes fixes.
* **D5 Accessibility and text input**: screen readers, keyboard focus and IME on the desktop and in the browser, since parity includes creating and editing events and tasks.
* **D6 Purpose of the epic**: an independent second client, natively rendered, that proves the contract serves more than the React app and lets the maintainer evaluate a GPU-native Rust UI.

## Considered Options

* Rune, pinned to a `dev` revision
* iced
* egui with eframe
* Slint
* Tauri shell around the existing React app

## Decision Outcome

Chosen option: "Rune, pinned to a `dev` revision", because it is a natively rendered Rust UI on all four targets (D1, D6) with the strongest built-in headless tooling of the options: element trees, accessibility trees, PNG snapshots, scripted input and a fixed virtual clock, with no display (D2). A separate workspace gives it its own pins (D3). It is the weakest option on stability (D4): no releases, a git dependency with six patched forks, and an experimental, WebGPU-only web target. The conventions below contain that risk, and the maintainer accepts it as the price of the evaluation the epic exists for. egui with eframe is the fallback if Rune proves unworkable (see "Fallback").

| Driver | **Rune (chosen)** | iced | egui with eframe | Slint | Tauri shell |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 One codebase on four targets | ★★☆ | ★★☆ | ★★★ | ★★★ | ★★☆ |
| D2 Headless testability | ★★★ | ★☆☆ | ★★☆ | ★★☆ | ★★☆ |
| D3 Isolation from the backend | ★★★ | ★★★ | ★★★ | ★★★ | ★★☆ |
| D4 Stability and supply chain | ☆☆☆ | ★★☆ | ★★★ | ★★☆ | ★★★ |
| D5 Accessibility and text input | ★★☆ | ★☆☆ | ★★☆ | ★★☆ | ★★★ |
| D6 Purpose of the epic | ★★★ | ★★☆ | ★★☆ | ★★☆ | ☆☆☆ |

### Rune dependency

* **Pinned revision.** `native/Cargo.toml` depends on Rune by git URL and an exact `rev` of the `dev` branch (Rune says "Pin a rev of `dev`; `dev` is never rewritten"), never a branch. It copies the six `[patch.crates-io]` entries from Rune's "Depending on Rune" section at the same `rev` (its patched winit, sctk-adwaita, parley_engine, wgpu-hal, accesskit_windows and accesskit_macos). A Rune bump is its own PR that moves the `rev`, the patches and the toolchain pin together, reads Rune's CHANGELOG for changes that move output without a code change, and re-blesses goldens only with the diff reviewed.
* **Name collision.** The crates.io packages `rune` and `rune-core` belong to an unrelated scripting language. The git source in the lockfile is the guard; Dependabot does not update git dependencies, so bumps are manual.
* **Upstream.** Rune takes issues, not pull requests. A Rune defect we hit is reported upstream and worked around in `native/`, never by forking Rune into this repository.

### The `native/` workspace

* **Layout.** A Cargo workspace at `native/`, a sibling of `backend/` and `frontend/` ([ADR-0001](0001-monorepo-layout.md)), with `crates/calendar-native` (the app: views, state, platform glue) and `crates/calendar-client` (the generated client and a thin hand-written layer for the base URL, cookies and errors). It has no path, git or registry dependency on any `backend/` crate; the contract is the only coupling.
* **Toolchain.** `native/rust-toolchain.toml` pins Rune's toolchain exactly, `1.99.1` today, with `clippy`, `rustfmt` and the `wasm32-unknown-unknown` target. It follows Rune's pin, not the backend's: the two workspaces may differ, and `just doctor` checks both.
* **Dependencies.** A workspace dependency table and a committed `native/Cargo.lock`, with every recipe and CI step `--locked`, as in [ADR-0053](0053-cargo-workspace-dependency-management.md). Dependabot gets a `/native` Cargo entry for the registry dependencies.
* **Lints.** rustfmt and Clippy with `all` denied and `pedantic` on, warnings as errors, as strict as the backend ([ADR-0055](0055-rust-static-analysis-and-formatting.md)).
* **Recipes.** A `native` just module (`native/mod.just`): `dev` opens the app on Linux/WSLg against the local API, `test` runs the headless suite, `lint`, `build`, `build-web`, `generate`. The root `build`, `test`, `lint` and `check` include it.

### Generated Rust client

The contract is OpenAPI 3.1.1 (generated by utoipa) and uses 3.1 type arrays, counted on 2026-11-20: 53 nullable ones such as `["null", "string"]` and 13 non-null `["integer", "string"]` unions.

| Generator | Version checked | OpenAPI 3.1 | Fit |
| --- | --- | --- | --- |
| `openapi-to-rust` | 0.24.0 | Yes; documents `type: ["X", "null"]`, `oneOf`, `anyOf`, `allOf` | reqwest client that compiles for `wasm32-unknown-unknown` and native: **chosen** |
| `oas3-gen` | 0.29.0 | Yes (3.1.2) | reqwest client; wasm32 and type-array handling not documented: fallback |
| `progenitor` | 0.17.0 | No: "OpenAPI 3.0.x" only; 3.1 support is an open issue (#762, since 2024) | Ruled out unless the contract were down-converted |
| OpenAPI Generator, `rust` | 7.27.0 | "3.1 (beta support)" | Needs a Java runtime in the toolchain; ruled out |
| 3.1 to 3.0 down-conversion, then progenitor | `@apiture/openapi-down-convert` 0.14.2 | Converts | A Node tool ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)) and a lossy step for the `["integer", "string"]` unions; ruled out |

* **Running it.** The generator's version is pinned exactly. It runs from `native/` through `just native generate`, either as a pinned build-only dependency of a small generator binary in the workspace (so `native/Cargo.lock` holds it) or, if the crate offers only a CLI, installed with `cargo install --locked --version`. #1003 chooses between the two and records it on its card. Its output is committed under `crates/calendar-client/src/` and never edited by hand, like `schema.gen.ts`.
* **`just contracts`.** It becomes `backend::contract frontend::generate native::generate`, so one command regenerates the contract and both clients. The agent hook that guards generated files covers the new path.
* **Staleness.** The Linux native CI job runs `just native generate` and fails on any diff (`git diff --exit-code`), so a contract change without a regenerated Rust client fails CI. The job also runs when only `contracts/openapi.json` changes.
* **If the generator fails.** If `openapi-to-rust` cannot generate a client that builds and round-trips against the API, #1003 switches to `oas3-gen` with this ADR amended, before hand-writing anything.

### CI

* **Every PR: Linux and WASM.** A Linux job builds, lints and runs the headless tests (element and accessibility tree goldens, and PNG snapshots) on a software Vulkan driver (Mesa lavapipe), with the `libxkbcommon` and `libwayland` build packages. A WASM job builds the `wasm32-unknown-unknown` bundle and checks its size. Both join the `changes` filter and the `CI result` gate, and run on every PR as agreed.
* **`native/` PRs and nightly: macOS and Windows.** A matrix job builds and runs the same headless tests on `macos-latest` and `windows-latest` (MSVC) when a PR touches `native/` or `contracts/openapi.json`, and on a nightly schedule against `main`. Windows and macOS failures on a PR block it like any job.
* **Goldens.** The tree goldens are the gate on every platform: they are deterministic and independent of the GPU. PNG snapshots are rendered with the same GPU path; on Linux CI they are compared with a tolerance, and on macOS and Windows they are kept as artefacts until #1009 shows they are stable enough to gate.
* **Browser smoke test.** Rune's web target needs WebGPU. A headless browser smoke test of the WASM bundle is part of #1009 if a CI runner's Chromium exposes WebGPU; until then the WASM job builds only.

### WASM hosting at `/native/`

* **Build.** `just native build-web` runs `cargo build --target wasm32-unknown-unknown --locked` and `wasm-bindgen` at the exact version Rune pins (`wasm-bindgen-cli` 0.2.129 today, installed `--locked`). It does not call Rune's `scripts/web-build.sh`, which needs Python, so the repository takes on no Python or shell tooling ([ADR-0058](0058-typescript-on-deno-for-repository-tooling.md)).
* **Same origin.** The bundle is served under `/native/` on the same origin as the API and the React app, so the browser's session cookie works unchanged ([ADR-0027](0027-google-oidc-bff-session.md)). Locally the Vite dev server serves it under `/native/` beside its `/api` proxy. In deployment the container image builds it and places it at `native/` in the web root that the API already serves, with the same cache rules; requests under `/native/` fall back to `/native/index.html`, not to the React app's entry page. #1009 delivers both.
* **Browsers.** Without WebGPU (no WebGL fallback in Rune), `/native/` shows a message that links to the React app.

### Fallback

* **When:** if Rune blocks a slice for more than a week with no upstream fix or workaround, or a Rune bump breaks the app in a way that cannot be fixed in `native/`.
* **What:** egui with eframe, the most stable option with web support through WebGL or wgpu. The `native/` workspace, the generated client, the recipes, CI and `/native/` hosting stay as they are; only `calendar-native`'s UI layer changes, and this ADR is superseded.
* **What keeps it viable:** the generated client and the app state stay in crates or modules that do not import Rune, so the UI layer can be replaced alone.

### Consequences

* Good, because the contract gains a second, independent consumer in another language, which catches contract defects the TypeScript client hides.
* Good, because headless trees, snapshots and scripted input make the UI testable in CI and the end-to-end stack without a display.
* Good, because a separate workspace keeps the backend's toolchain, lockfile and CI time unchanged when `native/` is untouched.
* Bad, because Rune has no releases, is a git dependency with six patched forks, does not take pull requests, and records frequent changes that move output; every bump costs review time.
* Bad, because two Rust toolchains are installed and cached, and macOS and Windows runners make `native/` PRs slower and dearer.
* Bad, because the WASM build works only in browsers with WebGPU, and text input and screen-reader support on the web are less complete than in the React app.
* Neutral, because packaging, code signing and installers are out of scope (#1011).

### Confirmation

* `just tools adr` validates this record and its architecture model entry.
* CI: the Linux and WASM native jobs on every PR, the macOS and Windows matrix on `native/` PRs and nightly, and the staleness check of the generated client, all under `CI result` (#1002, #1003, #1009).
* `native/Cargo.toml` names Rune by exact `rev`; `native/rust-toolchain.toml` matches Rune's pin at that `rev`; `just doctor` checks the toolchains.
* Review: no `native/` crate depends on a `backend/` crate, and the `ADR-0058` rule holds (no Python or shell build steps).

## Pros and Cons of the Options

### Rune, pinned to a `dev` revision

* Good, because **D1 One codebase on four targets**: one renderer on macOS, Windows, Linux (X11 and Wayland) and the web.
* Bad, because **D1 One codebase on four targets**: the web target is "experimental", needs WebGPU and has no WebGL fallback, overlays or native menus.
* Good, because **D2 Headless testability**: every app runs headless with "same renderer, fixed virtual clock" and writes `--snap` PNGs, `--tree` element trees with roles and rectangles, accessibility trees and `--script` input; tests can drive `App::headless_runtime` in process.
* Good, because **D3 Isolation from the backend**: the separate workspace holds its pins.
* Bad, because **D4 Stability and supply chain**: no releases or tags, not on crates.io, six patched forks to copy, an upstream that takes no pull requests, and CI upstream only on macOS.
* Neutral, because **D4 Stability and supply chain**: MIT-licensed and very active (`dev` moved on the day of writing).
* Neutral, because **D5 Accessibility and text input**: AccessKit on the desktop (UIA, NSAccessibility, AT-SPI) and secure text fields, but Rune notes that "winit's IME is incomplete", and the web uses a DOM mirror and a hidden textarea.
* Good, because **D6 Purpose of the epic**: a natively rendered, independent client in pure Rust, which is the evaluation the maintainer asked for.

### iced

* Good, because **D1 One codebase on four targets**: Windows, macOS, Linux and the web.
* Bad, because **D2 Headless testability**: we found no built-in equivalent of Rune's tree and snapshot tooling to drive CI and the end-to-end stack.
* Good, because **D3 Isolation from the backend**: on crates.io and fits the same separate workspace.
* Neutral, because **D4 Stability and supply chain**: MIT and on crates.io, but its README calls it "experimental software" and its last release (0.14.0) was in December 2025.
* Bad, because **D5 Accessibility and text input**: screen-reader support was not found in its released crates; not verified further for this record.
* Neutral, because **D6 Purpose of the epic**: a natively rendered Rust client, but not the framework the maintainer chose to evaluate.

### egui with eframe

* Good, because **D1 One codebase on four targets**: Linux, macOS, Windows and the web, with WebGL or wgpu in the browser.
* Neutral, because **D2 Headless testability**: a separate test harness exists, with less tooling around trees, scripts and video than Rune's.
* Good, because **D3 Isolation from the backend**: the same separate workspace.
* Good, because **D4 Stability and supply chain**: regular releases on crates.io (0.37.0, October 2026), MIT or Apache-2.0.
* Neutral, because **D5 Accessibility and text input**: AccessKit on the desktop; immediate-mode text input is functional but basic.
* Neutral, because **D6 Purpose of the epic**: immediate mode suits tools more than a product UI, and it is not the maintainer's chosen subject.

### Slint

* Good, because **D1 One codebase on four targets**: desktop, mobile, web and embedded.
* Neutral, because **D2 Headless testability**: it has a testing backend, not checked in depth here.
* Good, because **D3 Isolation from the backend**: the same separate workspace.
* Neutral, because **D4 Stability and supply chain**: stable 1.x releases (1.19.0, November 2026), but the licence is GPL-3.0, a royalty-free licence with conditions, or a commercial one.
* Neutral, because **D5 Accessibility and text input**: AccessKit-based accessibility on the desktop.
* Neutral, because **D6 Purpose of the epic**: the UI is written in Slint's own markup language, not plain Rust.

### Tauri shell around the existing React app

* Neutral, because **D1 One codebase on four targets**: desktop through the system webviews (WebView2, WKWebView, WebKitGTK); the browser target is simply the React app.
* Neutral, because **D2 Headless testability**: Playwright covers the browser, but driving the desktop webviews headlessly differs per platform.
* Neutral, because **D3 Isolation from the backend**: the shell is Rust, but the UI shares the React app's code and release cadence.
* Good, because **D4 Stability and supply chain**: stable 2.x (2.12.7, November 2026), Apache-2.0 or MIT, a large community.
* Good, because **D5 Accessibility and text input**: the browser's DOM accessibility and text input.
* Bad, because **D6 Purpose of the epic**: it reuses the React client, so the contract gains no second consumer and nothing is evaluated.

## More Information

* **Versions checked on 2026-11-20:** Rune `dev` at `9553c9a7d7d1e5e038d14e0b313513e95b4fb8bb` (no tags; MIT; `rust-toolchain.toml` channel `1.99.1` with `wasm32-unknown-unknown`; wgpu 30.0.1, winit 0.30.13; `wasm-bindgen-cli` 0.2.129); iced 0.14.0; egui and eframe 0.37.0; Slint 1.19.0; Tauri 2.12.7; `openapi-to-rust` 0.24.0; `oas3-gen` 0.29.0; progenitor 0.17.0; OpenAPI Generator 7.27.0; `@apiture/openapi-down-convert` 0.14.2; reqwest 0.13.5 (browser `fetch` on wasm32, where cookies are the browser's; a native-only `cookies` feature); `keyring` 4.2.0. Versions on crates.io, Rune from its repository and README files.
* **Related:** [ADR-0001](0001-monorepo-layout.md) (top-level directories), [ADR-0003](0003-react-vite-typescript-web-ui.md) (the first UI), [ADR-0004](0004-openapi-contract-and-generated-client.md) (contract-first), [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md) (the client supplies `today` and `timeZone`), [ADR-0053](0053-cargo-workspace-dependency-management.md) and [ADR-0055](0055-rust-static-analysis-and-formatting.md) (Cargo and lint conventions copied), [ADR-0058](0058-typescript-on-deno-for-repository-tooling.md) (no Python or shell tooling). Native sign-in is a separate decision (#1001).
* **Delivery:** #1002 (scaffold, recipes, Linux and WASM CI), #1003 (generated client), #1009 (macOS and Windows CI, `/native/` hosting); story card in #999.
* **Revisit** when Rune publishes releases (pin a version instead of a `rev`), when a generator in the table changes its OpenAPI 3.1 support, when Rune's web target gains WebGL, or when the fallback condition above is met.
