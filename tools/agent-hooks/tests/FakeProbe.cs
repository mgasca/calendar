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
}
