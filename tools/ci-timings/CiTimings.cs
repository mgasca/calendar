using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace CiTimings;

/// <summary>One workflow run as <c>gh run list</c> reports it.</summary>
/// <param name="Id">The run's database id, used by the jobs endpoint.</param>
/// <param name="Status">queued, in_progress or completed.</param>
/// <param name="Conclusion">success, failure, cancelled, … (empty while the run is not completed).</param>
/// <param name="CreatedAt">When the run was created.</param>
/// <param name="Event">push, pull_request, merge_group, …</param>
/// <param name="HeadBranch">The branch the run was for (a pull request's head branch); empty when not listed.</param>
/// <param name="HeadSha">The commit the run tested; empty when not listed.</param>
public sealed record WorkflowRun(
  long Id,
  string Status,
  string Conclusion,
  DateTimeOffset CreatedAt,
  string Event,
  string HeadBranch = "",
  string HeadSha = "");

/// <summary>A step of a job with the wall-clock span GitHub recorded for it.</summary>
/// <param name="Number">The step's position in the job.</param>
/// <param name="Name">The step's name.</param>
/// <param name="StartedAt">When the step started.</param>
/// <param name="CompletedAt">When the step completed.</param>
/// <param name="Conclusion">success, failure, cancelled or skipped; empty when not reported.</param>
public sealed record StepTiming(int Number, string Name, DateTimeOffset StartedAt, DateTimeOffset CompletedAt, string Conclusion = "")
{
  /// <summary>Seconds between start and completion.</summary>
  public double Seconds => (CompletedAt - StartedAt).TotalSeconds;
}

/// <summary>A job of a run with its steps.</summary>
/// <param name="RunId">The run the job belongs to.</param>
/// <param name="Name">The job's display name (<c>name:</c> in the workflow).</param>
/// <param name="Conclusion">success, failure, cancelled or skipped.</param>
/// <param name="StartedAt">When the job started on a runner.</param>
/// <param name="CompletedAt">When the job completed.</param>
/// <param name="Steps">The steps that ran, with their spans; skipped steps are left out.</param>
/// <param name="CreatedAt">When GitHub created the job (for a job with <c>needs</c>, when they finished); null if not reported.</param>
public sealed record JobTiming(
  long RunId,
  string Name,
  string Conclusion,
  DateTimeOffset StartedAt,
  DateTimeOffset CompletedAt,
  IReadOnlyList<StepTiming> Steps,
  DateTimeOffset? CreatedAt = null)
{
  /// <summary>Seconds between start and completion.</summary>
  public double Seconds => (CompletedAt - StartedAt).TotalSeconds;
}

/// <summary>Summary statistics of a sample of durations, in seconds.</summary>
/// <param name="Count">How many values the sample holds.</param>
/// <param name="Min">The smallest value.</param>
/// <param name="Median">The 50th percentile (nearest rank).</param>
/// <param name="P90">The 90th percentile (nearest rank).</param>
/// <param name="Max">The largest value.</param>
/// <param name="Mean">The arithmetic mean.</param>
public sealed record Summary(int Count, double Min, double Median, double P90, double Max, double Mean);

/// <summary>Reads the JSON that <c>gh run list</c> and the jobs endpoint return.</summary>
public static class Parser
{
  private const string StartedAt = "started_at";
  private const string CompletedAt = "completed_at";

  /// <summary>
  /// Parses <c>gh run list --json databaseId,status,conclusion,createdAt,event</c>, plus <c>headBranch</c> and <c>headSha</c>
  /// when listed.
  /// </summary>
  /// <param name="json">The JSON array.</param>
  /// <returns>The runs in the order listed (newest first).</returns>
  public static IReadOnlyList<WorkflowRun> ParseRuns(string json)
  {
    using var document = JsonDocument.Parse(json);
    return
    [
      .. document.RootElement.EnumerateArray().Select(run => new WorkflowRun(
        run.GetProperty("databaseId").GetInt64(),
        Text(run, "status"),
        Text(run, "conclusion"),
        run.GetProperty("createdAt").GetDateTimeOffset(),
        Text(run, "event"),
        Text(run, "headBranch"),
        Text(run, "headSha"))),
    ];
  }

