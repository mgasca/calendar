using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentHooks;

/// <summary>What a hook tells Claude Code: an exit code, JSON on stdout and a note on stderr.</summary>
public sealed record HookResult(int ExitCode, string? Stdout = null, string? Stderr = null)
{
  /// <summary>Let the action through, with nothing to add.</summary>
  public static HookResult Pass { get; } = new(0);
}

/// <summary>A guard's verdict on a pre-tool-use action.</summary>
public sealed record Verdict(string Decision, string Reason);

/// <summary>The fields of a hook's stdin JSON that the guards read.</summary>
public sealed record HookInput(string? ToolName, string? Command, string? FilePath, string Cwd, bool StopHookActive)
{
  /// <summary>Parses the JSON Claude Code writes to a hook's stdin. Throws <see cref="JsonException"/> when malformed.</summary>
  public static HookInput Parse(string json)
  {
    using var doc = JsonDocument.Parse(json);
    JsonElement root = doc.RootElement;
    JsonElement toolInput = root.TryGetProperty("tool_input", out JsonElement input) ? input : default;
    return new HookInput(
      Text(root, "tool_name"),
      toolInput.ValueKind == JsonValueKind.Object ? Text(toolInput, "command") : null,
      toolInput.ValueKind == JsonValueKind.Object ? Text(toolInput, "file_path") : null,
      Text(root, "cwd") ?? Directory.GetCurrentDirectory(),
      root.TryGetProperty("stop_hook_active", out JsonElement active) && active.ValueKind == JsonValueKind.True);
  }

  private static string? Text(JsonElement element, string name) =>
    element.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

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

/// <summary>Builds the JSON shapes Claude Code understands.</summary>
public static class HookOutput
{
  /// <summary>A PreToolUse decision: "deny" or "ask", with the reason shown to Claude.</summary>
  public static string PreToolUse(Verdict verdict) =>
    Write(w =>
    {
      w.WriteStartObject("hookSpecificOutput");
      w.WriteString("hookEventName", "PreToolUse");
      w.WriteString("permissionDecision", verdict.Decision);
      w.WriteString("permissionDecisionReason", verdict.Reason);
      w.WriteEndObject();
    });

  /// <summary>Extra context for Claude after an event, without blocking anything.</summary>
  public static string Context(string eventName, string text) =>
    Write(w =>
    {
      w.WriteStartObject("hookSpecificOutput");
      w.WriteString("hookEventName", eventName);
      w.WriteString("additionalContext", text);
      w.WriteEndObject();
    });

  /// <summary>Keeps Claude working, with the reason as its next instruction.</summary>
  public static string StopBlock(string reason) =>
    Write(w =>
    {
      w.WriteString("decision", "block");
      w.WriteString("reason", reason);
    });

  private static string Write(Action<Utf8JsonWriter> body)
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
    {
      writer.WriteStartObject();
      body(writer);
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray());
  }
}

/// <summary>Splits a shell command line into the simple commands it runs, tracking <c>cd</c>.</summary>
public static partial class ShellCommand
{
  /// <summary>One simple command: its tokens and the directory it runs in.</summary>
  public sealed record Segment(IReadOnlyList<string> Tokens, string Cwd);

  /// <summary>Splits on <c>&amp;&amp;</c>, <c>||</c>, <c>;</c>, <c>|</c> and newlines, applying <c>cd</c> to later segments.</summary>
  public static IReadOnlyList<Segment> Split(string command, string cwd)
  {
    var segments = new List<Segment>();
    var current = cwd;
    foreach (var part in SeparatorRegex().Split(command))
    {
      IReadOnlyList<string> tokens = Tokenize(part);
      if (tokens.Count == 0)
      {
        continue;
      }
      if (tokens[0] == "cd" && tokens.Count > 1)
      {
        current = Path.GetFullPath(Path.Combine(current, tokens[1]));
        continue;
      }
      segments.Add(new Segment(tokens, current));
    }
    return segments;
  }

  /// <summary>Splits one simple command into words, honouring single and double quotes.</summary>
  public static IReadOnlyList<string> Tokenize(string text)
  {
    var tokens = new List<string>();
    var token = new StringBuilder();
    var inToken = false;
    var quote = '\0';
    foreach (var c in text)
    {
      if (quote != '\0')
      {
        if (c == quote)
        {
          quote = '\0';
        }
        else
        {
          token.Append(c);
        }
      }
      else if (c is '\'' or '"')
      {
        quote = c;
        inToken = true;
      }
      else if (char.IsWhiteSpace(c))
      {
        if (inToken)
        {
          tokens.Add(token.ToString());
          token.Clear();
          inToken = false;
        }
      }
      else
      {
        token.Append(c);
        inToken = true;
      }
    }
    if (inToken)
    {
      tokens.Add(token.ToString());
    }
    return tokens;
  }

