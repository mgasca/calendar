#!/usr/bin/env -S dotnet run
#:include ToolVersions.cs

// Fails when a package version pinned by repo tooling drifts from backend/Directory.Packages.props.
// Dependabot updates the backend but can't see tooling pins (ADR-0017), so this keeps them in step.
//
//   dotnet run tools/tool-versions/tool-versions.cs              report; exit 1 on drift
//   dotnet run tools/tool-versions/tool-versions.cs -- --fix     rewrite drifted pins to the backend versions
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
var centralPath = Path.Combine(root, "backend", "Directory.Packages.props");
if (!File.Exists(centralPath))
{
    await Console.Error.WriteLineAsync($"not found: {centralPath}");
    return 2;
}

var central = VersionChecker.ReadCentralVersions(centralPath);
var pins = VersionChecker.FindPins(root);
var drifts = VersionChecker.FindDrift(pins, central);

foreach (var pin in pins)
{
    var drift = drifts.FirstOrDefault(d => d.Pin == pin);
    var line = (drift, central.ContainsKey(pin.Package)) switch
    {
        (not null, _) => $"DRIFT {pin.Package} {pin.Version} in {pin.File}; backend has {drift.BackendVersion}",
        (null, true) => $"OK    {pin.Package} {pin.Version} in {pin.File}",
        _ => $"SKIP  {pin.Package} {pin.Version} in {pin.File}; not in backend, bump it manually",
    };
    Console.WriteLine(line);
}

if (drifts.Count == 0)
{
    return 0;
}

if (fix)
{
    var changed = VersionChecker.Fix(root, drifts);
    Console.WriteLine($"Updated {changed} pin(s). Run 'make tooling' to refresh packages.lock.json files, then commit.");
    return 0;
}

Console.WriteLine($"{drifts.Count} pin(s) drifted from backend/Directory.Packages.props. Fix with: make tool-versions ARGS=--fix");
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