  /// <summary>Parses <c>GET /repos/{owner}/{repo}/actions/runs/{id}/jobs</c>.</summary>
  /// <param name="runId">The run the jobs belong to.</param>
  /// <param name="json">The JSON object with a <c>jobs</c> array.</param>
  /// <returns>Every job that ran (not skipped) and has both a start and a completion time, with its completed steps.</returns>
  public static IReadOnlyList<JobTiming> ParseJobs(long runId, string json)
  {
    using var document = JsonDocument.Parse(json);
    var jobs = new List<JobTiming>();
    foreach (JsonElement job in document.RootElement.GetProperty("jobs").EnumerateArray())
    {
      // A job skipped by its `if` reports start and end times that mean nothing (the end can come before the start).
      if (string.Equals(Text(job, "conclusion"), "skipped", StringComparison.Ordinal)
        || !TryTime(job, StartedAt, out DateTimeOffset started) || !TryTime(job, CompletedAt, out DateTimeOffset completed))
      {
        continue;
      }
      List<StepTiming> steps = [];
      foreach (JsonElement step in job.GetProperty("steps").EnumerateArray())
      {
        if (TryTime(step, StartedAt, out DateTimeOffset stepStarted) && TryTime(step, CompletedAt, out DateTimeOffset stepCompleted))
        {
          var number = step.GetProperty("number").GetInt32();
          steps.Add(new StepTiming(number, Text(step, "name"), stepStarted, stepCompleted, Text(step, "conclusion")));
        }
      }
      DateTimeOffset? created = TryTime(job, "created_at", out DateTimeOffset createdAt) ? createdAt : null;
      jobs.Add(new JobTiming(runId, Text(job, "name"), Text(job, "conclusion"), started, completed, steps, created));
    }
    return jobs;
  }

  private static string Text(JsonElement element, string property) =>
    element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.String
      ? value.GetString() ?? string.Empty
      : string.Empty;

  private static bool TryTime(JsonElement element, string property, out DateTimeOffset time)
  {
    time = default;
    return element.TryGetProperty(property, out JsonElement value)
      && value.ValueKind == JsonValueKind.String
      && value.TryGetDateTimeOffset(out time);
  }
}

/// <summary>Order statistics over a sample.</summary>
public static class Statistics
{
  /// <summary>Summarises a sample; an empty sample gives zeros.</summary>
  /// <param name="values">The durations, in any order.</param>
  /// <returns>Count, minimum, median, 90th percentile, maximum and mean.</returns>
  public static Summary Summarize(IEnumerable<double> values)
  {
    double[] sorted = [.. values.Order()];
    if (sorted.Length == 0)
    {
      return new Summary(0, 0, 0, 0, 0, 0);
    }
    return new Summary(sorted.Length, sorted[0], Percentile(sorted, 0.5), Percentile(sorted, 0.9), sorted[^1], sorted.Average());
  }

  /// <summary>The nearest-rank percentile: the value at position ⌈q·n⌉ of the sorted sample.</summary>
  /// <param name="sorted">The sample in ascending order, not empty.</param>
  /// <param name="quantile">The quantile between 0 and 1.</param>
  /// <returns>A value from the sample, never an interpolation.</returns>
  public static double Percentile(IReadOnlyList<double> sorted, double quantile)
  {
    var rank = (int)Math.Ceiling(quantile * sorted.Count);
    return sorted[Math.Clamp(rank, 1, sorted.Count) - 1];
  }
}