  [GeneratedRegex(@"\s*(?:&&|\|\||;|\||\r?\n)\s*")]
  private static partial Regex SeparatorRegex();
}

/// <summary>Guards for Bash commands: protect unstaged work, the shared stash, the public record and the shared database.</summary>
public static partial class BashGuard
{
  private const string Deny = "deny";
  private const string Ask = "ask";

  private static readonly string[] GhPostSubjects = ["issue", "pr"];
  private static readonly string[] GhPostVerbs = ["create", "comment", "edit", "review"];
  private static readonly string[] SafeStashVerbs = ["list", "show", "branch", "create", "store"];

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
      "stash" => Stash([.. tokens.Skip(2)]),
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

  private static Verdict? Stash(List<string> args)
  {
    var verb = args.FirstOrDefault(a => !a.StartsWith('-'));
    var bare = verb is null
      || (verb == "push" && !args.Any(a => a is "-m" or "--message" || a.StartsWith("--message=", StringComparison.Ordinal)))
      || (verb is "pop" or "drop" or "apply" && args.SkipWhile(a => a != verb).Skip(1).All(a => a.StartsWith('-')));
    if (!bare || (verb is not null && SafeStashVerbs.Contains(verb)))
    {
      return null;
    }
    return new Verdict(
      Deny,
      "The stash stack is shared by every worktree of this repo, so a bare stash, pop or drop can take another session's work. "
      + "Prefer a WIP commit. If you must stash: git stash push -u -m \"<unique-tag>\", note its SHA with "
      + "git stash list --format='%H %gs', restore with git stash apply <sha>, then drop that entry by tag.");
  }

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

/// <summary>Refuses hand edits of generated files.</summary>
public static class EditGuard
{
  private static readonly string[] GeneratedSuffixes =
  [
    "contracts/openapi.json",
    "frontend/packages/api-client/src/schema.gen.ts",
    "packages.lock.json",
    "pnpm-lock.yaml",
  ];

  /// <summary>A deny verdict for a generated file, or null.</summary>
  public static Verdict? Evaluate(string filePath)
  {
    var normalized = filePath.Replace('\\', '/');
    return GeneratedSuffixes.Any(s => normalized.EndsWith(s, StringComparison.Ordinal))
      ? new Verdict(
        "deny",
        $"{Path.GetFileName(filePath)} is generated. Run `just contracts` for the API contract and TS client, `dotnet restore` "
        + "for packages.lock.json, or `pnpm install` for pnpm-lock.yaml, and commit the result instead of editing it.")
      : null;
  }
}

/// <summary>Reports C# lines over the S103 limit right after an edit, because nothing fixes them automatically.</summary>
public static class LineLengthCheck
{
  /// <summary>The S103 maximum from the repo's SonarLint.xml.</summary>
  public const int MaximumLineLength = 140;

  /// <summary>Line numbers over the limit; empty for non-C# files and EF migrations.</summary>
  public static IReadOnlyList<int> LongLines(string filePath, string? content)
  {
    var normalized = filePath.Replace('\\', '/');
    var isMigration = normalized.Contains("/Migrations/", StringComparison.Ordinal);
    if (content is null || !normalized.EndsWith(".cs", StringComparison.Ordinal) || isMigration)
    {
      return [];
    }
    var lines = content.Split('\n');
    return [.. Enumerable.Range(0, lines.Length).Where(i => lines[i].TrimEnd('\r').Length > MaximumLineLength).Select(i => i + 1)];
  }

  /// <summary>The note for Claude, or null when every line fits.</summary>
  public static string? Describe(string filePath, string? content)
  {
    IReadOnlyList<int> lines = LongLines(filePath, content);
    return lines.Count == 0
      ? null
      : $"{Path.GetFileName(filePath)}: line(s) {string.Join(", ", lines)} exceed {MaximumLineLength} characters (S103, a build error). "
        + "Wrap them by hand; dotnet format does not.";
  }
}

/// <summary>At stop time, notices API contract sources that changed without their generated outputs.</summary>
public static class ContractCheck
{
  private static readonly string[] ContractSources =
  [
    "backend/src/Calendar.Api/Contracts/",
    "backend/src/Calendar.Api/Endpoints/",
    "backend/src/Calendar.Api/Program.cs",
  ];

  private const string Contract = "contracts/openapi.json";
  private const string Client = "frontend/packages/api-client/src/schema.gen.ts";

