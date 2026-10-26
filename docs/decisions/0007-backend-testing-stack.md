---
status: accepted
date: 2026-10-26
decision-makers: mgasca, Claude (AI assistant)
---

# xUnit v3 on Microsoft.Testing.Platform, Shouldly and NSubstitute for .NET tests

## Context and Problem Statement

Which test framework, test runner, assertion library and mocking library should the backend use?

## Decision Drivers

* **D1 Adoption & AI familiarity**: widely used, so docs, examples and agent-written tests are plentiful and correct.
* **D2 Licensing & trust**: free OSS licence and a clean maintenance and supply-chain record.
* **D3 Modern .NET support**: first-class on .NET 10, Microsoft.Testing.Platform (MTP), parallelism and async.
* **D4 Readable tests & failures**: tests read naturally, and failure messages explain what went wrong.
* **D5 Low friction**: minimal configuration and ceremony per test project.

## Considered Options

### Test framework

* xUnit v3
* NUnit 4
* MSTest 4
* TUnit

### Test runner

* Microsoft.Testing.Platform (MTP)
* VSTest

### Assertion library

* Shouldly
* FluentAssertions 8
* AwesomeAssertions (community fork of FluentAssertions 7)
* Built-in framework asserts

### Mocking library

* NSubstitute
* Moq
* FakeItEasy

## Decision Outcome

Chosen: **xUnit v3** on **MTP**, with **Shouldly** and **NSubstitute**. Also used: `Microsoft.AspNetCore.Mvc.Testing` (`WebApplicationFactory<Program>`) for in-memory HTTP integration tests and `Microsoft.Testing.Extensions.CodeCoverage` for coverage. All of this is wired up in `tests/Directory.Build.props`.

**Test framework:** xUnit v3, because it is the most adopted (D1) and is built for MTP (D3).

| Driver | **xUnit v3 (chosen)** | NUnit 4 | MSTest 4 | TUnit |
| --- | :---: | :---: | :---: | :---: |
| D1 Adoption | ★★★ | ★★☆ | ★★☆ | ★☆☆ |
| D2 Licensing & trust | ★★★ | ★★★ | ★★★ | ★★★ |
| D3 Modern .NET | ★★★ | ★★☆ | ★★★ | ★★★ |
| D4 Readability | ★★☆ | ★★★ | ★★☆ | ★★★ |
| D5 Low friction | ★★★ | ★★☆ | ★★☆ | ★★☆ |

**Runner:** MTP, because it is the modern runner natively supported by .NET 10 `dotnet test` (D3), with test projects as standalone executables.

| Driver | **Microsoft.Testing.Platform (chosen)** | VSTest |
| --- | :---: | :---: |
| D1 Adoption | ★★☆ | ★★★ |
| D3 Modern .NET | ★★★ | ★☆☆ |
| D5 Low friction | ★★☆ | ★★★ |

**Assertions:** Shouldly, because it is free (D2) and has the clearest failure messages (D4).

| Driver | **Shouldly (chosen)** | FluentAssertions 8 | AwesomeAssertions | Built-in asserts |
| --- | :---: | :---: | :---: | :---: |
| D1 Adoption | ★★☆ | ★★★ | ★☆☆ | ★★★ |
| D2 Licensing & trust | ★★★ | ☆☆☆ | ★★☆ | ★★★ |
| D4 Readability | ★★★ | ★★★ | ★★★ | ★☆☆ |
| D5 Low friction | ★★★ | ★★☆ | ★★☆ | ★★★ |

**Mocking:** NSubstitute, because it has a clean trust record (D2), concise syntax (D4) and a Roslyn analyzer that catches misuse (D5).

| Driver | **NSubstitute (chosen)** | Moq | FakeItEasy |
| --- | :---: | :---: | :---: |
| D1 Adoption | ★★☆ | ★★★ | ★☆☆ |
| D2 Licensing & trust | ★★★ | ★☆☆ | ★★★ |
| D4 Readability | ★★★ | ★★☆ | ★★★ |
| D5 Low friction | ★★★ | ★★★ | ★★☆ |

### Consequences