/// <summary>
/// A cancelled pull request run and the run that superseded it. Times are seconds after T0, the moment the superseding
/// run was created, which is when its push cancelled the old run.
/// </summary>
/// <param name="CancelledRunId">The run that was cancelled.</param>
/// <param name="SupersedingRunId">The next pull request run of the same branch.</param>
/// <param name="SupersededAt">T0: when the superseding run was created.</param>
/// <param name="PushGap">Seconds from the cancelled run's creation to T0, which is how far apart the two pushes were.</param>
/// <param name="Wait">T0 to the superseding run's first job starting; null when none of its jobs started.</param>
/// <param name="AllStarted">
/// T0 to the last of the superseding run's first jobs starting: the jobs GitHub created with the run, not those that
/// wait on <c>needs</c>. It exceeds <paramref name="Wait"/> when the jobs queue for runners. Null when job creation
/// times are not reported.
/// </param>
/// <param name="CancelNotHeardAt">
/// The latest start of a step in a job GitHub marked cancelled, leaving out skipped steps and the runner's set-up and
/// clean-up. The runner had not yet heard of the cancel when it started that step, so this is a lower bound on the
/// cancel's delivery. Null when no such step started after T0.
/// </param>
/// <param name="CancelHeardBy">
/// The earliest end of a step that ended cancelled. The runner had heard of the cancel by then, so this is an upper
/// bound on its delivery. Null when no step ended cancelled.
/// </param>
/// <param name="CancelledJobsEnd">The last end of the old run's jobs that GitHub marked cancelled; null when there are none.</param>
/// <param name="RunEnd">The last end of any of the old run's jobs, including those that run whatever happens (<c>if: always()</c>).</param>
/// <param name="JobsNotCancelled">The old run's jobs GitHub did not mark cancelled, as "name conclusion", comma-separated.</param>
public sealed record SupersededPair(
  long CancelledRunId,
  long SupersedingRunId,
  DateTimeOffset SupersededAt,
  double PushGap,
  double? Wait,
  double? AllStarted,
  double? CancelNotHeardAt,
  double? CancelHeardBy,
  double? CancelledJobsEnd,
  double RunEnd,
  string JobsNotCancelled);

/// <summary>Pairs cancelled pull request runs with the runs that superseded them, and times how the hand-over went.</summary>
public static class Supersession
{
  private const string Cancelled = "cancelled";

  /// <summary>Pairs each cancelled <c>pull_request</c> run with the next <c>pull_request</c> run of the same branch.</summary>
  /// <param name="runs">Runs in any order, with their head branches.</param>
  /// <returns>(cancelled, superseding) pairs, newest first.</returns>
  public static IReadOnlyList<(WorkflowRun Cancelled, WorkflowRun Superseding)> Pair(IEnumerable<WorkflowRun> runs)
  {
    List<WorkflowRun> pullRequestRuns =
    [
      .. runs.Where(run => string.Equals(run.Event, "pull_request", StringComparison.Ordinal)).OrderBy(run => run.CreatedAt),
    ];
    var pairs = new List<(WorkflowRun Cancelled, WorkflowRun Superseding)>();
    for (var index = 0; index < pullRequestRuns.Count; index++)
    {
      WorkflowRun run = pullRequestRuns[index];
      if (!string.Equals(run.Conclusion, Cancelled, StringComparison.Ordinal))
      {
        continue;
      }
      WorkflowRun? next = pullRequestRuns.Skip(index + 1)
        .FirstOrDefault(later => string.Equals(later.HeadBranch, run.HeadBranch, StringComparison.Ordinal));
      if (next is not null)
      {
        pairs.Add((run, next));
      }
    }
    pairs.Reverse();
    return pairs;
  }

  /// <summary>Times one pair from the jobs of both runs.</summary>
  /// <param name="cancelled">The cancelled run.</param>
  /// <param name="superseding">The run created after it on the same branch.</param>
  /// <param name="cancelledJobs">The cancelled run's jobs.</param>
  /// <param name="supersedingJobs">The superseding run's jobs.</param>
  /// <returns>The pair, or null when the old run had already ended at T0 (it was cancelled by hand, not superseded).</returns>
  public static SupersededPair? Measure(
    WorkflowRun cancelled,
    WorkflowRun superseding,
    IReadOnlyList<JobTiming> cancelledJobs,
    IReadOnlyList<JobTiming> supersedingJobs)
  {
    DateTimeOffset t0 = superseding.CreatedAt;
    if (cancelledJobs.Count == 0 || cancelledJobs.Max(job => job.CompletedAt) <= t0)
    {
      return null;
    }
    double After(DateTimeOffset time) => (time - t0).TotalSeconds;
    List<JobTiming> stopped = [.. cancelledJobs.Where(job => string.Equals(job.Conclusion, Cancelled, StringComparison.Ordinal))];
    var notHeardAt = stopped
      .SelectMany(job => job.Steps)
      .Where(step => step.Conclusion is "success" or "failure" or Cancelled && !IsBookkeeping(step.Name) && step.StartedAt > t0)
      .Select(step => (double?)After(step.StartedAt))
      .Max();
    var heardBy = cancelledJobs
      .SelectMany(job => job.Steps)
      .Where(step => string.Equals(step.Conclusion, Cancelled, StringComparison.Ordinal) && step.CompletedAt > t0)
      .Select(step => (double?)After(step.CompletedAt))
      .Min();
    double? stoppedEnd = stopped.Count == 0 ? null : After(stopped.Max(job => job.CompletedAt));
    double? wait = supersedingJobs.Count == 0 ? null : After(supersedingJobs.Min(job => job.StartedAt));
    DateTimeOffset? allStarted = FirstJobsStarted(supersedingJobs);
    var others = string.Join(
      ", ",
      cancelledJobs
        .Where(job => !string.Equals(job.Conclusion, Cancelled, StringComparison.Ordinal))
        .Select(job => $"{job.Name} {job.Conclusion}"));
    return new SupersededPair(
      cancelled.Id,
      superseding.Id,
      t0,
      (t0 - cancelled.CreatedAt).TotalSeconds,
      wait,
      allStarted is null ? null : After(allStarted.Value),
      notHeardAt,
      heardBy,
      stoppedEnd,
      After(cancelledJobs.Max(job => job.CompletedAt)),
      others);
  }

