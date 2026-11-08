using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace CiTimings;

/// <summary>The constants that turn a baseline sample into a threshold (ADR 0045).</summary>
/// <param name="Alpha">The false-failure budget per run, across every gated job (0.001 is 0.1 % of runs).</param>
/// <param name="Jobs">How many jobs share the budget; each job gets <c>Alpha / Jobs</c> (Bonferroni).</param>
/// <param name="FloorSeconds">The smallest margin above the median, in seconds.</param>
/// <param name="RelativeMargin">The smallest margin above the median, as a fraction of it (0.1 is 10 %).</param>
public sealed record GateConstants(double Alpha, int Jobs, double FloorSeconds, double RelativeMargin)
{
  /// <summary>
  /// The constants of ADR 0045 as recalibrated in record 0017: 0.1 % across 5 jobs (the baseline sets the real count),
  /// at least 15 s and 10 % above the median.
  /// </summary>
  public static GateConstants Default { get; } = new(0.001, 5, 15, 0.10);

  /// <summary>The one-sided normal quantile for the per-job budget, <c>Φ⁻¹(1 − α/J)</c>.</summary>
  public double Z => Probability.NormalQuantile(1 - (Alpha / Jobs));
}

/// <summary>One job's pinned statistics on one path, and the threshold derived from them.</summary>
/// <param name="Count">How many baseline runs had the job succeed.</param>
/// <param name="Median">The nearest-rank median duration, in seconds.</param>
/// <param name="LogMedian">The median of ln(seconds).</param>
/// <param name="LogMad">The median absolute deviation of ln(seconds), unscaled.</param>
/// <param name="P90">The nearest-rank 90th percentile, in seconds.</param>
/// <param name="P95">The nearest-rank 95th percentile, in seconds.</param>
/// <param name="Max">The largest baseline duration, in seconds.</param>
/// <param name="Threshold">The whole number of seconds above which a run of the job fails the gate.</param>
/// <param name="Seconds">The sample itself, ascending, so the trend check (#386) can test later runs against it without the API.</param>
public sealed record JobBaseline(
  int Count,
  double Median,
  double LogMedian,
  double LogMad,
  double P90,
  double P95,
  double Max,
  double Threshold,
  IReadOnlyList<double> Seconds)
{
  /// <summary>Equal when every statistic and every sampled duration are equal.</summary>
  /// <param name="other">The other baseline.</param>
  /// <returns>True when equal.</returns>
  public bool Equals(JobBaseline? other) =>
    other is not null
    && (Count, Median, LogMedian, LogMad) == (other.Count, other.Median, other.LogMedian, other.LogMad)
    && (P90, P95, Max, Threshold) == (other.P90, other.P95, other.Max, other.Threshold)
    && Seconds.SequenceEqual(other.Seconds);

  /// <inheritdoc/>
  public override int GetHashCode() => HashCode.Combine(Count, Median, Threshold, Seconds.Count);
}

/// <summary>The baseline of one path: which runs it came from, and every job's statistics.</summary>
/// <param name="Path"><c>check</c> or <c>publication</c>.</param>
/// <param name="Status"><c>pinned</c> when every job has at least the minimum number of runs, otherwise <c>provisional</c>.</param>
/// <param name="Runs">The baseline runs, oldest first.</param>
/// <param name="Jobs">Each job's baseline, by job name.</param>
public sealed record PathBaseline(
  string Path,
  string Status,
  IReadOnlyList<WorkflowRun> Runs,
  IReadOnlyDictionary<string, JobBaseline> Jobs);

/// <summary>The committed baseline file: the method, its constants, and one baseline per path.</summary>
/// <param name="Workflow">The workflow file the runs belong to.</param>
/// <param name="Record">The benchmark record that measured it, for example <c>docs/benchmarks/0014-….md</c>.</param>
/// <param name="MinRuns">The number of runs a job needs on a path before its threshold is pinned.</param>
/// <param name="Constants">The constants the thresholds were derived with.</param>
/// <param name="Paths">The baselines, by path.</param>
public sealed record BaselineFile(
  string Workflow,
  string Record,
  int MinRuns,
  GateConstants Constants,
  IReadOnlyDictionary<string, PathBaseline> Paths);

