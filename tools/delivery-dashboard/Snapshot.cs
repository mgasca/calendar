using System.Globalization;
using System.Text;
using System.Text.Json;
using CiTimings;

namespace DeliveryDashboard;

/// <summary>The oldest and newest run a section was computed from.</summary>
/// <param name="From">When the oldest sampled run was created.</param>
/// <param name="To">When the newest sampled run was created.</param>
public sealed record SampleWindow(DateTimeOffset From, DateTimeOffset To);

/// <summary>A job's pinned baseline on one path (ADR-0045).</summary>
/// <param name="Count">How many baseline runs the job succeeded in.</param>
/// <param name="MedianSeconds">The baseline median.</param>
/// <param name="ThresholdSeconds">The run time above which a run fails the gate.</param>
public sealed record JobBaselineStat(int Count, double MedianSeconds, double ThresholdSeconds);

/// <summary>The trend check's conclusion for one job (ADR-0045).</summary>
/// <param name="Verdict"><c>noShift</c>, <c>slower</c>, <c>faster</c>, or <c>inconclusive</c> while there are too few recent runs.</param>
/// <param name="RecentRuns">How many recent runs the job has.</param>
/// <param name="ShiftSeconds">The Hodges-Lehmann shift of the recent runs against the baseline.</param>
/// <param name="LowSeconds">The lower end of the approximate 95 % interval of the shift.</param>
/// <param name="HighSeconds">The upper end of that interval.</param>
/// <param name="MinEffectSeconds">The smallest shift that counts.</param>
public sealed record JobTrend(
  string Verdict,
  int RecentRuns,
  double ShiftSeconds,
  double LowSeconds,
  double HighSeconds,
  double MinEffectSeconds);

/// <summary>Statistics of one CI job on one path over the sampled runs, in seconds.</summary>
/// <param name="Job">The job's display name.</param>
/// <param name="Path"><c>check</c> or <c>publication</c> (ADR-0045).</param>
/// <param name="Count">How many runs the statistics come from.</param>
/// <param name="MinSeconds">The shortest execution time.</param>
/// <param name="MedianSeconds">The median execution time (nearest rank).</param>
/// <param name="P90Seconds">The 90th percentile (nearest rank).</param>
/// <param name="MaxSeconds">The longest execution time.</param>
/// <param name="Baseline">The pinned baseline on this path; null when none is pinned. Schema version 2.</param>
/// <param name="Trend">The trend check's conclusion; null when the job has no pinned baseline. Schema version 2.</param>
public sealed record JobStat(
  string Job,
  string Path,
  int Count,
  double MinSeconds,
  double MedianSeconds,
  double P90Seconds,
  double MaxSeconds,
  JobBaselineStat? Baseline = null,
  JobTrend? Trend = null);

/// <summary>The runs the trend check compared with the baseline.</summary>
/// <param name="Runs">How many recent runs were compared.</param>
/// <param name="Required">How many the check needs before it concludes anything.</param>
/// <param name="Window">The span of the compared runs; null when there are none.</param>
public sealed record TrendSection(int Runs, int Required, SampleWindow? Window);

/// <summary>How long runs waited before their first job started, in seconds.</summary>
/// <param name="Runs">How many runs the statistics come from.</param>
/// <param name="MedianSeconds">The median (nearest rank).</param>
/// <param name="P90Seconds">The 90th percentile (nearest rank).</param>
/// <param name="MaxSeconds">The longest wait.</param>
public sealed record QueueStat(int Runs, double MedianSeconds, double P90Seconds, double MaxSeconds);

/// <summary>The CI-speed section: job run times over the newest successful push runs on main.</summary>
/// <param name="Workflow">The workflow file the runs belong to.</param>
/// <param name="Basis"><c>measured</c> or <c>inferred</c>: how the numbers were obtained.</param>
/// <param name="Runs">How many runs were sampled.</param>
/// <param name="Window">The span of the sampled runs; null when no run was sampled.</param>
/// <param name="Jobs">One entry per job and path, sorted by job then path.</param>
/// <param name="Trend">The runs the trend check used; null when no baseline was available. Schema version 2.</param>
/// <param name="Queue">The wait before the first job; null when no run reported one. Schema version 2.</param>
public sealed record CiSection(
  string Workflow,
  string Basis,
  int Runs,
  SampleWindow? Window,
  IReadOnlyList<JobStat> Jobs,
  TrendSection? Trend = null,
  QueueStat? Queue = null);

/// <summary>One day's delivery snapshot: aggregates and public data only, with a version for later readers.</summary>
/// <param name="Version">The schema version; <see cref="SnapshotJson.CurrentVersion"/>.</param>
/// <param name="Date">The day the snapshot is for (UTC).</param>
/// <param name="GeneratedAt">When the snapshot was taken.</param>
/// <param name="Repository"><c>owner/name</c> of the repository the data comes from.</param>
/// <param name="Ci">The CI-speed section.</param>
/// <param name="Flow">The flow section (#598); null in a snapshot written without it.</param>
public sealed record Snapshot(
  int Version,
  DateOnly Date,
  DateTimeOffset GeneratedAt,
  string Repository,
  CiSection Ci,
  FlowSection? Flow = null);