  /// <summary>
  /// When the last of a run's first jobs started: those GitHub created within a few seconds of its earliest job, which
  /// leaves out jobs created later because they wait on <c>needs</c>.
  /// </summary>
  /// <param name="jobs">The run's jobs.</param>
  /// <returns>The latest start among the first jobs, or null when no job reports its creation time.</returns>
  public static DateTimeOffset? FirstJobsStarted(IReadOnlyCollection<JobTiming> jobs)
  {
    List<(DateTimeOffset Created, DateTimeOffset Started)> created =
    [
      .. jobs.Where(job => job.CreatedAt is not null).Select(job => (job.CreatedAt!.Value, job.StartedAt)),
    ];
    if (created.Count == 0)
    {
      return null;
    }
    DateTimeOffset firstWave = created.Min(job => job.Created).AddSeconds(5);
    return created.Where(job => job.Created <= firstWave).Max(job => job.Started);
  }

  /// <summary>Whether a step is the runner's own set-up or clean-up, which also runs after a cancel.</summary>
  /// <param name="name">The step's name.</param>
  /// <returns>True for set-up, post and clean-up steps.</returns>
  public static bool IsBookkeeping(string name) =>
    name.StartsWith("Post ", StringComparison.Ordinal)
    || name is "Set up job" or "Complete job" or "Initialize containers" or "Stop containers";
}

/// <summary>Renders the sample as Markdown tables.</summary>
public static class Report
{
  private const string None = "–";

  /// <summary>One row per superseded pair, newest first. Times are whole seconds after the superseding run was created.</summary>
  /// <param name="pairs">The timed pairs.</param>
  /// <returns>A Markdown table.</returns>
  public static string SupersededTable(IEnumerable<SupersededPair> pairs)
  {
    var text = new StringBuilder();
    text.Append("| Cancelled | Superseding | Push gap s | Wait s | All started s | Cancel heard s |")
      .AppendLine(" Old jobs end s | Old run ends s | Not cancelled |");
    text.AppendLine("| --- | --- | --: | --: | --: | --: | --: | --: | --- |");
    foreach (SupersededPair pair in pairs)
    {
      var heard = $"{WholeOrDash(pair.CancelNotHeardAt)}..{WholeOrDash(pair.CancelHeardBy)}";
      text.Append(CultureInfo.InvariantCulture, $"| {pair.CancelledRunId} | {pair.SupersedingRunId} | {Whole(pair.PushGap)} |")
        .Append(CultureInfo.InvariantCulture, $" {WholeOrDash(pair.Wait)} | {WholeOrDash(pair.AllStarted)} | {heard} |")
        .Append(CultureInfo.InvariantCulture, $" {WholeOrDash(pair.CancelledJobsEnd)} | {Whole(pair.RunEnd)} |")
        .Append(CultureInfo.InvariantCulture, $" {(pair.JobsNotCancelled.Length == 0 ? None : pair.JobsNotCancelled)} |")
        .AppendLine();
    }
    return text.ToString();
  }

