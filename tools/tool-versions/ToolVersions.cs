using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace ToolVersions;

/// <summary>A package version pinned by repo tooling, and where it is pinned.</summary>
public sealed record PinnedPackage(string Package, string Version, string File);

/// <summary>A pin whose version differs from the backend's central version.</summary>
public sealed record VersionDrift(PinnedPackage Pin, string BackendVersion);

/// <summary>
/// Keeps package versions pinned by repo tooling (ADR-0017) in step with backend/Directory.Packages.props.
/// Dependabot can't see tooling pins (#:package directives, folder-local Directory.Build.props), but it
/// does update the backend, so the backend's versions are the reference.
/// </summary>
public static partial class VersionChecker
{
  /// <summary>Folders, relative to the repo root, that hold tooling.</summary>
  public static readonly string[] ToolingDirectories = [".claude/skills", "tools"];

  private static readonly string[] SkippedSegments = ["bin", "obj", "fixtures", "node_modules"];

  private static readonly char[] PathSeparators = [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar];

  /// <summary>Reads PackageVersion Include/Version pairs from a Central Package Management props file.</summary>
  public static IReadOnlyDictionary<string, string> ReadCentralVersions(string propsPath)
  {
    var doc = XDocument.Load(propsPath);
    return doc.Descendants("PackageVersion")
        .Where(e => e.Attribute("Include") is not null && e.Attribute("Version") is not null)
        .ToDictionary(e => e.Attribute("Include")!.Value, e => e.Attribute("Version")!.Value, StringComparer.OrdinalIgnoreCase);
  }

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

  /// <summary>Pins whose package the backend also uses, at a different version.</summary>
  public static IReadOnlyList<VersionDrift> FindDrift(IEnumerable<PinnedPackage> pins, IReadOnlyDictionary<string, string> central) =>
      [.. pins
            .Where(p => central.TryGetValue(p.Package, out var v) && v != p.Version)
            .Select(p => new VersionDrift(p, central[p.Package]))];

  /// <summary>Rewrites each drifted pin to the backend version. Returns the number of pins changed.</summary>
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
          m => m.Groups[1].Value + drift.BackendVersion + (m.Groups.Count > 2 ? m.Groups[2].Value : ""),
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
