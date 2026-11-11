---
status: accepted
date: 2026-10-28
decision-makers: mgasca, Claude (AI assistant)
---

# Google OpenID Connect with a backend-for-frontend cookie session

## Context and Problem Statement

Internet-facing deployment triggers the authentication revisit in [ADR-0019](0019-single-user-mode-with-authentication-deferred.md). The same-origin API serves the web application, while future native and command-line clients need a path to authentication ([ADR-0002](0002-dotnet-10-minimal-api-backend.md), [ADR-0004](0004-openapi-contract-and-generated-client.md)). How should the app authenticate its owner and control access?

## Decision Drivers

* **D1 Browser security**: protect sessions and avoid exposing tokens to JavaScript.
* **D2 Access control**: restrict access to explicitly allowed, verified accounts.
* **D3 Operational simplicity**: keep the first deployment and local setup manageable.
* **D4 Future clients**: leave a viable path for mobile, desktop and CLI clients.
* **D5 Ecosystem**: use familiar, documented authentication mechanisms.

## Considered Options

* Google OIDC with a BFF cookie
* SPA with PKCE and bearer tokens
* Hosted identity provider or ASP.NET Core Identity

## Decision Outcome

Chosen option: "Google OIDC with a BFF cookie", because the API handles the code flow and keeps tokens out of JavaScript (D1), enforces an allow-list (D2), and fits the existing same-origin deployment (D3), while leaving a bearer scheme for later clients (D4).

| Driver | **BFF cookie (chosen)** | SPA with PKCE | Hosted IdP or Identity |
| --- | :---: | :---: | :---: |
| D1 Browser security | ★★★ | ★★☆ | ★★☆ |
| D2 Access control | ★★★ | ★★★ | ★★★ |
| D3 Operational simplicity | ★★★ | ★★☆ | ★☆☆ |
| D4 Future clients | ★★☆ | ★★★ | ★★☆ |
| D5 Ecosystem | ★★★ | ★★★ | ★★★ |

### Implementation conventions

* The API runs the Google OpenID Connect authorization code flow and issues an HttpOnly session cookie. The browser uses the same origin, including the development proxy; no CORS policy permits cross-origin access. The cookie uses SameSite=Lax and is Secure behind HTTPS.
* Trust forwarded headers only from configured trusted proxies so the public HTTPS origin is used for redirects and secure cookies. API authentication failures return 401 rather than redirecting callers; health endpoints and the OpenAPI document are public.
* Require a verified email matching `Auth__AllowedEmails`. No open sign-up is provided. Validate return URLs as local paths.
* This replaces the constraints while authentication was deferred in [ADR-0019](0019-single-user-mode-with-authentication-deferred.md). There is still no `owner_id` or per-user query scoping: add both before a second user is supported. The allow-list controls access to the shared data, not isolation between users.
* Before mobile, desktop or CLI clients are supported, add a bearer scheme alongside the cookie scheme on the same API, validating Google ID tokens including signature, issuer, audience and lifetime and applying the same verified-email allow-list. Client-specific audience and token handling must be designed and tested then.
* Google is an external identity provider, not a new Compose backing service. The second-backing-service Aspire re-evaluation trigger in [ADR-0016](0016-local-database-provisioning.md) remains in force.

### Amendment, 2026-11-04: the Vite dev proxy may send the seed key

The decision above is unchanged: browsers sign in with Google through the API, the session is an HttpOnly cookie, the allow-list controls access and there is no CORS. The ratings of D1 to D5 stand. What changes is who may send the Development-only seed key (`X-Dev-Seed-Key`, last bullet under Consequences). Until now only the local seeder used it. Now the Vite dev server's `/api` proxy may add it too, so a developer's own browser comes up signed in without a Google OAuth client. Story [0021](../stories/0021-sign-in-locally-without-google.md) holds the scope and acceptance criteria.

**Conventions**

* **Opt-in only.** The proxy adds the header only when the `just frontend dev-signed-in` recipe sets `CALENDAR_DEV_SIGN_IN=true`. Plain `just frontend dev` and every build and production path send nothing. `.env.example` sets a seed key by default, so the key being present must not switch the mode on by itself.
* **One key.** The proxy reads `Auth__DevSeedKey`, the same value the API checks, and never copies it into another variable.
* **Server side only.** The proxy adds the header between the dev server and the API. The key never appears in anything served to the browser, and browser code never reads or sends it, so D1 holds.
* **The dev server's own page only.** The proxy removes any `X-Dev-Seed-Key` the client sends, and adds the key only to requests from the dev server's own origin:
  * `Sec-Fetch-Site` is `same-origin`, `none` or absent, and any `Origin` header names the dev server's own host;
  * `same-site` is refused, because `localhost:3000` and `localhost:5173` are the same site;
  * a request with neither header, such as curl, still gets the key.

  This is needed because Vite's default CORS policy lets any `localhost`, `127.0.0.1`, `[::1]` or `*.localhost` origin read `/api` responses. A key on every request would let any other local page act as the developer, and any internet site send simple requests with the key added.
