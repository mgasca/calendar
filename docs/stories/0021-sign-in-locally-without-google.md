---
status: implemented
date: 2026-11-04
issue: https://github.com/mgasca/calendar/issues/238
pr:
  - https://github.com/mgasca/calendar/pull/239
adrs: ["0027", "0038", "0041"]
---

# 0021 Sign in to the local web app without Google

## Story

> As a developer running the app on my own machine, I need to open the web app in my browser already signed in, without a Google OAuth client, so that I can try a change by hand without setting up real credentials.

Tracked in issue #238. Card PR: [#239](https://github.com/mgasca/calendar/pull/239).

## Background

The web app signs in only with Google ([ADR-0027](../decisions/0027-google-oidc-bff-session.md)). Locally, **Sign in with Google** returns 503 until `.env` holds a real OAuth client id and secret and an allow-listed email (README, "Google sign-in setup").

The API already has a second, Development-only way in: the seed scheme (`backend/src/Calendar.Api/DevSeedAuthenticationHandler.cs`).
- It is enabled only when the environment is Development and `Auth:DevSeedKey` is at least 32 characters (`Program.cs`).
- A request with that key in `X-Dev-Seed-Key` acts as the user of the first allow-listed email ([ADR-0041](../decisions/0041-per-user-data-ownership.md)).
- `curl`, `just db seed` and the headless driver in the `run-calendar` skill use it. A normal browser never sends the header, so this path is closed to a person at the keyboard.

`.env.example` already sets a disposable `Auth__DevSeedKey`, and the root `justfile` loads `.env` into every recipe, module recipes included ([ADR-0038](../decisions/0038-just-as-the-top-level-task-runner.md), amendment). The Vite dev server already proxies `/api` to the API (`frontend/apps/web/vite.config.ts`), so the browser and the API share one origin.

Measured on Vite 8.3.5 (2026-11-04, in a scratch directory with a throwaway upstream): a `/api` proxy with `headers: { 'X-Dev-Seed-Key': … }` forwards the header, and its value replaces one the client sent.

### Agreed scope

