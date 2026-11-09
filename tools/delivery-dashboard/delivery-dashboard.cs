#!/usr/bin/env -S dotnet run
#:include ../ci-timings/CiTimings.cs
#:include ../ci-timings/Baseline.cs
#:include ../ci-timings/Trend.cs
#:include Snapshot.cs
#:include SnapshotRules.cs
#:include FlowSection.cs
#:include FlowRules.cs

// The snapshot tool of the delivery dashboard (story 0053, ADR-0049, issue #596). It writes one JSON snapshot of
// delivery data (aggregates and public data only) and checks snapshot files against the schema and the privacy rules.
// Needs the GitHub CLI signed in (gh auth status) for `snapshot`.
//
//   dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- snapshot [--repo OWNER/NAME] [--workflow ci.yml]
//                                                                  [--runs 30] [--date YYYY-MM-DD] [--out FILE]
//                                                                  [--baseline .github/ci-baseline.json]
//       samples the newest successful push runs of the workflow on main, writes the snapshot to --out (standard
//       output without it) and fails, writing nothing, when the snapshot does not pass the rules
//   dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- check FILE...
//       validates snapshot files; exit code 1 when any file has a problem

using System.Globalization;
using CiTimings;
using DeliveryDashboard;

if (args.Length == 0)
{
  return await Usage("a command is needed");
}

if (args[0] == "check")
{
  return await Check(args[1..]);
}

if (args[0] != "snapshot")
{
  return await Usage($"unknown command: {args[0]}");
}

var workflow = "ci.yml";
var baselinePath = ".github/ci-baseline.json";
var runCount = 30;
string? repo = null;
string? output = null;
DateOnly? date = null;
var pending = new Queue<string>(args[1..]);
while (pending.TryDequeue(out var arg))
{
  switch (arg)
  {
    case "--workflow" when pending.Count > 0:
      workflow = pending.Dequeue();
      break;
    case "--baseline" when pending.Count > 0:
      baselinePath = pending.Dequeue();
      break;
    case "--repo" when pending.Count > 0:
      repo = pending.Dequeue();
      break;
    case "--out" when pending.Count > 0:
      output = pending.Dequeue();
      break;
    case "--runs" when pending.Count > 0 && int.TryParse(pending.Dequeue(), NumberStyles.None, CultureInfo.InvariantCulture, out var count):
      runCount = count;
      break;
    case "--date" when pending.Count > 0
      && DateOnly.TryParseExact(
        pending.Dequeue(), SnapshotJson.DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly day):
      date = day;
      break;
    default:
      return await Usage($"unknown or incomplete argument: {arg}");
  }
}

var repository = repo ?? (await Gh.RunAsync(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).Trim();
var listJson = await Gh.RunAsync(
[
  "run", "list", "--workflow", workflow, "--branch", "main", "--event", "push", "--status", "success", "--repo", repository,
  "--limit", Math.Max(runCount * 2, 20).ToString(CultureInfo.InvariantCulture),
  "--json", "databaseId,status,conclusion,createdAt,event,headBranch,headSha",
]);
List<SampledRun> sampled = [];
List<double> queue = [];
IEnumerable<WorkflowRun> wanted = Parser.ParseRuns(listJson)
  .Where(item => BaselineRuns.IsSuccessful(item) && BaselineRuns.IsMain(item))
  .Take(runCount);
foreach (WorkflowRun run in wanted)
{
  var jobsJson = await Gh.RunAsync(["api", $"repos/{repository}/actions/runs/{run.Id}/jobs?per_page=50"]);
  IReadOnlyList<JobTiming> jobs = Parser.ParseJobs(run.Id, jobsJson);
  sampled.Add(new SampledRun(run, [.. Baselines.Samples(run, jobs)]));
  if (CiSnapshot.QueueSeconds(run, jobs) is { } wait)
  {
    queue.Add(wait);
  }
}

// The pinned baseline of ADR-0045; without the file (another checkout) the snapshot has no baseline or trend.
BaselineFile? pinned = File.Exists(baselinePath) ? BaselineIo.Read(await File.ReadAllTextAsync(baselinePath)) : null;

DateTimeOffset now = DateTimeOffset.UtcNow;
var taken = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, now.Minute, now.Second, TimeSpan.Zero);
var snapshot = new Snapshot(
  SnapshotJson.CurrentVersion,
  date ?? DateOnly.FromDateTime(now.UtcDateTime),
  taken,
  repository,
  CiSnapshot.Build(workflow, sampled, pinned, TrendConstants.Default, queue),
  await FlowCollector.CollectAsync(repository, taken));
var json = SnapshotJson.Write(snapshot);
IReadOnlyList<string> problems = SnapshotRules.Validate(json);
if (problems.Count > 0)
{
  foreach (var problem in problems)
  {
    await Console.Error.WriteLineAsync(problem);
  }
  await Console.Error.WriteLineAsync("the snapshot does not pass the rules; nothing was written");
  return 1;
}

if (output is null)
{
  await Console.Out.WriteAsync(json);
}
else
{
  await File.WriteAllTextAsync(output, json);
  await Console.Out.WriteLineAsync($"wrote {output}: {sampled.Count} runs of {workflow}, {snapshot.Ci.Jobs.Count} job and path rows");
}
return 0;

static async Task<int> Check(string[] files)
{
  if (files.Length == 0)
  {
    return await Usage("check needs at least one file");
  }
  var failed = false;
  foreach (var file in files)
  {
    IReadOnlyList<string> problems = SnapshotRules.Validate(await File.ReadAllTextAsync(file));
    await Console.Out.WriteLineAsync($"{(problems.Count == 0 ? "OK  " : "FAIL")} {file}");
    foreach (var problem in problems)
    {
      await Console.Out.WriteLineAsync($"  {problem}");
    }
    failed |= problems.Count > 0;
  }
  return failed ? 1 : 0;
}

static async Task<int> Usage(string message)
{
  await Console.Error.WriteLineAsync(message);
  await Console.Error.WriteLineAsync(
    "usage: delivery-dashboard snapshot [--repo OWNER/NAME] [--workflow FILE] [--runs N] [--date YYYY-MM-DD] [--out FILE]"
    + " | delivery-dashboard check FILE...");
  return 2;
}
