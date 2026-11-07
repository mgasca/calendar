#!/usr/bin/env -S dotnet run
#:package YamlDotNet@18.1.0
#:include WorkflowYaml.cs
#:include DeliveryGuards.cs

// Mechanism guards for the delivery performance fixes (epic #380, issue #387): deterministic checks over ci.yml, the
// just modules and the backend MSBuild files that fail when a fix's mechanism is reverted. They never measure time.
// The tests (tests/delivery-guards.tests.cs, run by `just tools test`) run every guard against the checkout; this entry
// prints the same report by hand.
//
//   dotnet run tools/delivery-guards/delivery-guards.cs              check the checkout above the current directory
//   dotnet run tools/delivery-guards/delivery-guards.cs -- --root P  check another checkout

using DeliveryGuards;

string? root = null;
var pending = new Queue<string>(args);
while (pending.TryDequeue(out var arg))
{
  if (arg == "--root" && pending.TryDequeue(out var value))
  {
    root = value;
  }
  else
  {
    await Console.Error.WriteLineAsync("usage: delivery-guards.cs [--root <repo root>]");
    return 2;
  }
}

root ??= FindRoot(Environment.CurrentDirectory);
if (root is null)
{
  await Console.Error.WriteLineAsync("No repo root (a directory with .just-version) above the current directory; pass --root.");
  return 2;
}

var failed = 0;
foreach ((Guard guard, IReadOnlyList<string> failures) in Guards.RunAll(RepoFiles.Load(root)))
{
  var record = guard.Record == "none" ? "" : $", record {guard.Record}";
  await Console.Out.WriteLineAsync($"{(failures.Count == 0 ? "ok  " : "FAIL")} {guard.Id} ({guard.Fix}{record}): {guard.Mechanism}");
  foreach (var failure in failures)
  {
    await Console.Out.WriteLineAsync($"       {failure}");
  }

  failed += failures.Count == 0 ? 0 : 1;
}

return failed == 0 ? 0 : 1;

static string? FindRoot(string start)
{
  for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
  {
    if (File.Exists(Path.Combine(dir.FullName, ".just-version")))
    {
      return dir.FullName;
    }
  }

  return null;
}