* A new recipe, `just frontend dev-signed-in`, starts the Vite dev server with its `/api` proxy adding `X-Dev-Seed-Key: $Auth__DevSeedKey` to every request. The browser then comes up signed in as the first allow-listed email.
* The recipe switches the mode on with `CALENDAR_DEV_SIGN_IN=true`. The key is read from `Auth__DevSeedKey`, so it lives in `.env` only once.
* Plain `just frontend dev` is unchanged: no header, and Google sign-in as before.
* In this mode the dev server refuses to start in three cases:
  * the key is missing;
  * the key is shorter than 32 characters (the API's minimum);
  * `CALENDAR_API_URL` points at anything other than a loopback host (`localhost`, `127.0.0.1`, `::1`), so the key never goes to a remote API.
* The recipe warns when `Auth__AllowedEmails__0` is unset, because the API rejects the key without it.
* Docs: the README's run table and "Google sign-in setup", `.env.example`, the `run-calendar` skill's human path, and the CALM model (`docs/architecture/calendar.architecture.json`).

### Not in this story

* Any backend or contract change. The API still accepts the key only in Development.
* A sign-in button or page for the seed scheme. The browser never sees the key.
* Making **Sign out** end this mode (see the known limitation under the user guide).
* Changing the `run-calendar` agent path, which keeps its own driver header.

### Acceptance criteria

1. **Given** the API runs in Development with `Auth__DevSeedKey` and `Auth__AllowedEmails__0` set, **when** I start `just frontend dev-signed-in` and open the app, **then** I see my Today view signed in as the first allow-listed email, without the sign-in page. Tested by "signs requests in with the seed key when dev sign-in is on" in [`apiProxy.test.ts`](../../frontend/apps/web/dev/apiProxy.test.ts) against a fake API. End to end on 2026-11-04: through the recipe, `/api/auth/me` returned 200 with the allow-listed email, and the browse driver showed **Today** signed in with no console or HTTP errors.
2. **Given** the same API, **when** I start plain `just frontend dev`, **then** no seed header is added and an unauthenticated `/api/auth/me` through Vite returns 401. Tested by "proxies to the local API without a key by default, even when .env holds one" and "adds no key in plain dev mode". Also checked end to end: 401 with the key in the environment.
3. **Given** the mode is on, **when** a request through the proxy already carries a different `X-Dev-Seed-Key`, **then** the proxy's key replaces it. Tested by "replaces a key the client sends with the proxy's". End to end: the browse driver sent a wrong key of its own and still saw **Today** signed in.
4. **Given** the mode is on, **when** the key is missing or shorter than 32 characters, or `CALENDAR_API_URL` is not a loopback host, **then** the dev server refuses to start with a message that names the problem. Tested by "refuses a missing key", "refuses a key shorter than the API minimum" and "refuses to send the key to …". All three were also checked through the recipe.
5. **Given** the mode is on, **when** the page runs, **then** the key is never in anything served to the browser: it is added only between the dev server and the API. Not directly tested. Checked by hand on 2026-11-04: the key did not appear in `/`, `/src/main.tsx`, `/src/App.tsx`, `/@vite/client`, `/@vite/env`, `/src/features/auth/auth.ts`, `/src/api/client.ts`, or the `/api/auth/me` response headers. Vite exposes only `VITE_`-prefixed variables to the page, and the key isn't one.
6. **Given** `Auth__AllowedEmails__0` is unset, **when** I start the recipe, **then** it warns that the API will reject the key. Checked by hand through the recipe; there is no automated test for recipes.

## Design decisions

### Architecture Decision Records

| ADR | Decision | Why it matters for this story |
| --- | --- | --- |
| [0027](../decisions/0027-google-oidc-bff-session.md) | Google OIDC with a BFF cookie session, plus a Development-only seed key | Amended in this story's card PR: the Vite dev proxy may also send the seed key, on opt-in, under the conditions in the agreed scope |
| [0038](../decisions/0038-just-as-the-top-level-task-runner.md) | `just` as the task runner, with modules | The new recipe lives in `frontend/mod.just`, and `.env` reaches it through the root's `dotenv-load` |
| [0041](../decisions/0041-per-user-data-ownership.md) | Per-user data ownership | The seed scheme acts as the first allow-listed email's user, so the browser sees that account's data |

The amendment to ADR-0027 keeps the decision and its ratings. It widens only who may send the existing development key. No new ADR is expected.

### Other decisions (not ADR-worthy)

* **A recipe, not a flag in `.env`:** `.env.example` already sets the seed key, so switching the mode on whenever the key exists would hide the Google path for everyone. A separate recipe keeps plain `just frontend dev` Google-only. Agreed in the handover planning for #238.
* **Reuse `Auth__DevSeedKey`:** a second variable holding the same key could drift from the API's copy.
* **Loopback check in the dev server:** the API refuses the key outside Development, but the dev server checks the target too, so a mistyped `CALENDAR_API_URL` cannot send the key to a remote host.
* **Only `true` switches the mode on:** `CALENDAR_DEV_SIGN_IN` set to `1`, `yes` or `TRUE` leaves it off. The recipe is the documented switch, so the value is fixed.
* **Questions left as recommended:** the card PR asked whether to amend ADR-0027 or write a new ADR, and whether to keep the recipe name `dev-signed-in`. Both were merged without a reply, so the recommended answers stand: an amendment, and that name.

## Implementation notes

### Where things live

| Area | Location |
| --- | --- |
| Proxy options and refusals | `frontend/apps/web/dev/apiProxy.ts` (`apiProxy(env)`) |
| Wiring | `frontend/apps/web/vite.config.ts` (`server.proxy['/api']`); `tsconfig.node.json` type-checks `dev/` |
| Recipe | `frontend/mod.just` (`dev-signed-in`) |
| Tests | `frontend/apps/web/dev/apiProxy.test.ts`, in the Vitest project `dev-server` |
| Docs | `README.md` (run table, "Google sign-in setup"), `.env.example`, `.claude/skills/run-calendar/SKILL.md`, `docs/architecture/calendar.architecture.json` |

### API

No changes. The API's seed scheme, its Development-only switch and `contracts/openapi.json` are unchanged.

### Testing

* `apiProxy.test.ts` (21 tests) unit-tests the options and every refusal. It also starts a real Vite dev server (`createServer`) proxying to a throwaway Node HTTP server, and checks the key the API actually receives: added, replacing a client's key, and absent in plain mode.
* Negative control (2026-11-04): with `apiProxy` returning the options without `headers`, 7 tests failed, including both dev-server tests that expect the key. The fix was saved outside the checkout first and restored by hash.
* End to end on a throwaway stack (PostgreSQL 55432, API 55041 in Development, Vite on 5173 through the recipe), see the acceptance criteria.

### Lessons learned, known issues and follow-ups

* **Vitest projects:** the web test setup (`src/test/setup.ts`) patches `window` and starts MSW, so Node-side dev-server tests can't share it. `vite.config.ts` now has two Vitest projects: `web` (jsdom, the setup, `src/**`) and `dev-server` (Node, no setup, `dev/**`). `just frontend test` runs both.
* **Measured:** Vite 8.3.5 proxies with http-proxy-3, where the `headers` option is merged over the client's headers, so the proxy's key wins. A Vite upgrade that changes this fails "replaces a key the client sends with the proxy's".
* **Known limitation:** **Sign out** clears the cookie, but the next request carries the key again, so the mode can't be left from the UI. Stop the recipe instead.
* **Known limitation:** the recipe prints its "Dev sign-in" line before Vite checks the key, so a refused start shows that line followed by the error.
* **Security note:** while the recipe runs, anyone who can reach the dev server is signed in. Vite listens only on localhost unless started with `--host`, and the recipe doesn't pass it.

## User guide

### Open the app signed in, without Google

1. Make sure `.env` has `Auth__DevSeedKey` (it does if you copied `.env.example`) and add your email as `Auth__AllowedEmails__0`.
2. Start the database and the API as usual (`just db up`, `just db migrate`, `just backend dev`).
3. Start the web app with `just frontend dev-signed-in` instead of `just frontend dev`.
4. Open http://localhost:5173. You land on **Today**, signed in as that email. The menu shows **dev-seed** as your name.

If the recipe stops with an error, it names what to fix: a missing `Auth__DevSeedKey`, a key shorter than 32 characters, or a `CALENDAR_API_URL` that isn't on this machine. If the app shows the sign-in page instead, check that `Auth__AllowedEmails__0` is set and that the API was restarted after you set it.

Known limitation: **Sign out** cannot end this mode, because the dev server signs every request in again. To sign out, stop the recipe and start plain `just frontend dev`.
