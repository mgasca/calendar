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
public sealed record WorkflowRun(long Id, string Status, string Conclusion, DateTimeOffset CreatedAt, string Event);

/// <summary>A step of a job with the wall-clock span GitHub recorded for it.</summary>
/// <param name="Number">The step's position in the job.</param>
/// <param name="Name">The step's name.</param>
/// <param name="StartedAt">When the step started.</param>
/// <param name="CompletedAt">When the step completed.</param>
public sealed record StepTiming(int Number, string Name, DateTimeOffset StartedAt, DateTimeOffset CompletedAt)
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
public sealed record JobTiming(
  long RunId,
  string Name,
  string Conclusion,
  DateTimeOffset StartedAt,
  DateTimeOffset CompletedAt,
  IReadOnlyList<StepTiming> Steps)
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

  /// <summary>Parses <c>gh run list --json databaseId,status,conclusion,createdAt,event</c>.</summary>
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
        Text(run, "event"))),
    ];
  }

  /// <summary>Parses <c>GET /repos/{owner}/{repo}/actions/runs/{id}/jobs</c>.</summary>
  /// <param name="runId">The run the jobs belong to.</param>
  /// <param name="json">The JSON object with a <c>jobs</c> array.</param>
  /// <returns>Every job that has both a start and a completion time, with its completed steps.</returns>
  public static IReadOnlyList<JobTiming> ParseJobs(long runId, string json)
  {
    using var document = JsonDocument.Parse(json);
    var jobs = new List<JobTiming>();
    foreach (JsonElement job in document.RootElement.GetProperty("jobs").EnumerateArray())
    {
      if (!TryTime(job, StartedAt, out DateTimeOffset started) || !TryTime(job, CompletedAt, out DateTimeOffset completed))
      {
        continue;
      }
      List<StepTiming> steps = [];
      foreach (JsonElement step in job.GetProperty("steps").EnumerateArray())
      {
        if (TryTime(step, StartedAt, out DateTimeOffset stepStarted) && TryTime(step, CompletedAt, out DateTimeOffset stepCompleted))
        {
          steps.Add(new StepTiming(step.GetProperty("number").GetInt32(), Text(step, "name"), stepStarted, stepCompleted));
        }
      }
      jobs.Add(new JobTiming(runId, Text(job, "name"), Text(job, "conclusion"), started, completed, steps));
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

/// <summary>Renders the sample as Markdown tables.</summary>
public static class Report
{
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
