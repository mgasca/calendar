using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class ShellCommandTests
{
  [Fact]
  public void Split_tracks_cd_and_separators()
  {
    IReadOnlyList<ShellCommand.Segment> segments = ShellCommand.Split("cd backend && dotnet build; git status | head -1\ngit log", "/repo");

    segments.Select(s => s.Tokens[0]).ShouldBe(["dotnet", "git", "head", "git"]);
    segments.Select(s => s.Cwd).ShouldAllBe(c => c == "/repo/backend");
  }

  [Fact]
  public void Tokenize_honours_quotes() =>
    ShellCommand.Tokenize("gh pr create --body \"a b && c\" -t 'x y'").ShouldBe(["gh", "pr", "create", "--body", "a b && c", "-t", "x y"]);
}
