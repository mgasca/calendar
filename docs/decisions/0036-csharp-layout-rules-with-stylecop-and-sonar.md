---
status: accepted
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# C# layout rules enforced with a StyleCop subset and Sonar's line-length rule

## Context and Problem Statement

[ADR-0009](0009-static-analysis-and-formatting.md) enforces .NET style with Roslyn analyzers, SonarAnalyzer and `dotnet format`, driven by `.editorconfig`. That setup leaves three layout choices unenforced:

* Single-line blocks such as `if (y) { Foo(); }` are allowed.
* A wrapped parameter or argument list can mix lines, with some items sharing a line and others on their own.
* Lines have no maximum length; 128 lines were over 140 characters.

`dotnet format` can't close these gaps on its own: it ignores `max_line_length` and has no parameter-wrapping rule. How do we enforce these three rules, in the build and with automatic fixes where possible?

## Decision Drivers

* **D1 Rule coverage**: enforces all three rules: no single-line blocks, one item per line once a list wraps, and a 140-character limit.
* **D2 Automatic fixes**: most code is written by AI agents, so `just format` should fix violations rather than leave them for hand edits.
* **D3 Fits the existing toolchain**: runs inside `dotnet build` and `dotnet format`, configured in `.editorconfig`, the same locally and in CI ([ADR-0009](0009-static-analysis-and-formatting.md)), and works for the file-based tooling apps ([ADR-0017](0017-dotnet-file-based-apps-for-repo-tooling.md)).
* **D4 Low maintenance**: few extra tools or packages, and those are maintained with usable releases.
* **D5 Targeted change**: changes only the code that breaks these rules, leaving other formatting as it is.

## Considered Options

* StyleCop.Analyzers limited to SA1501, SA1116 and SA1117, plus Sonar S103
* CSharpier as the C# formatter
* Roslyn formatting options only (`csharp_preserve_single_line_blocks = false`)
* NewStyleCop.Analyzers (community fork) with the same rule subset, plus Sonar S103

## Decision Outcome

Chosen option: "StyleCop.Analyzers limited to SA1501, SA1116 and SA1117, plus Sonar S103", because it covers the rules (D1) with build-time analyzers that `dotnet format` already knows how to fix (D2, D3), and it only touches code that breaks the rules (D5). It is weaker than CSharpier on D1 and D2, because long lines are reported but not rewrapped. CSharpier would mean reformatting every file and running a second formatter alongside `dotnet format`, which loses D3 and D5.

| Driver | **StyleCop subset + Sonar S103 (chosen)** | CSharpier | Roslyn formatting options only | NewStyleCop subset + Sonar S103 |
| --- | :---: | :---: | :---: | :---: |
| D1 Rule coverage | ★★☆ | ★★★ | ★☆☆ | ★★☆ |
| D2 Automatic fixes | ★★☆ | ★★★ | ★☆☆ | ★★☆ |
| D3 Fits the existing toolchain | ★★★ | ★☆☆ | ★★★ | ★★★ |
| D4 Low maintenance | ★★☆ | ★★☆ | ★★★ | ★☆☆ |
| D5 Targeted change | ★★★ | ☆☆☆ | ★☆☆ | ★★★ |

### Implementation

**Packages**

* `StyleCop.Analyzers` `1.3.151-beta`, referenced from `backend/Directory.Build.props` (version in `Directory.Packages.props`) and pinned in `tools/Directory.Build.props` and `.claude/skills/adr-draft/Directory.Build.props`. `just tool-versions` keeps the pins in step.
* SonarAnalyzer.CSharp is already referenced.

**Rules** (in each of the three `.editorconfig` copies)

* Every StyleCop category is set to `none`: `dotnet_analyzer_diagnostic.category-StyleCop.CSharp.*.severity`.
* These rules are then enabled as warnings:
  * SA1501: a statement must not be on a single line.
  * SA1116: a wrapped parameter or argument list starts on the line after the opening parenthesis.
  * SA1117: parameters or arguments go all on one line or each on its own line.
* S103 (line length) is enabled as a warning. Its 140-character limit is set in a `SonarLint.xml` file, passed as an `AdditionalFiles` item. `max_line_length = 140` is also set in `.editorconfig` so editors show the margin.
* EF Core migrations are generated code. Sonar doesn't honour `generated_code = true`, so `Migrations/.editorconfig` also turns S103 off.

**Fixes**

* `dotnet format` applies the SA1501, SA1116 and SA1117 code fixes, including in `just format`.
* Lines over 140 characters are wrapped by hand.

### Other rules adopted with this change

These rules came out of the same review and are configured in the same `.editorconfig` section:

* **Banned clock APIs.** `Microsoft.CodeAnalysis.BannedApiAnalyzers` runs on `backend/src` (`src/Directory.Build.props`, `src/BannedSymbols.txt`). It bans `DateTime.Now`, `DateTime.UtcNow`, `DateTime.Today`, `DateTimeOffset.Now`, `DateTimeOffset.UtcNow` and `TimeZoneInfo.Local`. Production code takes time from `TimeProvider` and "today" from the client ([ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md)).
* **Naming (IDE1006).**
  * PascalCase: types, members, local functions, constants, `static readonly` fields, and non-private fields.
  * `_camelCase`: other private fields.
  * `I` and `T` prefixes: interfaces and type parameters.
  * camelCase: locals and parameters.
* **`var` (IDE0007/IDE0008).** `var` for built-in types and when the type is apparent, explicit types elsewhere. These are now warnings; before, they were suggestions, which the build ignores.
* **Code-quality rules beyond `latest-recommended`:**
  * CA1851: possible multiple enumeration.
  * CA1307 and CA1309: explicit and ordinal `StringComparison`.
