# Architecture Decision Records

Decisions are recorded in [MADR 4.0](https://adr.github.io/madr/) format. To add one, copy [`adr-template.md`](adr-template.md) to `NNNN-short-title.md`.

Every record lists its **decision drivers**, rates each option against them in a table (drivers as rows, options as columns, ★★★ to ☆☆☆), and gives pros and cons for every option in terms of those drivers. See [ADR-0000](0000-use-markdown-architectural-decision-records.md) for the conventions.

- **Drafting with an AI agent:** the [`adr-draft`](../../.claude/skills/adr-draft/SKILL.md) skill walks through the whole process: drivers, research, writing, validation and the review PR.
- **Validation:** `make adr-check` (also part of `make lint` and CI) checks structure, rating tables, driver coverage, links and this index.

| ADR | Title | Status |
| --- | --- | --- |
| [0000](0000-use-markdown-architectural-decision-records.md) | Use Markdown Architectural Decision Records | accepted |
| [0001](0001-monorepo-layout.md) | Single repository with per-stack top-level directories | accepted |
| [0002](0002-dotnet-10-minimal-api-backend.md) | .NET 10 LTS with ASP.NET Core Minimal APIs, Domain + Api projects | accepted |
| [0003](0003-react-vite-typescript-web-ui.md) | React + Vite + TypeScript SPA for the web UI | accepted |
| [0004](0004-openapi-contract-and-generated-client.md) | OpenAPI document as the API contract, with a generated TypeScript client | accepted |
| [0005](0005-pnpm-workspace-for-frontend.md) | pnpm workspaces for frontend packages | accepted |
| [0006](0006-dotnet-dependency-management.md) | NuGet Central Package Management with lock files and source mapping | accepted |
| [0007](0007-backend-testing-stack.md) | xUnit v3 on Microsoft.Testing.Platform, Shouldly and NSubstitute for .NET tests | accepted |
| [0008](0008-frontend-testing-stack.md) | Vitest, Testing Library and MSW for frontend tests | accepted |
| [0009](0009-static-analysis-and-formatting.md) | Static analysis and formatting enforced at build time | accepted |
| [0010](0010-toolchain-version-pins.md) | Pin TypeScript 6.0 and ESLint 9 for ecosystem compatibility | accepted |
| [0011](0011-make-as-top-level-task-runner.md) | GNU Make as a thin top-level task runner | accepted |
| [0012](0012-ci-and-dependency-updates.md) | GitHub Actions CI, security scanning and Dependabot | accepted |
| [0013](0013-public-repository-for-github-security-features.md) | Public GitHub repository to enable branch rules and security scanning | accepted |
| [0014](0014-postgresql-database-engine.md) | PostgreSQL as the database engine, with SQLite on a volume as a budget fallback | accepted |
| [0015](0015-ef-core-data-access.md) | EF Core 10 with code-first migrations for data access | accepted |
| [0016](0016-local-database-provisioning.md) | Docker Compose for local databases and Testcontainers for tests; adopt .NET Aspire later | accepted |
| [0017](0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET 10 file-based apps for all repo tooling scripts, in their skill folder or `tools/<name>/` | accepted |
| [0018](0018-time-representation-and-bcl-date-time-types.md) | UTC instants plus an IANA zone id and floating dates, using BCL time types instead of NodaTime | accepted |
| [0019](0019-single-user-mode-with-authentication-deferred.md) | Single-user mode with authentication deferred: no auth and no owner column yet | superseded by [ADR-0027](0027-google-oidc-bff-session.md) |
| [0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) | A dedicated day-agenda endpoint as the read model, beside resource endpoints for writes | accepted |
| [0021](0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's IANA time zone and local date define "today", with the server computing the day window | accepted |
| [0022](0022-astro-starlight-documentation-ui.md) | Astro and Starlight for the developer documentation UI | proposed |
| [0023](0023-static-adr-log-publication.md) | Build the canonical ADR log as a static site and publish main to GitHub Pages | proposed |
| [0024](0024-week-agenda-endpoint-on-range-based-internals.md) | A sibling week-agenda endpoint as a read model, built on range-based internals | accepted |
| [0025](0025-github-pages-pr-previews.md) | GitHub Pages pull-request previews alongside production using a retained static snapshot | proposed |
| [0026](0026-client-side-routing-with-tanstack-router.md) | Client-side routing with TanStack Router and code-based route definitions | accepted |
| [0027](0027-google-oidc-bff-session.md) | Google OpenID Connect with a backend-for-frontend cookie session | accepted |
| [0028](0028-publish-user-stories-on-the-documentation-site.md) | Publish user stories on the documentation site alongside the ADR log | proposed |
| [0035](0035-separate-staging-and-production-environments.md) | Separate staging and production environments | proposed |
