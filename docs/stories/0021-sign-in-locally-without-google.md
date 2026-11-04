---
status: planned
date: 2026-11-04
issue: https://github.com/mgasca/calendar/issues/238
pr: []
adrs: ["0027", "0038", "0041"]
---

# 0021 Sign in to the local web app without Google

## Story

> As a developer running the app on my own machine, I need to open the web app in my browser already signed in, without a Google OAuth client, so that I can try a change by hand without setting up real credentials.

Tracked in issue #238.

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

1. **Given** the API runs in Development with `Auth__DevSeedKey` and `Auth__AllowedEmails__0` set, **when** I start `just frontend dev-signed-in` and open the app, **then** I see my Today view signed in as the first allow-listed email, without the sign-in page.
2. **Given** the same API, **when** I start plain `just frontend dev`, **then** no seed header is added and an unauthenticated `/api/auth/me` through Vite returns 401.
3. **Given** the mode is on, **when** a request through the proxy already carries a different `X-Dev-Seed-Key`, **then** the proxy's key replaces it.
4. **Given** the mode is on, **when** the key is missing or shorter than 32 characters, or `CALENDAR_API_URL` is not a loopback host, **then** the dev server refuses to start with a message that names the problem.
5. **Given** the mode is on, **when** the page runs, **then** the key is never in anything served to the browser: it is added only between the dev server and the API.
6. **Given** `Auth__AllowedEmails__0` is unset, **when** I start the recipe, **then** it warns that the API will reject the key.

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

## Implementation notes

*Planned. This section is completed as the story is built.*

## User guide

*Planned behaviour. This section is finalised when the story is implemented.*

### Open the app signed in, without Google

1. Make sure `.env` has `Auth__DevSeedKey` (it does if you copied `.env.example`) and add your email as `Auth__AllowedEmails__0`.
2. Start the database and the API as usual (`just db up`, `just db migrate`, `just backend dev`).
3. Start the web app with `just frontend dev-signed-in` instead of `just frontend dev`.
4. Open http://localhost:5173. You land on **Today**, signed in as that email.

Known limitation: **Sign out** cannot end this mode, because the dev server signs every request in again. To sign out, stop the recipe and start plain `just frontend dev`.
