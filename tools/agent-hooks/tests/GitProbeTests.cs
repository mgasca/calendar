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
  public void ReadFile_returns_null_for_a_missing_file()
  {
    var probe = new GitProbe();
    File.WriteAllText(Path.Combine(_root, "body.md"), "hello");

    probe.ReadFile(_root, "body.md").ShouldBe("hello");
    probe.ReadFile(_root, "missing.md").ShouldBeNull();
  }
}
