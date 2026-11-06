using System.Diagnostics;
using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class PullRequestLookupTests : IDisposable
{
  private readonly string _root = Directory.CreateTempSubdirectory("agent-hooks-gh-").FullName;

  public void Dispose() => Directory.Delete(_root, recursive: true);

  [Theory]
  [InlineData("{\"number\":186,\"state\":\"MERGED\"}\n", 186, "MERGED", true)]
  [InlineData("{\"state\":\"CLOSED\",\"number\":226}", 226, "CLOSED", true)]
  [InlineData("{\"number\":293,\"state\":\"OPEN\"}", 293, "OPEN", false)]
  public void Parse_reads_the_number_and_state(string json, int number, string state, bool finished)
  {
    PullRequest pr = PullRequestLookup.Parse(json).ShouldNotBeNull();

    pr.ShouldBe(new PullRequest(number, state));
    pr.IsMergedOrClosed.ShouldBe(finished);
  }

  [Theory]
  [InlineData("")]
  [InlineData("no pull requests found for branch \"x\"")]
  [InlineData("[]")]
  [InlineData("{\"number\":1}")]
  [InlineData("{\"number\":\"1\",\"state\":\"MERGED\"}")]
  [InlineData("{\"number\":1,\"state\":\"DRAFT\"}")]
  public void Parse_rejects_anything_that_is_not_a_pr(string text) => PullRequestLookup.Parse(text).ShouldBeNull();

  [Fact]
  public void Find_asks_gh_for_the_branch_in_the_push_directory()
  {
    var gh = FakeGh("pwd > \"$0.cwd\"; echo \"$@\" > \"$0.args\"; echo '{\"number\":186,\"state\":\"MERGED\"}'");

    PullRequestLookup.Find(_root, "feature", gh, PullRequestLookup.Timeout).ShouldBe(new PullRequest(186, "MERGED"));

    File.ReadAllText(gh + ".args").Trim().ShouldBe("pr view feature --json number,state");
    File.ReadAllText(gh + ".cwd").Trim().ShouldBe(_root);
  }

  [Fact]
  public void Find_is_null_when_gh_finds_no_pr()
  {
    var gh = FakeGh("echo 'no pull requests found for branch \"feature\"' >&2; exit 1");

    PullRequestLookup.Find(_root, "feature", gh, PullRequestLookup.Timeout).ShouldBeNull();
  }

  [Fact]
  public void Find_is_null_when_gh_fails_after_printing_a_pr()
  {
    var gh = FakeGh("echo '{\"number\":186,\"state\":\"MERGED\"}'; exit 4");

    PullRequestLookup.Find(_root, "feature", gh, PullRequestLookup.Timeout).ShouldBeNull();
  }

  [Fact]
  public void Find_is_null_when_gh_is_missing() =>
    PullRequestLookup.Find(_root, "feature", Path.Combine(_root, "no-gh"), PullRequestLookup.Timeout).ShouldBeNull();

  [Fact]
  public void Find_is_null_when_gh_waits_for_input_or_runs_past_the_timeout()
  {
    var gh = FakeGh("read answer; sleep 10; echo '{\"number\":186,\"state\":\"MERGED\"}'");
    var clock = Stopwatch.StartNew();

    PullRequestLookup.Find(_root, "feature", gh, TimeSpan.FromMilliseconds(300)).ShouldBeNull();

    clock.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5));
  }

  [Fact]
  public void Find_runs_gh_without_prompts()
  {
    var gh = FakeGh("echo \"{\\\"number\\\":${GH_PROMPT_DISABLED:-0},\\\"state\\\":\\\"OPEN\\\"}\"");

    PullRequestLookup.Find(_root, "feature", gh, PullRequestLookup.Timeout).ShouldBe(new PullRequest(1, "OPEN"));
  }

  [Fact]
  public void Find_text_asks_gh_for_the_base_and_body_of_the_named_pr_in_the_named_repo()
  {
    var gh = FakeGh("echo \"$@\" > \"$0.args\"; echo '{\"number\":358,\"baseRefName\":\"main\",\"body\":\"Refs #318\"}'");

    PullRequestLookup.FindText(_root, "358", "mgasca/calendar", gh, PullRequestLookup.Timeout)
      .ShouldBe(new PullRequestText(358, "main", "Refs #318"));

    File.ReadAllText(gh + ".args").Trim().ShouldBe("pr view 358 --repo mgasca/calendar --json number,baseRefName,body");
  }

  [Fact]
  public void Find_text_without_a_selector_asks_for_the_current_branch_pr()
  {
    var gh = FakeGh("echo \"$@\" > \"$0.args\"; echo '{\"number\":1,\"baseRefName\":\"main\",\"body\":\"\"}'");

    PullRequestLookup.FindText(_root, null, null, gh, PullRequestLookup.Timeout).ShouldBe(new PullRequestText(1, "main", ""));

    File.ReadAllText(gh + ".args").Trim().ShouldBe("pr view --json number,baseRefName,body");
  }

  [Theory]
  [InlineData("")]
  [InlineData("{\"number\":1,\"baseRefName\":\"main\"}")]
  [InlineData("{\"number\":1,\"body\":\"x\"}")]
  [InlineData("{\"number\":1,\"baseRefName\":\"main\",\"body\":null}")]
  public void Parse_text_rejects_anything_without_a_number_base_and_body(string text) =>
    PullRequestLookup.ParseText(text).ShouldBeNull();

  [Fact]
  public void Find_text_is_null_when_gh_fails() =>
    PullRequestLookup.FindText(_root, "358", null, FakeGh("exit 1"), PullRequestLookup.Timeout).ShouldBeNull();

  /// <summary>An executable shell script standing in for gh, in the test's temporary directory.</summary>
  private string FakeGh(string body)
  {
    var path = Path.Combine(_root, $"gh-{Guid.NewGuid():N}");
    File.WriteAllText(path, $"#!/bin/sh\n{body}\n");
    if (!OperatingSystem.IsWindows())
    {
      File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }
    return path;
  }
}