/// <summary>Builds the CI-speed section from sampled runs.</summary>
public static class CiSnapshot
{
  /// <summary>The basis of every number the tool computes from GitHub's recorded timestamps.</summary>
  public const string Measured = "measured";

  /// <summary>Builds the section.</summary>
  /// <param name="workflow">The workflow file the runs belong to.</param>
  /// <param name="runs">The sampled runs with the gated, successful jobs of each (see <see cref="Baselines.Samples"/>).</param>
  /// <param name="baseline">The pinned baseline (.github/ci-baseline.json); without it, no baseline or trend is reported.</param>
  /// <param name="constants">The trend constants; <see cref="TrendConstants.Default"/> when null.</param>
  /// <param name="queueSeconds">How long each sampled run waited before its first job started.</param>
  /// <returns>The section; the jobs are sorted so the same input gives the same file.</returns>
  public static CiSection Build(
    string workflow,
    IReadOnlyList<SampledRun> runs,
    BaselineFile? baseline = null,
    TrendConstants? constants = null,
    IReadOnlyList<double>? queueSeconds = null)
  {
    TrendConstants settings = constants ?? TrendConstants.Default;
    TrendResult? trend = null;
    if (baseline is not null)
    {
      HashSet<long> recent = [.. Trend.RecentRuns(baseline, runs.Select(item => item.Run), settings).Select(run => run.Id)];
      trend = Trend.Evaluate(baseline, [.. runs.Where(item => recent.Contains(item.Run.Id))], settings);
    }
    List<JobStat> jobs =
    [
      .. runs
        .SelectMany(item => item.Samples)
        .GroupBy(sample => (sample.Job, sample.Path))
        .Select(group => Stat(group.Key.Job, group.Key.Path, group.Select(sample => sample.Seconds), baseline, trend))
        .OrderBy(stat => stat.Job, StringComparer.Ordinal)
        .ThenBy(stat => stat.Path, StringComparer.Ordinal),
    ];
    TrendSection? trendSection = trend is null ? null : new TrendSection(trend.Recent.Count, settings.Runs, Window(trend.Recent));
    return new CiSection(workflow, Measured, runs.Count, Window(runs.Select(item => item.Run)), jobs, trendSection, Queue(queueSeconds));
  }

  /// <summary>How long a run waited between its creation and its first job starting.</summary>
  /// <param name="run">The run.</param>
  /// <param name="jobs">Every job of the run that ran.</param>
  /// <returns>The wait in seconds; null when no job reported a start or the start precedes the creation.</returns>
  public static double? QueueSeconds(WorkflowRun run, IReadOnlyList<JobTiming> jobs)
  {
    if (jobs.Count == 0)
    {
      return null;
    }
    var wait = (jobs.Min(job => job.StartedAt) - run.CreatedAt).TotalSeconds;
    return wait < 0 ? null : wait;
  }

  private static SampleWindow? Window(IEnumerable<WorkflowRun> runs)
  {
    List<WorkflowRun> list = [.. runs];
    return list.Count == 0 ? null : new SampleWindow(list.Min(run => run.CreatedAt), list.Max(run => run.CreatedAt));
  }

  private static QueueStat? Queue(IReadOnlyList<double>? seconds)
  {
    if (seconds is null || seconds.Count == 0)
    {
      return null;
    }
    Summary summary = Statistics.Summarize(seconds);
    return new QueueStat(summary.Count, Round(summary.Median), Round(summary.P90), Round(summary.Max));
  }

  private static JobStat Stat(string job, string path, IEnumerable<double> seconds, BaselineFile? baseline, TrendResult? trend)
  {
    Summary summary = Statistics.Summarize(seconds);
    JobBaseline? pinned = null;
    if (baseline is not null && baseline.Paths.TryGetValue(path, out PathBaseline? found))
    {
      found.Jobs.TryGetValue(job, out pinned);
    }
    JobBaselineStat? pinnedStat = pinned is null ? null : new JobBaselineStat(pinned.Count, Round(pinned.Median), Round(pinned.Threshold));
    TrendRow? row = pinned is null ? null : trend?.Rows.FirstOrDefault(item => item.Path == path && item.Job == job);
    JobTrend? jobTrend = null;
    if (row is not null && trend is not null)
    {
      var verdict = trend.Enough ? Verdict(row.Verdict) : "inconclusive";
      jobTrend = new JobTrend(verdict, row.RecentCount, Round(row.Shift), Round(row.Low), Round(row.High), Round(row.MinEffect));
    }
    return new JobStat(
      job, path, summary.Count, Round(summary.Min), Round(summary.Median), Round(summary.P90), Round(summary.Max), pinnedStat, jobTrend);
  }

  private static string Verdict(TrendVerdict verdict) => verdict switch
  {
    TrendVerdict.Slower => "slower",
    TrendVerdict.Faster => "faster",
    _ => "noShift",
  };

  private static double Round(double seconds) => Math.Round(seconds, 1, MidpointRounding.AwayFromZero);
}

