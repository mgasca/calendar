---
status: proposed
date: 2026-11-20
decision-makers: mgasca, Claude (AI assistant)
---

# Native sign-in through the system browser and a loopback handover of the cookie session

## Context and Problem Statement

The second Calendar UI is a Rune app that runs on the Linux, macOS and Windows desktop and as a WASM build in the browser ([epic #998](https://github.com/mgasca/calendar/issues/998), [ADR-0067](0067-second-ui-in-rune-with-a-native-workspace-and-generated-rust-client.md)). The API signs people in with Google through a backend-for-frontend: it runs the authorization-code flow itself and issues a sealed, HttpOnly, `SameSite=Lax` session cookie (`calendar_session`, eight hours, no sliding renewal) to a same-origin browser ([ADR-0027](0027-google-oidc-bff-session.md), [ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md)). [ADR-0027](0027-google-oidc-bff-session.md) says a bearer scheme that validates Google ID tokens must be added "before mobile, desktop or CLI clients are supported" ([#84](https://github.com/mgasca/calendar/issues/84)). The WASM build is served same-origin at `/native/` and uses the cookie unchanged. The desktop build is not a browser, and the maintainer agreed on 2026-11-20 that it signs in through the existing Google flow in the system browser and keeps the cookie session. How exactly does the session reach the desktop app, and what happens to [ADR-0027](0027-google-oidc-bff-session.md)'s deferred bearer scheme?

## Decision Drivers

* **D1 Credential exposure**: the session cookie, Google's tokens and any handover secret never travel in a URL in clear, cannot be redeemed by another local process or a web page, and rest in OS-protected storage on the desktop.
* **D2 One authentication model on the API**: reuse the Google flow, the allow-list, the sealed session cookie and the stub provider ([ADR-0064](0064-stub-oidc-provider-for-sign-in-tests.md)) rather than add a second way to authenticate every request.
* **D3 Provider and standards compliance**: follow RFC 8252 (OAuth for native apps) and Google's OAuth policies, which forbid embedded user-agents and recommend the loopback redirect for desktop apps.
* **D4 User experience**: one click opens the browser the person already uses; a browser that is already signed in needs no second Google prompt; the app stays signed in across restarts for the session's lifetime.
* **D5 Testability**: the whole handover runs headlessly against the end-to-end stack with the stub provider ([ADR-0063](0063-docker-compose-profiles-for-local-backing-services-instead-of-aspire.md), [story 0064](../stories/0064-test-every-user-flow-end-to-end-and-prove-it-is-observable.md)), and each refusal has an API test.
* **D6 Future clients**: leave a clear path to the bearer scheme for clients that cannot hold a cookie (mobile, CLI, third-party).

## Considered Options

* System browser, loopback redirect with a one-time code redeemed for the cookie session
* System browser, loopback redirect that carries the session cookie value
* Bearer scheme now: the app runs Google's desktop flow with PKCE and sends the ID token
* Embedded webview that runs the web sign-in and captures the cookie
* Device authorization grant with a code typed in the browser

## Decision Outcome

Chosen option: "System browser, loopback redirect with a one-time code redeemed for the cookie session", because the only thing that crosses from the browser to the app is a short-lived, single-use code that is worthless without the app's PKCE verifier (D1), the API keeps exactly one session model and one Google flow, which the stub provider already drives (D2, D5), it is the pattern RFC 8252 and Google prescribe for desktop apps (D3), and a browser already signed in to Calendar skips Google entirely (D4). The bearer scheme stays deferred for the clients that need it (D6).

| Driver | **Loopback, one-time code (chosen)** | Loopback carrying the cookie | Bearer scheme now | Embedded webview | Device grant |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Credential exposure | ★★★ | ☆☆☆ | ★★☆ | ★☆☆ | ★★☆ |
| D2 One authentication model on the API | ★★★ | ★★★ | ☆☆☆ | ★★★ | ★★☆ |
| D3 Provider and standards compliance | ★★★ | ★☆☆ | ★★★ | ☆☆☆ | ★★☆ |
| D4 User experience | ★★★ | ★★★ | ★★☆ | ★★☆ | ★☆☆ |
| D5 Testability | ★★★ | ★★★ | ★☆☆ | ★☆☆ | ★★☆ |
| D6 Future clients | ★★☆ | ★☆☆ | ★★★ | ☆☆☆ | ★★☆ |

### The handover

The desktop app is a public client of the **Calendar API**, not of Google: Google's client stays the API's web client, and its registered callback (`/api/auth/callback/google`) does not change. The endpoint and table names are proposals for #1008; the contract records the final ones.

1. **The app prepares.** It generates a PKCE verifier and a `state` (32 random bytes each, base64url) and opens a listener on `127.0.0.1` on a port the OS chooses (`[::1]` when IPv4 loopback is unavailable). It opens the listener only when the person starts sign-in, accepts one request on `/callback`, and closes it after that request or after five minutes (RFC 8252, 8.3).
2. **The browser starts.** The app opens the system browser at `GET /api/auth/native/start?redirect_uri=http://127.0.0.1:{port}/callback&state=…&code_challenge=…&code_challenge_method=S256`. The API answers 400, with no redirect, unless the redirect URI is exactly `http://127.0.0.1:{port}/callback` or `http://[::1]:{port}/callback` with a port from 1024 to 65535, the method is `S256`, and the challenge is 43 base64url characters. It seals the request into a short-lived `calendar_native` flow cookie (15 minutes, its own sealing purpose, like `calendar_signin`) and redirects to `/api/auth/login?returnUrl=/api/auth/native/confirm`.
3. **Google, as today.** `login` and `callback` run unchanged: `state`, PKCE and `nonce` towards Google, the verified-email allow-list, and the browser's own `calendar_session` cookie. A browser that already holds a valid session goes straight to the confirm page.
4. **The person confirms.** `GET /api/auth/native/confirm` requires the browser's session and the flow cookie and shows a page that names the signed-in email and asks "Sign in to the Calendar desktop app?". Its button submits a same-origin form, `POST /api/auth/native/confirm`. The POST is refused unless `Origin` is the API's own origin (or `Sec-Fetch-Site` is `same-origin`), so another site cannot submit it. Without the click, a page or process that sends the browser to `start` with its own listener gets no code.
5. **A one-time code.** The POST mints a code (32 random bytes) and stores its SHA-256 hash with the user id, the code challenge, the redirect URI and an expiry of 60 seconds in a new `native_handover_codes` table (RFC 6749, 4.1.2: single use, short-lived). It clears the flow cookie and redirects (303) to `{redirect_uri}?code=…&state=…`. The app's listener compares `state` in constant time, answers with a small "You can close this tab" page, and closes.
6. **Redemption.** The app sends `POST /api/auth/native/token` with `{ code, codeVerifier, redirectUri }` as JSON. In one transaction the API marks the code used and checks that it was unused and unexpired, was issued for that redirect URI, and that `BASE64URL(SHA256(codeVerifier))` equals the stored challenge. On success it answers 204 with a `Set-Cookie` for an ordinary `calendar_session` ticket, issued like the browser's, with the same eight-hour lifetime. Every failure is 400 `invalid_grant` with no detail, including a second redemption of a used code. The endpoint is public, like sign-in ([ADR-0027](0027-google-oidc-bff-session.md)). Expired rows are deleted when a code is redeemed.

### On the desktop

* **Cookie store.** The app's HTTP client keeps the session in its own cookie store and sends it only to the configured API origin. It persists the cookie in the OS credential store (Secret Service on Linux, Keychain on macOS, Credential Manager on Windows) under the API origin, never in a plain file or a log. When no credential store is available, as on a headless CI runner, it keeps the session in memory only.
* **Secure.** Against an HTTPS API the cookie is `Secure`, as today. Against a local `http://` API it is not, as for the web app in Development.
* **CSRF.** The cookie stays `SameSite=Lax` and the API keeps its same-origin, no-CORS posture. The app is not a browser, so it adds no CSRF exposure. The new surfaces have their own protection: `state` on the loopback, PKCE on redemption, and the same-origin confirm POST.
* **Sign-out.** The app calls the existing `POST /api/auth/logout`, then deletes the stored cookie whatever the answer. As for the web app, a sealed ticket cannot be revoked before it expires: signing out on one device does not end another, and only rotating the session key ([ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md)) ends every session. A 401 on any request returns the app to its sign-in screen.
* **WASM.** The browser build at `/native/` is same-origin. It uses `/api/auth/login?returnUrl=/native/` and the browser's cookie unchanged, and never calls the `native` endpoints. `local_return_url` already accepts `/native/`.

### Local and end-to-end use

* The stub provider ([ADR-0064](0064-stub-oidc-provider-for-sign-in-tests.md)) stands in for Google with no change, because step 3 is the existing flow. Its Development-only, loopback-only guard is unchanged.
* The end-to-end test plays the browser headlessly: it follows the redirects from `start`, fills the stub's login form, posts the confirm form, and delivers the loopback redirect to the app's listener, which redeems the code against the `just e2e` stack. Other Rune flows may sign in with the development seed key ([story 0021](../stories/0021-sign-in-locally-without-google.md)).
* API tests cover every refusal: a non-loopback, `localhost`, wrong-path or privileged-port redirect URI; a missing or wrong flow cookie; a cross-origin confirm POST; an expired, reused or wrong-verifier code; a redirect URI that differs at redemption.

### The deferred bearer scheme (#84)

This record **amends** [ADR-0027](0027-google-oidc-bff-session.md) and leaves the bearer scheme deferred. [ADR-0027](0027-google-oidc-bff-session.md)'s decision, a backend-for-frontend cookie session, stands and now also serves the desktop app. What changes is its trigger: the desktop app no longer needs the bearer scheme first, because it holds the same cookie session. The bearer scheme is still required before a client that cannot keep a cookie is supported (a mobile app, a CLI, a third-party client), and #84 stays open with that narrower trigger. [ADR-0027](0027-google-oidc-bff-session.md) gets a dated amendment bullet in this PR.

### Consequences

* Good, because the API keeps one session format, one allow-list check and one Google client; the new code is three endpoints and one table.
* Good, because the only value in a URL is a 60-second, single-use code bound to a PKCE challenge, and the cookie never appears in a URL, a log or a plain file.
* Bad, because the handover adds a table, a migration and an API surface to test.
* Bad, because the browser that runs the flow is signed in to the web app too, and signing out of the desktop app does not sign the browser out.
* Bad, because sessions on the desktop, like the web app's, cannot be revoked one by one before their eight hours end.
* Neutral, because a person signs in again every eight hours, as on the web; a refresh mechanism is out of scope.
* Neutral, because the bearer scheme stays deferred, with a narrower trigger.

### Confirmation

* API tests in `backend/crates/calendar-api/tests/` cover the handover's success path and each refusal listed above (#1008).
* A Rune unit test covers the listener: it accepts only `/callback` with the expected `state`, then closes.
* The end-to-end native sign-in flow runs headlessly against the stub provider in the `just e2e` stack (#1010), and the CALM model's sign-in flow names it.
* The `security-reviewer` agent reviews #1008 before merge.

## Pros and Cons of the Options

### System browser, loopback redirect with a one-time code redeemed for the cookie session

* Good, because **D1 Credential exposure**: the code is useless without the verifier that only the app holds, expires in 60 seconds and works once; the cookie travels only in a `Set-Cookie` header on the app's own connection.
* Bad, because **D1 Credential exposure**: a malicious process on the same machine could listen on a loopback port and start a flow; the confirm click is what stops it.
* Good, because **D2 One authentication model on the API**: requests keep authenticating with the existing sealed cookie, and the Google flow is reused unchanged.
* Good, because **D3 Provider and standards compliance**: RFC 8252's loopback IP redirect with PKCE (7.3), on `127.0.0.1` rather than `localhost` (8.3), in the system browser (8.12); Google calls the loopback redirect "the recommended mechanism" for desktop apps.
* Good, because **D4 User experience**: one click, the person's own browser and password manager, and no Google prompt when the browser is already signed in.
* Good, because **D5 Testability**: the stub provider and a headless HTTP client drive every step.
* Neutral, because **D6 Future clients**: it serves only clients that can open a browser and hold a cookie; the bearer scheme stays the path for the rest.

### System browser, loopback redirect that carries the session cookie value

* Bad, because **D1 Credential exposure**: the session itself is in a plain-HTTP URL, in browser history and in reach of any local listener; #1001 rules this out.
* Good, because **D2 One authentication model on the API**: no table and no redemption endpoint.
* Bad, because **D3 Provider and standards compliance**: RFC 8252 expects a code redeemed with PKCE, not a credential in the redirect.
* Good, because **D4 User experience**: the same as the chosen option.
* Good, because **D5 Testability**: the same as the chosen option.
* Bad, because **D6 Future clients**: nothing reusable for later clients.

### Bearer scheme now: the app runs Google's desktop flow with PKCE and sends the ID token

* Neutral, because **D1 Credential exposure**: tokens stay on the device, but a Google ID token lasts about an hour, so the app must also keep a Google refresh token, a longer-lived Google credential than the eight-hour cookie.
* Bad, because **D2 One authentication model on the API**: every request gains a second scheme to validate (signature against Google's keys, issuer, the audience of a second client, expiry), with the allow-list on each request.
* Good, because **D3 Provider and standards compliance**: Google's documented desktop-app flow.
* Neutral, because **D4 User experience**: a separate Google consent for a second OAuth client, and no reuse of the browser's Calendar session.
* Bad, because **D5 Testability**: the stub provider must issue verifiable signed tokens for a second client, and the end-to-end stack needs a key-set path the API does not use today.
* Good, because **D6 Future clients**: it delivers the planned scheme of [ADR-0027](0027-google-oidc-bff-session.md) once, for desktop, mobile and CLI.

### Embedded webview that runs the web sign-in and captures the cookie

* Bad, because **D1 Credential exposure**: the app could read the person's Google password as it is typed, which is why providers forbid it.
* Good, because **D2 One authentication model on the API**: the API is untouched.
* Bad, because **D3 Provider and standards compliance**: Google's policy says "a developer must not direct a Google OAuth 2.0 authorization request to an embedded user-agent" and answers `disallowed_useragent`; RFC 8252 (8.12) forbids it.
* Neutral, because **D4 User experience**: it stays in the app, but without the person's browser session or password manager.
* Bad, because **D5 Testability**: the app would need a webview beside Rune, and Google blocks the flow there anyway.
* Bad, because **D6 Future clients**: a dead end.

### Device authorization grant with a code typed in the browser

* Good, because **D1 Credential exposure**: no listener; the app polls with its own device code.
* Neutral, because **D2 One authentication model on the API**: the API could run its own device grant over the cookie session, but that is a new grant with polling, user codes and expiry to build.
* Neutral, because **D3 Provider and standards compliance**: RFC 8628 defines it for devices without a usable browser, which a desktop is not.
* Bad, because **D4 User experience**: the person copies a code by hand on the same machine.
* Neutral, because **D5 Testability**: a headless test can approve the code with an HTTP client, but polling makes the tests slower.
* Good, because **D6 Future clients**: a CLI could use the same grant later.

## More Information

* **Facts checked on 2026-11-20:** RFC 8252 sections 6, 7.3, 8.3 and 8.12 (the authorization server "MUST allow any port to be specified at the time of the request for loopback IP redirect URIs"; `localhost` "is NOT RECOMMENDED"); RFC 6749 section 4.1.2 (a code is single use, and "A maximum authorization code lifetime of 10 minutes is RECOMMENDED"); Google's [OAuth 2.0 for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app) (loopback recommended for macOS, Linux and Windows; custom URI schemes and the out-of-band copy flow no longer supported; "Desktop apps are public clients and cannot keep secrets confidential"), its [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies) (no embedded user-agents) and its [device flow](https://developers.google.com/identity/protocols/oauth2/limited-input-device).
* **Ports:** #1001 asks for allow-listed redirect ports. RFC 8252 requires an authorization server to accept any port on a loopback IP, so the allow-list is the host (`127.0.0.1`, `[::1]`), the path (`/callback`) and the unprivileged range, not a list of ports. A fixed range would collide with whatever else listens there.
* **Related:** [ADR-0027](0027-google-oidc-bff-session.md) (amended by this record), [ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md) (the sealed cookie), [ADR-0064](0064-stub-oidc-provider-for-sign-in-tests.md) (the stub), [ADR-0066](0066-per-user-data-ownership-with-a-typed-owner-id-on-every-query.md) (the code carries the user id, and every query still takes the owner), [ADR-0067](0067-second-ui-in-rune-with-a-native-workspace-and-generated-rust-client.md) (the Rune app, its workspace and the `/native/` hosting). Delivery: #1008 (API and app) and #1010 (end to end), in epic #998.
* **Revisit** when a mobile, CLI or third-party client is planned (the bearer trigger, #84), when sessions must be revocable per device, or if Google or the operating systems stop supporting loopback redirects.
