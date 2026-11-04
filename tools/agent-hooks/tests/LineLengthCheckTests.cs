using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class LineLengthCheckTests
{
  private static readonly string Long = new('x', LineLengthCheck.MaximumLineLength + 10);
  private static readonly string Exact = new('x', LineLengthCheck.MaximumLineLength);

  [Fact]
  public void Long_cs_lines_are_listed_by_number()
  {
    LineLengthCheck.LongLines("/repo/a/B.cs", $"ok\n{Long}\n{Exact}\n{Long}\r\n").ShouldBe([2, 4]);
    (LineLengthCheck.Describe("/repo/a/B.cs", $"{Long}\n") ?? string.Empty).ShouldContain("B.cs: line(s) 1 exceed 140");
  }

  [Theory]
  [InlineData("/repo/a/B.cs")]
  [InlineData("/repo/x/Migrations/20260101_Init.cs")]
  [InlineData("/repo/a/b.ts")]
  public void Exact_limit_migrations_and_other_languages_produce_nothing(string path)
  {
    var content = path.EndsWith("B.cs", StringComparison.Ordinal) ? $"{Exact}\n" : $"{Long}\n";

    LineLengthCheck.LongLines(path, content).ShouldBeEmpty();
    LineLengthCheck.Describe(path, content).ShouldBeNull();
  }
}
