using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class GitProbeTests : IDisposable
{
  private readonly string _root = Directory.CreateTempSubdirectory("agent-hooks-").FullName;

  public void Dispose() => Directory.Delete(_root, recursive: true);

  [Fact]
  public void Linked_worktree_is_detected_from_a_git_file_but_not_a_git_directory()
  {
    var probe = new GitProbe();
    var nested = Path.Combine(_root, "a", "b");
    Directory.CreateDirectory(nested);

    probe.IsLinkedWorktree(nested).ShouldBeFalse();

    Directory.CreateDirectory(Path.Combine(_root, ".git"));
    probe.IsLinkedWorktree(nested).ShouldBeFalse();

    Directory.Delete(Path.Combine(_root, ".git"));
    File.WriteAllText(Path.Combine(_root, ".git"), "gitdir: elsewhere\n");
    probe.IsLinkedWorktree(nested).ShouldBeTrue();
  }

  [Fact]
  public void ChangedFiles_drops_a_file_that_already_matches_origin_main_after_a_squash_merge()
  {
    Git("init", "-q", "-b", "main");
    Commit(("delivered.cs", "old"), ("pending.cs", "old"));
    Git("update-ref", "refs/remotes/origin/main", "HEAD");
    Git("switch", "-q", "-c", "feature");
    Commit(("delivered.cs", "new"), ("pending.cs", "new"));
    var branch = Git("rev-parse", "HEAD");

    // Squash-merge only delivered.cs: origin/main gets a new commit with the same content, not the branch commit.
    Git("switch", "-q", "--detach", "origin/main");
    Commit(("delivered.cs", "new"));
    Git("update-ref", "refs/remotes/origin/main", "HEAD");
    Git("switch", "-q", "feature");

    Git("rev-parse", "HEAD").ShouldBe(branch);
    new GitProbe().ChangedFiles(_root).ShouldBe(["pending.cs"]);
  }

  [Fact]
  public void CurrentBranch_names_the_checked_out_branch_and_is_null_when_detached_or_missing()
  {
    var probe = new GitProbe();
    Git("init", "-q", "-b", "main");
    Commit(("a.cs", "a"));
    Git("switch", "-q", "-c", "claude/293-push-guard");

    probe.CurrentBranch(_root).ShouldBe("claude/293-push-guard");

    Git("switch", "-q", "--detach");
    probe.CurrentBranch(_root).ShouldBeNull();
    probe.CurrentBranch(Path.Combine(_root, "not-created-yet")).ShouldBeNull();
  }

  [Fact]
  public void LastWriteTimeUtc_reads_the_file_time_and_is_null_for_a_missing_file()
  {
    var probe = new GitProbe();
    var when = new DateTime(2026, 11, 5, 13, 38, 22, DateTimeKind.Utc);
    File.WriteAllText(Path.Combine(_root, "openapi.json"), "{}");
    File.SetLastWriteTimeUtc(Path.Combine(_root, "openapi.json"), when);

    probe.LastWriteTimeUtc(_root, "openapi.json").ShouldBe(when);
    probe.LastWriteTimeUtc(_root, "missing.json").ShouldBeNull();
  }

  private void Commit(params (string Path, string Text)[] files)
  {
    foreach ((string Path, string Text) file in files)
    {
      File.WriteAllText(System.IO.Path.Combine(_root, file.Path), file.Text);
    }
    Git("add", "-A");
    Git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "change");
  }

  private string Git(params string[] args)
  {
    var info = new System.Diagnostics.ProcessStartInfo("git")
    {
      WorkingDirectory = _root,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false,
    };
    info.Environment["GIT_CONFIG_GLOBAL"] = "/dev/null";
    info.Environment["GIT_CONFIG_NOSYSTEM"] = "1";
    foreach (var arg in args)
    {
      info.ArgumentList.Add(arg);
    }
    using System.Diagnostics.Process process = System.Diagnostics.Process.Start(info).ShouldNotBeNull();
    var output = process.StandardOutput.ReadToEnd();
    var error = process.StandardError.ReadToEnd();
    process.WaitForExit();
    process.ExitCode.ShouldBe(0, $"git {string.Join(' ', args)}: {error}");
    return output.Trim();
  }

  [Fact]
  public void ReadFile_returns_null_for_a_missing_file()
  {
    var probe = new GitProbe();
    File.WriteAllText(Path.Combine(_root, "body.md"), "hello");

    probe.ReadFile(_root, "body.md").ShouldBe("hello");
    probe.ReadFile(_root, "missing.md").ShouldBeNull();
  }
}
