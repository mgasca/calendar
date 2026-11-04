namespace AgentHooks;

/// <summary>Questions about the repository that the guards ask; faked in tests, answered by git in the tool.</summary>
public interface IRepoProbe
{
  /// <summary>True when any of the paths (resolved against <paramref name="cwd"/>) has unstaged changes.</summary>
  bool HasUnstagedChanges(string cwd, IReadOnlyList<string> paths);

  /// <summary>True when the path (resolved against <paramref name="cwd"/>) exists in the working tree.</summary>
  bool PathExists(string cwd, string path);

  /// <summary>True when the checkout containing <paramref name="cwd"/> is a linked worktree (its .git is a file).</summary>
  bool IsLinkedWorktree(string cwd);

  /// <summary>The file's text, or null when it cannot be read.</summary>
  string? ReadFile(string cwd, string path);

  /// <summary>Repo-relative paths changed since the branch left origin/main, plus everything git status reports.</summary>
  IReadOnlyList<string> ChangedFiles(string cwd);
}