  /// <summary>Statistics of each segment of the hand-over, and the control: pull request runs that superseded nothing.</summary>
  /// <param name="pairs">The timed pairs.</param>
  /// <param name="controlFirstJob">Seconds from creation to the first job starting, for pull request runs that superseded none.</param>
  /// <param name="controlAllStarted">Seconds from creation to the last of their first jobs starting.</param>
  /// <returns>A Markdown table; a segment no pair has a value for shows n = 0.</returns>
  public static string SupersessionSummary(
    IReadOnlyCollection<SupersededPair> pairs,
    IEnumerable<double> controlFirstJob,
    IEnumerable<double> controlAllStarted)
  {
    var text = new StringBuilder();
    text.AppendLine("| Seconds after the superseding run was created | n | min | median | p90 | max |");
    text.AppendLine("| --- | --: | --: | --: | --: | --: |");
    (string Label, IEnumerable<double> Values)[] rows =
    [
      ("Wait: the superseding run's first job starts", Values(pairs, pair => pair.Wait)),
      ("All of the superseding run's first jobs have started", Values(pairs, pair => pair.AllStarted)),
      ("The old run's runners had not yet heard of the cancel (lower bound)", Values(pairs, pair => pair.CancelNotHeardAt)),
      ("The old run's runners had heard of it (upper bound)", Values(pairs, pair => pair.CancelHeardBy)),
      ("The old run's cancelled jobs end", Values(pairs, pair => pair.CancelledJobsEnd)),
      ("The old run ends", pairs.Select(pair => pair.RunEnd)),
      ("Control: a pull request run that superseded nothing, created → first job", controlFirstJob),
      ("Control: the same runs, created → all first jobs started", controlAllStarted),
    ];
    foreach ((string Label, IEnumerable<double> Values) row in rows)
    {
      Summary stats = Statistics.Summarize(row.Values);
      text.Append(CultureInfo.InvariantCulture, $"| {row.Label} | {stats.Count} |")
        .Append(stats.Count == 0
          ? $" {None} | {None} | {None} | {None} |"
          : $" {Whole(stats.Min)} | {Whole(stats.Median)} | {Whole(stats.P90)} | {Whole(stats.Max)} |")
        .AppendLine();
    }
    return text.ToString();
  }

  private static IEnumerable<double> Values(IEnumerable<SupersededPair> pairs, Func<SupersededPair, double?> select) =>
    pairs.Select(select).OfType<double>();

  private static string WholeOrDash(double? seconds) => seconds is null ? None : Whole(seconds.Value);

  /// <summary>Jobs by name, slowest median first: count, min, median, p90 and max as m:ss.</summary>
  /// <param name="jobs">The jobs of every sampled run.</param>
  /// <returns>A Markdown table.</returns>
  public static string JobsTable(IEnumerable<JobTiming> jobs)
  {
    var text = new StringBuilder();
    text.AppendLine("| Job | n | min | median | p90 | max |");
    text.AppendLine("| --- | --: | --: | --: | --: | --: |");
    IEnumerable<(string Name, Summary Stats)> rows = jobs
      .GroupBy(job => job.Name, StringComparer.Ordinal)
      .Select(group => (group.Key, Statistics.Summarize(group.Select(job => job.Seconds))))
      .OrderByDescending(row => row.Item2.Median)
      .ThenBy(row => row.Key, StringComparer.Ordinal);
    foreach ((string Name, Summary Stats) row in rows)
    {
      Summary stats = row.Stats;
      text.Append(CultureInfo.InvariantCulture, $"| {row.Name} | {stats.Count} | {Clock(stats.Min)} | {Clock(stats.Median)} |")
        .Append(CultureInfo.InvariantCulture, $" {Clock(stats.P90)} | {Clock(stats.Max)} |")
        .AppendLine();
    }
    return text.ToString();
  }

