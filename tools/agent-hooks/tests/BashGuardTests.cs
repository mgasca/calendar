using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class BashGuardTests
{
  private const string Root = "/repo";
  private readonly FakeProbe _probe = new();

  // The push tests run on branch feature, whose PR #186 merged; the other guards never ask for a branch or a PR.
  public BashGuardTests()
  {
    _probe.Branches[Root] = "feature";
    _probe.PullRequests["feature"] = new PullRequest(186, "MERGED");
  }

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
  [InlineData("gh pr create --title t --body \"$(cat <<'EOF'\nSummary\n\nsee /home/me/x.md\nEOF\n)\"")]
  [InlineData("gh pr create --title t --body \"$(cat <<'EOF'\nIt's \"quoted\" (a) | b && c\nsee /home/me/x.md\nEOF\n)\" && echo done")]
  [InlineData("gh pr create --title t --body 'Summary\n\nsee /home/me/x.md'")]
  [InlineData("gh pr comment 1 --body \"Summary;\nsee /home/me/x.md\"")]
  [InlineData("gh pr comment 1 --body-file - <<'EOF'\nSummary\nsee /home/me/x.md\nEOF")]
  public void Private_details_on_a_later_line_of_a_multi_line_body_are_denied(string command)
  {
    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain("/home/me/x.md");
  }

  [Theory]
  [InlineData("gh issue comment 1 -F /tmp/body.md")]
  [InlineData("gh issue comment 1 --body-file=/tmp/body.md")]
  public void Body_file_contents_are_scanned_in_the_short_and_equals_forms(string command)
  {
    _probe.Files["/tmp/body.md"] = "ran from /home/me/repo";

    BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull().Reason.ShouldContain("/home/me/repo");
  }

  [Fact]
  public void A_line_of_a_multi_line_body_is_not_run_as_a_command()
  {
    _probe.Dirty.Add("/repo/AGENTS.md");

    BashGuard.Evaluate("git commit -m \"$(cat <<'EOF'\nfix\ngit restore AGENTS.md\nEOF\n)\"", Root, _probe).ShouldBeNull();
    _probe.UnstagedQueries.ShouldBeEmpty();
  }

  [Theory]
  [InlineData("just db migrate")]
  [InlineData("just db::up db::migrate")]
  [InlineData("just db reset")]
  [InlineData("just db::psql")]
  [InlineData("just db do up migrate")]
  [InlineData("just db do -n reset")]
  [InlineData("just db::do seed psql")]
  [InlineData("just db run up migrate")]
  [InlineData("just db run -n reset")]
  [InlineData("just db::run seed psql")]
  [InlineData("just db run seed down")]
  [InlineData("just db::run --yes seed migrate")]
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
  [InlineData("just db run seed --api-url http://localhost:55041", true)]
  [InlineData("just backend run build test", true)]
  [InlineData("just db run up migrate", false)]
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

  [Theory]
  [InlineData("git push")]
  [InlineData("git push origin")]
  [InlineData("git push -u origin HEAD")]
  [InlineData("git push --set-upstream origin HEAD")]
  [InlineData("git push origin feature")]
  [InlineData("git push origin HEAD:feature")]
  [InlineData("git push --force-with-lease origin +local:refs/heads/feature")]
  [InlineData("git push -o ci.skip origin feature")]
  [InlineData("git push --follow-tags")]
  [InlineData("git push origin docs feature")]
  [InlineData("git -c push.default=current push")]
  [InlineData("git add -A && git commit -m 'card' && git push")]
  public void Push_to_a_branch_whose_pr_merged_is_denied(string command)
  {
    Verdict verdict = BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldStartWith("this branch's PR is merged/closed: start a new branch from origin/main");
    verdict.Reason.ShouldContain("'feature' has PR #186 merged");
  }

  [Fact]
  public void Push_to_a_branch_whose_pr_closed_is_denied()
  {
    _probe.PullRequests["feature"] = new PullRequest(226, "CLOSED");

    Verdict verdict = BashGuard.Evaluate("git push", Root, _probe).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain("PR #226 closed");
  }

  [Fact]
  public void Push_to_a_branch_whose_pr_is_open_passes()
  {
    _probe.PullRequests["feature"] = new PullRequest(293, "OPEN");

    BashGuard.Evaluate("git push -u origin HEAD", Root, _probe).ShouldBeNull();
    _probe.PullRequestQueries.ShouldBe([(Root, "feature")]);
  }

  [Theory]
  [InlineData("git push origin other")]
  [InlineData("git push origin feature:other")]
  public void Push_to_a_branch_without_a_pr_passes(string command)
  {
    BashGuard.Evaluate(command, Root, _probe).ShouldBeNull();
    _probe.PullRequestQueries.ShouldBe([(Root, "other")]);
  }

  [Fact]
  public void Push_from_a_detached_head_passes_without_asking_gh()
  {
    _probe.Branches.Clear();

    BashGuard.Evaluate("git push origin HEAD", Root, _probe).ShouldBeNull();
    _probe.PullRequestQueries.ShouldBeEmpty();
  }

  [Theory]
  [InlineData("git push origin --delete feature")]
  [InlineData("git push -d origin feature")]
  [InlineData("git push origin :feature")]
  [InlineData("git push --dry-run")]
  [InlineData("git push -n origin feature")]
  [InlineData("git push --all")]
  [InlineData("git push --mirror")]
  [InlineData("git push --tags")]
  [InlineData("git push origin --tags")]
  [InlineData("git push origin refs/tags/v1")]
  [InlineData("git push origin 'refs/heads/*:refs/heads/*'")]
  [InlineData("git push origin 293")]
  [InlineData("git pull")]
  [InlineData("git log --oneline -- push")]
  public void Pushes_that_name_no_branch_to_check_pass_without_asking_gh(string command)
  {
    _probe.PullRequests["293"] = new PullRequest(1, "MERGED");

    BashGuard.Evaluate(command, Root, _probe).ShouldBeNull();
    _probe.PullRequestQueries.ShouldBeEmpty();
  }

  [Theory]
  [InlineData("git switch -c fresh origin/main && git push -u origin HEAD")]
  [InlineData("git checkout -b fresh origin/main && git push -u origin HEAD")]
  [InlineData("git switch fresh && git push")]
  [InlineData("git checkout fresh && git push")]
  public void A_branch_switched_to_earlier_in_the_command_is_the_one_checked(string command)
  {
    BashGuard.Evaluate(command, Root, _probe).ShouldBeNull();
    _probe.PullRequestQueries.ShouldBe([(Root, "fresh")]);
  }

  [Fact]
  public void A_detaching_switch_earlier_in_the_command_leaves_no_branch_to_check()
  {
    BashGuard.Evaluate("git switch --detach origin/main && git push origin HEAD", Root, _probe).ShouldBeNull();
    _probe.PullRequestQueries.ShouldBeEmpty();
  }

  [Fact]
  public void A_file_checkout_is_not_a_branch_switch()
  {
    _probe.Existing.Add("AGENTS.md");

    BashGuard.Evaluate("git checkout AGENTS.md && git push", Root, _probe).ShouldNotBeNull().Decision.ShouldBe("deny");
  }

  [Theory]
  [InlineData("git -C other push")]
  [InlineData("cd other && git push")]
  public void The_push_is_checked_in_the_directory_it_runs_in(string command)
  {
    _probe.Branches[Root] = "fresh";
    _probe.Branches["/repo/other"] = "feature";

    BashGuard.Evaluate(command, Root, _probe).ShouldNotBeNull().Decision.ShouldBe("deny");
    _probe.PullRequestQueries.ShouldBe([("/repo/other", "feature")]);
  }
}