/// <summary>One job of one run, with the path it counts on.</summary>
/// <param name="RunId">The run.</param>
/// <param name="Job">The job's name.</param>
/// <param name="Path"><c>check</c> or <c>publication</c>.</param>
/// <param name="Seconds">The job's execution time.</param>
public sealed record PathSample(long RunId, string Job, string Path, double Seconds);

/// <summary>Which jobs are gated, which path a run is on, and the per-path statistics.</summary>
public static class Baselines
{
  /// <summary>The path of a run whose Docs site job built the publication artifact: a push to main, or a docs-only pull request.</summary>
  public const string PublicationPath = "publication";

  /// <summary>The path of every other run: a dispatch, and every pull request that is not docs-only.</summary>
  public const string CheckPath = "check";

  /// <summary>The Docs site job, whose publication step decides the path.</summary>
  public const string DocsSiteJob = "Docs site";

  /// <summary>The step that runs only on the publication path.</summary>
  public const string PublicationStep = "Build and verify publication artifact";

  /// <summary>Jobs never gated: the gate's own job, and the optional cancel job.</summary>
  public static readonly IReadOnlySet<string> Ungated =
    new HashSet<string>(StringComparer.Ordinal) { "CI result", "Cancel superseded runs" };

  /// <summary>
  /// The path a run is on, from what it did rather than its event: <see cref="PublicationPath"/> when the Docs site step
  /// "Build and verify publication artifact" succeeded, otherwise <see cref="CheckPath"/> (ADR 0045). Every gated job
  /// of the run counts on that path.
  /// </summary>
  /// <param name="jobs">The run's jobs.</param>
  /// <returns><see cref="PublicationPath"/> or <see cref="CheckPath"/>.</returns>
  public static string PathOf(IEnumerable<JobTiming> jobs) =>
    jobs
      .Where(job => string.Equals(job.Name, DocsSiteJob, StringComparison.Ordinal))
      .SelectMany(job => job.Steps)
      .Any(step => string.Equals(step.Name, PublicationStep, StringComparison.Ordinal)
        && string.Equals(step.Conclusion, "success", StringComparison.Ordinal))
      ? PublicationPath
      : CheckPath;

  /// <summary>The gated, successful jobs of a run, each on the run's path.</summary>
  /// <param name="run">The run.</param>
  /// <param name="jobs">The run's jobs.</param>
  /// <returns>One sample per gated job that succeeded.</returns>
  public static IEnumerable<PathSample> Samples(WorkflowRun run, IReadOnlyCollection<JobTiming> jobs)
  {
    var path = PathOf(jobs);
    return jobs
      .Where(job => string.Equals(job.Conclusion, "success", StringComparison.Ordinal) && !Ungated.Contains(job.Name))
      .Select(job => new PathSample(run.Id, job.Name, path, job.Seconds));
  }


  /// <summary>Derives one job's statistics and threshold from its baseline durations.</summary>
  /// <param name="seconds">The durations, in any order, not empty, all positive.</param>
  /// <param name="constants">The gate's constants.</param>
  /// <returns>The job's baseline.</returns>
  public static JobBaseline Derive(IEnumerable<double> seconds, GateConstants constants)
  {
    double[] sorted = [.. seconds.Order()];
    if (sorted.Length == 0)
    {
      throw new ArgumentException("a baseline needs at least one duration", nameof(seconds));
    }
    double[] logs = [.. sorted.Select(value => Math.Log(value))];
    var logMedian = Statistics.Percentile(logs, 0.5);
    double[] deviations = [.. logs.Select(value => Math.Abs(value - logMedian)).Order()];
    var logMad = Statistics.Percentile(deviations, 0.5);
    var median = Statistics.Percentile(sorted, 0.5);
    return new JobBaseline(
      sorted.Length,
      median,
      Math.Round(logMedian, 6),
      Math.Round(logMad, 6),
      Statistics.Percentile(sorted, 0.9),
      Statistics.Percentile(sorted, 0.95),
      sorted[^1],
      Threshold(median, logMedian, logMad, constants),
      sorted);
  }

