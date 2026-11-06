using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class PullRequestLinkCheckTests
{
  private const string Root = "/repo";
  private readonly FakeProbe _probe = new();

  private string? Describe(string command) => PullRequestLinkCheck.Describe(command, Root, _probe);

  [Theory]
  [InlineData("gh pr create --title t --body 'Summary only'")]
  [InlineData("gh pr create --base main --title t -b 'Summary only'")]
  [InlineData("gh pr create -B main --title t --body=Summary")]
  [InlineData("git push -u origin HEAD && gh pr create --title t --body \"$(cat <<'EOF'\nSummary\n\nMore\nEOF\n)\"")]
  public void A_pr_to_main_without_closes_or_refs_gets_a_note(string command)
  {
    var note = Describe(command).ShouldNotBeNull();

    note.ShouldStartWith("Reminder, not a block (AGENTS.md, Stories and issues: the PR that completes an issue carries `Closes #N`)");
    note.ShouldContain("this PR targets main and its body has neither `Closes #N` nor `Refs #N`");
  }

  [Theory]
  [InlineData("Closes #321")]
  [InlineData("closes: #321")]
  [InlineData("Fixes #321")]
  [InlineData("Resolved mgasca/calendar#321")]
  [InlineData("Closes https://github.com/mgasca/calendar/issues/321")]
  [InlineData("Refs #318")]
  [InlineData("Ref: #318, #321")]
  public void A_pr_to_main_with_closes_or_refs_passes(string link) =>
    Describe($"gh pr create --title t --body \"$(cat <<'EOF'\nSummary\n\n{link}\nEOF\n)\"").ShouldBeNull();

  [Fact]
  public void The_note_names_the_issues_the_body_only_mentions()
  {
    var note = Describe("gh pr create --title t --body 'Delivering #274, child of #272.'").ShouldNotBeNull();

    note.ShouldContain("(it mentions #274, #272, which links nothing)");
  }

  [Theory]
  [InlineData("gh pr create --base docs/story-0027 --title t --body 'Summary'")]
  [InlineData("gh pr create --title t --fill")]
  [InlineData("gh pr create --title t --template .github/pull_request_template.md")]
  [InlineData("gh pr create --web")]
  [InlineData("gh pr create --title t --body-file missing.md")]
  [InlineData("gh pr view 5 --json body")]
  [InlineData("gh issue create --title t --body 'Summary'")]
  public void A_pr_elsewhere_or_with_an_unknown_body_passes(string command) => Describe(command).ShouldBeNull();

  [Fact]
  public void A_missing_base_is_the_default_branch()
  {
    _probe.Default = "develop";
    Describe("gh pr create --title t --body 'Summary'").ShouldBeNull();

    _probe.Default = null;
    Describe("gh pr create --title t --body 'Summary'").ShouldNotBeNull();
  }

  [Theory]
  [InlineData("gh pr create --title t --body-file body.md")]
  [InlineData("gh pr create --title t -F body.md")]
  [InlineData("gh pr create --title t --body-file=body.md")]
  public void The_body_file_is_read(string command)
  {
    _probe.Files["body.md"] = "Summary";
    Describe(command).ShouldNotBeNull();

    _probe.Files["body.md"] = "Summary\n\nCloses #321";
    Describe(command).ShouldBeNull();
  }

  [Fact]
  public void A_body_from_a_heredoc_on_stdin_is_read()
  {
    Describe("gh pr create --title t --body-file - <<'EOF'\nSummary\nEOF").ShouldNotBeNull();
    Describe("GH_PROMPT_DISABLED=1 gh pr create --title t --body 'Summary only'").ShouldNotBeNull();
    Describe("gh pr create --title t --body-file - <<'EOF'\nSummary\nRefs #318\nEOF").ShouldBeNull();
  }

  [Theory]
  [InlineData("Summary\n\nRefs #318, #321", "has `Refs #318, #321` but no `Closes #N`. A stacked PR gets its `Closes`")]
  [InlineData("Summary", "has neither `Closes #N` nor `Refs #N`")]
  public void A_retarget_to_main_without_closes_gets_a_note_from_the_current_body(string body, string expected)
  {
    _probe.PullRequestTexts["358"] = new PullRequestText(358, "fix/355-multiline-shell-split", body);

    var note = Describe("gh pr edit 358 --base main").ShouldNotBeNull();

    note.ShouldContain("this PR is being retargeted to main and its body " + expected);
    _probe.PullRequestTextQueries.ShouldBe([("358", null)]);
  }

  [Fact]
  public void A_retarget_reads_the_current_branch_pr_and_the_named_repo()
  {
    _probe.PullRequestTexts[string.Empty] = new PullRequestText(358, "x", "Closes #321");

    Describe("gh pr edit -R mgasca/calendar -B main").ShouldBeNull();
    _probe.PullRequestTextQueries.ShouldBe([(null, "mgasca/calendar")]);
  }

  [Fact]
  public void A_retarget_with_a_new_body_reads_that_body_and_asks_gh_nothing()
  {
    Describe("gh pr edit 358 --base main --body 'Closes #321'").ShouldBeNull();
    Describe("gh pr edit 358 --base main --body 'Refs #318'").ShouldNotBeNull().ShouldContain("but no `Closes #N`");
    _probe.PullRequestTextQueries.ShouldBeEmpty();
  }

  [Fact]
  public void A_retarget_passes_when_gh_cannot_answer() => Describe("gh pr edit 358 --base main").ShouldBeNull();

  [Fact]
  public void A_new_body_on_a_pr_to_main_is_checked_against_its_current_base()
  {
    _probe.PullRequestTexts["40"] = new PullRequestText(40, "main", "old");
    _probe.PullRequestTexts["41"] = new PullRequestText(41, "docs/story-0027", "old");

    Describe("gh pr edit 40 --body 'Summary'").ShouldNotBeNull().ShouldContain("PR #40 targets main");
    Describe("gh pr edit 40 --body 'Refs #318'").ShouldBeNull();
    Describe("gh pr edit 41 --body 'Summary'").ShouldBeNull();
  }

  [Theory]
  [InlineData("gh pr edit 358 --title t")]
  [InlineData("gh pr edit 358 --add-label bug")]
  [InlineData("gh pr edit 358 --base docs/story-0027")]
  [InlineData("gh pr edit 358 --base docs/story-0027 --body 'Summary'")]
  public void An_edit_that_leaves_the_link_alone_asks_gh_nothing(string command)
  {
    Describe(command).ShouldBeNull();
    _probe.PullRequestTextQueries.ShouldBeEmpty();
  }
}
