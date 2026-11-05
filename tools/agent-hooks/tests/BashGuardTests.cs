using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class BashGuardTests
{
  private const string Root = "/repo";
  private readonly FakeProbe _probe = new();

  [Theory]
  [InlineData("git restore AGENTS.md")]
  [InlineData("git restore -SW AGENTS.md")]
  [InlineData("git restore --worktree --staged AGENTS.md")]
  [InlineData("git checkout -- AGENTS.md")]
  [InlineData("git checkout AGENTS.md")]
  [InlineData("git checkout -- .")]
  [InlineData("echo x && git restore AGENTS.md")]
  public void Discarding_unstaged_changes_is_denied(string command)
  {
    _probe.Dirty.Add("/repo/AGENTS.md");
    _probe.Existing.Add("AGENTS.md");

    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain("Save the patch");
  }

  [Theory]
  [InlineData("git restore AGENTS.md")]
  [InlineData("git restore --staged AGENTS.md")]
  [InlineData("git restore -S AGENTS.md")]
  [InlineData("git checkout main")]
  [InlineData("git checkout -b feature")]
  [InlineData("git status")]
  [InlineData("git diff -- AGENTS.md")]
  public void Clean_paths_branches_and_other_git_commands_pass(string command)
  {
    _probe.Dirty.Add("/repo/README.md");

    BashGuard.Evaluate(command, Root, _probe).ShouldBeNull();
  }

  [Fact]
  public void Restore_after_cd_probes_the_path_relative_to_the_new_directory()
  {
    _probe.Dirty.Add("/repo/backend/src/X.cs");

    Verdict verdict = BashGuard.Evaluate("cd backend && git restore src/X.cs", Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    (var cwd, IReadOnlyList<string> paths) = _probe.UnstagedQueries.ShouldHaveSingleItem();
    cwd.ShouldBe("/repo/backend");
    paths.ShouldBe(["src/X.cs"]);
  }

  [Theory]
  [InlineData("gh pr create --title t --body \"see /home/me/repo/x.md\"", "/home/me/repo/x.md")]
  [InlineData("gh issue comment 1 --body 'logs in /tmp/claude/out.txt'", "/tmp/claude/out.txt")]
  [InlineData("gh pr comment 2 --body 'C:\\Users\\me\\repo'", "C:\\Users\\me\\repo")]
  [InlineData("gh pr edit 3 --body 'from .claude/worktrees/task-1/'", ".claude/worktrees/task-1/")]
  [InlineData("gh pr review 4 --comment --body 'agent-ab12cd34ef'", "agent-ab12cd34ef")]
  [InlineData(
    "gh api repos/o/r/issues/1/comments -f body='id 12345678-1234-1234-1234-123456789abc'",
    "12345678-1234-1234-1234-123456789abc")]
  public void Public_posts_with_private_details_are_denied(string command, string expectedHit)
  {
    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain(expectedHit);
  }

  [Theory]
  [InlineData("gh pr create --title t --body 'see docs/stories/0020.md and https://github.com/mgasca/calendar/pull/1'")]
  [InlineData("gh pr view 1 --json files")]
  [InlineData("gh issue list --limit 50")]
  [InlineData("gh api repos/o/r/pulls/1")]
  public void Clean_posts_and_read_only_gh_commands_pass(string command) =>
    BashGuard.Evaluate(command, Root, _probe).ShouldBeNull();

  [Fact]
  public void Body_file_contents_are_scanned_and_its_path_is_not()
  {
    _probe.Files["/tmp/body.md"] = "Refs #216, see docs/stories/0020.md";
    BashGuard.Evaluate("gh issue comment 1 --body-file /tmp/body.md", Root, _probe).ShouldBeNull();

    _probe.Files["/tmp/body.md"] = "ran from /home/me/repo";
    Verdict verdict = BashGuard.Evaluate("gh issue comment 1 --body-file /tmp/body.md", Root, _probe).ShouldNotBeNull();
    verdict.Reason.ShouldContain("/home/me/repo");
  }

  [Theory]
  [InlineData("just db migrate")]
  [InlineData("just db::up db::migrate")]
  [InlineData("just db reset")]
  [InlineData("just db::psql")]
  [InlineData("just db do up migrate")]
  [InlineData("just db do -n reset")]
  [InlineData("just db::do seed psql")]
  [InlineData("docker compose down -v")]
  public void Shared_database_from_a_linked_worktree_asks(string command)
  {
    _probe.LinkedWorktree = true;

    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("ask");
    verdict.Reason.ShouldContain("run-calendar");
  }

  [Theory]
  [InlineData("just db migrate", true)]
  [InlineData("just db migrate", false)]
  [InlineData("just db seed --api-url http://localhost:55041", true)]
  [InlineData("just db", true)]
  [InlineData("just db do seed --api-url http://localhost:55041", true)]
  [InlineData("just backend do build test", true)]
  [InlineData("just docs build", true)]
  [InlineData("docker run -d --rm --name calendar-agent-db postgres", true)]
  [InlineData("just test", true)]
  public void Shared_database_passes_from_the_main_checkout_and_isolated_commands_pass_anywhere(string command, bool linked)
  {
    _probe.LinkedWorktree = linked;

    Verdict? verdict = BashGuard.Evaluate(command, Root, _probe);

    if (command == "just db migrate" && linked)
    {
      verdict.ShouldNotBeNull();
    }
    else
    {
      verdict.ShouldBeNull();
    }
  }
}