  /// <summary>The steps of one job, in step order: count, min, median, p90, max and mean in seconds.</summary>
  /// <param name="jobs">The jobs of every sampled run.</param>
  /// <param name="jobName">The job whose steps to summarise.</param>
  /// <returns>A Markdown table, with only the header when no run has that job.</returns>
  public static string StepsTable(IEnumerable<JobTiming> jobs, string jobName)
  {
    var text = new StringBuilder();
    text.AppendLine("| Step | n | min s | median s | p90 s | max s | mean s |");
    text.AppendLine("| --- | --: | --: | --: | --: | --: | --: |");
    IEnumerable<(int Number, string Name, Summary Stats)> rows = jobs
      .Where(job => string.Equals(job.Name, jobName, StringComparison.Ordinal))
      .SelectMany(job => job.Steps)
      .GroupBy(step => step.Name, StringComparer.Ordinal)
      .Select(group => (group.Min(step => step.Number), group.Key, Statistics.Summarize(group.Select(step => step.Seconds))))
      .OrderBy(row => row.Item1)
      .ThenBy(row => row.Item2, StringComparer.Ordinal);
    foreach ((int Number, string Name, Summary Stats) row in rows)
    {
      Summary stats = row.Stats;
      text.Append(CultureInfo.InvariantCulture, $"| {row.Number}. {row.Name} | {stats.Count} | {Whole(stats.Min)} |")
        .Append(CultureInfo.InvariantCulture, $" {Whole(stats.Median)} | {Whole(stats.P90)} | {Whole(stats.Max)} |")
        .Append(CultureInfo.InvariantCulture, $" {stats.Mean.ToString("F1", CultureInfo.InvariantCulture)} |")
        .AppendLine();
    }
    return text.ToString();
  }

  /// <summary>Seconds as m:ss, rounded to the second.</summary>
  /// <param name="seconds">A duration in seconds.</param>
  /// <returns>For example 4:26.</returns>
  public static string Clock(double seconds)
  {
    var whole = (long)Math.Round(seconds);
    return string.Create(CultureInfo.InvariantCulture, $"{whole / 60}:{whole % 60:00}");
  }

  private static string Whole(double seconds) => Math.Round(seconds).ToString("F0", CultureInfo.InvariantCulture);
}

/// <summary>Runs the GitHub CLI, found on PATH, and returns its standard output.</summary>
public static class Gh
{
  /// <summary>How many times a call is tried when GitHub answers with a server error.</summary>
  public const int Attempts = 3;

  /// <summary>gh resolved on PATH once, so the process start uses an absolute path.</summary>
  private static readonly Lazy<string> Executable = new(() =>
    (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
      .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
      .Select(dir => Path.Combine(dir, OperatingSystem.IsWindows() ? "gh.exe" : "gh"))
      .FirstOrDefault(File.Exists) ?? "/usr/bin/gh");

  /// <summary>Whether gh's stderr reports a server-side failure worth retrying (HTTP 5xx), not a usage or auth error.</summary>
  /// <param name="error">What gh wrote to stderr.</param>
  /// <returns>True for a 5xx answer.</returns>
  public static bool IsTransient(string error) =>
    error.Contains("Server Error", StringComparison.Ordinal) || error.Contains("HTTP 5", StringComparison.Ordinal);

  /// <summary>Runs <c>gh</c> with the given arguments, retrying a server error up to <see cref="Attempts"/> times.</summary>
  /// <param name="arguments">The arguments, one per element.</param>
  /// <returns>Standard output.</returns>
  /// <exception cref="InvalidOperationException">gh exited with a non-zero code; the message carries its stderr.</exception>
  public static async Task<string> RunAsync(IReadOnlyList<string> arguments)
  {
    var attempt = 0;
    while (true)
    {
      attempt++;
      (int ExitCode, string Output, string Error) result = await RunOnceAsync(arguments);
      if (result.ExitCode == 0)
      {
        return result.Output;
      }
      if (attempt < Attempts && IsTransient(result.Error))
      {
        await Task.Delay(TimeSpan.FromSeconds(2 * attempt));
        continue;
      }
      throw new InvalidOperationException($"gh {string.Join(' ', arguments)} failed ({result.ExitCode}): {result.Error.Trim()}");
    }
  }

  private static async Task<(int ExitCode, string Output, string Error)> RunOnceAsync(IReadOnlyList<string> arguments)
  {
    var start = new ProcessStartInfo(Executable.Value)
    {
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false,
    };
    foreach (var argument in arguments)
    {
      start.ArgumentList.Add(argument);
    }
    using Process process = Process.Start(start) ?? throw new InvalidOperationException("gh did not start");
    Task<string> output = process.StandardOutput.ReadToEndAsync();
    Task<string> error = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync();
    return (process.ExitCode, await output, await error);
  }
}
