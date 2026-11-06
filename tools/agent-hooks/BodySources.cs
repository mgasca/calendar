using System.Text.RegularExpressions;

namespace AgentHooks;

/// <summary>
/// What the earlier segments of one command state about the body sources a later <c>gh</c> post reads: the variables they
/// assign and the files they write, so a source the shell has yet to expand or create can still be read (#374). The hook
/// sees the command before it runs; anything the command does not state is left to the hook's environment, or unread.
/// </summary>
public sealed partial class BodySources(IRepoProbe probe)
{
  // Commands whose stdin heredoc, or whose words, a redirect writes to a file.
  private static readonly string[] HeredocWriters = ["cat", "tee"];
  private static readonly string[] WordWriters = ["echo", "printf"];
  private static readonly string[] AssignmentBuiltins = ["export", "declare", "readonly", "local"];

  // Assigned variables; a null value is one whose own value could not be resolved.
  private readonly Dictionary<string, string?> _variables = new(StringComparer.Ordinal);
  private readonly Dictionary<string, string> _written = new(StringComparer.Ordinal);
  private ShellCommand.Segment? _previous;

  /// <summary>Notes what a segment assigns or writes, once the guards have evaluated it.</summary>
  public void Observe(ShellCommand.Segment segment)
  {
    IReadOnlyList<string> tokens = segment.Tokens;
    var start = AssignmentBuiltins.Contains(tokens[0]) ? 1 : 0;
    if (tokens.Skip(start).All(t => AssignmentRegex().IsMatch(t)) && tokens.Count > start)
    {
      foreach (var token in tokens.Skip(start))
      {
        var equals = token.IndexOf('=', StringComparison.Ordinal);
        _variables[token[..equals]] = Expand(token[(equals + 1)..]);
      }
    }
    else if (WrittenText(segment) is { } text)
    {
      foreach ((var path, var append) in WrittenFiles(segment))
      {
        _written[path] = append && _written.TryGetValue(path, out var before) ? before + text : text;
      }
    }
    _previous = segment;
  }

  /// <summary>
  /// The text a body source names: for <c>-</c>, the segment's heredoc, its <c>&lt; file</c> redirect or what the command
  /// piped into it gives; otherwise the file, as an earlier segment wrote it or as it is on disk. Null when unreadable.
  /// </summary>
  public string? Read(ShellCommand.Segment segment, string path) =>
    path == "-" ? Stdin(segment) : ReadFile(segment.Cwd, path);

  /// <summary>
  /// The path with <c>~</c>, <c>$NAME</c> and <c>${NAME}</c> expanded from the command's assignments, then the hook's
  /// environment; null when a variable is unknown or anything else is left to expand (<c>$(...)</c>).
  /// </summary>
  public string? Expand(string path)
  {
    var text = path == "~" || path.StartsWith("~/", StringComparison.Ordinal) ? "${HOME}" + path[1..] : path;
    var unknown = false;
    var expanded = VariableRegex().Replace(text, m =>
    {
      var name = m.Groups["braced"].Success ? m.Groups["braced"].Value : m.Groups["plain"].Value;
      var value = _variables.TryGetValue(name, out var assigned) ? assigned : Environment.GetEnvironmentVariable(name);
      unknown |= value is null;
      return value ?? string.Empty;
    });
    return unknown || expanded.Contains('$', StringComparison.Ordinal) ? null : expanded;
  }

  private string? ReadFile(string cwd, string path)
  {
    if (Expand(path) is not { } expanded)
    {
      return null;
    }
    return _written.TryGetValue(Path.GetFullPath(Path.Combine(cwd, expanded)), out var text)
      ? text
      : probe.ReadFile(cwd, expanded);
  }

  private string? Stdin(ShellCommand.Segment segment)
  {
    if (segment.Stdin is not null)
    {
      return segment.Stdin;
    }
    if (RedirectedFrom(segment.Tokens) is { } file)
    {
      return ReadFile(segment.Cwd, file);
    }
    if (!segment.Piped || _previous is not { } producer)
    {
      return null;
    }
    // cat reads its files; for any other command the body usually comes from its words (jq -n '{body: ...}', echo ...).
    List<string> args = [.. producer.Tokens.Skip(1)];
    return producer.Tokens[0] == "cat" && args.Count > 0 && args.All(a => !a.StartsWith('-'))
      ? string.Join('\n', args.Select(a => ReadFile(producer.Cwd, a) ?? a))
      : string.Join('\n', args);
  }

  /// <summary>The file of a <c>&lt; file</c> or <c>&lt;file</c> redirect in the words, or null.</summary>
  public static string? RedirectedFrom(IReadOnlyList<string> tokens)
  {
    for (var i = 0; i < tokens.Count; i++)
    {
      if (tokens[i] == "<" && i + 1 < tokens.Count)
      {
        return tokens[i + 1];
      }
      if (tokens[i].Length > 1 && tokens[i][0] == '<' && tokens[i][1] is not ('<' or '('))
      {
        return tokens[i][1..];
      }
    }
    return null;
  }

  /// <summary>What a writer segment puts in the files it writes: a cat or tee heredoc, or echo's or printf's words.</summary>
  private static string? WrittenText(ShellCommand.Segment segment)
  {
    var name = segment.Tokens[0];
    if (HeredocWriters.Contains(name))
    {
      return segment.Stdin;
    }
    return WordWriters.Contains(name)
      ? string.Join(' ', segment.Tokens.Skip(1).Where(t => !IsRedirect(t)).Except(OutputPaths(segment.Tokens))) + "\n"
      : null;
  }

  /// <summary>The full paths a writer segment writes, each with whether it appends.</summary>
  private static IEnumerable<(string Path, bool Append)> WrittenFiles(ShellCommand.Segment segment)
  {
    IReadOnlyList<string> tokens = segment.Tokens;
    for (var i = 1; i < tokens.Count; i++)
    {
      var token = tokens[i];
      var append = token.StartsWith(">>", StringComparison.Ordinal) || token.StartsWith("1>>", StringComparison.Ordinal);
      var bare = token.TrimStart('1').TrimStart('>');
      if (IsRedirect(token))
      {
        var file = bare.Length > 0 ? bare : NextWord(tokens, i);
        if (file is not null)
        {
          yield return (Path.GetFullPath(Path.Combine(segment.Cwd, file)), append);
        }
      }
      else if (tokens[0] == "tee" && !token.StartsWith('-') && !IsRedirectTarget(tokens, i))
      {
        yield return (Path.GetFullPath(Path.Combine(segment.Cwd, token)), tokens.Contains("-a") || tokens.Contains("--append"));
      }
    }
  }

  private static string? NextWord(IReadOnlyList<string> tokens, int i) => i + 1 < tokens.Count ? tokens[i + 1] : null;

  private static List<string> OutputPaths(IReadOnlyList<string> tokens) =>
    [.. tokens.Where((_, i) => IsRedirectTarget(tokens, i))];

  private static bool IsRedirectTarget(IReadOnlyList<string> tokens, int i) => i > 0 && tokens[i - 1] is ">" or ">>" or "1>" or "1>>";

  // Standard output only: 2> and &> write other streams or both, which no gh post reads from a file it then names.
  private static bool IsRedirect(string token) =>
    token.StartsWith('>') || token.StartsWith("1>", StringComparison.Ordinal);

  [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*=")]
  private static partial Regex AssignmentRegex();

  [GeneratedRegex(@"\$(?:\{(?<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?<plain>[A-Za-z_][A-Za-z0-9_]*))")]
  private static partial Regex VariableRegex();
}
