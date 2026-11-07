#!/usr/bin/env -S dotnet run
#:include CiTimings.cs
#:include Baseline.cs
#:include Trend.cs

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
//   dotnet run tools/ci-timings/ci-timings.cs -- --baseline --created "2026-11-06T20:04:00Z..2026-11-07T20:00:00Z" \
//     --holdout ">2026-11-07T20:00:00Z"   pins each job's baseline per path (check, publication) from the push and dispatch
//                                         runs on main in --created, writes .github/ci-baseline.json (--out) and back-tests
//                                         its thresholds on the runs in --holdout, on main and on pull requests (ADR 0045)
//     [--min-runs 30] [--alpha 0.01] [--floor 15] [--margin 0.1] [--record docs/benchmarks/0014-….md]
//   dotnet run tools/ci-timings/ci-timings.cs -- --trend [--issue]   the last 20 successful push runs on main not in the
//                                         baseline against .github/ci-baseline.json (--out): exact one-sided Mann–Whitney at
//                                         p < 0.002 and a Hodges–Lehmann shift of at least max(10 s, 5 %); --issue comments on
//                                         the open trend issue (label performance) or opens it, only when a job is slower

using System.Globalization;
using CiTimings;

var workflow = "ci.yml";
var runs = 40;
string? repo = null;
string? branch = null;
string? created = null;
var superseded = false;
var baseline = false;
var trend = false;
var issue = false;
string? holdout = null;
var output = ".github/ci-baseline.json";
var record = "docs/benchmarks/0014-ci-job-baseline.md";
var minRuns = 30;
GateConstants constants = GateConstants.Default;
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
    case "--baseline":
      baseline = true;
      break;
    case "--trend":
      trend = true;
      break;
    case "--issue":
      issue = true;
      break;
    case "--holdout" when pending.Count > 0:
      holdout = pending.Dequeue();
      break;
    case "--out" when pending.Count > 0:
      output = pending.Dequeue();
      break;
    case "--record" when pending.Count > 0:
      record = pending.Dequeue();
      break;
    case "--min-runs" when pending.Count > 0
      && int.TryParse(pending.Dequeue(), NumberStyles.None, CultureInfo.InvariantCulture, out var least):
      minRuns = least;
      break;
    case "--alpha" when pending.Count > 0 && TryNumber(pending.Dequeue(), out var alpha):
      constants = constants with { Alpha = alpha };
      break;
    case "--floor" when pending.Count > 0 && TryNumber(pending.Dequeue(), out var floor):
      constants = constants with { FloorSeconds = floor };
      break;
    case "--margin" when pending.Count > 0 && TryNumber(pending.Dequeue(), out var margin):
      constants = constants with { RelativeMargin = margin };
      break;
    default:
      await Console.Error.WriteLineAsync($"unknown argument: {arg}");
      await Console.Error.WriteLineAsync(
        "usage: ci-timings [--workflow FILE] [--runs N] [--repo OWNER/NAME] [--branch NAME] [--created RANGE] [--job NAME]... "
        + "[--superseded] [--baseline --created RANGE [--holdout RANGE] [--out FILE] [--record FILE] [--min-runs N]"
        + " [--alpha A] [--floor S] [--margin R]] [--trend [--out FILE] [--issue]]");
      return 2;
  }
}