  /// <summary>The reason to keep working, or null when the contract and client look in step.</summary>
  public static string? Evaluate(IReadOnlyList<string> changedFiles)
  {
    var sourcesChanged = changedFiles.Any(f => ContractSources.Any(s => f.StartsWith(s, StringComparison.Ordinal)));
    var contractChanged = changedFiles.Contains(Contract, StringComparer.Ordinal);
    var clientChanged = changedFiles.Contains(Client, StringComparer.Ordinal);
    if (sourcesChanged && !contractChanged)
    {
      return "API contract sources changed but contracts/openapi.json did not. Run `just contracts` and commit the result "
        + "(CI fails on a stale contract); if the contract is unchanged, say so and stop.";
    }
    if (contractChanged && !clientChanged)
    {
      return "contracts/openapi.json changed but the TS client did not. Run `just contracts` so schema.gen.ts is regenerated, "
        + "and commit both.";
    }
    return null;
  }
}

/// <summary>Maps a subcommand and its stdin to a result. The entry point only does I/O.</summary>
public static class HookRunner
{
  /// <summary>The subcommands the tool accepts.</summary>
  public static readonly string[] Subcommands = ["pre-bash", "pre-edit", "post-edit", "stop", "warm"];

  /// <summary>Runs one hook. Malformed JSON and unknown subcommands exit 2 so the mistake is visible.</summary>
  public static HookResult Run(string subcommand, string stdin, IRepoProbe probe, string sdkVersion)
  {
    if (!Subcommands.Contains(subcommand))
    {
      return new HookResult(
        2,
        Stderr: $"agent-hooks: unknown subcommand '{subcommand}'. Usage: agent-hooks <{string.Join('|', Subcommands)}>");
    }
    HookInput input;
    try
    {
      input = HookInput.Parse(stdin);
    }
    catch (JsonException e)
    {
      return new HookResult(2, Stderr: $"agent-hooks {subcommand}: stdin is not the hook JSON ({e.Message})");
    }
    return subcommand switch
    {
      "pre-bash" => PreBash(input, probe),
      "pre-edit" => PreEdit(input),
      "post-edit" => PostEdit(input, probe),
      "stop" => Stop(input, probe),
      _ => new HookResult(0, HookOutput.Context("SessionStart", $"agent-hooks active (tools/agent-hooks, .NET runtime {sdkVersion}).")),
    };
  }

  private static HookResult PreBash(HookInput input, IRepoProbe probe)
  {
    if (input.Command is null)
    {
      return new HookResult(0, Stderr: "agent-hooks pre-bash: no tool_input.command; letting it through");
    }
    Verdict? verdict = BashGuard.Evaluate(input.Command, input.Cwd, probe);
    return verdict is null ? HookResult.Pass : new HookResult(0, HookOutput.PreToolUse(verdict));
  }

  private static HookResult PreEdit(HookInput input)
  {
    if (input.FilePath is null)
    {
      return new HookResult(0, Stderr: "agent-hooks pre-edit: no tool_input.file_path; letting it through");
    }
    Verdict? verdict = EditGuard.Evaluate(input.FilePath);
    return verdict is null ? HookResult.Pass : new HookResult(0, HookOutput.PreToolUse(verdict));
  }

  private static HookResult PostEdit(HookInput input, IRepoProbe probe)
  {
    if (input.FilePath is null)
    {
      return HookResult.Pass;
    }
    var note = LineLengthCheck.Describe(input.FilePath, probe.ReadFile(input.Cwd, input.FilePath));
    return note is null ? HookResult.Pass : new HookResult(0, HookOutput.Context("PostToolUse", note));
  }

  private static HookResult Stop(HookInput input, IRepoProbe probe)
  {
    if (input.StopHookActive)
    {
      return HookResult.Pass;
    }
    var reason = ContractCheck.Evaluate(probe.ChangedFiles(input.Cwd));
    return reason is null ? HookResult.Pass : new HookResult(0, HookOutput.StopBlock(reason));
  }
}

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
        files.UnionWith(Lines(Git(cwd, ["diff", "--name-only", mergeBase.Output.Trim()]).Output));
        break;
      }
    }
    files.UnionWith(Lines(Git(cwd, ["status", "--porcelain", "--untracked-files=all"]).Output)
      .Select(l => l.Length > 3 ? l[3..] : l)
      .Select(l => l.Contains(" -> ", StringComparison.Ordinal) ? l[(l.IndexOf(" -> ", StringComparison.Ordinal) + 4)..] : l));
    return [.. files.Order(StringComparer.Ordinal)];
  }

  /// <summary>git resolved on PATH once, so the process start uses an absolute path.</summary>
  private static readonly Lazy<string> GitExecutable = new(() =>
    (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
      .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
      .Select(dir => Path.Combine(dir, OperatingSystem.IsWindows() ? "git.exe" : "git"))
      .FirstOrDefault(File.Exists) ?? "/usr/bin/git");

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
