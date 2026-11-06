#!/usr/bin/env -S dotnet run
#:include HandoverWatch.cs

// Prints the comments and reviews that are new since the last run on an issue and its delivery PRs (open, closed and
// merged), plus each PR's state when it changes, and records what it printed in .plan/handover-watch/<issue>.seen so the
// next run prints only what came after. A delivery PR is one that cross-references the issue with Closes, Fixes,
// Resolves or Refs in its body. One GraphQL query per run, plus one per round of follow-up pages for a list longer than a
// page. Needs the GitHub CLI signed in (gh auth status). See tools/README.md, "handover-watch".
//
//   dotnet run tools/handover-watch/handover-watch.cs -- 320            new items on #320 and its delivery PRs
//   dotnet run tools/handover-watch/handover-watch.cs -- 320 --pr 361   also watch PR #361 (repeatable)
//   dotnet run tools/handover-watch/handover-watch.cs -- 320 --peek     print without recording anything as seen

using System.Text.Json;
using HandoverWatch;

if (Options.Parse(args) is not { } options)
{
  await Console.Error.WriteLineAsync(Options.Usage);
  return 2;
}

// The record lives in the checkout that holds this file, whatever the working directory.
var root = AppContext.GetData("EntryPointFileDirectoryPath") is string toolDirectory
  ? Path.GetFullPath(Path.Combine(toolDirectory, "..", ".."))
  : Directory.GetCurrentDirectory();

try
{
  Snapshot snapshot = await Fetch.RunAsync(options, request => Gh.GraphQlAsync(root, request));
  IReadOnlyList<PullRequest> pullRequests = snapshot.PullRequests;
  List<WatchItem> items = [.. snapshot.Items, .. Watch.StateItems(pullRequests)];

  var recordPath = SeenRecord.PathFor(root, options.Issue);
  HashSet<string> seen = SeenRecord.Parse(File.Exists(recordPath) ? await File.ReadAllTextAsync(recordPath) : string.Empty);
  IReadOnlyList<WatchItem> fresh = Watch.NewItems(items, seen);
  await Console.Out.WriteAsync(Report.Render(options.Issue, pullRequests, fresh));
  await Console.Out.FlushAsync();

  // Recorded only after printing, so a failed run prints again rather than loses an item.
  if (!options.Peek && fresh.Count > 0)
  {
    Directory.CreateDirectory(Path.GetDirectoryName(recordPath)!);
    await File.AppendAllTextAsync(recordPath, SeenRecord.Lines(fresh));
  }
  return 0;
}
catch (Exception error) when (error is InvalidOperationException or JsonException or KeyNotFoundException)
{
  await Console.Error.WriteLineAsync($"handover-watch: {error.Message}");
  return 1;
}
