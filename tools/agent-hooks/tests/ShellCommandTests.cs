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
  public void Separators_inside_quotes_substitutions_and_heredocs_do_not_split()
  {
    IReadOnlyList<ShellCommand.Segment> segments = ShellCommand.Split(
      "gh pr create --body \"$(cat <<'EOF'\nIt's \"x y\" (a) | b\nEOF\n)\" && git push\necho 'a\nb; c'",
      "/repo");

    segments.Select(s => s.Tokens[0]).ShouldBe(["gh", "git", "echo"]);
    segments[0].Tokens.ShouldBe(["gh", "pr", "create", "--body", "$(cat <<'EOF'\nIt's \"x y\" (a) | b\nEOF\n)"]);
    segments[2].Tokens.ShouldBe(["echo", "a\nb; c"]);
  }

  [Fact]
  public void A_segment_after_a_single_pipe_is_marked_piped()
  {
    IReadOnlyList<ShellCommand.Segment> segments = ShellCommand.Split("jq -n x | gh api a --input - || echo no", "/repo");

    segments.Select(s => s.Piped).ShouldBe([false, true, false]);
  }

  [Fact]
  public void A_top_level_heredoc_is_the_segment_stdin()
  {
    IReadOnlyList<ShellCommand.Segment> segments = ShellCommand.Split(
      "gh pr create --body-file - <<'EOF' && echo done\nline 1\n\tline 2\nEOF\ngit status <<-END\n\tx\n\tEND",
      "/repo");

    segments.Select(s => s.Tokens[0]).ShouldBe(["gh", "echo", "git"]);
    segments[0].Tokens.ShouldBe(["gh", "pr", "create", "--body-file", "-"]);
    segments[0].Stdin.ShouldBe("line 1\n\tline 2\n");
    segments[1].Stdin.ShouldBeNull();
    segments[2].Stdin.ShouldBe("x\n");
  }

  [Fact]
  public void A_comment_runs_to_the_end_of_its_line_and_a_hash_inside_a_word_is_kept()
  {
    IReadOnlyList<ShellCommand.Segment> segments = ShellCommand.Split("a # it's (x\nb c#d 'e # f' \"#5\"", "/repo");

    segments.Select(s => s.Tokens).ShouldBe([["a"], ["b", "c#d", "e # f", "#5"]]);
  }

  [Fact]
  public void An_ansi_c_quote_honours_escaped_quotes() =>
    ShellCommand.Split("echo $'it\\'s' && git status", "/repo").Select(s => s.Tokens[0]).ShouldBe(["echo", "git"]);

  [Fact]
  public void A_command_reading_a_pipe_gets_the_heredoc_of_the_command_before_it()
  {
    IReadOnlyList<ShellCommand.Segment> segments = ShellCommand.Split("cat <<'EOF' | gh pr comment 1 --body-file -\nbody\nEOF", "/repo");

    segments[1].Stdin.ShouldBe("body\n");
  }

  [Fact]
  public void Backslashes_escape_and_join_lines()
  {
    ShellCommand.Split("git commit -m \"say \\\"hi\\\"\" \\\n  --amend a\\ b", "/repo")
      .ShouldHaveSingleItem().Tokens.ShouldBe(["git", "commit", "-m", "say \"hi\"", "--amend", "a b"]);
  }

  [Theory]
  [InlineData("gh pr create --body \"unterminated")]
  [InlineData("echo 'open")]
  [InlineData("echo $(open")]
  [InlineData("cat <<EOF\nno end")]
  [InlineData("cat <<")]
  [InlineData("echo \\")]
  public void Unterminated_input_never_throws(string command) =>
    ShellCommand.Split(command, "/repo").ShouldNotBeEmpty();

  [Fact]
  public void Tokenize_honours_quotes() =>
    ShellCommand.Tokenize("gh pr create --body \"a b && c\" -t 'x y'").ShouldBe(["gh", "pr", "create", "--body", "a b && c", "-t", "x y"]);
}