  /// <summary>
  /// <c>max(exp(m + z · 1.4826 · MAD), median + max(floor, r · median))</c>, rounded up to a whole second, since the jobs
  /// API reports whole seconds.
  /// </summary>
  /// <param name="median">The median duration, in seconds.</param>
  /// <param name="logMedian">The median of ln(seconds).</param>
  /// <param name="logMad">The median absolute deviation of ln(seconds).</param>
  /// <param name="constants">The gate's constants.</param>
  /// <returns>The threshold, in whole seconds.</returns>
  public static double Threshold(double median, double logMedian, double logMad, GateConstants constants)
  {
    var bound = Math.Exp(logMedian + (constants.Z * 1.4826 * logMad));
    var practical = median + Math.Max(constants.FloorSeconds, constants.RelativeMargin * median);
    // Rounded to a microsecond first, so floating-point noise (55.000000001) does not add a whole second.
    return Math.Ceiling(Math.Round(Math.Max(bound, practical), 6));
  }

  /// <summary>Builds one path's baseline from the samples of its runs.</summary>
  /// <param name="path">The path.</param>
  /// <param name="runs">The runs the samples came from.</param>
  /// <param name="samples">The samples; those of other paths are ignored.</param>
  /// <param name="minRuns">The number of runs every job needs for the path to be pinned.</param>
  /// <param name="constants">The gate's constants.</param>
  /// <returns>The path's baseline, or null when no sample is on the path.</returns>
  public static PathBaseline? Build(
    string path,
    IEnumerable<WorkflowRun> runs,
    IEnumerable<PathSample> samples,
    int minRuns,
    GateConstants constants)
  {
    List<PathSample> onPath = [.. samples.Where(sample => string.Equals(sample.Path, path, StringComparison.Ordinal))];
    if (onPath.Count == 0)
    {
      return null;
    }
    HashSet<long> ids = [.. onPath.Select(sample => sample.RunId)];
    var jobs = new SortedDictionary<string, JobBaseline>(StringComparer.Ordinal);
    foreach (IGrouping<string, PathSample> group in onPath.GroupBy(sample => sample.Job, StringComparer.Ordinal))
    {
      jobs[group.Key] = Derive(group.Select(sample => sample.Seconds), constants);
    }
    var status = jobs.Values.All(job => job.Count >= minRuns) ? "pinned" : "provisional";
    return new PathBaseline(path, status, [.. runs.Where(run => ids.Contains(run.Id)).OrderBy(run => run.CreatedAt)], jobs);
  }
}

/// <summary>The normal quantile and the binomial bound the gate and its back-test need.</summary>
public static class Probability
{
  /// <summary>The standard normal quantile Φ⁻¹(p), by Acklam's rational approximation (relative error below 1.2e-9).</summary>
  /// <param name="p">A probability strictly between 0 and 1.</param>
  /// <returns>The z with Φ(z) = p.</returns>
  public static double NormalQuantile(double p)
  {
    if (p is <= 0 or >= 1)
    {
      throw new ArgumentOutOfRangeException(nameof(p), p, "must be strictly between 0 and 1");
    }
    double[] a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01,
      2.506628277459239e+00];
    double[] b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    double[] c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00,
      2.938163982698783e+00];
    double[] d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const double Low = 0.02425;
    if (p < Low)
    {
      var q = Math.Sqrt(-2 * Math.Log(p));
      return Horner(c, q) / ((Horner(d, q) * q) + 1);
    }
    if (p > 1 - Low)
    {
      return -NormalQuantile(1 - p);
    }
    var r = p - 0.5;
    var s = r * r;
    return Horner(a, s) * r / ((Horner(b, s) * s) + 1);
  }

  /// <summary>Evaluates a polynomial by Horner's rule, highest coefficient first.</summary>
  /// <param name="coefficients">The coefficients, highest power first.</param>
  /// <param name="x">The point.</param>
  /// <returns>The value.</returns>
  private static double Horner(IReadOnlyList<double> coefficients, double x) =>
    coefficients.Aggregate(0.0, (value, coefficient) => (value * x) + coefficient);

  /// <summary>
  /// The one-sided Clopper–Pearson upper confidence bound on a rate: the largest p for which seeing at most
  /// <paramref name="failures"/> in <paramref name="trials"/> still has probability at least 1 − confidence.
  /// </summary>
  /// <param name="failures">The observed count.</param>
  /// <param name="trials">The number of trials, at least 1.</param>
  /// <param name="confidence">For example 0.95.</param>
  /// <returns>The upper bound, between 0 and 1.</returns>
  public static double UpperBound(int failures, int trials, double confidence)
  {
    if (failures >= trials)
    {
      return 1;
    }
    var low = (double)failures / trials;
    double high = 1;
    for (var iteration = 0; iteration < 100; iteration++)
    {
      var middle = (low + high) / 2;
      if (BinomialCdf(failures, trials, middle) > 1 - confidence)
      {
        low = middle;
      }
      else
      {
        high = middle;
      }
    }
    return high;
  }

  /// <summary>P(X ≤ k) for X ~ Binomial(n, p).</summary>
  /// <param name="k">The count.</param>
  /// <param name="n">The trials.</param>
  /// <param name="p">The success probability.</param>
  /// <returns>The cumulative probability.</returns>
  public static double BinomialCdf(int k, int n, double p)
  {
    if (p <= 0)
    {
      return 1;
    }
    if (p >= 1)
    {
      return k >= n ? 1 : 0;
    }
    double total = 0;
    var logChoose = 0.0;
    for (var i = 0; i <= k; i++)
    {
      if (i > 0)
      {
        logChoose += Math.Log(n - i + 1) - Math.Log(i);
      }
      total += Math.Exp(logChoose + (i * Math.Log(p)) + ((n - i) * Math.Log(1 - p)));
    }
    return Math.Min(total, 1);
  }
}

