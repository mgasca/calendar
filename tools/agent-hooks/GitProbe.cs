using System.Diagnostics;

namespace AgentHooks;

/// <summary>Answers the probe questions by running git in the given directory.</summary>
public sealed class GitProbe : IRepoProbe
{
  /// <inheritdoc/>
  public bool HasUnstagedChanges(string cwd, IReadOnlyList<string> paths) =>
    Git(cwd, ["diff", "--quiet", "--", .. paths]).ExitCode == 1;

  /// <inheritdoc/>
  public bool PathExists(string cwd, string path) => Path.Exists(Path.Combine(cwd, path));

  /// <inheritdoc/>
  public bool IsLinkedWorktree(string cwd)
  {
    for (var dir = new DirectoryInfo(cwd); dir is not null; dir = dir.Parent)
    {
      var dotGit = Path.Combine(dir.FullName, ".git");
      if (File.Exists(dotGit))
      {
        return true;
      }
      if (Directory.Exists(dotGit))
      {
        return false;
      }
    }
    return false;
  }

  /// <inheritdoc/>
  public string? ReadFile(string cwd, string path)
  {
    var full = Path.Combine(cwd, path);
    return File.Exists(full) ? File.ReadAllText(full) : null;
  }

  /// <inheritdoc/>
  public IReadOnlyList<string> ChangedFiles(string cwd)
  {
    var files = new HashSet<string>(StringComparer.Ordinal);
    foreach (var baseRef in new[] { "origin/main", "main" })
    {
      GitResult mergeBase = Git(cwd, ["merge-base", "HEAD", baseRef]);
      if (mergeBase.ExitCode == 0 && mergeBase.Output.Trim().Length > 0)
      {
        // A file that already matches the base tip was delivered (for example by a squash merge, which leaves the merge
        // base behind), so only files that still differ from the tip count as the branch's changes (#254).
        IEnumerable<string> sinceMergeBase = Lines(Git(cwd, ["diff", "--name-only", mergeBase.Output.Trim()]).Output);
        var fromTip = new HashSet<string>(Lines(Git(cwd, ["diff", "--name-only", baseRef]).Output), StringComparer.Ordinal);
        files.UnionWith(sinceMergeBase.Where(fromTip.Contains));
        break;
      }
    }
    files.UnionWith(Lines(Git(cwd, ["status", "--porcelain", "--untracked-files=all"]).Output)
      .Select(l => l.Length > 3 ? l[3..] : l)
      .Select(l => l.Contains(" -> ", StringComparison.Ordinal) ? l[(l.IndexOf(" -> ", StringComparison.Ordinal) + 4)..] : l));
    return [.. files.Order(StringComparer.Ordinal)];
  }

  /// <inheritdoc/>
  public DateTime? LastWriteTimeUtc(string cwd, string path)
  {
    var full = Path.Combine(cwd, path);
    return File.Exists(full) ? File.GetLastWriteTimeUtc(full) : null;
  }

  /// <inheritdoc/>
  public string? CurrentBranch(string cwd)
  {
    ExternalCommand.Output? output =
      ExternalCommand.Run(GitExecutable.Value, ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd, BranchTimeout);
    var branch = output is { ExitCode: 0 } ? output.Stdout.Trim() : string.Empty;
    return branch.Length > 0 ? branch : null;
  }

  /// <inheritdoc/>
  public PullRequest? PullRequestFor(string cwd, string branch) =>
    PullRequestLookup.Find(cwd, branch, "gh", PullRequestLookup.Timeout);

  /// <inheritdoc/>
  public string? DefaultBranch(string cwd)
  {
    ExternalCommand.Output? output = ExternalCommand.Run(
      GitExecutable.Value, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd, BranchTimeout);
    var head = output is { ExitCode: 0 } ? output.Stdout.Trim() : string.Empty;
    var slash = head.IndexOf('/', StringComparison.Ordinal);
    return slash > 0 && slash < head.Length - 1 ? head[(slash + 1)..] : null;
  }

  /// <inheritdoc/>
  public PullRequestText? PullRequestTextFor(string cwd, string? selector, string? repo) =>
    PullRequestLookup.FindText(cwd, selector, repo, "gh", PullRequestLookup.Timeout);

  private static readonly TimeSpan BranchTimeout = TimeSpan.FromSeconds(5);

  /// <summary>git resolved on PATH once, so the process start uses an absolute path.</summary>
  private static readonly Lazy<string> GitExecutable = new(() => ExternalCommand.OnPath("git"));

  private static IEnumerable<string> Lines(string output) =>
    output.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0);

  private sealed record GitResult(int ExitCode, string Output);

  private static GitResult Git(string cwd, IReadOnlyList<string> args)
  {
    var info = new ProcessStartInfo(GitExecutable.Value)
    {
      WorkingDirectory = cwd,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false,
    };
    foreach (var arg in args)
    {
      info.ArgumentList.Add(arg);
    }
    using var process = Process.Start(info);
    if (process is null)
    {
      return new GitResult(127, string.Empty);
    }
    var output = process.StandardOutput.ReadToEnd();
    process.WaitForExit();
    return new GitResult(process.ExitCode, output);
  }
}
