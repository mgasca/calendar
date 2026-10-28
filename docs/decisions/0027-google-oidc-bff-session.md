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