/// <summary>A job of a held-out run that took longer than its path's threshold.</summary>
/// <param name="RunId">The run.</param>
/// <param name="Job">The job.</param>
/// <param name="Path">The path it counted on.</param>
/// <param name="Seconds">How long it took.</param>
/// <param name="Threshold">The threshold it exceeded.</param>
public sealed record Exceedance(long RunId, string Job, string Path, double Seconds, double Threshold);

/// <summary>The back-test: the baseline's thresholds applied to runs it was not measured from.</summary>
/// <param name="Runs">How many held-out runs had at least one gated job with a pinned or provisional threshold.</param>
/// <param name="FailedRuns">How many of them the gate would have failed.</param>
/// <param name="JobChecks">Per job and path: (checked, exceeded).</param>
/// <param name="Exceedances">Every exceedance.</param>
public sealed record BackTest(
  int Runs,
  int FailedRuns,
  IReadOnlyDictionary<(string Job, string Path), (int Checked, int Exceeded)> JobChecks,
  IReadOnlyList<Exceedance> Exceedances);

/// <summary>Back-tests a baseline, and reads and writes the baseline file.</summary>
public static class BaselineIo
{
  // Relaxed escaping keeps "+" and "'" readable in the method text; the file is read by jq and the tool, never embedded in HTML.
  private static readonly JsonWriterOptions WriterOptions = new()
  {
    Indented = true,
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
  };

  /// <summary>
  /// Applies each sample's path threshold. A job with no baseline on its path is not checked, and a run the baseline
  /// itself was measured from is left out.
  /// </summary>
  /// <param name="baseline">The baseline.</param>
  /// <param name="samples">The held-out runs' samples.</param>
  /// <returns>The counts and the exceedances.</returns>
  public static BackTest Evaluate(BaselineFile baseline, IEnumerable<PathSample> samples)
  {
    var checks = new SortedDictionary<(string Job, string Path), (int Checked, int Exceeded)>();
    List<Exceedance> exceedances = [];
    HashSet<long> checkedRuns = [];
    // A run the baseline was measured from is never held out, even when the two windows overlap.
    HashSet<long> pinned = [.. baseline.Paths.Values.SelectMany(path => path.Runs).Select(run => run.Id)];
    foreach (PathSample sample in samples.Where(sample => !pinned.Contains(sample.RunId)))
    {
      if (!baseline.Paths.TryGetValue(sample.Path, out PathBaseline? path) || !path.Jobs.TryGetValue(sample.Job, out JobBaseline? job))
      {
        continue;
      }
      checkedRuns.Add(sample.RunId);
      var exceeded = sample.Seconds > job.Threshold;
      (int Checked, int Exceeded) count = checks.GetValueOrDefault((sample.Job, sample.Path));
      checks[(sample.Job, sample.Path)] = (count.Checked + 1, count.Exceeded + (exceeded ? 1 : 0));
      if (exceeded)
      {
        exceedances.Add(new Exceedance(sample.RunId, sample.Job, sample.Path, sample.Seconds, job.Threshold));
      }
    }
    var failed = exceedances.Select(item => item.RunId).Distinct().Count();
    return new BackTest(checkedRuns.Count, failed, checks, exceedances);
  }

