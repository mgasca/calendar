using System.Text.RegularExpressions;

namespace Calendar.Testing;

/// <summary>Locates files that tests share with local development, so the two can't drift (ADR-0016).</summary>
internal static partial class RepoFiles
{
    public static string Find(string relativePath)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, relativePath);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }
        throw new FileNotFoundException($"'{relativePath}' not found in any parent of {AppContext.BaseDirectory}.");
    }

    /// <summary>The postgres image pinned in compose.yaml.</summary>
    public static string PostgresImage()
    {
        var match = ImageRegex().Match(File.ReadAllText(Find("compose.yaml")));
        return match.Success ? match.Groups["image"].Value : throw new InvalidOperationException("No postgres image found in compose.yaml.");
    }

    [GeneratedRegex(@"^\s*image:\s*(?<image>postgres:\S+)\s*$", RegexOptions.Multiline)]
    private static partial Regex ImageRegex();
}
