using System.Text;
using System.Text.RegularExpressions;

namespace AgentHooks;

/// <summary>Guards for Bash commands: protect unstaged work, the public record and the shared database.</summary>
public static partial class BashGuard
{
  private const string Deny = "deny";
  private const string Ask = "ask";

  private static readonly string[] GhPostSubjects = ["issue", "pr"];
  private static readonly string[] GhPostVerbs = ["create", "comment", "edit", "review"];

  /// <summary>The first verdict any segment of the command earns, or null when it may run.</summary>
  public static Verdict? Evaluate(string command, string cwd, IRepoProbe probe)
  {
    foreach (ShellCommand.Segment segment in ShellCommand.Split(command, cwd))
    {
      Verdict? verdict = segment.Tokens[0] switch
      {
        "git" => Git(segment, probe),
        "gh" => GhPost(segment, probe),
        "just" => SharedDatabase(segment, probe, segment.Tokens.Skip(1).Any(t => DbRecipeRegex().IsMatch(t))),
        "docker" => SharedDatabase(segment, probe, segment.Tokens.Count > 1 && segment.Tokens[1] == "compose"),
        _ => null,
      };
      if (verdict is not null)
      {
        return verdict;
      }
    }
    return null;
  }

  private static Verdict? Git(ShellCommand.Segment segment, IRepoProbe probe)
  {
    IReadOnlyList<string> tokens = segment.Tokens;
    if (tokens.Count < 2)
    {
      return null;
    }
    return tokens[1] switch
    {
      "restore" => Restore([.. tokens.Skip(2)], segment.Cwd, probe),
      "checkout" => Checkout([.. tokens.Skip(2)], segment.Cwd, probe),
      _ => null,
    };
  }

  private static Verdict? Restore(List<string> args, string cwd, IRepoProbe probe)
  {
    var staged = args.Any(a => a == "--staged" || HasShortFlag(a, 'S'));
    var worktree = args.Any(a => a == "--worktree" || HasShortFlag(a, 'W'));
    if (staged && !worktree)
    {
      return null;
    }
    List<string> paths = PathArgs(args);
    return paths.Count > 0 ? Discard(paths, cwd, probe) : null;
  }

  private static Verdict? Checkout(List<string> args, string cwd, IRepoProbe probe)
  {
    var separator = args.IndexOf("--");
    List<string> paths = separator >= 0
      ? [.. args.Skip(separator + 1)]
      : [.. PathArgs(args).Where(p => p == "." || probe.PathExists(cwd, p))];
    if (separator < 0 && args.Any(a => a is "-b" or "-B" or "--orphan" or "--detach"))
    {
      return null;
    }
    return paths.Count > 0 ? Discard(paths, cwd, probe) : null;
  }

  private static Verdict? Discard(List<string> paths, string cwd, IRepoProbe probe) =>
    probe.HasUnstagedChanges(cwd, paths)
      ? new Verdict(
        Deny,
        $"Unstaged changes in {string.Join(", ", paths)} would be discarded. Save the patch (git diff > file) or make a WIP commit "
        + "first, then restore the saved version explicitly (AGENTS.md: preserve the fix when proving a regression test).")
      : null;

  private static Verdict? GhPost(ShellCommand.Segment segment, IRepoProbe probe)
  {
    IReadOnlyList<string> tokens = segment.Tokens;
    if (tokens.Count < 3)
    {
      return null;
    }
    var isPost = (GhPostSubjects.Contains(tokens[1]) && GhPostVerbs.Contains(tokens[2]))
      || (tokens[1] == "api" && tokens.Skip(2).Any(t => t is "-f" or "-F" or "--field" or "--raw-field" or "--input"));
    if (!isPost)
    {
      return null;
    }
    var text = new StringBuilder();
    var i = 1;
    while (i < tokens.Count)
    {
      if (tokens[i] is "--body-file" or "-F" && tokens[1] != "api" && i + 1 < tokens.Count)
      {
        text.AppendLine(probe.ReadFile(segment.Cwd, tokens[i + 1]) ?? string.Empty);
        i += 2;
      }
      else if (tokens[i].StartsWith("--body-file=", StringComparison.Ordinal))
      {
        text.AppendLine(probe.ReadFile(segment.Cwd, tokens[i]["--body-file=".Length..]) ?? string.Empty);
        i++;
      }
      else
      {
        text.AppendLine(tokens[i]);
        i++;
      }
    }
    List<string> hits = [.. PrivateDetailRegex().Matches(text.ToString()).Select(m => m.Value).Distinct(StringComparer.Ordinal)];
    return hits.Count == 0
      ? null
      : new Verdict(
        Deny,
        $"The post would publish private details: {string.Join(", ", hits)}. Use repository-relative paths and public "
        + "issue/PR links, and leave session, task and subagent handles out (AGENTS.md: public GitHub posts).");
  }

  private static Verdict? SharedDatabase(ShellCommand.Segment segment, IRepoProbe probe, bool touchesSharedDatabase) =>
    touchesSharedDatabase && probe.IsLinkedWorktree(segment.Cwd)
      ? new Verdict(
        Ask,
        "This runs from a linked worktree against the shared Compose project (name calendar, volume calendar-pgdata, port 5432), "
        + "which other checkouts and the human's own database use. For an isolated stack follow the run-calendar skill "
        + "(throwaway PostgreSQL on 55432); clean up only resources this task started.")
      : null;

  private static List<string> PathArgs(List<string> args) => [.. args.Where(a => !a.StartsWith('-'))];

  /// <summary>True for a bundle of short flags such as <c>-SW</c> that contains <paramref name="flag"/>.</summary>
  private static bool HasShortFlag(string arg, char flag) =>
    arg.Length > 1 && arg[0] == '-' && arg[1] != '-' && arg.Contains(flag, StringComparison.Ordinal);

  [GeneratedRegex(@"^db-(up|down|reset|migrate|psql)$")]
  private static partial Regex DbRecipeRegex();

  [GeneratedRegex(
    @"/home/[^\s""']*|/tmp/[^\s""']*|/mnt/c/[^\s""']*|/Users/[^\s""']*|\b[A-Za-z]:\\[^\s""']*|\.claude/worktrees/[^\s""']*"
    + @"|\b(?:session|task|agent)[_-][0-9a-f]{8,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    RegexOptions.IgnoreCase)]
  private static partial Regex PrivateDetailRegex();
}
