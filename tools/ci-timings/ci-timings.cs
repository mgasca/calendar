#!/usr/bin/env -S dotnet run
#:include CiTimings.cs

// Samples how long a GitHub Actions workflow's jobs and steps take, from the runs GitHub keeps, and prints Markdown
// tables for a benchmark record (docs/benchmarks/README.md). Only completed, successful runs count, so cancelled and
// failed runs don't skew the sample. Needs the GitHub CLI signed in (gh auth status).
//
//   dotnet run tools/ci-timings/ci-timings.cs                              last 40 successful runs of ci.yml, per-job table
//   dotnet run tools/ci-timings/ci-timings.cs -- --job Frontend            also the step table of that job (repeatable)
//   dotnet run tools/ci-timings/ci-timings.cs -- --runs 20 --workflow x.yml --repo owner/name
//   dotnet run tools/ci-timings/ci-timings.cs -- --branch my-branch          only runs whose head is that branch (a PR branch)
//   dotnet run tools/ci-timings/ci-timings.cs -- --created "<2026-11-06T16:15Z"  only runs created in that range (gh run list --created)
//   dotnet run tools/ci-timings/ci-timings.cs -- --superseded                pull request runs cancelled by a newer push: how
//                                                                            long the newer run waited, and where the wait went
//                                                                            (up to --runs pairs from the last 5 × --runs runs)

using System.Globalization;
using CiTimings;

var workflow = "ci.yml";
var runs = 40;
string? repo = null;
string? branch = null;
string? created = null;
var superseded = false;
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
    case "--branch" when pending.Count > 0:
      branch = pending.Dequeue();
      break;
    case "--created" when pending.Count > 0:
      created = pending.Dequeue();
      break;
    case "--job" when pending.Count > 0:
      jobNames.Add(pending.Dequeue());
      break;
    case "--superseded":
      superseded = true;
      break;
    default:
      await Console.Error.WriteLineAsync($"unknown argument: {arg}");
      await Console.Error.WriteLineAsync(
        "usage: ci-timings [--workflow FILE] [--runs N] [--repo OWNER/NAME] [--branch NAME] [--created RANGE] [--job NAME]... "
        + "[--superseded]");
      return 2;
  }
}

List<string> repoArguments = repo is null ? [] : ["--repo", repo];
List<string> branchArguments = branch is null ? [] : ["--branch", branch];
List<string> createdArguments = created is null ? [] : ["--created", created];
var listJson = await Gh.RunAsync(
[
  "run", "list", "--workflow", workflow, "--limit", (runs * (superseded ? 5 : 2)).ToString(CultureInfo.InvariantCulture),
  "--json", "databaseId,status,conclusion,createdAt,event,headBranch",
  .. repoArguments,
  .. branchArguments,
  .. createdArguments,
]);
IReadOnlyList<WorkflowRun> listed = Parser.ParseRuns(listJson);
repo ??= (await Gh.RunAsync(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).Trim();
var scope = (branch is null ? "" : $" on branch `{branch}`") + (created is null ? "" : $" created {created}");
var jobsByRun = new Dictionary<long, IReadOnlyList<JobTiming>>();

async Task<IReadOnlyList<JobTiming>> JobsOf(long runId)
{
  if (!jobsByRun.TryGetValue(runId, out IReadOnlyList<JobTiming>? jobsOfRun))
  {
    jobsOfRun = Parser.ParseJobs(runId, await Gh.RunAsync(["api", $"repos/{repo}/actions/runs/{runId}/jobs?per_page=50"]));
    jobsByRun[runId] = jobsOfRun;
  }
  return jobsOfRun;
}

var report = new System.Text.StringBuilder();
if (superseded)
{
  List<SupersededPair> pairs = [];
  foreach ((WorkflowRun cancelled, WorkflowRun superseding) in Supersession.Pair(listed))
  {
    if (pairs.Count == runs)
    {
      break;
    }
    SupersededPair? pair = Supersession.Measure(cancelled, superseding, await JobsOf(cancelled.Id), await JobsOf(superseding.Id));
    if (pair is not null)
    {
      pairs.Add(pair);
    }
  }
  if (pairs.Count == 0)
  {
    await Console.Error.WriteLineAsync($"no superseded pull request runs of {workflow} in the last {runs * 5} runs{scope}");
    return 1;
  }
  HashSet<long> supersedingIds = [.. pairs.Select(pair => pair.SupersedingRunId)];
  List<double> controlFirstJob = [];
  List<double> controlAllStarted = [];
  IEnumerable<WorkflowRun> control = listed
    .Where(run => string.Equals(run.Event, "pull_request", StringComparison.Ordinal))
    .Where(run => string.Equals(run.Conclusion, "success", StringComparison.Ordinal) && !supersedingIds.Contains(run.Id))
    .Take(runs);
  foreach (WorkflowRun run in control)
  {
    IReadOnlyList<JobTiming> jobsOfRun = await JobsOf(run.Id);
    if (jobsOfRun.Count > 0)
    {
      controlFirstJob.Add((jobsOfRun.Min(job => job.StartedAt) - run.CreatedAt).TotalSeconds);
    }
    if (Supersession.FirstJobsStarted(jobsOfRun) is { } allStarted)
    {
      controlAllStarted.Add((allStarted - run.CreatedAt).TotalSeconds);
    }
  }
  report.Append(CultureInfo.InvariantCulture, $"Sample: {pairs.Count} superseded pull request runs of `{workflow}` in {repo}{scope}, ")
    .Append(CultureInfo.InvariantCulture, $"superseded {pairs[^1].SupersededAt:yyyy-MM-dd HH:mm}Z")
    .Append(CultureInfo.InvariantCulture, $" to {pairs[0].SupersededAt:yyyy-MM-dd HH:mm}Z, ")
    .Append(CultureInfo.InvariantCulture, $"and {controlFirstJob.Count} pull request runs that superseded nothing.")
    .AppendLine().AppendLine();
  report.Append(Report.SupersessionSummary(pairs, controlFirstJob, controlAllStarted)).AppendLine();
  report.Append(Report.SupersededTable(pairs));
  await Console.Out.WriteAsync(report.ToString());
  return 0;
}

List<WorkflowRun> sample =
[
  .. listed
    .Where(run => string.Equals(run.Status, "completed", StringComparison.Ordinal))
    .Where(run => string.Equals(run.Conclusion, "success", StringComparison.Ordinal))
    .Take(runs),
];
if (sample.Count == 0)
{
  await Console.Error.WriteLineAsync($"no successful runs of {workflow} in the last {runs * 2} runs");
  return 1;
}

List<JobTiming> jobs = [];
foreach (var runId in sample.Select(run => run.Id))
{
  jobs.AddRange(await JobsOf(runId));
}

IEnumerable<string> events = sample.Select(run => run.Event).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
report.Append(CultureInfo.InvariantCulture, $"Sample: {sample.Count} successful runs of `{workflow}` in {repo}{scope}, ")
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
