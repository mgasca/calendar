# Architecture Decision Records

Decisions are recorded in [MADR 4.0](https://adr.github.io/madr/) format. To add one, copy [`adr-template.md`](adr-template.md) to `NNNN-short-title.md`.

| ADR | Title | Status |
| --- | --- | --- |
| [0000](0000-use-markdown-architectural-decision-records.md) | Use Markdown Architectural Decision Records | accepted |
| [0001](0001-monorepo-layout.md) | Single repository with per-stack top-level directories | accepted |
| [0002](0002-dotnet-10-minimal-api-backend.md) | .NET 10 LTS with ASP.NET Core Minimal APIs | accepted |
| [0003](0003-react-vite-typescript-web-ui.md) | React + Vite + TypeScript for the web UI | accepted |
| [0004](0004-openapi-contract-and-generated-client.md) | OpenAPI contract with generated TypeScript client | accepted |
| [0005](0005-pnpm-workspace-for-frontend.md) | pnpm workspaces for frontend packages | accepted |
| [0006](0006-dotnet-dependency-management.md) | NuGet Central Package Management with lock files | accepted |
| [0007](0007-backend-testing-stack.md) | xUnit v3 / MTP, Shouldly, NSubstitute for .NET tests | accepted |
| [0008](0008-frontend-testing-stack.md) | Vitest, Testing Library, MSW for frontend tests | accepted |
| [0009](0009-static-analysis-and-formatting.md) | Static analysis and formatting enforced at build time | accepted |
| [0010](0010-toolchain-version-pins.md) | Pin TypeScript 6.0 and ESLint 9 | accepted |
| [0011](0011-make-as-top-level-task-runner.md) | GNU Make as a thin top-level task runner | accepted |
| [0012](0012-ci-and-dependency-updates.md) | GitHub Actions CI, security scanning and Dependabot | accepted |
