using System.Text;

namespace AgentHooks;

/// <summary>Splits a shell command line into the simple commands it runs, tracking <c>cd</c>.</summary>
public static class ShellCommand
{
  /// <summary>
  /// One simple command: its words, the directory it runs in, the body of a heredoc that feeds it (null when none), and
  /// whether a pipe feeds it the output of the command before.
  /// </summary>
  public sealed record Segment(IReadOnlyList<string> Tokens, string Cwd, string? Stdin = null, bool Piped = false);

  /// <summary>
  /// Splits on <c>&amp;&amp;</c>, <c>||</c>, <c>;</c>, <c>|</c> and newlines, applying <c>cd</c> to later segments. A separator
  /// inside quotes, a <c>$(...)</c> substitution or a heredoc body does not split, so a multi-line body stays one word (#355).
  /// </summary>
  public static IReadOnlyList<Segment> Split(string command, string cwd)
  {
    var segments = new List<Segment>();
    var current = cwd;
    string? previousStdin = null;
    foreach (Scanner.Command parsed in new Scanner(command).Commands())
    {
      // A command at the end of a pipe reads what the one before it was fed (cat <<'EOF' | gh ... --body-file -).
      var stdin = parsed.Stdin?.ToString() ?? (parsed.Piped ? previousStdin : null);
      previousStdin = stdin;
      if (parsed.Words.Count == 0)
      {
        continue;
      }
      Unwrapped run = Unwrap(parsed.Words, current);
      // cd changes the shell's directory only when it runs in the shell (cd, builtin cd), not under sudo or env.
      if (run.Words[0] == "cd" && run.Words.Count > 1 && run.InShell)
      {
        current = Path.GetFullPath(Path.Combine(current, run.Words[1]));
        continue;
      }
      segments.Add(new Segment(run.Words, run.Cwd, stdin, parsed.Piped));
    }
    return segments;
  }

  /// <summary>
  /// A command that runs the command after it: its options that take a value (the next word, or the rest of a short
  /// option), its option that changes the directory, and whether the command it runs stays in the shell.
  /// </summary>
  private sealed record Wrapper(string[] WithValue, string? ChdirShort, bool InShell);

  // The wrappers unwrapped for the guards (#376). Only command and builtin run a builtin in the shell itself.
  private static readonly Dictionary<string, Wrapper> Wrappers = new(StringComparer.Ordinal)
  {
    ["env"] = new(["-u", "--unset", "-C", "--chdir"], "-C", InShell: false),
    ["command"] = new([], null, InShell: true),
    ["builtin"] = new([], null, InShell: true),
    ["exec"] = new(["-a"], null, InShell: false),
    ["nohup"] = new([], null, InShell: false),
    ["time"] = new(["-f", "--format", "-o", "--output"], null, InShell: false),
    ["nice"] = new(["-n", "--adjustment"], null, InShell: false),
    ["timeout"] = new(["-s", "--signal", "-k", "--kill-after"], null, InShell: false),
    ["sudo"] = new(
      [
        "-u", "--user", "-g", "--group", "-C", "--close-from", "-D", "--chdir", "-h", "--host", "-p", "--prompt", "-r",
        "--role", "-t", "--type", "-U", "--other-user", "-T", "--command-timeout", "-R", "--chroot",
      ],
      "-D",
      InShell: false),
  };

  // Builtins that assign shell variables; behind a wrapper that runs a separate process they assign nothing.
  private static readonly string[] AssignmentBuiltins = ["export", "declare", "readonly", "local", "typeset"];

  /// <summary>The command a simple command really runs, the directory it runs in, and whether it runs in the shell.</summary>
  internal sealed record Unwrapped(IReadOnlyList<string> Words, string Cwd, bool InShell);

