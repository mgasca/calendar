using System.Text;

namespace AgentHooks;

/// <summary>Splits a shell command line into the simple commands it runs, tracking <c>cd</c>.</summary>
public static class ShellCommand
{
  /// <summary>
  /// One simple command: its words, the directory it runs in, and the body of a heredoc that feeds it (null when none).
  /// </summary>
  public sealed record Segment(IReadOnlyList<string> Tokens, string Cwd, string? Stdin = null);

  /// <summary>
  /// Splits on <c>&amp;&amp;</c>, <c>||</c>, <c>;</c>, <c>|</c> and newlines, applying <c>cd</c> to later segments. A separator
  /// inside quotes, a <c>$(...)</c> substitution or a heredoc body does not split, so a multi-line body stays one word (#355).
  /// </summary>
  public static IReadOnlyList<Segment> Split(string command, string cwd)
  {
    var segments = new List<Segment>();
    var current = cwd;
    foreach (Scanner.Command parsed in new Scanner(command).Commands())
    {
      if (parsed.Words.Count == 0)
      {
        continue;
      }
      if (parsed.Words[0] == "cd" && parsed.Words.Count > 1)
      {
        current = Path.GetFullPath(Path.Combine(current, parsed.Words[1]));
        continue;
      }
      segments.Add(new Segment(parsed.Words, current, parsed.Stdin?.ToString()));
    }
    return segments;
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
          commands.Add(new Command());
        }
        else if (char.IsWhiteSpace(c))
        {
          EndWord();
          _pos++;
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
        else if (c is '\'' or '"' or '\\' || Next("$("))
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
