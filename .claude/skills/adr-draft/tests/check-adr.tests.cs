#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../scripts/check-adr/AdrValidator.cs

// Tests for the ADR validator. Run: dotnet run tests/check-adr.tests.cs
// Each test copies fixtures/valid to a temp directory, breaks one rule, and asserts the matching error.

using System.Runtime.CompilerServices;
using Shouldly;
using Xunit;

namespace AdrDraft.Tests;

public sealed class AdrValidatorTests : IDisposable
{
    private const string First = "0000-first-decision.md";
    private readonly string _dir;

    public AdrValidatorTests()
    {
        _dir = Directory.CreateTempSubdirectory("adr-tests-").FullName;
        foreach (var file in Directory.EnumerateFiles(FixturesDir()))
        {
            File.Copy(file, Path.Combine(_dir, Path.GetFileName(file)));
        }
    }

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public void ValidFixtures_HaveNoErrors()
    {
        AdrValidator.CheckRepository(_dir).ShouldBeEmpty();
        foreach (var file in AdrValidator.AdrFiles(_dir).Values)
        {
            Check(file).Errors.ShouldBeEmpty();
        }
    }

    [Fact]
    public void NextNumber_IsOneAfterHighest() => AdrValidator.NextNumber(_dir).ShouldBe("0002");

    [Theory]
    [InlineData("status: accepted", "status: maybe", "front matter status invalid")]
    [InlineData("date: 2026-01-01", "date: Jan 1", "front matter date must be YYYY-MM-DD")]
    [InlineData("decision-makers: tester", "decision-makers:", "decision-makers is empty")]
    [InlineData("# First decision\n", "First decision\n", "missing H1 title")]
    [InlineData("## Decision Drivers", "## Drivers", "missing sections")]
    [InlineData("* **D2 Cost**: cheaper is better.", "* **D3 Cost**: cheaper is better.", "numbered D1..Dn")]
    [InlineData("* **D2 Cost**: cheaper is better.", "* Cost: cheaper is better.", "every Decision Drivers bullet")]
    [InlineData("\n### Option B\n", "\n", "2 considered options but 1 pros/cons sections")]
    [InlineData("Chosen option: \"Option A\"", "We pick \"Option A\"", "must state the choice")]
    [InlineData("### Confirmation", "### Verification", "missing '### Confirmation'")]
    [InlineData("**Option A (chosen)**", "Option A", "exactly one option column")]
    [InlineData("| **Option A (chosen)** | Option B |", "| Option A | **Option B (chosen)** |", "must be the first option column")]
    [InlineData("| D1 Speed | ★★★ | ★☆☆ |", "| D1 Speed | ★★★ | 1 |", "invalid ratings")]
    [InlineData("| D2 Cost | ★★☆ | ★★☆ |", "| D9 Cost | ★★☆ | ★★☆ |", "row D9 is not a declared driver")]
    [InlineData("| D2 Cost | ★★☆ | ★★☆ |", "| Cost | ★★☆ | ★★☆ |", "must start with a driver id")]
    [InlineData("* Good, because **D1 Speed**: fast.", "* Good: fast.", "pros/cons bullet must start")]
    [InlineData("[ADR-0001](0001-second-decision.md)", "ADR-0001", "bare reference ADR-0001")]
    [InlineData("(0001-second-decision.md)", "(0009-missing.md)", "broken link: 0009-missing.md")]
    public void BrokenRule_IsReported(string find, string replace, string expectedError)
    {
        Mutate(First, find, replace);

        Check(First).Errors.ShouldContain(e => e.Contains(expectedError, StringComparison.Ordinal));
    }

    [Fact]
    public void DriverNeverRated_IsReported()
    {
        Mutate(First, "| D2 Cost | ★★☆ | ★★☆ |\n", "");

        Check(First).Errors.ShouldContain(e => e.Contains("drivers not rated in any table: [D2]", StringComparison.Ordinal));
    }

    [Fact]
    public void DriverNeverArgued_IsReported()
    {
        Mutate(First, "* Neutral, because **D2 Cost**: average.", "* Neutral, because **D1 Speed**: average.");

        Check(First).Errors.ShouldContain(e => e.Contains("drivers never argued in pros/cons: [D2]", StringComparison.Ordinal));
    }

    [Fact]
    public void SectionsOutOfOrder_AreReported()
    {
        var text = File.ReadAllText(Path.Combine(_dir, First));
        var drivers = text[text.IndexOf("## Decision Drivers", StringComparison.Ordinal)..text.IndexOf("## Considered Options", StringComparison.Ordinal)];
        Mutate(First, drivers, "");
        Mutate(First, "## Pros and Cons of the Options", drivers + "## Pros and Cons of the Options");

        Check(First).Errors.ShouldContain(e => e.Contains("sections out of order", StringComparison.Ordinal));
    }

    [Fact]
    public void IndexTitleAndStatusMismatch_AreReported()
    {
        Mutate("README.md", "| First decision | accepted |", "| Old title | proposed |");

        var errors = Check(First).Errors;

        errors.ShouldContain(e => e.Contains("index title differs from H1", StringComparison.Ordinal));
        errors.ShouldContain(e => e.Contains("index status 'proposed' differs", StringComparison.Ordinal));
    }

    [Fact]
    public void MissingIndexRow_IsReported()
    {
        Mutate("README.md", "| [0000](0000-first-decision.md) | First decision | accepted |\n", "");

        Check(First).Errors.ShouldContain(e => e.Contains("no row for 0000-first-decision.md", StringComparison.Ordinal));
    }

    [Fact]
    public void NumberingGapAndStrayFiles_AreReported()
    {
        File.Move(Path.Combine(_dir, "0001-second-decision.md"), Path.Combine(_dir, "0005-second-decision.md"));
        File.WriteAllText(Path.Combine(_dir, "notes.md"), "stray");

        var errors = AdrValidator.CheckRepository(_dir);

        errors.ShouldContain(e => e.Contains("contiguous from 0000", StringComparison.Ordinal));
        errors.ShouldContain(e => e.Contains("notes.md", StringComparison.Ordinal));
    }

    [Fact]
    public void FixLinks_LinksBareReferencesButNotCodeOrSelf()
    {
        Mutate(First, "[ADR-0001](0001-second-decision.md)", "ADR-0001 and ADR-0000");

        var changed = AdrValidator.FixLinks(Path.Combine(_dir, First), AdrValidator.AdrFiles(_dir));

        changed.ShouldBe(1);
        var text = File.ReadAllText(Path.Combine(_dir, First));
        text.ShouldContain("[ADR-0001](0001-second-decision.md) and ADR-0000");
        text.ShouldContain("`ADR-0099`");
        Check(First).Errors.ShouldBeEmpty();
    }

    private AdrFileResult Check(string file) =>
        AdrValidator.CheckFile(
            Path.Combine(_dir, file),
            AdrValidator.AdrFiles(_dir),
            File.ReadAllText(Path.Combine(_dir, AdrValidator.IndexFileName)));

    private void Mutate(string file, string find, string replace)
    {
        var path = Path.Combine(_dir, file);
        var text = File.ReadAllText(path);
        text.ShouldContain(find, customMessage: "test setup: text to replace not found in fixture");
        File.WriteAllText(path, text.Replace(find, replace, StringComparison.Ordinal));
    }

    private static string FixturesDir([CallerFilePath] string sourceFile = "") =>
        Path.Combine(Path.GetDirectoryName(sourceFile)!, "fixtures", "valid");
}