List<string> repoArguments = repo is null ? [] : ["--repo", repo];
List<string> branchArguments = branch is null ? [] : ["--branch", branch];
List<string> createdArguments = created is null ? [] : ["--created", created];
if (trend)
{
  // The trend check: the newest successful push runs on main not in the baseline, against .github/ci-baseline.json
  // (--out). With --issue, a regression comments on the open trend issue or opens it; nothing else is ever posted.
  var trendRepo = repo ?? (await Gh.RunAsync(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).Trim();
  BaselineFile pinned = BaselineIo.Read(await File.ReadAllTextAsync(output));
  TrendConstants trendConstants = TrendConstants.Default;
  IReadOnlyList<WorkflowRun> pushes = Parser.ParseRuns(await Gh.RunAsync(
  [
    "run", "list", "--workflow", workflow, "--branch", "main", "--event", "push", "--limit", "200", "--repo", trendRepo,
    "--json", "databaseId,status,conclusion,createdAt,event,headBranch,headSha",
  ]));
  List<SampledRun> recent = [];
  foreach (WorkflowRun run in Trend.RecentRuns(pinned, pushes, trendConstants))
  {
    var jobsJson = await Gh.RunAsync(["api", $"repos/{trendRepo}/actions/runs/{run.Id}/jobs?per_page=50"]);
    recent.Add(new SampledRun(run, [.. Baselines.Samples(run, Parser.ParseJobs(run.Id, jobsJson))]));
  }
  TrendResult result = Trend.Evaluate(pinned, recent, trendConstants);
  var trendReport = Trend.Report(result, pinned, trendConstants);
  await Console.Out.WriteAsync(trendReport);
  if (issue)
  {
    var openJson = await Gh.RunAsync(
    [
      "issue", "list", "--repo", trendRepo, "--state", "open", "--label", Trend.IssueLabel, "--limit", "100", "--json", "number,title",
    ]);
    var action = Trend.IssueAction(result, Parser.ParseIssues(openJson));
    if (action is not null)
    {
      var bodyPath = Path.Combine(Path.GetTempPath(), $"ci-trend-{Environment.ProcessId}.md");
      await File.WriteAllTextAsync(bodyPath, trendReport + "\nPosted by the scheduled trend check, `.github/workflows/ci-trend.yml`.\n");
      List<string> post = action == 0
        ? ["issue", "create", "--repo", trendRepo, "--title", Trend.IssueTitle, "--label", Trend.IssueLabel, "--body-file", bodyPath]
        : ["issue", "comment", action.Value.ToString(CultureInfo.InvariantCulture), "--repo", trendRepo, "--body-file", bodyPath];
      await Console.Out.WriteLineAsync((await Gh.RunAsync(post)).Trim());
      File.Delete(bodyPath);
    }
  }
  return 0;
}

if (baseline)
{
  // The baseline: successful runs on main (push and dispatch) created in --created, written to --out; the back-test:
  // runs created in --holdout, the main runs and the pull request runs each reported on their own.
  if (created is null)
  {
    await Console.Error.WriteLineAsync("--baseline needs --created RANGE, the baseline window");
    return 2;
  }
  var repoName = repo ?? (await Gh.RunAsync(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).Trim();
  // Only runs on main are read for the baseline, so a pull request run in the window costs no jobs call (#392 review).
  List<SampledRun> inWindow = await BaselineSampler.SampleAsync(Gh.RunAsync, repoName, workflow, created, BaselineRuns.IsMain);
  BaselineFile file = BaselineRuns.Build(workflow, record, minRuns, constants, inWindow);
  await File.WriteAllTextAsync(output, BaselineIo.Write(file));
  var text = new System.Text.StringBuilder();
  text.Append(CultureInfo.InvariantCulture, $"Baseline: {inWindow.Count} successful runs of `{workflow}` on `main` in {repoName}")
    .Append(CultureInfo.InvariantCulture, $" created {created}, written to `{output}`.").AppendLine().AppendLine();
  text.Append(BaselineReport.Window(file)).AppendLine();
  text.Append(BaselineReport.Table(file));
  if (holdout is not null)
  {
    List<SampledRun> held = await BaselineSampler.SampleAsync(
      Gh.RunAsync,
      repoName,
      workflow,
      holdout,
      run => BaselineRuns.IsMain(run) || string.Equals(run.Event, "pull_request", StringComparison.Ordinal));
    IEnumerable<PathSample> heldMain = held.Where(item => BaselineRuns.IsMain(item.Run)).SelectMany(item => item.Samples);
    IEnumerable<PathSample> heldPullRequests = held
      .Where(item => string.Equals(item.Run.Event, "pull_request", StringComparison.Ordinal))
      .SelectMany(item => item.Samples);
    text.AppendLine().Append(CultureInfo.InvariantCulture, $"Back-test on runs on `main` created {holdout}:").AppendLine().AppendLine();
    text.Append(BaselineReport.BackTestTable(BaselineIo.Evaluate(file, heldMain)));
    text.AppendLine().Append(CultureInfo.InvariantCulture, $"Back-test on pull request runs created {holdout}:").AppendLine().AppendLine();
    text.Append(BaselineReport.BackTestTable(BaselineIo.Evaluate(file, heldPullRequests)));
  }
  await Console.Out.WriteAsync(text.ToString());
  return 0;
}

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

static bool TryNumber(string text, out double value) =>
  double.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value);