  /// <summary>Writes the baseline file as indented JSON with sorted keys, so a re-run diffs cleanly.</summary>
  /// <param name="baseline">The baseline.</param>
  /// <returns>The JSON text, ending with a newline.</returns>
  public static string Write(BaselineFile baseline)
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, WriterOptions))
    {
      writer.WriteStartObject();
      writer.WriteNumber("schema", 1);
      writer.WriteString("workflow", baseline.Workflow);
      writer.WriteString("record", baseline.Record);
      writer.WriteString(
        "method",
        "threshold = ceil(max(exp(logMedian + z * 1.4826 * logMad), median + max(floorSeconds, relativeMargin * median))); "
        + "z = NormalQuantile(1 - alpha / jobs); nearest-rank statistics of each job's start-to-end seconds (ADR 0045)");
      writer.WriteNumber("minRuns", baseline.MinRuns);
      writer.WriteStartObject("constants");
      writer.WriteNumber("alpha", baseline.Constants.Alpha);
      writer.WriteNumber("jobs", baseline.Constants.Jobs);
      writer.WriteNumber("z", Math.Round(baseline.Constants.Z, 4));
      writer.WriteNumber("floorSeconds", baseline.Constants.FloorSeconds);
      writer.WriteNumber("relativeMargin", baseline.Constants.RelativeMargin);
      writer.WriteEndObject();
      writer.WriteStartObject("paths");
      foreach (PathBaseline path in baseline.Paths.Values.OrderBy(path => path.Path, StringComparer.Ordinal))
      {
        WritePath(writer, path);
      }
      writer.WriteEndObject();
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray()) + "\n";
  }

  /// <summary>Reads a baseline file written by <see cref="Write"/>.</summary>
  /// <param name="json">The file's text.</param>
  /// <returns>The baseline.</returns>
  public static BaselineFile Read(string json)
  {
    using var document = JsonDocument.Parse(json);
    JsonElement root = document.RootElement;
    JsonElement constants = root.GetProperty("constants");
    var paths = new SortedDictionary<string, PathBaseline>(StringComparer.Ordinal);
    foreach (JsonProperty path in root.GetProperty("paths").EnumerateObject())
    {
      var jobs = new SortedDictionary<string, JobBaseline>(StringComparer.Ordinal);
      foreach (JsonProperty job in path.Value.GetProperty("jobs").EnumerateObject())
      {
        JsonElement value = job.Value;
        jobs[job.Name] = new JobBaseline(
          value.GetProperty("n").GetInt32(),
          value.GetProperty("median").GetDouble(),
          value.GetProperty("logMedian").GetDouble(),
          value.GetProperty("logMad").GetDouble(),
          value.GetProperty("p90").GetDouble(),
          value.GetProperty("p95").GetDouble(),
          value.GetProperty("max").GetDouble(),
          value.GetProperty("threshold").GetDouble(),
          [.. value.GetProperty("seconds").EnumerateArray().Select(seconds => seconds.GetDouble())]);
      }
      List<WorkflowRun> runs =
      [
        .. path.Value.GetProperty("runs").EnumerateArray().Select(run => new WorkflowRun(
          run.GetProperty("id").GetInt64(),
          "completed",
          "success",
          run.GetProperty("createdAt").GetDateTimeOffset(),
          run.GetProperty("event").GetString() ?? string.Empty,
          "main",
          run.GetProperty("commit").GetString() ?? string.Empty)),
      ];
      paths[path.Name] = new PathBaseline(path.Name, path.Value.GetProperty("status").GetString() ?? string.Empty, runs, jobs);
    }
    return new BaselineFile(
      root.GetProperty("workflow").GetString() ?? string.Empty,
      root.GetProperty("record").GetString() ?? string.Empty,
      root.GetProperty("minRuns").GetInt32(),
      new GateConstants(
        constants.GetProperty("alpha").GetDouble(),
        constants.GetProperty("jobs").GetInt32(),
        constants.GetProperty("floorSeconds").GetDouble(),
        constants.GetProperty("relativeMargin").GetDouble()),
      paths);
  }

  private static void WritePath(Utf8JsonWriter writer, PathBaseline path)
  {
    writer.WriteStartObject(path.Path);
    writer.WriteString("status", path.Status);
    writer.WriteNumber("n", path.Runs.Count);
    if (path.Runs.Count > 0)
    {
      writer.WriteStartObject("window");
      writer.WriteString("from", path.Runs[0].CreatedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture));
      writer.WriteString("to", path.Runs[^1].CreatedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture));
      writer.WriteString("firstCommit", path.Runs[0].HeadSha);
      writer.WriteString("lastCommit", path.Runs[^1].HeadSha);
      writer.WriteEndObject();
    }
    writer.WriteStartObject("jobs");
    foreach (KeyValuePair<string, JobBaseline> entry in path.Jobs.OrderBy(entry => entry.Key, StringComparer.Ordinal))
    {
      var name = entry.Key;
      JobBaseline job = entry.Value;
      writer.WriteStartObject(name);
      writer.WriteNumber("n", job.Count);
      writer.WriteNumber("median", job.Median);
      writer.WriteNumber("logMedian", job.LogMedian);
      writer.WriteNumber("logMad", job.LogMad);
      writer.WriteNumber("p90", job.P90);
      writer.WriteNumber("p95", job.P95);
      writer.WriteNumber("max", job.Max);
      writer.WriteNumber("threshold", job.Threshold);
      writer.WriteStartArray("seconds");
      foreach (var seconds in job.Seconds)
      {
        writer.WriteNumberValue(seconds);
      }
      writer.WriteEndArray();
      writer.WriteEndObject();
    }
    writer.WriteEndObject();
    writer.WriteStartArray("runs");
    foreach (WorkflowRun run in path.Runs)
    {
      writer.WriteStartObject();
      writer.WriteNumber("id", run.Id);
      writer.WriteString("createdAt", run.CreatedAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture));
      writer.WriteString("event", run.Event);
      writer.WriteString("commit", run.HeadSha);
      writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
  }
}

