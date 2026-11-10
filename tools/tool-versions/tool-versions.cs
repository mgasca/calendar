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

IReadOnlyDictionary<string, string> central = VersionChecker.ReadCentralVersions(centralPath);
IReadOnlyList<PinnedPackage> pins = VersionChecker.FindPins(root);
IReadOnlyList<VersionDrift> drifts = VersionChecker.FindDrift(pins, central);

foreach (PinnedPackage pin in pins)
{
  VersionDrift? drift = drifts.FirstOrDefault(d => d.Pin == pin);
  var line = (drift, central.ContainsKey(pin.Package)) switch
  {
    (not null, _) => $"DRIFT {pin.Package} {pin.Version} in {pin.File}; backend has {drift.BackendVersion}",
    (null, true) => $"OK    {pin.Package} {pin.Version} in {pin.File}",
    _ => $"SKIP  {pin.Package} {pin.Version} in {pin.File}; not in backend, bump it manually",
  };
  Console.WriteLine(line);
}

// The repo-root global.json (tools, CI tool jobs) and backend/global.json must pin the same SDK (#645).
var sdkOk = true;
var rootGlobal = Path.Combine(root, "global.json");
var backendGlobal = Path.Combine(root, "backend", "global.json");
if (File.Exists(rootGlobal) && File.Exists(backendGlobal))
{
  SdkPin rootSdk = VersionChecker.ReadSdkPin(rootGlobal);
  SdkPin backendSdk = VersionChecker.ReadSdkPin(backendGlobal);
  sdkOk = rootSdk == backendSdk;
  Console.WriteLine(sdkOk
    ? $"OK    .NET SDK {rootSdk} in global.json and backend/global.json"
    : $"DRIFT .NET SDK {rootSdk} in global.json; backend/global.json has {backendSdk}");
}

if (drifts.Count > 0 && fix)
{
  var changed = VersionChecker.Fix(root, drifts);
  Console.WriteLine($"Updated {changed} pin(s). Run 'just tools test' to refresh packages.lock.json files, then commit.");
}
else if (drifts.Count > 0)
{
  Console.WriteLine($"{drifts.Count} pin(s) drifted from backend/Directory.Packages.props. Fix with: just tools versions --fix");
}

if (!sdkOk)
{
  Console.WriteLine("Set the same sdk block in both global.json files, then refresh the tool lock files (tools/README.md).");
}

return sdkOk && (drifts.Count == 0 || fix) ? 0 : 1;

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
