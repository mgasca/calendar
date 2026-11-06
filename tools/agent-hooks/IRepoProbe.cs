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

  /// <summary>
  /// Repo-relative paths changed since the branch left origin/main that still differ from origin/main, so a squash-merged
  /// change drops out, plus everything git status reports.
  /// </summary>
  IReadOnlyList<string> ChangedFiles(string cwd);

  /// <summary>The file's last write time in UTC, or null when it does not exist.</summary>
  DateTime? LastWriteTimeUtc(string cwd, string path);

  /// <summary>The branch checked out in <paramref name="cwd"/>, or null when HEAD is detached or git cannot tell.</summary>
  string? CurrentBranch(string cwd);

  /// <summary>The pull request whose head is <paramref name="branch"/>, or null when there is none or gh cannot answer.</summary>
  PullRequest? PullRequestFor(string cwd, string branch);

  /// <summary>The remote's default branch (<c>origin/HEAD</c> without <c>origin/</c>), or null when git cannot tell.</summary>
  string? DefaultBranch(string cwd);

  /// <summary>
  /// The base and body of the PR that <c>gh pr view [<paramref name="selector"/>]</c> finds (the current branch's when null),
  /// in <paramref name="repo"/> when given; null when there is none or gh cannot answer.
  /// </summary>
  PullRequestText? PullRequestTextFor(string cwd, string? selector, string? repo);
}