  /// <summary>
  /// The words of the command a simple command really runs: leading <c>NAME=value</c> assignments and wrappers such as
  /// <c>env</c>, <c>command</c>, <c>sudo</c> or <c>timeout</c> are removed with their options, read as each wrapper reads
  /// them (bundles such as <c>-Eu root</c>, attached values such as <c>-Cdir</c>, <c>env -C</c> and <c>sudo -D</c> changing
  /// the directory), and a path to the command becomes its name, so every guard sees the command first (#376). Words with
  /// nothing left to run, <c>command -v</c>, <c>env -S</c>, and an assignment builtin behind a wrapper that leaves the shell
  /// stay as they are.
  /// </summary>
  internal static Unwrapped Unwrap(IReadOnlyList<string> words, string cwd)
  {
    var unchanged = new Unwrapped(words, cwd, InShell: true);
    var i = 0;
    var dir = cwd;
    var inShell = true;
    while (i < words.Count)
    {
      if (IsAssignment(words[i]))
      {
        i++;
        continue;
      }
      var name = Path.GetFileName(words[i]);
      if (!Wrappers.TryGetValue(name, out Wrapper? wrapper))
      {
        break;
      }
      inShell &= wrapper.InShell;
      var j = i + 1;
      while (j < words.Count && words[j].Length > 1 && words[j][0] == '-')
      {
        if (words[j] == "--")
        {
          j++;
          break;
        }
        if (Option(name, wrapper, words, j) is not { } option)
        {
          return unchanged;
        }
        if (option.Chdir is { } target)
        {
          dir = Path.GetFullPath(Path.Combine(dir, target));
        }
        j += option.Words;
      }
      // timeout's first word after its options is the duration.
      i = name == "timeout" ? j + 1 : j;
    }
    if (i >= words.Count || (i == 0 && !words[0].Contains('/', StringComparison.Ordinal))
      || (!inShell && AssignmentBuiltins.Contains(words[i])))
    {
      return unchanged;
    }
    return new Unwrapped([Path.GetFileName(words[i]), .. words.Skip(i + 1)], dir, inShell);
  }

  /// <summary>An option word read as its wrapper reads it: how many words it spans and the directory it moves to.</summary>
  private sealed record ParsedOption(int Words, string? Chdir);

  /// <summary>
  /// The option at <paramref name="j"/>, or null when the wrapper runs nothing the guards can see: a lookup
  /// (<c>command -v</c>) or a command string (<c>env -S</c>).
  /// </summary>
  private static ParsedOption? Option(string name, Wrapper wrapper, IReadOnlyList<string> words, int j)
  {
    var option = words[j];
    if (option.StartsWith("--", StringComparison.Ordinal))
    {
      var equals = option.IndexOf('=', StringComparison.Ordinal);
      var key = equals < 0 ? option : option[..equals];
      if (key == "--split-string")
      {
        return null;
      }
      var separate = equals < 0 && wrapper.WithValue.Contains(key);
      var value = separate ? ValueAfter(words, j) : null;
      if (equals >= 0)
      {
        value = option[(equals + 1)..];
      }
      var span = separate ? 2 : 1;
      return new ParsedOption(span, key == "--chdir" ? value : null);
    }
    // A bundle of short options: the first that takes a value takes the rest of the word, or the next word.
    for (var k = 1; k < option.Length; k++)
    {
      var flag = "-" + option[k];
      if ((name == "command" && option[k] is 'v' or 'V') || (name == "env" && option[k] == 'S'))
      {
        return null;
      }
      if (wrapper.WithValue.Contains(flag))
      {
        var attached = k + 1 < option.Length;
        var value = attached ? option[(k + 1)..] : ValueAfter(words, j);
        return new ParsedOption(attached ? 1 : 2, flag == wrapper.ChdirShort ? value : null);
      }
    }
    return new ParsedOption(1, null);
  }

  private static string? ValueAfter(IReadOnlyList<string> words, int i) => i + 1 < words.Count ? words[i + 1] : null;

  private static bool IsAssignment(string word)
  {
    var equals = word.IndexOf('=', StringComparison.Ordinal);
    return equals > 0 && (char.IsAsciiLetter(word[0]) || word[0] == '_')
      && word.Take(equals).All(c => char.IsAsciiLetterOrDigit(c) || c == '_');
  }

