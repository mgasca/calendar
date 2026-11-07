# Frontend

The pnpm workspace for Calendar's TypeScript UIs. Practices for changing the code (checks, dates and clocks, forms, TanStack Query, code splitting) are in [AGENTS.md](AGENTS.md); styling a view for the light and dark themes is in the [theme guide](../docs/runbooks/web-theme-and-styling.md).

## Workspace

```
apps/web/              React + Vite + TypeScript web UI (day, week and task views)
apps/docs/             Astro + Starlight documentation site, see its README
packages/api-client/   Typed client generated from contracts/openapi.json, shared by all TS UIs
```

New TypeScript UIs go under `apps/` and consume the API through `packages/api-client`, never backend code. Node comes from `.node-version` and pnpm from Corepack (see [Prerequisites](../README.md#prerequisites)). The documentation site has its own [README](apps/docs/README.md).

## Common tasks

| Task                                                              | Command                                          |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| Install dependencies (each worktree needs its own)                | `just frontend install`                          |
| Run the web UI (http://localhost:5173, proxies `/api` to the API) | `just frontend dev`                              |
| Run the web UI signed in without Google                           | `just frontend dev-signed-in` (see below)        |
| Build                                                             | `just frontend build`                            |
| Tests, every package                                              | `just frontend test`                             |
| One web test file                                                 | `just frontend test-web <file-or-pattern>`       |
| Lint / type-check                                                 | `just frontend lint` / `just frontend typecheck` |
| Format                                                            | `just frontend format`                           |
| Regenerate the TS client from the contract                        | `just contracts` (also rebuilds the contract)    |

The web UI needs the API running (`just backend dev`, see the [backend README](../backend/README.md)).

## Sign in without Google

To try the web app without an OAuth client, set `Auth__AllowedEmails__0` in `.env`, replace the placeholder `Auth__DevSeedKey` there with the output of `openssl rand -hex 32` (anyone can read the one in `.env.example`), start the API with `just backend dev`, and run `just frontend dev-signed-in` instead of `just frontend dev`. The Vite proxy adds the Development-only seed key to `/api` requests from the app's own page, so http://localhost:5173 opens signed in as that email. Pages from other origins, including other `localhost` ports, get no key. The key never reaches the browser. The dev server refuses to start in three cases:

- the key is missing or shorter than 32 characters;
- `CALENDAR_API_URL` is not a loopback address;
- it's asked to listen beyond this machine (`--host`, `server.host`, or `vite preview --host`).

It warns, but starts, if the key is still the placeholder. To test from another device, use plain `just frontend dev --host`. **Sign out** does not end this mode: stop the recipe instead ([story 0021](../docs/stories/0021-sign-in-locally-without-google.md), [ADR-0027](../docs/decisions/0027-google-oidc-bff-session.md) amendment).

Real Google sign-in is configured on the API: see [Google sign-in setup](../backend/README.md#google-sign-in-setup).

## Tooling

| Concern            | Choice                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| Dependencies       | pnpm workspace + `pnpm-lock.yaml`                                                   |
| Static analysis    | ESLint (typescript-eslint strict type-checked, react-hooks, jsx-a11y), `tsc` strict |
| Formatting         | Prettier                                                                            |
| Unit tests         | Vitest, Testing Library, MSW                                                        |
| Integration tests  | MSW-mocked API                                                                      |
| Coverage           | `@vitest/coverage-v8`                                                               |
| Dependency updates | Dependabot (`npm`)                                                                  |