/// <summary>Renders the baseline and its back-test as Markdown for the benchmark record.</summary>
public static class BaselineReport
{
  /// <summary>One row per path and job: n, median, MAD of ln seconds, p90, p95, max and the threshold.</summary>
  /// <param name="baseline">The baseline.</param>
  /// <returns>A Markdown table.</returns>
  public static string Table(BaselineFile baseline)
  {
    var text = new StringBuilder();
    text.AppendLine("| Path | Job | n | median | log-MAD | p90 | p95 | max | threshold | status |");
    text.AppendLine("| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |");
    foreach (PathBaseline path in baseline.Paths.Values.OrderBy(path => path.Path, StringComparer.Ordinal))
    {
      foreach (KeyValuePair<string, JobBaseline> entry in path.Jobs.OrderBy(entry => entry.Key, StringComparer.Ordinal))
      {
        var name = entry.Key;
        JobBaseline job = entry.Value;
        text.Append(CultureInfo.InvariantCulture, $"| {path.Path} | {name} | {job.Count} | {Report.Clock(job.Median)} |")
          .Append(CultureInfo.InvariantCulture, $" {job.LogMad.ToString("F3", CultureInfo.InvariantCulture)} | {Report.Clock(job.P90)} |")
          .Append(CultureInfo.InvariantCulture, $" {Report.Clock(job.P95)} | {Report.Clock(job.Max)} | {Report.Clock(job.Threshold)} |")
          .Append(CultureInfo.InvariantCulture, $" {path.Status} |")
          .AppendLine();
      }
    }
    return text.ToString();
  }