  /// <summary>Splits one simple command into words, honouring quotes, escapes, substitutions and heredocs.</summary>
  public static IReadOnlyList<string> Tokenize(string text) =>
    [.. new Scanner(text).Commands().SelectMany(c => c.Words)];

  /// <summary>
  /// A small shell lexer: enough of bash's quoting to find where commands start and what their words are. It never throws;
  /// unterminated input ends the word or body it is in. A <c>$(...)</c> is kept verbatim in its word.
  /// </summary>
  private sealed class Scanner(string text)
  {
    public sealed class Command
    {
      public List<string> Words { get; } = [];

      public StringBuilder? Stdin { get; set; }

      /// <summary>True when a <c>|</c> (not <c>||</c>) comes before the command, so it reads the previous one's output.</summary>
      public bool Piped { get; init; }
    }

    private sealed record Heredoc(string Delimiter, bool StripTabs, Command Owner);

    private readonly List<Heredoc> _pending = [];
    private int _pos;

    public List<Command> Commands()
    {
      var commands = new List<Command> { new() };
      var word = new StringBuilder();
      var inWord = false;
      void EndWord()
      {
        if (inWord)
        {
          commands[^1].Words.Add(word.ToString());
          word.Clear();
          inWord = false;
        }
      }
      while (_pos < text.Length)
      {
        var c = text[_pos];
        var separator = c == '\n' ? 1 : Separator();
        if (separator > 0)
        {
          EndWord();
          _pos += separator;
          if (c == '\n')
          {
            ReadHeredocBodies();
          }
          commands.Add(new Command { Piped = c == '|' && separator == 1 });
        }
        else if (char.IsWhiteSpace(c))
        {
          EndWord();
          _pos++;
        }
        else if (c == '#' && !inWord)
        {
          // A comment: an apostrophe in it must not open a quote that hides the commands after it.
          SkipComment();
        }
        else if (StartsHeredoc())
        {
          EndWord();
          _pending.Add(ReadHeredocOperator(commands[^1]));
        }
        else
        {
          inWord |= ReadWordPart(word);
        }
      }
      EndWord();
      return commands;
    }

    /// <summary>The length of the command separator at the position, or 0.</summary>
    private int Separator()
    {
      if (Next("&&") || Next("||"))
      {
        return 2;
      }
      return text[_pos] is ';' or '|' ? 1 : 0;
    }

    private bool Next(string s) => string.CompareOrdinal(text, _pos, s, 0, s.Length) == 0;

    private bool StartsHeredoc() => Next("<<") && !Next("<<<");

    /// <summary>Reads one quoted, escaped, substituted or plain character run into the word; true when it is part of a word.</summary>
    private bool ReadWordPart(StringBuilder word)
    {
      var c = text[_pos];
      if (c == '\'')
      {
        _pos++;
        var end = text.IndexOf('\'', _pos);
        end = end < 0 ? text.Length : end;
        word.Append(text, _pos, end - _pos);
        _pos = Math.Min(end + 1, text.Length);
      }
      else if (c == '"')
      {
        _pos++;
        ReadDoubleQuoted(word);
      }
      else if (c == '\\')
      {
        // A backslash escapes the next character; before a newline (or at the end) it only joins lines.
        var escaped = _pos + 1 < text.Length ? text[_pos + 1] : '\n';
        _pos += 2;
        if (escaped == '\n')
        {
          return false;
        }
        word.Append(escaped);
      }
      else if (Next("$'"))
      {
        _pos += 2;
        ReadAnsiQuoted(word);
      }
      else if (Next("$("))
      {
        var start = _pos;
        SkipSubstitution();
        word.Append(text, start, _pos - start);
      }
      else
      {
        word.Append(c);
        _pos++;
      }
      return true;
    }

    /// <summary>Moves to the end of a <c>#</c> comment's line, leaving the newline to end the command.</summary>
    private void SkipComment()
    {
      var end = text.IndexOf('\n', _pos);
      _pos = end < 0 ? text.Length : end;
    }

