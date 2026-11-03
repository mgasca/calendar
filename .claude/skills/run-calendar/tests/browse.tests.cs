#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:project ../scripts/browse/lib/BrowseScript.csproj

// Tests for the browse driver's script parsing. Run: dotnet run tests/browse.tests.cs
// They reference the parsing library, not the driver, so they need neither Playwright nor Chromium.

using Shouldly;
using Xunit;

namespace RunCalendar.Tests;

public sealed class ScriptSplitTests
{
  [Fact]
  public void Split_SeparatesWordsAndKeepsTheRestOfTheLineAsTheLastPart()
  {
    Splits("fill label=Title Buy milk", 3, "fill", "label=Title", "Buy milk");
    Splits("click text=Week", 2, "click", "text=Week");
  }

  [Fact]
  public void Split_KeepsSpacesInsideSingleQuotesAndDropsTheQuotes()
  {
    Splits("fill 'label=Task title' Buy milk", 3, "fill", "label=Task title", "Buy milk");
    Splits("fill 'role=textbox[name=\"Task title\"]' x", 3, "fill", "role=textbox[name=\"Task title\"]", "x");
  }

  [Fact]
  public void Split_LeavesTheLastPartRaw()
  {
    Splits("eval  document.querySelector('main').innerText ", 2, "eval", "document.querySelector('main').innerText");
    Splits("fill label=Notes  two  spaces 'kept' ", 3, "fill", "label=Notes", "two  spaces 'kept'");
    Splits("click role=button[name=\"Add task\"]", 2, "click", "role=button[name=\"Add task\"]");
  }

  [Fact]
  public void Split_CollapsesRepeatedSpacesBetweenParts()
    => Splits("fill   label=Title   x", 3, "fill", "label=Title", "x");

  [Fact]
  public void Split_ReturnsFewerPartsWhenTheLineIsShort()
  {
    Splits("text", 2, "text");
    Splits("text ", 2, "text");
    Splits("fill label=Title", 3, "fill", "label=Title");
    Splits("", 2);
  }

  [Fact]
  public void Split_AnUnclosedQuoteRunsToTheEndOfTheLine()
    => Splits("fill 'label=Task title", 3, "fill", "label=Task title");

  [Fact]
  public void Split_AnEmptyQuotedWordIsNoPart() => Splits("'' x", 2, "x");

  private static void Splits(string line, int parts, params string[] expected)
    => Script.Split(line, parts).ShouldBe(expected);
}

public sealed class ScriptParseTests
{
  [Theory]
  [InlineData("")]
  [InlineData("   ")]
  [InlineData("# a comment")]
  [InlineData("  # an indented comment")]
  public void Parse_SkipsBlankLinesAndComments(string line) => Script.Parse(line).ShouldBeNull();

  [Theory]
  [InlineData("fill label=Title Buy milk", "fill", "label=Title", "Buy milk")]
  [InlineData("select 'label=Priority' High", "select", "label=Priority", "High")]
  [InlineData("click role=button[name=\"Add task\"]", "click", "role=button[name=\"Add task\"]", "")]
  [InlineData("eval [1, 2].length", "eval", "[1, 2].length", "")]
  [InlineData("  nav /week  ", "nav", "/week", "")]
  [InlineData("text", "text", "", "")]
  [InlineData("screenshot", "screenshot", "", "")]
  [InlineData("bogus a b", "bogus", "a b", "")]
  public void Parse_SplitsTheCommandFromItsArguments(string line, string name, string target, string rest)
    => Script.Parse(line).ShouldBe(new ScriptCommand(name, target, rest));

  [Fact]
  public void Parse_GivesALineWithoutACommandWordAnEmptyName()
    => Script.Parse("''").ShouldBe(new ScriptCommand("", "", ""));
}