* **Loopback target, loopback listener, valid key.** In this mode the dev server refuses to start in any of these cases:
  * `CALENDAR_API_URL` is not a loopback host (`localhost`, `127.0.0.1`, `::1`);
  * `vite` or `vite preview` would listen beyond loopback (`--host`, `server.host` or `preview.host` set to anything else; #242);
  * the key is missing or shorter than the API's 32-character minimum.
* **The API is unchanged.** It still accepts the key only in Development, as the first allow-listed email's user ([ADR-0041](0041-per-user-data-ownership.md)), and Google stays the only sign-in in every other environment.

**Evidence**

* **Measured on Vite 8.3.5, 2026-11-04, in a scratch directory with a throwaway upstream (not the repository):** a `/api` proxy entry with `headers: { 'X-Dev-Seed-Key': … }` forwarded the header to the upstream, and its value replaced a different `X-Dev-Seed-Key` sent by the client.
* **Untested until delivery:** the repository's proxy, recipe and refusals, and the end-to-end sign-in. The acceptance criteria of story 0021 cover all of them.
* **Measured on Vite 8.3.5 and Chromium, 2026-11-04, during the review of PR #241:** with that fixed `headers` entry, a page served from `http://127.0.0.1:55180` read `http://localhost:55173/api/auth/me` as `200` with the allow-listed email. With the same-origin rule above, the same request got `401`, and the app's own page stayed signed in.
* **Measured on Vite 8.3.5, 2026-11-05, for #242:**
  * Before the listener check, the real `vite.config.ts` started with dev sign-in on and `--host`.
  * With the check, `CALENDAR_DEV_SIGN_IN=true pnpm dev --host` and `vite preview --host` exited before listening, and plain `pnpm dev --host` still listened on all interfaces.

**Consequences of the amendment**

* Good, because **D3 Operational simplicity**: trying the web app by hand no longer needs a Google OAuth client.
* Bad, because **D1 Browser security** in development: while the recipe runs, anyone who can reach the dev server is signed in as the first allow-listed email. In this mode the dev server refuses to listen beyond loopback, so that means local users and programs only. Other pages in the developer's browser are not signed in, because of the same-origin rule.
* Bad, because the same-origin rule depends on browser-set headers (`Sec-Fetch-Site`, `Origin`). A local program that isn't a browser, such as curl or a script run by another user on the same machine, sends neither header and gets the key. That is the "anyone who can reach the dev server" exposure in the bullet above.
* Bad, because **Sign out** cannot end the mode, since the next request carries the key again. Stopping the recipe signs out.
* Neutral, because the API, its contract, CORS and every non-Development environment do not change.

### Consequences

* Good, because browser tokens stay server-side and access requires an allowed verified email.
* Bad, because deployments must configure Google credentials, trusted proxies and HTTPS correctly.
* Neutral, because ownership isolation and non-browser bearer authentication remain follow-ups.

* Neutral, because a configured development-only seed key permits the local seeder to authenticate via `X-Dev-Seed-Key`; it is unavailable outside Development and does not change CORS. Use a unique secret of at least 32 characters.

### Confirmation

API and web tests cover anonymous 401 responses, allowed and denied accounts, session lifecycle and return paths; deployment checks cover forwarded headers, cookie attributes and the absence of CORS headers. Code review checks the follow-up triggers in the README and PR template.

## Pros and Cons of the Options

### Google OIDC with a BFF cookie

* Good, because **D1 Browser security**: JavaScript does not hold tokens and the cookie is HttpOnly.
* Good, because **D2 Access control**: the API checks verified email against configuration.
* Good, because **D3 Operational simplicity**: no local identity service or account database is needed.
* Neutral, because **D4 Future clients**: native clients require a separate bearer scheme later.
* Good, because **D5 Ecosystem**: OIDC and ASP.NET cookie authentication are common patterns.

### SPA with PKCE and bearer tokens

* Neutral, because **D1 Browser security**: PKCE protects the code flow but browser code handles tokens.
* Good, because **D2 Access control**: the API can validate tokens and enforce the same allow-list.
* Neutral, because **D3 Operational simplicity**: token lifecycle management moves into the SPA.
* Good, because **D4 Future clients**: bearer authentication can also support native clients.
* Good, because **D5 Ecosystem**: PKCE and bearer validation are widely supported.

### Hosted identity provider or ASP.NET Core Identity

* Neutral, because **D1 Browser security**: a server-side cookie can protect browser sessions, depending on configuration.
* Good, because **D2 Access control**: a provider or application can enforce an allow-list.
* Bad, because **D3 Operational simplicity**: another provider relationship or an application-managed identity store adds configuration and operations.
* Neutral, because **D4 Future clients**: native support depends on the provider and its token flows.
* Good, because **D5 Ecosystem**: both approaches have established tooling.

## More Information

The follow-up triggers are recorded in the README and pull request template. [Story 0005](../stories/0005-google-sign-in.md) records the implementation and user-facing flow.

[ADR-0041](0041-per-user-data-ownership.md) delivers the ownership follow-up (`owner_id` and per-user scoping) and replaces the shared-data item in the README and the pull request template with its own trigger. The bearer-scheme follow-up for non-browser clients stays open.

* **Amendment, 2026-11-04:** the Vite dev proxy may send the Development-only seed key on opt-in, in issue #238 and story [0021](../stories/0021-sign-in-locally-without-google.md). The decision itself is unchanged, so this ADR was amended, not superseded, as [ADR-0038](0038-just-as-the-top-level-task-runner.md) was for its module layout.
* **Amendment, 2026-11-11:** the session cookie is now sealed by the Rust API with a key held in the `session_keys` table, replacing ASP.NET Data Protection ([ADR-0056](0056-session-cookie-sealed-with-a-database-held-key.md)). The decision stands: Google sign-in through a backend-for-frontend with an HttpOnly session cookie. This record's conventions never named the sealing mechanism.
