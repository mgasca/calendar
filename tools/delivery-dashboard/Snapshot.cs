using System.Globalization;
using System.Text;
using System.Text.Json;
using CiTimings;

namespace DeliveryDashboard;

/// <summary>The oldest and newest run a section was computed from.</summary>
/// <param name="From">When the oldest sampled run was created.</param>
/// <param name="To">When the newest sampled run was created.</param>
public sealed record SampleWindow(DateTimeOffset From, DateTimeOffset To);

/// <summary>Statistics of one CI job on one path over the sampled runs, in seconds.</summary>
/// <param name="Job">The job's display name.</param>
/// <param name="Path"><c>check</c> or <c>publication</c> (ADR-0045).</param>
/// <param name="Count">How many runs the statistics come from.</param>
/// <param name="MinSeconds">The shortest execution time.</param>
/// <param name="MedianSeconds">The median execution time (nearest rank).</param>
/// <param name="P90Seconds">The 90th percentile (nearest rank).</param>
/// <param name="MaxSeconds">The longest execution time.</param>
public sealed record JobStat(
  string Job,
  string Path,
  int Count,
  double MinSeconds,
  double MedianSeconds,
  double P90Seconds,
  double MaxSeconds);

/// <summary>The CI-speed section: job run times over the newest successful push runs on main.</summary>
/// <param name="Workflow">The workflow file the runs belong to.</param>
/// <param name="Basis"><c>measured</c> or <c>inferred</c>: how the numbers were obtained.</param>
/// <param name="Runs">How many runs were sampled.</param>
/// <param name="Window">The span of the sampled runs; null when no run was sampled.</param>
/// <param name="Jobs">One entry per job and path, sorted by job then path.</param>
public sealed record CiSection(string Workflow, string Basis, int Runs, SampleWindow? Window, IReadOnlyList<JobStat> Jobs);

/// <summary>One day's delivery snapshot: aggregates and public data only, with a version for later readers.</summary>
/// <param name="Version">The schema version; <see cref="SnapshotJson.CurrentVersion"/>.</param>
/// <param name="Date">The day the snapshot is for (UTC).</param>
/// <param name="GeneratedAt">When the snapshot was taken.</param>
/// <param name="Repository"><c>owner/name</c> of the repository the data comes from.</param>
/// <param name="Ci">The CI-speed section.</param>
/// <param name="Quality">The quality section (#599); null in a snapshot written without it.</param>
public sealed record Snapshot(
  int Version,
  DateOnly Date,
  DateTimeOffset GeneratedAt,
  string Repository,
  CiSection Ci,
  QualitySection? Quality = null);

/// <summary>Builds the CI-speed section from sampled runs.</summary>
public static class CiSnapshot
{
  /// <summary>The basis of every number the tool computes from GitHub's recorded timestamps.</summary>
  public const string Measured = "measured";

  /// <summary>Builds the section.</summary>
  /// <param name="workflow">The workflow file the runs belong to.</param>
  /// <param name="runs">The sampled runs with the gated, successful jobs of each (see <see cref="Baselines.Samples"/>).</param>
  /// <returns>The section; the jobs are sorted so the same input gives the same file.</returns>
  public static CiSection Build(string workflow, IReadOnlyList<SampledRun> runs)
  {
    SampleWindow? window = runs.Count == 0
      ? null
      : new SampleWindow(runs.Min(item => item.Run.CreatedAt), runs.Max(item => item.Run.CreatedAt));
    List<JobStat> jobs =
    [
      .. runs
        .SelectMany(item => item.Samples)
        .GroupBy(sample => (sample.Job, sample.Path))
        .Select(group => Stat(group.Key.Job, group.Key.Path, group.Select(sample => sample.Seconds)))
        .OrderBy(stat => stat.Job, StringComparer.Ordinal)
        .ThenBy(stat => stat.Path, StringComparer.Ordinal),
    ];
    return new CiSection(workflow, Measured, runs.Count, window, jobs);
  }

  private static JobStat Stat(string job, string path, IEnumerable<double> seconds)
  {
    Summary summary = Statistics.Summarize(seconds);
    return new JobStat(job, path, summary.Count, Round(summary.Min), Round(summary.Median), Round(summary.P90), Round(summary.Max));
  }

  private static double Round(double seconds) => Math.Round(seconds, 1, MidpointRounding.AwayFromZero);
}

/// <summary>Writes a snapshot as JSON in a fixed property order, so one day's file only changes when its data does.</summary>
public static class SnapshotJson
{
  /// <summary>The schema version this tool writes and accepts.</summary>
  public const int CurrentVersion = 1;

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
      if (snapshot.Quality is not null)
      {
        writer.WritePropertyName("quality");
        QualityJson.Write(writer, snapshot.Quality);
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
    if (ci.Window is null)
    {
      writer.WriteNull("window");
    }
    else
    {
      writer.WriteStartObject("window");
      writer.WriteString("from", Time(ci.Window.From));
      writer.WriteString("to", Time(ci.Window.To));
      writer.WriteEndObject();
    }
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
      writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
  }

  private static string Time(DateTimeOffset time) =>
    time.ToUniversalTime().ToString(TimeFormat, CultureInfo.InvariantCulture);
}