* **Code-style rules as warnings:**
  * IDE0130: namespaces match folders. Turned off in the tooling folders, where file-based apps have no root namespace.
  * IDE0040: explicit accessibility modifiers.
  * IDE0300–IDE0305: collection expressions.
  * IDE0320: static anonymous functions.
* **Primary constructors (IDE0290)** are allowed but not required.

### Consequences

* Good, because single-line blocks and lists that mix wrapped lines fail the build, and `just format` fixes most violations.
* Good, because the rest of the formatting is unchanged. Short auto-properties and initializers stay on one line.
* Good, because the clock bans enforce [ADR-0021](0021-client-supplied-date-and-time-zone-define-the-day.md) at compile time.
* Bad, because S103 only reports long lines, so they are wrapped by hand. String literals and comments sometimes have to be split.
* Bad, because SA1117 accepts a wrapped list whose items all share the line after the parenthesis. Review has to catch that case; no analyzer here does.
* Bad, because StyleCop has had no stable release since 1.1.118 (April 2019). We pin a 1.3 beta and take Dependabot bumps.
* Bad, because the C# `.editorconfig` section has three copies (root, `tools/`, `.claude/skills/adr-draft/`), and every rule change has to go into all three.
* Neutral, because the explicit-type `var` rule turned several hundred `var` declarations into explicit types and pushed some lines past 140.

### Confirmation

* The analyzers run in every `dotnet build`, with warnings as errors, in `just lint` and in CI.
* The tooling apps run the same rules when `just tooling` builds them.
* `dotnet format --verify-no-changes` fails when a StyleCop code fix hasn't been applied.

## Pros and Cons of the Options

### StyleCop subset + Sonar S103

* Good, because **D1 Rule coverage**: SA1501, SA1116 and SA1117 cover single-line statements and list wrapping, and S103 caps line length.
* Neutral, because **D1 Rule coverage**: SA1117 still allows all the items on the line after the parenthesis.
* Good, because **D2 Automatic fixes**: all three StyleCop rules have code fixes that support fix-all, so `dotnet format` applies them.
* Bad, because **D2 Automatic fixes**: S103 has no code fix.
* Good, because **D3 Fits the existing toolchain**: these are ordinary NuGet analyzers, configured in `.editorconfig` and run by `dotnet build` and `dotnet format`.
* Neutral, because **D4 Low maintenance**: one package, actively developed again, but only as 1.3 betas.
* Good, because **D5 Targeted change**: everything else in StyleCop is off, so only code that breaks the three rules changes.

### CSharpier

* Good, because **D1 Rule coverage**: it never keeps a block with statements on one line, it breaks lists one item per line, and it wraps to `max_line_length` (read from `.editorconfig`).
* Good, because **D2 Automatic fixes**: it rewraps long lines itself, so nothing is left to hand-edit except long strings and comments.
* Bad, because **D3 Fits the existing toolchain**: it is a separate dotnet tool. It conflicts with `dotnet format` whitespace formatting, so `just format` and `just lint` would have to run it alongside `dotnet format style` and `dotnet format analyzers`.
* Neutral, because **D4 Low maintenance**: it is well maintained (1.3.0 at the time of writing), but it adds a tool to pin in the tool manifest.
* Bad, because **D5 Targeted change**: it decides every whitespace choice and reformats every file. [ADR-0009](0009-static-analysis-and-formatting.md) rejected it for that reason.

### Roslyn formatting options only

* Bad, because **D1 Rule coverage**: `dotnet format` ignores `max_line_length` and has no parameter-wrapping rule.
* Bad, because **D2 Automatic fixes**: the only option it offers, `csharp_preserve_single_line_blocks = false`, expands every brace pair, not only statement blocks.
* Good, because **D3 Fits the existing toolchain**: no new packages.
* Good, because **D4 Low maintenance**: built into the SDK.
* Bad, because **D5 Targeted change**: a trial expanded every `{ get; init; }` auto-property and every short `new { ... }` or `with { ... }` initializer onto several lines (16 files, +720/−172).

### NewStyleCop subset + Sonar S103

* Good, because **D1 Rule coverage** and **D2 Automatic fixes**: it is a fork of StyleCop.Analyzers, with the same rules and code fixes.
* Good, because **D3 Fits the existing toolchain**: it is used in the same way as the original package.
* Bad, because **D4 Low maintenance**: it is maintained by one person (13 GitHub stars). Its last stable release is 1.2.1 (November 2025) and 1.3.0 is still in alpha. It was created while the original was dormant, and the original is active again.
* Good, because **D5 Targeted change**: the same targeted rule subset.

## More Information

* This ADR refines the .NET part of [ADR-0009](0009-static-analysis-and-formatting.md) and doesn't supersede it. [ADR-0009](0009-static-analysis-and-formatting.md)'s choice of Roslyn + SonarAnalyzer + `dotnet format` still holds, as does its TypeScript decision. StyleCop is added only for three layout rules; [ADR-0009](0009-static-analysis-and-formatting.md) rejected the full StyleCop rule set.
* Versions at the time of writing:
  * StyleCop.Analyzers `1.3.151-beta` (2026-10-21); last stable `1.1.118`.
  * NewStyleCop.Analyzers `1.2.1` stable, `1.3.0-alpha.3` (2026-09-22).
  * CSharpier `1.3.0`.
  * Microsoft.CodeAnalysis.BannedApiAnalyzers `5.6.0`.
  * SonarAnalyzer.CSharp `10.35.0.4138`.
* S103's parameter comes from Sonar's `SonarLint.xml` reader (`maximumLineLength`, default 200). This was checked in the sonar-dotnet source.
* Revisit:
  * when StyleCop.Analyzers ships a stable 1.3, to move off the beta;
  * if hand-wrapping long lines becomes a recurring cost, to reconsider CSharpier.
