---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# xUnit v3 on Microsoft.Testing.Platform, Shouldly and NSubstitute for .NET tests

## Context and Problem Statement

Which test framework and supporting libraries should the backend use?

## Considered Options

* Framework: xUnit v3, NUnit 4, MSTest 4, TUnit
* Assertions: Shouldly, FluentAssertions, AwesomeAssertions, built-in `Assert`
* Mocking: NSubstitute, Moq, FakeItEasy
* Runner: Microsoft.Testing.Platform (MTP) vs. VSTest

## Decision Outcome

* **xUnit v3** (`xunit.v3.mtp-v2`) is the most widely used .NET test framework. v3 runs tests as standalone executables and supports `TestContext.Current.CancellationToken`.
* **Microsoft.Testing.Platform** is enabled via `"test": { "runner": "Microsoft.Testing.Platform" }` in `backend/global.json`. It's the modern, faster runner that .NET 10's `dotnet test` supports natively.
* **Shouldly** for readable assertions. It's MIT-licensed. FluentAssertions was avoided because v8+ needs a commercial license.
* **NSubstitute** (plus `NSubstitute.Analyzers.CSharp`) for test doubles. Moq was avoided because of its 2023 SponsorLink data-collection incident.
* **Microsoft.AspNetCore.Mvc.Testing** (`WebApplicationFactory<Program>`) for in-memory HTTP integration tests.
* **Microsoft.Testing.Extensions.CodeCoverage** for coverage (`dotnet test -- --coverage`).
* Test naming is `Method_State_Expected` (CA1707 is suppressed for test projects only).

### Consequences

* Good, because `tests/Directory.Build.props` wires all of this up, so a new test project needs only a `ProjectReference`.
* Bad, because MTP changes `dotnet test` CLI arguments compared with VSTest. Runner options go after `--`, and `dotnet test` must run where `global.json` is visible.
* Neutral: TUnit is promising but younger. Revisit if its ecosystem matures.