  /// <summary>The back-test: per job and path, then per run, with the observed rate and its one-sided 95 % upper bound.</summary>
  /// <param name="test">The back-test.</param>
  /// <returns>Markdown: a table, a summary line and the exceedances, if any.</returns>
  public static string BackTestTable(BackTest test)
  {
    var text = new StringBuilder();
    text.AppendLine("| Path | Job | held-out runs | exceeded | observed rate | 95 % upper bound |");
    text.AppendLine("| --- | --- | --: | --: | --: | --: |");
    IEnumerable<KeyValuePair<(string Job, string Path), (int Checked, int Exceeded)>> rows = test.JobChecks
      .OrderBy(entry => entry.Key.Path, StringComparer.Ordinal)
      .ThenBy(entry => entry.Key.Job, StringComparer.Ordinal);
    foreach (KeyValuePair<(string Job, string Path), (int Checked, int Exceeded)> row in rows)
    {
      var job = row.Key.Job;
      var path = row.Key.Path;
      var count = row.Value.Checked;
      var exceeded = row.Value.Exceeded;
      text.Append(CultureInfo.InvariantCulture, $"| {path} | {job} | {count} | {exceeded} | {Percent((double)exceeded / count)} |")
        .Append(CultureInfo.InvariantCulture, $" {Percent(Probability.UpperBound(exceeded, count, 0.95))} |")
        .AppendLine();
    }
    text.AppendLine();
    if (test.Runs == 0)
    {
      text.AppendLine("No held-out run had a gated job with a baseline.");
      return text.ToString();
    }
    text.Append(CultureInfo.InvariantCulture, $"Runs the gate would have failed: **{test.FailedRuns} of {test.Runs}**")
      .Append(CultureInfo.InvariantCulture, $" ({Percent((double)test.FailedRuns / test.Runs)}; one-sided 95 % upper bound ")
      .Append(CultureInfo.InvariantCulture, $"{Percent(Probability.UpperBound(test.FailedRuns, test.Runs, 0.95))}).")
      .AppendLine();
    foreach (Exceedance item in test.Exceedances)
    {
      text.Append(CultureInfo.InvariantCulture, $"- run {item.RunId}: {item.Job} ({item.Path}) took {Report.Clock(item.Seconds)}")
        .Append(CultureInfo.InvariantCulture, $" against a threshold of {Report.Clock(item.Threshold)}")
        .AppendLine();
    }
    return text.ToString();
  }

  /// <summary>Per path: its status, how many runs, the window they span and its first and last commit.</summary>
  /// <param name="baseline">The baseline.</param>
  /// <returns>A Markdown table.</returns>
  public static string Window(BaselineFile baseline)
  {
    var text = new StringBuilder();
    text.AppendLine("| Path | status | runs | events | from | to | span | commits |");
    text.AppendLine("| --- | --- | --: | --- | --- | --- | --: | --- |");
    foreach (PathBaseline path in baseline.Paths.Values.OrderBy(path => path.Path, StringComparer.Ordinal))
    {
      if (path.Runs.Count == 0)
      {
        continue;
      }
      IEnumerable<string> events = path.Runs.Select(run => run.Event).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
      var commits = path.Runs.Select(run => run.HeadSha).Distinct(StringComparer.Ordinal).Count();
      TimeSpan span = path.Runs[^1].CreatedAt - path.Runs[0].CreatedAt;
      text.Append(CultureInfo.InvariantCulture, $"| {path.Path} | {path.Status} | {path.Runs.Count} | {string.Join(", ", events)} |")
        .Append(CultureInfo.InvariantCulture, $" {path.Runs[0].CreatedAt.ToUniversalTime():yyyy-MM-dd HH:mm}Z |")
        .Append(CultureInfo.InvariantCulture, $" {path.Runs[^1].CreatedAt.ToUniversalTime():yyyy-MM-dd HH:mm}Z |")
        .Append(CultureInfo.InvariantCulture, $" {span.TotalHours.ToString("F1", CultureInfo.InvariantCulture)} h | {commits} |")
        .AppendLine();
    }
    return text.ToString();
  }

  private static string Percent(double rate) => (rate * 100).ToString("F1", CultureInfo.InvariantCulture) + " %";
}

/// <summary>A run and the gated samples of its jobs.</summary>
/// <param name="Run">The run.</param>
/// <param name="Samples">Its gated, successful jobs, each with its path.</param>
public sealed record SampledRun(WorkflowRun Run, IReadOnlyList<PathSample> Samples);

/// <summary>Which listed runs a baseline is measured from, and the file built from them.</summary>
public static class BaselineRuns
{
  /// <summary>Whether a run completed successfully, the only runs a baseline or a back-test counts.</summary>
  /// <param name="run">The run.</param>
  /// <returns>True for a completed, successful run.</returns>
  public static bool IsSuccessful(WorkflowRun run) =>
    string.Equals(run.Status, "completed", StringComparison.Ordinal) && string.Equals(run.Conclusion, "success", StringComparison.Ordinal);

