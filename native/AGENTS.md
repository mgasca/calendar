# Rune UI practices

Practices for the second UI in `native/`, built with [Rune](https://github.com/anomalyco/rune), a pre-release GPU-rendered Rust UI framework ([ADR-0067](../docs/decisions/0067-second-ui-in-rune-with-a-native-workspace-and-generated-rust-client.md), epic [#998](https://github.com/mgasca/calendar/issues/998)). The root `AGENTS.md` still applies and nothing here overrides it. Rune's own guide is `crates/rune/README.md` in its repository, at the pinned revision.

## Workspace

- `native/` is its own Cargo workspace with its own `rust-toolchain.toml` (Rune's Rust pin, not the backend's) and `Cargo.lock`. Every recipe and CI step runs `--locked`. Nothing here depends on `backend/`: the app talks to the API only through the contract.
- `crates/calendar-native` is the app: `App` (all state), `view` (state to elements), `spec()` (window, size, named scenes), with a desktop `main.rs` and a wasm `start()`. It is a `cdylib` and `rlib`, so the same code builds the window, the browser bundle and the tests.
- Lints are the backend's (`warnings` denied, Clippy `all` denied, `pedantic` warned and denied by `-D warnings`). `just native lint` runs Clippy for the desktop **and** `wasm32-unknown-unknown` (`lint-desktop` and `lint-wasm`, which CI runs one per matrix row), so code that only one target compiles is caught.
- Linux builds need `libxkbcommon-dev` and `libwayland-dev` (`just doctor` checks them). Headless PNG renders without a GPU need `mesa-vulkan-drivers` (lavapipe).

## Commands

`just native dev` opens the window (WSLg works). `just native test` runs the headless suite and `just native lint` the checks. `just native build-web` builds the browser bundle into `native/target/web/` with `wasm-bindgen` at the version of the `wasm-bindgen` crate in `native/Cargo.lock`, which `native/Cargo.toml` pins to exactly the version in Rune's own lock (ADR-0067). `just frontend dev` then serves it at http://localhost:5173/native/ beside `/api`, on the web app's origin, and the container image builds it into `wwwroot/native/`, which the API serves at `/native/` (#1009). Without WebGPU the page links to the React app. The Dockerfile repeats this recipe's cargo and `wasm-bindgen` steps, so change both together. Don't use Rune's `scripts/web-build.sh`, which needs Python (ADR-0058).

## Views

- **Theme by token.** Colours come from `theme::tokens(cx.system_dark())`, whose values are the web app's `--color-*` tokens. `tests/theme.rs` fails when they drift from `frontend/packages/theme/src/tokens.css`. Pick a token by meaning, as the [theme guide](../docs/runbooks/web-theme-and-styling.md) says, and never add a literal colour to a view.
- **Key and name what a test or a user reaches.** Every element a test finds or presses gets a stable `.key("…")`, and every control gets a `role` and a `label`, so the accessibility tree reads like the web app's. For example, the current page is marked `checked`, where the web app uses `aria-current`.
- **Match the web app.** Labels, order and behaviour follow `frontend/apps/web`. When they differ on purpose, say so in the PR and on the story card.

## Headless tests

- **Element tree** (`tests/shell.rs`): `rune::Runtime::new(state, view, size, Env { system_dark, scale })`, then `rt.find(key)`, `rt.pointer_down/up`, `rt.frame(dt)` (virtual clock), and assertions on `rt.state`. No window and no GPU.
- **Goldens** (`tests/goldens.rs`): the app's own binary runs with `--scene <name> --theme light|dark --tree` and `--snap`. Accessibility trees gate on every platform. PNGs gate on Linux only, with a small per-pixel tolerance, because GPU output differs between platforms. A failure leaves the actual output in `native/target/goldens/`, which CI uploads.
- **Re-blessing**: run `BLESS=1 just native test`, look at every changed golden (open the PNGs), and say in the PR why it changed. Never re-bless to make an unexplained failure go away.
- Add a named scene to `spec()` for each state a golden needs, rather than driving input in a golden test.

## Bumping Rune

Rune has no releases: `native/Cargo.toml` pins an exact `rev` of its `dev` branch, which is never rewritten. A bump is its own PR, and it does all of these together:

1. Move the `rev` of `rune` **and of every `[patch.crates-io]` entry** to the new revision. Then compare the patch list with Rune's root `Cargo.toml` at that revision, because Cargo does not inherit a dependency's patches.
2. Move `rust-toolchain.toml` to the channel Rune's `rust-toolchain.toml` names at that revision.
3. Set the `wasm-bindgen` pin in `native/Cargo.toml` to the version in Rune's `Cargo.lock` at the new revision. Run `cargo update -p rune -p wasm-bindgen` (never edit `Cargo.lock` by hand). Then run `just native run lint test build-web`, after installing the matching `wasm-bindgen-cli` if the pin moved.
4. Read Rune's `CHANGELOG.md` between the two revisions for changes that move output without a code change. Re-bless goldens only with the diff reviewed.

## The API client

- `crates/calendar-client/src/generated/` is generated from `contracts/openapi.json` by `crates/calendar-client-gen`, which pins `openapi-to-rust` as a library. Run `just contracts` (or `just native generate`), and never edit the output by hand *(hook)*. `the_committed_client_is_the_generated_client` fails when the output is stale. `rustfmt` and the lints skip the generated module.
- Views call the API through `calendar_client::Api`, not the generated client:
  - Every call that depends on the day takes a `Day` (the client's date and IANA time zone, ADR-0021).
  - Errors are `ApiError { status, message }`, with the message chosen as the web app's `problemMessage` chooses it.
  - `on_unauthorized` fires on a 401 from anything but `/api/auth/me`.
  - `api.traced(&parent)` sends a W3C `traceparent` on every call it makes. Use one `TraceParent` per user action, so that action's server spans, logs and metrics share its trace id (#1010). The app exports no telemetry of its own.
- When a slice needs an operation the wrapper lacks, add a method to `Api` with a stub-server test in `tests/api.rs`, rather than calling `generated()` from a view.
- The session layer (`calendar-native/src/session/`, #1008) owns the `reqwest::Client`: a cookie store on the desktop, the browser's cookies on the web.

## State, loading and scenes

- `App` holds everything: `route`, `session` (owned by #1008), `api`, `effects`, `clock`, and one `Remote<T>` per page (`data`, `loading`, `error`). `load::ensure` decides what to fetch: the session check first, then the current page when its key (route and today's date) changed or its data is five minutes old. `poll` runs it every 15 s, so pages roll over at the user's midnight.
- API calls go through `effects.run(future, |app, output| …)`: a background tokio thread on the desktop, `spawn_local` in the browser. The result is applied before the next frame. Don't block in a handler.
- **Flow tests** (`tests/flow.rs`) use `Effects::manual()`, a `wiremock` API and a fixed `Clock` that `set_now` moves. `settle` runs every queued request and applies the results.
- **Scenes** (`spec()`) are offline: `App::offline()` is signed in, frozen at `fixtures::now()` in Europe/Madrid, and fed from `fixtures.rs`, which is shaped like the contract and checked by a decode test. Add a scene for each state a golden needs.
- Formatting is English, in the web app's en-GB patterns (`format.rs`), with times in the user's IANA zone through `chrono-tz`.

## Dialogs and forms

- A form's rules live in `forms.rs`, which has no UI and is unit-tested. Its state and its saves live in `dialogs.rs`, and its drawing in `views/dialogs.rs`.
- Text fields are `rune::TextEdit` values in the dialog's state, drawn with `text_input(..).on_edit(accessor)`. Each accessor falls back to `App::scratch` once the dialog has closed.
- Headless tests type with `rt.paste(..)` after pressing the field.
- Saves return `calendar_client::SaveError`, whose `body` holds the 400 `errors` for the form's fields.
