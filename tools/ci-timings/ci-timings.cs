#!/usr/bin/env -S dotnet run
#:include CiTimings.cs

// Samples how long a GitHub Actions workflow's jobs and steps take, from the runs GitHub keeps, and prints Markdown
// tables for a benchmark record (docs/benchmarks/README.md). Only completed, successful runs count, so cancelled and
// failed runs don't skew the sample. Needs the GitHub CLI signed in (gh auth status).
//
//   dotnet run tools/ci-timings/ci-timings.cs                              last 40 successful runs of ci.yml, per-job table
//   dotnet run tools/ci-timings/ci-timings.cs -- --job Frontend            also the step table of that job (repeatable)
//   dotnet run tools/ci-timings/ci-timings.cs -- --runs 20 --workflow x.yml --repo owner/name

using System.Globalization;
using CiTimings;

var workflow = "ci.yml";
var runs = 40;
string? repo = null;
List<string> jobNames = [];
var pending = new Queue<string>(args);
while (pending.TryDequeue(out var arg))
{
  switch (arg)
  {
    case "--workflow" when pending.Count > 0:
      workflow = pending.Dequeue();
      break;
    case "--runs" when pending.Count > 0 && int.TryParse(pending.Dequeue(), NumberStyles.None, CultureInfo.InvariantCulture, out var count):
      runs = count;
      break;
    case "--repo" when pending.Count > 0:
      repo = pending.Dequeue();
      break;
    case "--job" when pending.Count > 0:
      jobNames.Add(pending.Dequeue());
      break;
    default:
      await Console.Error.WriteLineAsync($"unknown argument: {arg}");
      await Console.Error.WriteLineAsync("usage: ci-timings [--workflow FILE] [--runs N] [--repo OWNER/NAME] [--job NAME]...");
      return 2;
  }
}

List<string> repoArguments = repo is null ? [] : ["--repo", repo];
var listJson = await Gh.RunAsync(
[
  "run", "list", "--workflow", workflow, "--limit", (runs * 2).ToString(CultureInfo.InvariantCulture),
  "--json", "databaseId,status,conclusion,createdAt,event", .. repoArguments,
]);
List<WorkflowRun> sample =
[
  .. Parser.ParseRuns(listJson)
    .Where(run => string.Equals(run.Status, "completed", StringComparison.Ordinal))
    .Where(run => string.Equals(run.Conclusion, "success", StringComparison.Ordinal))
    .Take(runs),
];
if (sample.Count == 0)
{
  await Console.Error.WriteLineAsync($"no successful runs of {workflow} in the last {runs * 2} runs");
  return 1;
}

repo ??= (await Gh.RunAsync(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).Trim();
List<JobTiming> jobs = [];
foreach (var runId in sample.Select(run => run.Id))
{
  var jobsJson = await Gh.RunAsync(["api", $"repos/{repo}/actions/runs/{runId}/jobs?per_page=50"]);
  jobs.AddRange(Parser.ParseJobs(runId, jobsJson));
}

IEnumerable<string> events = sample.Select(run => run.Event).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
var report = new System.Text.StringBuilder();
report.Append(CultureInfo.InvariantCulture, $"Sample: {sample.Count} successful runs of `{workflow}` in {repo}, ")
  .Append(CultureInfo.InvariantCulture, $"{sample[^1].CreatedAt:yyyy-MM-dd HH:mm}Z to {sample[0].CreatedAt:yyyy-MM-dd HH:mm}Z ")
  .Append(CultureInfo.InvariantCulture, $"(events: {string.Join(", ", events)}).")
  .AppendLine().AppendLine();
report.Append(Report.JobsTable(jobs));
foreach (var jobName in jobNames)
{
  report.AppendLine().Append(CultureInfo.InvariantCulture, $"Steps of `{jobName}`:").AppendLine().AppendLine();
  report.Append(Report.StepsTable(jobs, jobName));
}
await Console.Out.WriteAsync(report.ToString());
return 0;
