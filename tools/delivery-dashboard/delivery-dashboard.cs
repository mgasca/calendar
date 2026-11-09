#!/usr/bin/env -S dotnet run
#:include ../ci-timings/CiTimings.cs
#:include ../ci-timings/Baseline.cs
#:include ../ci-timings/Trend.cs
#:include Snapshot.cs
#:include SnapshotRules.cs
#:include QualitySection.cs
#:include QualityRules.cs
#:include AgentSection.cs
#:include AgentRules.cs
#:include FlowSection.cs
#:include FlowRules.cs
#:include Alerts.cs

// The snapshot tool of the delivery dashboard (story 0053, ADR-0049, issue #596). It writes one JSON snapshot of
// delivery data (aggregates and public data only) and checks snapshot files against the schema and the privacy rules.
// Needs the GitHub CLI signed in (gh auth status) for `snapshot`.
//
//   dotnet run tools/delivery-dashboard/delivery-dashboard.cs -- snapshot [--repo OWNER/NAME] [--workflow ci.yml]
//                                                                  [--runs 30] [--quality-runs 100] [--date YYYY-MM-DD] [--out FILE]
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

if (args[0] == "alerts")
{
  return await AlertCommand(args[1..]);
}

if (args[0] == "retention")
{
  return await RetentionCommand(args[1..]);
}

if (args[0] != "snapshot")
{
  return await Usage($"unknown command: {args[0]}");
}

var workflow = "ci.yml";
var baselinePath = ".github/ci-baseline.json";
var runCount = 30;
var qualityRuns = 100;
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
    case "--quality-runs" when pending.Count > 0
      && int.TryParse(pending.Dequeue(), NumberStyles.None, CultureInfo.InvariantCulture, out var sample):
      qualityRuns = sample;
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
Dictionary<long, string> fetchedJobs = [];
List<double> queue = [];
IEnumerable<WorkflowRun> wanted = Parser.ParseRuns(listJson)
  .Where(item => BaselineRuns.IsSuccessful(item) && BaselineRuns.IsMain(item))
  .Take(runCount);
foreach (WorkflowRun run in wanted)
{
  var jobsJson = await Gh.RunAsync(["api", $"repos/{repository}/actions/runs/{run.Id}/jobs?per_page=50"]);
  fetchedJobs[run.Id] = jobsJson;
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
  QualityCollector.Build(workflow, await QualityCollector.CollectAsync(repository, workflow, qualityRuns, fetchedJobs)),
  await FlowCollector.CollectAsync(repository, taken),
  AgentCollector.Build(await AgentCollector.CollectAsync(repository, AgentCollector.DefaultIssues)));
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
  await Console.Out.WriteLineAsync(
    $"quality: {snapshot.Quality?.Sample.Runs} runs in scope, {snapshot.Quality?.Sample.IgnoredRuns} ignored");
  await Console.Out.WriteLineAsync(
    $"agents: {snapshot.Agents?.Sample.Scanned} issues scanned, {snapshot.Agents?.Activity.Issues} listed, "
    + $"{snapshot.Agents?.Activity.WithCounts} with count comments");
}
return 0;

