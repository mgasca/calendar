using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace ToolVersions;

/// <summary>A package version pinned by repo tooling, and where it is pinned.</summary>
public sealed record PinnedPackage(string Package, string Version, string File);

/// <summary>A pin whose version is behind the newest version another tooling file pins for the same package.</summary>
public sealed record VersionDrift(PinnedPackage Pin, string ExpectedVersion);

/// <summary>
/// Keeps the package versions pinned by repo tooling (ADR-0017) equal across the tools. Dependabot can't see tooling
/// pins (#:package directives, folder-local Directory.Build.props), so they are bumped by hand, and a package bumped in
/// one tool but not in another is the drift this finds. The newest version pinned anywhere is the reference. (Until
/// the backend moved to Rust, the reference was its Directory.Packages.props, which Dependabot did update.)
/// </summary>
public static partial class VersionChecker
{
  /// <summary>Folders, relative to the repo root, that hold tooling.</summary>
  public static readonly string[] ToolingDirectories = [".claude/skills", "tools"];

  private static readonly string[] SkippedSegments = ["bin", "obj", "fixtures", "node_modules"];

  private static readonly char[] PathSeparators = [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar];

  /// <summary>Finds pins in #:package directives (*.cs) and PackageReference Version attributes (Directory.Build.props).</summary>
  public static IReadOnlyList<PinnedPackage> FindPins(string root)
  {
    var pins = new List<PinnedPackage>();
    foreach (var dir in ToolingDirectories.Select(d => Path.Combine(root, d)).Where(Directory.Exists))
    {
      IEnumerable<string> files = Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
        .Where(f => !IsSkipped(root, f))
        .Order(StringComparer.Ordinal);
      foreach (var file in files)
      {
        var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
        if (file.EndsWith(".cs", StringComparison.Ordinal))
        {
          pins.AddRange(PackageDirectiveRegex().Matches(File.ReadAllText(file))
              .Select(m => new PinnedPackage(m.Groups["name"].Value, m.Groups["version"].Value, relative)));
        }
        else if (Path.GetFileName(file) == "Directory.Build.props")
        {
          pins.AddRange(XDocument.Load(file).Descendants("PackageReference")
              .Where(e => e.Attribute("Include") is not null && e.Attribute("Version") is not null)
              .Select(e => new PinnedPackage(e.Attribute("Include")!.Value, e.Attribute("Version")!.Value, relative)));
        }
      }
    }
    return pins;
  }

  /// <summary>The newest version pinned for each package (ids compare case-insensitively, like NuGet ids).</summary>
  public static IReadOnlyDictionary<string, string> NewestVersions(IEnumerable<PinnedPackage> pins) =>
      pins.GroupBy(p => p.Package, StringComparer.OrdinalIgnoreCase)
          .ToDictionary(g => g.Key, g => g.Select(p => p.Version).Max(VersionOrder.Instance)!, StringComparer.OrdinalIgnoreCase);

  /// <summary>Pins whose package another tooling file pins at a newer version.</summary>
  public static IReadOnlyList<VersionDrift> FindDrift(IReadOnlyCollection<PinnedPackage> pins)
  {
    IReadOnlyDictionary<string, string> newest = NewestVersions(pins);
    return [.. pins.Where(p => newest[p.Package] != p.Version).Select(p => new VersionDrift(p, newest[p.Package]))];
  }

  /// <summary>Rewrites each drifted pin to the expected version. Returns the number of pins changed.</summary>
  public static int Fix(string root, IEnumerable<VersionDrift> drifts)
  {
    var changed = 0;
    foreach (IGrouping<string, VersionDrift> group in drifts.GroupBy(d => d.Pin.File, StringComparer.Ordinal))
    {
      var path = Path.Combine(root, group.Key);
      var text = File.ReadAllText(path);
      foreach (VersionDrift? drift in group)
      {
        var name = Regex.Escape(drift.Pin.Package);
        var oldVersion = Regex.Escape(drift.Pin.Version);
        var pattern = path.EndsWith(".cs", StringComparison.Ordinal)
            ? $@"(?m)^(#:package\s+{name}@){oldVersion}(?=\s|$)"
            : $@"(<PackageReference\s+Include=""{name}""\s+Version=""){oldVersion}("")";
        var updated = Regex.Replace(
          text,
          pattern,
          m => m.Groups[1].Value + drift.ExpectedVersion + (m.Groups.Count > 2 ? m.Groups[2].Value : ""),
          RegexOptions.IgnoreCase,
          TimeSpan.FromSeconds(1));
        if (updated != text)
        {
          changed++;
          text = updated;
        }
      }
      File.WriteAllText(path, text);
    }
    return changed;
  }

  private static bool IsSkipped(string root, string file) =>
      Path.GetRelativePath(root, file).Split(PathSeparators)
          .Any(segment => SkippedSegments.Contains(segment, StringComparer.Ordinal));

  [GeneratedRegex(@"^#:package\s+(?<name>[^@\s]+)@(?<version>\S+)", RegexOptions.Multiline, 1000)]
  private static partial Regex PackageDirectiveRegex();
}

/// <summary>
/// Orders package versions: the dotted numeric parts compare as numbers, a release sorts after its prereleases, and
/// anything else falls back to ordinal text order.
/// </summary>
public sealed class VersionOrder : IComparer<string>
{
  /// <summary>The one instance.</summary>
  public static readonly VersionOrder Instance = new();

  /// <inheritdoc />
  public int Compare(string? x, string? y)
  {
    if (x is null || y is null)
    {
      return (x is null ? 0 : 1) - (y is null ? 0 : 1);
    }

    (var xNumbers, var xLabel) = Split(x);
    (var yNumbers, var yLabel) = Split(y);
    for (var i = 0; i < Math.Max(xNumbers.Length, yNumbers.Length); i++)
    {
      var difference = Part(xNumbers, i).CompareTo(Part(yNumbers, i));
      if (difference != 0)
      {
        return difference;
      }
    }

    if (xLabel.Length == 0 || yLabel.Length == 0)
    {
      return (xLabel.Length == 0 ? 1 : 0) - (yLabel.Length == 0 ? 1 : 0);
    }

    return string.CompareOrdinal(xLabel, yLabel);
  }

  private static long Part(long[] numbers, int index) => index < numbers.Length ? numbers[index] : 0;

  private static (long[] Numbers, string Label) Split(string version)
  {
    var parts = version.Split('-', 2);
    var numbers = new List<long>();
    foreach (var text in parts[0].Split('.'))
    {
      if (!long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var number))
      {
        return ([], version);
      }

      numbers.Add(number);
    }

    return ([.. numbers], parts.Length > 1 ? parts[1] : "");
  }
}
