# Backend

The .NET 10 API for Calendar: events, tasks, day and week agendas, and Google sign-in, backed by PostgreSQL. Practices for changing the code (tests, queries, indexes, analyzer traps) are in [AGENTS.md](AGENTS.md).

## Projects

```
Calendar.slnx
src/Calendar.Domain/          Domain model; no framework dependencies
src/Calendar.Infrastructure/  EF Core DbContext, mappings, migrations (PostgreSQL)
src/Calendar.Api/             ASP.NET Core minimal API
tests/                        xUnit v3 test projects (one per src project) + Calendar.Testing (Testcontainers support)
```

The build generates [`contracts/openapi.json`](../contracts/openapi.json). Run `just contracts` after an API change and commit the result.

## Common tasks

| Task | Command |
| --- | --- |
| Run the API (http://localhost:5041) | `just backend dev` |
| Build | `just backend build` |
| Tests (API tests need Docker) | `just backend test` |
| One test | `just backend test --filter-method "*Name*"` |
| Build, then test | `just backend run build test` |
| Format | `just backend format` |
| psql shell on the local database | `just db psql` |
| Wipe the local database | `just db reset` (then `just db migrate`) |
| Seed a sample day into the running API (additive; accepts `--date …` and `--time-zone …`) | `just db seed` (set `Auth__DevSeedKey` in `.env` and export it before starting the API in Development) |

Start the database first with `just db up` and `just db migrate` (see [Local database](../README.md#local-database)).

## Local database

The database has two roles: `calendar_migrator` (owns the schema, runs migrations) and `calendar_app` (DML only; the API always connects as this role). Migrations are applied only by `just db migrate`, never at API startup.

Give the API its connection string with user-secrets (no secret is ever committed to `appsettings*.json`). Use the `CALENDAR_APP_PASSWORD` from your `.env`:

```sh
dotnet user-secrets set "ConnectionStrings:Calendar" \
  "Host=127.0.0.1;Port=5432;Database=calendar;Username=calendar_app;Password=dev-app-password" \
  --project backend/src/Calendar.Api
```

or set the environment variable `ConnectionStrings__Calendar`. In Development the API logs EF Core SQL commands. Integration tests need no setup beyond a running Docker daemon: they start their own throwaway PostgreSQL (the image pinned in `compose.yaml`) with `Calendar.Testing`.

## Google sign-in setup

Create a Google OAuth web application client and configure its authorized redirect URIs for each environment:

* Development: `http://localhost:5173/api/auth/callback/google`
* Production: `https://<host>/api/auth/callback/google`

Set `Auth__Google__ClientId`, `Auth__Google__ClientSecret` and indexed entries such as `Auth__AllowedEmails__0` in the untracked `.env` for local development, then export them into the API process (`just backend dev` loads `.env` for you; restart it after editing, since hot reload does not re-read the environment); use deployment secrets for production. Add only the verified Google emails permitted to access the calendar. Keep the client secret out of version control. Use HTTPS in production and configure trusted forwarded headers when behind a proxy so redirects and secure cookies use the public origin.

To use the web app without an OAuth client, see [signing in without Google](../frontend/README.md#sign-in-without-google). For what sign-in protects and its limits, see [Authentication and limitations](../README.md#authentication-and-limitations).

## Production environment configuration

Set `ConnectionStrings__Calendar` to the PostgreSQL connection string for the least-privilege
`calendar_app` role. Supply `Auth__Google__ClientId` and `Auth__Google__ClientSecret` from
deployment secrets, and configure allowed Google email addresses as indexed environment variables
`Auth__AllowedEmails__0`, `Auth__AllowedEmails__1`, and so on. Register the public HTTPS callback
`https://<host>/api/auth/callback/google` with Google. The API trusts one forwarded hop from the
Container Apps ingress; the container must only be reachable through that ingress.

ASP.NET Data Protection keys are stored unencrypted in the calendar database so sessions survive
restarts and revisions. Apply migrations separately as `calendar_migrator` before starting a new
revision; the application never applies them. Restrict database access and backups accordingly.

The Azure secrets that supply these settings are listed in the [Azure infrastructure runbook](../docs/runbooks/azure-infrastructure.md).

## Tooling

| Concern | Choice |
| --- | --- |
| Dependencies | Central Package Management (`Directory.Packages.props`) + `packages.lock.json` |
| Static analysis | Roslyn analyzers (`latest-recommended`) + SonarAnalyzer, warnings as errors |
| Formatting | `dotnet format` + `.editorconfig` |
| Unit tests | xUnit v3 (Microsoft.Testing.Platform), Shouldly, NSubstitute |
| Integration tests | `WebApplicationFactory` against Testcontainers PostgreSQL (+ Respawn) |
| Coverage | Microsoft.Testing.Extensions.CodeCoverage |
| Dependency updates | Dependabot (`nuget`, `docker`) |
