namespace AgentHooks.Tests;

/// <summary>A probe with scripted answers; records the questions it was asked.</summary>
internal sealed class FakeProbe : IRepoProbe
{
  public HashSet<string> Dirty { get; } = new(StringComparer.Ordinal);

  public HashSet<string> Existing { get; } = new(StringComparer.Ordinal);

  public Dictionary<string, string> Files { get; } = new(StringComparer.Ordinal);

  public List<string> Changed { get; } = [];

  public Dictionary<string, DateTime> WriteTimes { get; } = new(StringComparer.Ordinal);

  public bool LinkedWorktree { get; set; }

  public List<(string Cwd, IReadOnlyList<string> Paths)> UnstagedQueries { get; } = [];

  public bool HasUnstagedChanges(string cwd, IReadOnlyList<string> paths)
  {
    UnstagedQueries.Add((cwd, paths));
    return paths.Select(p => Path.GetFullPath(Path.Combine(cwd, p)))
      .Any(full => Dirty.Any(d => d == full || d.StartsWith(full + "/", StringComparison.Ordinal)));
  }

  public bool PathExists(string cwd, string path) => Existing.Contains(path);

  public bool IsLinkedWorktree(string cwd) => LinkedWorktree;

  public string? ReadFile(string cwd, string path) => Files.TryGetValue(path, out var text) ? text : null;

  public IReadOnlyList<string> ChangedFiles(string cwd) => Changed;

  public DateTime? LastWriteTimeUtc(string cwd, string path) => WriteTimes.TryGetValue(path, out DateTime time) ? time : null;

  /// <summary>The branch checked out per directory; a directory missing here has a detached HEAD.</summary>
  public Dictionary<string, string> Branches { get; } = new(StringComparer.Ordinal);

  /// <summary>The PR of each head branch; a branch missing here has none.</summary>
  public Dictionary<string, PullRequest> PullRequests { get; } = new(StringComparer.Ordinal);

  public List<(string Cwd, string Branch)> PullRequestQueries { get; } = [];

  public string? CurrentBranch(string cwd) => Branches.TryGetValue(cwd, out var branch) ? branch : null;

  public PullRequest? PullRequestFor(string cwd, string branch)
  {
    PullRequestQueries.Add((cwd, branch));
    return PullRequests.TryGetValue(branch, out PullRequest? pr) ? pr : null;
  }

  /// <summary>The remote's default branch; null when git cannot tell.</summary>
  public string? Default { get; set; } = "main";

  public string? DefaultBranch(string cwd) => Default;

  /// <summary>The base and body of each PR, by the selector gh is given ("" for the current branch's PR).</summary>
  public Dictionary<string, PullRequestText> PullRequestTexts { get; } = new(StringComparer.Ordinal);

  public List<(string? Selector, string? Repo)> PullRequestTextQueries { get; } = [];

  public PullRequestText? PullRequestTextFor(string cwd, string? selector, string? repo)
  {
    PullRequestTextQueries.Add((selector, repo));
    return PullRequestTexts.TryGetValue(selector ?? string.Empty, out PullRequestText? pr) ? pr : null;
  }
}