    /// <summary>Reads a <c>$'...'</c> word, in which a backslash escapes the next character, a quote included.</summary>
    private void ReadAnsiQuoted(StringBuilder word)
    {
      while (_pos < text.Length && text[_pos] != '\'')
      {
        if (text[_pos] == '\\' && _pos + 1 < text.Length)
        {
          _pos++;
        }
        word.Append(text[_pos]);
        _pos++;
      }
      _pos = Math.Min(_pos + 1, text.Length);
    }

    private void ReadDoubleQuoted(StringBuilder word)
    {
      while (_pos < text.Length)
      {
        var c = text[_pos];
        if (c == '"')
        {
          _pos++;
          return;
        }
        if (c == '\\' && _pos + 1 < text.Length && text[_pos + 1] is '"' or '\\' or '$' or '`' or '\n')
        {
          if (text[_pos + 1] != '\n')
          {
            word.Append(text[_pos + 1]);
          }
          _pos += 2;
        }
        else if (Next("$("))
        {
          var start = _pos;
          SkipSubstitution();
          word.Append(text, start, _pos - start);
        }
        else
        {
          word.Append(c);
          _pos++;
        }
      }
    }

    /// <summary>Moves past a <c>$(...)</c>, including nested quotes, substitutions, parentheses and heredoc bodies.</summary>
    private void SkipSubstitution()
    {
      _pos += 2;
      var depth = 1;
      var scratch = new StringBuilder();
      var outer = _pending.Count;
      while (_pos < text.Length && depth > 0)
      {
        var c = text[_pos];
        if (c == ')')
        {
          depth--;
          _pos++;
        }
        else if (c == '(')
        {
          depth++;
          _pos++;
        }
        else if (c == '\n')
        {
          _pos++;
          ReadHeredocBodies(outer);
        }
        else if (StartsHeredoc())
        {
          _pending.Add(ReadHeredocOperator(owner: null));
        }
        else if (c == '#' && (char.IsWhiteSpace(text[_pos - 1]) || text[_pos - 1] is '(' or ';'))
        {
          SkipComment();
        }
        else if (c is '\'' or '"' or '\\' || Next("$(") || Next("$'"))
        {
          ReadWordPart(scratch);
          scratch.Clear();
        }
        else
        {
          _pos++;
        }
      }
      _pending.RemoveRange(outer, _pending.Count - outer);
    }

    /// <summary>Reads <c>&lt;&lt;[-] WORD</c>; the word's quotes are removed to give the delimiter.</summary>
    private Heredoc ReadHeredocOperator(Command? owner)
    {
      _pos += 2;
      var stripTabs = _pos < text.Length && text[_pos] == '-';
      _pos += stripTabs ? 1 : 0;
      while (_pos < text.Length && text[_pos] is ' ' or '\t')
      {
        _pos++;
      }
      var delimiter = new StringBuilder();
      while (_pos < text.Length && !char.IsWhiteSpace(text[_pos]) && text[_pos] is not (';' or '|' or '&' or '<' or '>' or '(' or ')'))
      {
        ReadWordPart(delimiter);
      }
      return new Heredoc(delimiter.ToString(), stripTabs, owner ?? new Command());
    }

    /// <summary>
    /// At the start of a line, reads the bodies of the heredocs opened on the previous line (from index <paramref name="from"/>
    /// on), each up to its delimiter line, and gives each body to the command it feeds.
    /// </summary>
    private void ReadHeredocBodies(int from = 0)
    {
      foreach (Heredoc heredoc in _pending.Skip(from))
      {
        var body = new StringBuilder();
        while (_pos < text.Length)
        {
          var end = text.IndexOf('\n', _pos);
          var line = end < 0 ? text[_pos..] : text[_pos..end];
          _pos = end < 0 ? text.Length : end + 1;
          line = heredoc.StripTabs ? line.TrimStart('\t') : line;
          if (line == heredoc.Delimiter)
          {
            break;
          }
          body.Append(line).Append('\n');
        }
        heredoc.Owner.Stdin = (heredoc.Owner.Stdin ?? new StringBuilder()).Append(body);
      }
      _pending.RemoveRange(from, _pending.Count - from);
    }
  }
}
