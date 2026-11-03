using System.Text;

namespace RunCalendar;

/// <summary>One command of a browse script.</summary>
/// <param name="Name">The command, such as <c>click</c>; empty when the line has no command word.</param>
/// <param name="Target">The command's first argument, usually a selector; empty when there is none.</param>
/// <param name="Rest">The text after the target for <c>fill</c> and <c>select</c>; empty otherwise.</param>
public sealed record ScriptCommand(string Name, string Target, string Rest);

/// <summary>Splits script lines into a command and its arguments. Pure logic, so it can be unit tested.</summary>
public static class Script
{
  /// <summary>
  /// Parses one script line, or returns null for a blank line or a <c>#</c> comment. <c>fill</c> and <c>select</c>
  /// take a target and the rest of the line; every other command takes the rest of the line as its target.
  /// </summary>
  public static ScriptCommand? Parse(string line)
  {
    var trimmed = line.Trim();
    if (trimmed.Length == 0 || trimmed.StartsWith('#'))
    {
      return null;
    }

    var name = Split(trimmed, 2) is [var first, ..] ? first : "";
    IReadOnlyList<string> parts = Split(trimmed, name is "fill" or "select" ? 3 : 2);
    return new ScriptCommand(name, parts.Count > 1 ? parts[1] : "", parts.Count > 2 ? parts[2] : "");
  }

  /// <summary>
  /// Splits <paramref name="line"/> into at most <paramref name="parts"/> parts. The parts before the last are
  /// separated by spaces, and one wrapped in single quotes keeps its spaces; the last part is the raw rest of the
  /// line, so text and JavaScript keep their quotes and spacing.
  /// </summary>
  public static IReadOnlyList<string> Split(string line, int parts)
  {
    var result = new List<string>();
    var current = new StringBuilder();
    var quoted = false;
    var i = 0;
    for (; i < line.Length && result.Count < parts - 1; i++)
    {
      var c = line[i];
      if (c == '\'')
      {
        quoted = !quoted;
      }
      else if (c == ' ' && !quoted)
      {
        Flush();
      }
      else
      {
        current.Append(c);
      }
    }
    if (result.Count < parts - 1)
    {
      Flush();
      return result;
    }

    var last = (current + line[i..]).Trim();
    if (last.Length > 0)
    {
      result.Add(last);
    }
    return result;

    void Flush()
    {
      if (current.Length > 0)
      {
        result.Add(current.ToString());
        current.Clear();
      }
    }
  }
}