  /// <summary>Whether a run is a push to <c>main</c> or a dispatch on it: the runs a baseline is measured from (ADR 0045).</summary>
  /// <param name="run">The run.</param>
  /// <returns>True for a push or <c>workflow_dispatch</c> run whose head branch is <c>main</c>.</returns>
  public static bool IsMain(WorkflowRun run) =>
    string.Equals(run.HeadBranch, "main", StringComparison.Ordinal) && run.Event is "push" or "workflow_dispatch";

  /// <summary>Builds the baseline file: one baseline per path that any sampled job counts on.</summary>
  /// <param name="workflow">The workflow file.</param>
  /// <param name="record">The benchmark record the baseline belongs to.</param>
  /// <param name="minRuns">The runs every job needs on a path for it to be pinned.</param>
  /// <param name="constants">The gate's constants; their job count is replaced by the number of jobs sampled.</param>
  /// <param name="sampled">The baseline runs with their samples.</param>
  /// <returns>The file.</returns>
  public static BaselineFile Build(
    string workflow,
    string record,
    int minRuns,
    GateConstants constants,
    IReadOnlyCollection<SampledRun> sampled)
  {
    List<PathSample> samples = [.. sampled.SelectMany(item => item.Samples)];
    List<WorkflowRun> runs = [.. sampled.Select(item => item.Run)];
    // J is the number of jobs the baseline holds, so a new or removed job changes each job's share of the budget (ADR 0045).
    var jobCount = samples.Select(sample => sample.Job).Distinct(StringComparer.Ordinal).Count();
    if (jobCount > 0)
    {
      constants = constants with { Jobs = jobCount };
    }
    var paths = new SortedDictionary<string, PathBaseline>(StringComparer.Ordinal);
    foreach (var path in new[] { Baselines.CheckPath, Baselines.PublicationPath })
    {
      if (Baselines.Build(path, runs, samples, minRuns, constants) is { } built)
      {
        paths[path] = built;
      }
    }
    return new BaselineFile(workflow, record, minRuns, constants, paths);
  }
}

/// <summary>Lists a window's runs and reads the jobs of only those a caller keeps, through an injectable gh.</summary>
public static class BaselineSampler
{
  /// <summary>The most runs one listing returns; a window that reaches it is refused rather than silently cut.</summary>
  public const int ListLimit = 1000;

  /// <summary>
  /// Lists the successful runs of a workflow created in <paramref name="range"/> and reads the jobs of each run that
  /// <paramref name="keep"/> accepts, oldest first. Runs it rejects cost no jobs call. A listing that reaches
  /// <see cref="ListLimit"/> throws, because the oldest runs of the window would be missing from what is reported.
  /// </summary>
  /// <param name="gh">Runs gh with the given arguments and returns its standard output.</param>
  /// <param name="repo">owner/name.</param>
  /// <param name="workflow">The workflow file.</param>
  /// <param name="range">A <c>gh run list --created</c> range.</param>
  /// <param name="keep">Which listed runs to read the jobs of.</param>
  /// <returns>The kept runs with their gated samples.</returns>
  /// <exception cref="InvalidOperationException">The window holds <see cref="ListLimit"/> runs or more.</exception>
  public static async Task<List<SampledRun>> SampleAsync(
    Func<IReadOnlyList<string>, Task<string>> gh,
    string repo,
    string workflow,
    string range,
    Func<WorkflowRun, bool> keep)
  {
    IReadOnlyList<WorkflowRun> listed = Parser.ParseRuns(await gh(
    [
      "run", "list", "--workflow", workflow, "--limit", ListLimit.ToString(CultureInfo.InvariantCulture), "--created", range,
      "--repo", repo, "--json", "databaseId,status,conclusion,createdAt,event,headBranch,headSha",
    ]));
    if (listed.Count >= ListLimit)
    {
      throw new InvalidOperationException(
        $"the window {range} holds at least {ListLimit} runs of {workflow}, so its oldest runs would be left out; narrow it");
    }
    List<SampledRun> sampled = [];
    foreach (WorkflowRun run in listed.Where(run => BaselineRuns.IsSuccessful(run) && keep(run)).OrderBy(run => run.CreatedAt))
    {
      var jobsJson = await gh(["api", $"repos/{repo}/actions/runs/{run.Id}/jobs?per_page=50"]);
      sampled.Add(new SampledRun(run, [.. Baselines.Samples(run, Parser.ParseJobs(run.Id, jobsJson))]));
    }
    return sampled;
  }
}
