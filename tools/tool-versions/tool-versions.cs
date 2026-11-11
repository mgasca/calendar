#!/usr/bin/env -S dotnet run
#:include ToolVersions.cs

// Fails when repo tooling pins one package at different versions. Dependabot can't see tooling pins (ADR-0017), so
// they are bumped by hand; this keeps a bump in one tool from leaving the others behind.
//
//   dotnet run tools/tool-versions/tool-versions.cs              report; exit 1 on drift
//   dotnet run tools/tool-versions/tool-versions.cs -- --fix     rewrite drifted pins to the newest pinned version
//   dotnet run tools/tool-versions/tool-versions.cs -- --root P  use another repo root

using ToolVersions;

var fix = false;
string? root = null;
var pending = new Queue<string>(args);
while (pending.TryDequeue(out var arg))
{
  switch (arg)
  {
    case "--fix":
      fix = true;
      break;
    case "--root" when pending.Count > 0:
      root = Path.GetFullPath(pending.Dequeue());
      break;
    default:
      await Console.Error.WriteLineAsync($"unknown argument: {arg}\nusage: tool-versions [--fix] [--root PATH]");
      return 2;
  }
}

root ??= RepoRoot();
IReadOnlyList<PinnedPackage> pins = VersionChecker.FindPins(root);
IReadOnlyList<VersionDrift> drifts = VersionChecker.FindDrift(pins);

foreach (PinnedPackage pin in pins)
{
  VersionDrift? drift = drifts.FirstOrDefault(d => d.Pin == pin);
  Console.WriteLine(drift is null
    ? $"OK    {pin.Package} {pin.Version} in {pin.File}"
    : $"DRIFT {pin.Package} {pin.Version} in {pin.File}; another tool pins {drift.ExpectedVersion}");
}

if (drifts.Count == 0)
{
  return 0;
}

if (fix)
{
  var changed = VersionChecker.Fix(root, drifts);
  Console.WriteLine($"Updated {changed} pin(s). Run 'just tools test' to refresh packages.lock.json files, then commit.");
  return 0;
}

Console.WriteLine($"{drifts.Count} pin(s) are behind the newest version pinned by another tool. Fix with: just tools versions --fix");
return 1;

// The nearest ancestor of the working directory containing .git (a directory, or a file in worktrees).
static string RepoRoot()
{
  for (var current = new DirectoryInfo(Directory.GetCurrentDirectory()); current is not null; current = current.Parent)
  {
    if (Path.Exists(Path.Combine(current.FullName, ".git")))
    {
      return current.FullName;
    }
  }
  return Directory.GetCurrentDirectory();
}