// alerts --snapshot FILE [--repo OWNER/NAME] [--page-url URL] [--issue]: prints the breached thresholds; with --issue, comments on
// the one open `performance` issue of each kind or opens it, and posts nothing else (ADR-0049: no new alert channel).
static async Task<int> AlertCommand(string[] arguments)
{
  string? file = null;
  string? repository = null;
  var pageUrl = string.Empty;
  var post = false;
  var queue = new Queue<string>(arguments);
  while (queue.TryDequeue(out var arg))
  {
    switch (arg)
    {
      case "--snapshot" when queue.Count > 0:
        file = queue.Dequeue();
        break;
      case "--repo" when queue.Count > 0:
        repository = queue.Dequeue();
        break;
      case "--page-url" when queue.Count > 0:
        pageUrl = queue.Dequeue();
        break;
      case "--issue":
        post = true;
        break;
      default:
        return await Usage($"unknown or incomplete argument: {arg}");
    }
  }
  if (file is null)
  {
    return await Usage("alerts needs --snapshot FILE");
  }
  var json = await File.ReadAllTextAsync(file);
  IReadOnlyList<string> problems = SnapshotRules.Validate(json);
  if (problems.Count > 0)
  {
    foreach (var problem in problems)
    {
      await Console.Error.WriteLineAsync(problem);
    }
    await Console.Error.WriteLineAsync("the snapshot does not pass the rules; no alert is evaluated");
    return 1;
  }
  IReadOnlyList<Breach> breaches = Alerts.Evaluate(json, AlertThresholds.Default);
  var report = breaches.Count == 0
    ? "No threshold is breached."
    : string.Join('\n', breaches.Select(breach => $"- [{breach.Kind}] {breach.Text}"));
  await Console.Out.WriteLineAsync(report);
  if (!post || breaches.Count == 0)
  {
    return 0;
  }
  repository ??= (await Gh.RunAsync(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).Trim();
  var openJson = await Gh.RunAsync(
    ["issue", "list", "--repo", repository, "--state", "open", "--label", Alerts.IssueLabel, "--limit", "100", "--json", "number,title"]);
  foreach (AlertAction action in Alerts.Actions(breaches, Parser.ParseIssues(openJson), pageUrl))
  {
    var bodyPath = Path.Combine(Path.GetTempPath(), $"dashboard-alert-{Environment.ProcessId}-{action.Kind}.md");
    await File.WriteAllTextAsync(bodyPath, action.Body);
    string[] command = action.Issue == 0
      ? ["issue", "create", "--repo", repository, "--title", action.Title, "--label", Alerts.IssueLabel, "--body-file", bodyPath]
      : ["issue", "comment", action.Issue.ToString(CultureInfo.InvariantCulture), "--repo", repository, "--body-file", bodyPath];
    await Console.Out.WriteLineAsync((await Gh.RunAsync(command)).Trim());
    File.Delete(bodyPath);
  }
  return 0;
}

// retention [--limit-mb 50] [--add BYTES] < `git ls-tree -r -l REF snapshots` or the GitHub trees API answer
// (`gh api repos/OWNER/NAME/git/trees/BRANCH?recursive=1`): fails when the data branch would pass its limit.
static async Task<int> RetentionCommand(string[] arguments)
{
  var limit = Retention.LimitBytes;
  long incoming = 0;
  var queue = new Queue<string>(arguments);
  while (queue.TryDequeue(out var arg))
  {
    switch (arg)
    {
      case "--limit-mb" when queue.Count > 0
        && long.TryParse(queue.Dequeue(), NumberStyles.None, CultureInfo.InvariantCulture, out var megabytes):
        limit = megabytes * 1024 * 1024;
        break;
      case "--add" when queue.Count > 0
        && long.TryParse(queue.Dequeue(), NumberStyles.None, CultureInfo.InvariantCulture, out var bytes):
        incoming = bytes;
        break;
      default:
        return await Usage($"unknown or incomplete argument: {arg}");
    }
  }
  Retention.Verdict verdict = Retention.Check(await Console.In.ReadToEndAsync(), limit, incoming);
  await Console.Out.WriteLineAsync(verdict.Message);
  if (verdict.Status == "warning")
  {
    await Console.Out.WriteLineAsync($"::warning::{verdict.Message}");
  }
  return verdict.Status == "over" ? 1 : 0;
}

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
    "usage: delivery-dashboard snapshot [--repo OWNER/NAME] [--workflow FILE] [--runs N] [--quality-runs N]"
    + " [--date YYYY-MM-DD] [--out FILE]"
    + " | delivery-dashboard check FILE...");
  return 2;
}