/// <summary>Writes a snapshot as JSON in a fixed property order, so one day's file only changes when its data does.</summary>
public static class SnapshotJson
{
  /// <summary>The schema version this tool writes; it accepts <see cref="OldestVersion"/> up to this one.</summary>
  public const int CurrentVersion = 2;

  /// <summary>The oldest schema version still accepted: version 1 has no baseline, trend or queue fields.</summary>
  public const int OldestVersion = 1;

  /// <summary>The format of a timestamp in a snapshot: UTC, whole seconds.</summary>
  public const string TimeFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'";

  /// <summary>The format of a date in a snapshot.</summary>
  public const string DateFormat = "yyyy-MM-dd";

  /// <summary>Serialises a snapshot.</summary>
  /// <param name="snapshot">The snapshot.</param>
  /// <returns>Indented JSON ending in a newline.</returns>
  public static string Write(Snapshot snapshot)
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
    {
      writer.WriteStartObject();
      writer.WriteNumber("version", snapshot.Version);
      writer.WriteString("date", snapshot.Date.ToString(DateFormat, CultureInfo.InvariantCulture));
      writer.WriteString("generatedAt", Time(snapshot.GeneratedAt));
      writer.WriteString("repository", snapshot.Repository);
      writer.WritePropertyName("ci");
      WriteCi(writer, snapshot.Ci);
      if (snapshot.Flow is not null)
      {
        writer.WritePropertyName("flow");
        FlowJson.Write(writer, snapshot.Flow);
      }
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray()) + "\n";
  }

  private static void WriteCi(Utf8JsonWriter writer, CiSection ci)
  {
    writer.WriteStartObject();
    writer.WriteString("workflow", ci.Workflow);
    writer.WriteString("basis", ci.Basis);
    writer.WriteNumber("runs", ci.Runs);
    WriteWindow(writer, ci.Window);
    WriteTrend(writer, ci.Trend);
    WriteQueue(writer, ci.Queue);
    writer.WriteStartArray("jobs");
    foreach (JobStat job in ci.Jobs)
    {
      writer.WriteStartObject();
      writer.WriteString("job", job.Job);
      writer.WriteString("path", job.Path);
      writer.WriteNumber("count", job.Count);
      writer.WriteNumber("minSeconds", job.MinSeconds);
      writer.WriteNumber("medianSeconds", job.MedianSeconds);
      writer.WriteNumber("p90Seconds", job.P90Seconds);
      writer.WriteNumber("maxSeconds", job.MaxSeconds);
      WriteBaseline(writer, job.Baseline);
      WriteJobTrend(writer, job.Trend);
      writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
  }

  private static void WriteWindow(Utf8JsonWriter writer, SampleWindow? window)
  {
    if (window is null)
    {
      writer.WriteNull("window");
      return;
    }
    writer.WriteStartObject("window");
    writer.WriteString("from", Time(window.From));
    writer.WriteString("to", Time(window.To));
    writer.WriteEndObject();
  }

  private static void WriteTrend(Utf8JsonWriter writer, TrendSection? trend)
  {
    if (trend is null)
    {
      writer.WriteNull("trend");
      return;
    }
    writer.WriteStartObject("trend");
    writer.WriteNumber("runs", trend.Runs);
    writer.WriteNumber("required", trend.Required);
    WriteWindow(writer, trend.Window);
    writer.WriteEndObject();
  }

  private static void WriteQueue(Utf8JsonWriter writer, QueueStat? queue)
  {
    if (queue is null)
    {
      writer.WriteNull("queue");
      return;
    }
    writer.WriteStartObject("queue");
    writer.WriteNumber("runs", queue.Runs);
    writer.WriteNumber("medianSeconds", queue.MedianSeconds);
    writer.WriteNumber("p90Seconds", queue.P90Seconds);
    writer.WriteNumber("maxSeconds", queue.MaxSeconds);
    writer.WriteEndObject();
  }

  private static void WriteBaseline(Utf8JsonWriter writer, JobBaselineStat? baseline)
  {
    if (baseline is null)
    {
      writer.WriteNull("baseline");
      return;
    }
    writer.WriteStartObject("baseline");
    writer.WriteNumber("count", baseline.Count);
    writer.WriteNumber("medianSeconds", baseline.MedianSeconds);
    writer.WriteNumber("thresholdSeconds", baseline.ThresholdSeconds);
    writer.WriteEndObject();
  }

  private static void WriteJobTrend(Utf8JsonWriter writer, JobTrend? trend)
  {
    if (trend is null)
    {
      writer.WriteNull("trend");
      return;
    }
    writer.WriteStartObject("trend");
    writer.WriteString("verdict", trend.Verdict);
    writer.WriteNumber("recentRuns", trend.RecentRuns);
    writer.WriteNumber("shiftSeconds", trend.ShiftSeconds);
    writer.WriteNumber("lowSeconds", trend.LowSeconds);
    writer.WriteNumber("highSeconds", trend.HighSeconds);
    writer.WriteNumber("minEffectSeconds", trend.MinEffectSeconds);
    writer.WriteEndObject();
  }

  private static string Time(DateTimeOffset time) =>
    time.ToUniversalTime().ToString(TimeFormat, CultureInfo.InvariantCulture);
}
