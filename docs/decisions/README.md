# Architecture Decision Records

Decisions are recorded in [MADR 4.0](https://adr.github.io/madr/) format. To add one, copy [`adr-template.md`](adr-template.md) to `NNNN-short-title.md`.

Every record lists its **decision drivers**, rates each option against them in a table (drivers as rows, options as columns, ★★★ to ☆☆☆), and gives pros and cons for every option in terms of those drivers. See [ADR-0000](0000-use-markdown-architectural-decision-records.md) for the conventions.

- **Drafting with an AI agent:** the [`adr-draft`](../../.claude/skills/adr-draft/SKILL.md) skill walks through the whole process: drivers, research, writing, validation and the review PR.
- **Status:** `proposed` while the decision is under review, `accepted` as soon as the user approves it (set in the same PR, before it merges), then `superseded by [ADR-NNNN](NNNN-….md)` if replaced. Status records whether a decision was **taken**, not whether it has been **delivered**: never wait for the implementation, build or rollout before accepting. Track delivery in issues and PRs.
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
| [0014](0014-postgresql-database-engine.md) | PostgreSQL as the database engine, with SQLite on a volume as a budget fallback | superseded by [ADR-0037](0037-postgresql-only-no-sqlite-fallback.md) |
| [0015](0015-ef-core-data-access.md) | EF Core 10 with code-first migrations for data access | accepted |
| [0016](0016-local-database-provisioning.md) | Docker Compose for local databases and Testcontainers for tests; adopt .NET Aspire later | accepted |
| [0017](0017-dotnet-file-based-apps-for-repo-tooling.md) | .NET 10 file-based apps for all repo tooling scripts, in their skill folder or `tools/<name>/` | accepted |
| [0018](0018-time-representation-and-bcl-date-time-types.md) | UTC instants plus an IANA zone id and floating dates, using BCL time types instead of NodaTime | accepted |
| [0019](0019-single-user-mode-with-authentication-deferred.md) | Single-user mode with authentication deferred: no auth and no owner column yet | superseded by [ADR-0027](0027-google-oidc-bff-session.md) |
| [0020](0020-aggregate-day-agenda-endpoint-as-read-model.md) | A dedicated day-agenda endpoint as the read model, beside resource endpoints for writes | accepted |
| [0021](0021-client-supplied-date-and-time-zone-define-the-day.md) | The client's IANA time zone and local date define "today", with the server computing the day window | accepted |
| [0022](0022-astro-starlight-documentation-ui.md) | Astro and Starlight for the developer documentation UI | proposed |
| [0023](0023-static-adr-log-publication.md) | Build the canonical ADR log as a static site and publish main to GitHub Pages | accepted |
| [0024](0024-week-agenda-endpoint-on-range-based-internals.md) | A sibling week-agenda endpoint as a read model, built on range-based internals | accepted |
| [0025](0025-github-pages-pr-previews.md) | GitHub Pages pull-request previews alongside production using a retained static snapshot | proposed |
| [0026](0026-client-side-routing-with-tanstack-router.md) | Client-side routing with TanStack Router and code-based route definitions | accepted |
| [0027](0027-google-oidc-bff-session.md) | Google OpenID Connect with a backend-for-frontend cookie session | accepted |
| [0028](0028-publish-user-stories-on-the-documentation-site.md) | Publish user stories on the documentation site alongside the ADR log | proposed |
| [0029](0029-azure-container-apps-compute-platform.md) | Use Azure Container Apps as the compute platform | accepted |
| [0030](0030-single-container-for-api-and-spa.md) | Single container for the API and SPA | accepted |
| [0031](0031-azure-postgresql-flexible-server.md) | Azure Database for PostgreSQL Flexible Server with public access and firewall rules | accepted |
| [0032](0032-azure-key-vault-for-secrets.md) | Azure Key Vault for secrets via managed identity | accepted |
| [0033](0033-bicep-for-infrastructure-as-code.md) | Bicep for Azure infrastructure as code | accepted |
| [0034](0034-github-actions-oidc-deployment.md) | Deploy with GitHub Actions and OIDC federation | accepted |
| [0035](0035-separate-staging-and-production-environments.md) | Separate staging and production environments | accepted |
| [0036](0036-csharp-layout-rules-with-stylecop-and-sonar.md) | C# layout rules enforced with a StyleCop subset and Sonar's line-length rule | accepted |
| [0037](0037-postgresql-only-no-sqlite-fallback.md) | PostgreSQL only: drop the SQLite budget fallback | accepted |
