using System.Text;
using System.Text.RegularExpressions;

namespace AgentHooks;

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