* Good, because a new test project needs only a `ProjectReference`; framework, assertions, mocks and coverage come from `tests/Directory.Build.props`.
* Bad, because MTP changes `dotnet test` arguments compared with VSTest. Runner options go after `--`, and `dotnet test` must run where `backend/global.json` is visible.
* Neutral: test naming is `Method_State_Expected`, with CA1707 suppressed in test projects only.

### Confirmation

CI runs `dotnet test` with coverage on every PR ([ADR-0012](0012-ci-and-dependency-updates.md)). Package versions are central ([ADR-0006](0006-dotnet-dependency-management.md)).

## Pros and Cons of the Options

### xUnit v3

* Good, because **D1 Adoption**: the most-used .NET test framework, and the one ASP.NET Core itself uses.
* Good, because **D3 Modern .NET**: v3 runs as standalone executables on MTP, with `TestContext.Current.CancellationToken`.
* Good, because **D5 Low friction**: no `[TestClass]`; constructor/`IAsyncLifetime` for setup.
* Bad, because **D4 Readability**: built-in `Assert` messages are terse (hence Shouldly).

### NUnit 4

* Good, because **D4 Readability**: rich constraint model (`Assert.That(x, Is.EqualTo(y))`).
* Good, because **D2 Licensing & trust**: MIT, long history.
* Bad, because **D3 Modern .NET**: MTP support via an adapter rather than native.
* Bad, because **D5 Low friction**: attributes for fixtures, setup and teardown add ceremony.

### MSTest 4

* Good, because **D3 Modern .NET**: Microsoft-maintained, native MTP.
* Bad, because **D1 Adoption**: less common in OSS, so fewer examples for agents.
* Bad, because **D5 Low friction**: `[TestClass]`/`[TestMethod]` ceremony.

### TUnit

* Good, because **D3 Modern .NET**: MTP-native, source-generated, very fast.
* Good, because **D4 Readability**: fluent async assertions built in.
* Bad, because **D1 Adoption**: young project, with fewer examples and less agent familiarity.

### Microsoft.Testing.Platform

* Good, because **D3 Modern .NET**: the direction of .NET testing; faster, with no VSTest host; enabled in `global.json`.
* Bad, because **D5 Low friction**: different CLI syntax, and some older docs and tools assume VSTest.

### VSTest

* Good, because **D1 Adoption** and **D5 Low friction**: the long-standing default that every tool understands.
* Bad, because **D3 Modern .NET**: legacy host, slower; xUnit v3 and .NET 10 steer toward MTP.

### Shouldly

* Good, because **D4 Readability**: `x.ShouldBe(y)` failures quote the source expression (`evt.Title should be "Standup" but was …`).
* Good, because **D2 Licensing & trust**: BSD licence.
* Good, because **D5 Low friction**: small API surface.
* Bad, because **D1 Adoption**: less common than FluentAssertions.

### FluentAssertions 8

* Good, because **D1 Adoption**: historically the most popular assertion library.
* Good, because **D4 Readability**: very expressive.
* Bad, because **D2 Licensing & trust**: v8 requires a paid commercial licence (Xceed) for non-OSS use.

### AwesomeAssertions

* Good, because **D4 Readability**: FluentAssertions API under Apache 2.0.
* Bad, because **D1 Adoption**: a young community fork.
* Neutral, because **D2 Licensing & trust**: the licence is fine, but long-term maintenance is unproven.

### Built-in asserts

* Good, because **D5 Low friction**: no extra package.
* Bad, because **D4 Readability**: limited assertions and terse failure messages.

### NSubstitute

* Good, because **D4 Readability**: `sub.Method().Returns(x)`, with no `.Object` or lambdas.
* Good, because **D2 Licensing & trust**: BSD, no incidents.
* Good, because **D5 Low friction**: `NSubstitute.Analyzers` flags non-virtual member substitution at compile time.
* Bad, because **D1 Adoption**: second to Moq.

### Moq

* Good, because **D1 Adoption**: the most widely used .NET mocking library.
* Bad, because **D2 Licensing & trust**: the 2023 SponsorLink incident shipped an obfuscated dependency that harvested developer emails.
* Neutral, because **D4 Readability**: `Setup(x => …)` and `.Object` are more verbose.

### FakeItEasy

* Good, because **D4 Readability**: a clear `A.CallTo(...)` API.
* Good, because **D2 Licensing & trust**: MIT, clean record.
* Bad, because **D1 Adoption**: smallest community of the three.
