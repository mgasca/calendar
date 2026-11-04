namespace AgentHooks;

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
