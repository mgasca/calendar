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

  // git's global options that take the next word as their value (-C is applied to the directory instead).
  private static readonly string[] GitGlobalOptionsWithValue = ["-c", "--git-dir", "--work-tree", "--namespace", "--config-env"];

  // git push options that take the next word as their value, and those after which no branch needs checking.
  private static readonly string[] PushOptionsWithValue = ["--repo", "-o", "--push-option", "--receive-pack", "--exec"];
  private static readonly string[] PushOptionsWithoutBranch = ["--all", "--branches", "--mirror", "--delete", "--dry-run"];

  /// <summary>The first verdict any segment of the command earns, or null when it may run.</summary>
  public static Verdict? Evaluate(string command, string cwd, IRepoProbe probe)
  {
    // Branches that earlier segments of this command switch to, by directory; null when the switch detaches HEAD.
    var switchedTo = new Dictionary<string, string?>(StringComparer.Ordinal);
    foreach (ShellCommand.Segment segment in ShellCommand.Split(command, cwd))
    {
      Verdict? verdict = segment.Tokens[0] switch
      {
        "git" => Git(segment, probe, switchedTo),
        "gh" => GhPost(segment, probe),
        "just" => SharedDatabase(segment, probe, DbRecipeRegex().IsMatch(string.Join(' ', segment.Tokens.Skip(1)))),
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

  /// <summary>A git subcommand with git's global options removed, and the directory it runs in (<c>-C</c> applied).</summary>
  private sealed record GitCall(string Subcommand, List<string> Args, string Cwd);

  private static GitCall? ParseGit(ShellCommand.Segment segment)
  {
    IReadOnlyList<string> tokens = segment.Tokens;
    var cwd = segment.Cwd;
    var i = 1;
    while (i < tokens.Count && tokens[i].StartsWith('-'))
    {
      if (tokens[i] == "-C" && i + 1 < tokens.Count)
      {
        cwd = Path.GetFullPath(Path.Combine(cwd, tokens[i + 1]));
      }
      i += tokens[i] == "-C" || GitGlobalOptionsWithValue.Contains(tokens[i]) ? 2 : 1;
    }
    return i < tokens.Count ? new GitCall(tokens[i], [.. tokens.Skip(i + 1)], cwd) : null;
  }

  private static Verdict? Git(ShellCommand.Segment segment, IRepoProbe probe, Dictionary<string, string?> switchedTo)
  {
    IReadOnlyList<string> tokens = segment.Tokens;
    GitCall? call = ParseGit(segment);
    if (call is null)
    {
      return null;
    }
    RecordBranchSwitch(call, probe, switchedTo);
    if (call.Subcommand == "push")
    {
      return Push(call, probe, switchedTo);
    }
    // restore and checkout are guarded in their plain form only, as before the push guard (#293).
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

  /// <summary>
  /// Notes the branch a <c>switch</c> or <c>checkout</c> moves to, so a later push in the same command checks the new branch
  /// (the remedy <c>git switch -c new origin/main &amp;&amp; git push -u origin HEAD</c> must pass).
  /// </summary>
  private static void RecordBranchSwitch(GitCall call, IRepoProbe probe, Dictionary<string, string?> switchedTo)
  {
    List<string> args = call.Args;
    if (call.Subcommand is not ("switch" or "checkout") || args.Contains("--"))
    {
      return;
    }
    var create = args.FindIndex(a => a is "-c" or "-C" or "--create" or "--force-create" or "-b" or "-B" or "--orphan");
    if (create >= 0 && create + 1 < args.Count)
    {
      switchedTo[call.Cwd] = args[create + 1];
    }
    else if (args.Any(a => a is "--detach" or "-d" or "-"))
    {
      switchedTo[call.Cwd] = null;
    }
    else if (PathArgs(args).FirstOrDefault() is { } target && (call.Subcommand == "switch" || !probe.PathExists(call.Cwd, target)))
    {
      switchedTo[call.Cwd] = target;
    }
  }

  private static Verdict? Push(GitCall call, IRepoProbe probe, Dictionary<string, string?> switchedTo)
  {
    var positionals = new List<string>();
    var tags = false;
    var i = 0;
    while (i < call.Args.Count)
    {
      var arg = call.Args[i];
      if (arg == "--")
      {
        positionals.AddRange(call.Args.Skip(i + 1));
        break;
      }
      if (PushOptionsWithoutBranch.Contains(arg) || HasShortFlag(arg, 'd') || HasShortFlag(arg, 'n'))
      {
        return null;
      }
      tags |= arg == "--tags";
      if (!arg.StartsWith('-'))
      {
        positionals.Add(arg);
      }
      i += PushOptionsWithValue.Contains(arg) ? 2 : 1;
    }
    if (tags && positionals.Count < 2)
    {
      return null;
    }
    var current = new Lazy<string?>(() =>
      switchedTo.TryGetValue(call.Cwd, out var switched) ? switched : probe.CurrentBranch(call.Cwd));
    IEnumerable<string?> branches = positionals.Count < 2
      ? [current.Value]
      : positionals.Skip(1).Select(refspec => RemoteBranch(refspec, current));
    foreach (var branch in branches)
    {
      // An all-digit name would be read by gh as a PR number, so it is not looked up.
      if (branch is null || branch.All(char.IsAsciiDigit))
      {
        continue;
      }
      if (probe.PullRequestFor(call.Cwd, branch) is { IsMergedOrClosed: true } pr)
      {
        return new Verdict(
          Deny,
          $"this branch's PR is merged/closed: start a new branch from origin/main (branch '{branch}' has PR #{pr.Number} "
          + $"{pr.State.ToLowerInvariant()}; a push adds nothing to it and recreates the deleted remote branch. "
          + "AGENTS.md: verify delivery across a merge).");
      }
    }
    return null;
  }

  /// <summary>
  /// The remote branch a refspec writes to: the destination side, without <c>+</c> or <c>refs/heads/</c>; the current branch
  /// for <c>HEAD</c>; null for a delete (<c>:branch</c>), a pattern, or a ref outside <c>refs/heads/</c> such as a tag.
  /// </summary>
  private static string? RemoteBranch(string refspec, Lazy<string?> current)
  {
    var spec = refspec.TrimStart('+');
    var colon = spec.IndexOf(':', StringComparison.Ordinal);
    var target = colon >= 0 ? spec[(colon + 1)..] : spec;
    if (colon == 0 || target.Length == 0 || target.Contains('*', StringComparison.Ordinal))
    {
      return null;
    }
    if (target is "HEAD" or "@")
    {
      return current.Value;
    }
    if (target.StartsWith("refs/heads/", StringComparison.Ordinal))
    {
      return target["refs/heads/".Length..];
    }
    return target.StartsWith("refs/", StringComparison.Ordinal) ? null : target;
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
        text.AppendLine(BodyFile(segment, tokens[i + 1], probe) ?? string.Empty);
        i += 2;
      }
      else if (tokens[i].StartsWith("--body-file=", StringComparison.Ordinal))
      {
        text.AppendLine(BodyFile(segment, tokens[i]["--body-file=".Length..], probe) ?? string.Empty);
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

  /// <summary>The text a <c>--body-file</c> names: the command's heredoc for <c>-</c> (stdin), otherwise the file's contents.</summary>
  internal static string? BodyFile(ShellCommand.Segment segment, string path, IRepoProbe probe) =>
    path == "-" ? segment.Stdin : probe.ReadFile(segment.Cwd, path);

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

  // A db module recipe on the shared database, written `db up` or `db::up` (story 0019), or named anywhere in a
  // `db run` chain (`db run -n up migrate`, #315). Keep guarding the former `do` spelling too.
  // `db seed` goes through the API.
  [GeneratedRegex(@"(?:^| )db(?: |::)(?:(?:do|run) (?:\S+ )*)?(?:up|down|reset|migrate|psql)(?: |$)")]
  private static partial Regex DbRecipeRegex();

  [GeneratedRegex(
    @"/home/[^\s""']*|/tmp/[^\s""']*|/mnt/c/[^\s""']*|/Users/[^\s""']*|\b[A-Za-z]:\\[^\s""']*|\.claude/worktrees/[^\s""']*"
    + @"|\b(?:session|task|agent)[_-][0-9a-f]{8,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    RegexOptions.IgnoreCase)]
  private static partial Regex PrivateDetailRegex();
}
