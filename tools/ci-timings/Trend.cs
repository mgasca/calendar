using System.Globalization;
using System.Text;

namespace CiTimings;

/// <summary>The constants of the trend check on main (ADR 0045, with the maintainer's answers on #394).</summary>
/// <param name="Runs">How many recent push runs, not in the baseline, are compared with it.</param>
/// <param name="PValue">The one-sided significance per job: 0.01 split over five jobs.</param>
/// <param name="MinSeconds">The smallest shift worth reporting, in seconds.</param>
/// <param name="MinRelative">The smallest shift worth reporting, as a fraction of the baseline median.</param>
public sealed record TrendConstants(int Runs, double PValue, double MinSeconds, double MinRelative)
{
  /// <summary>N = 20, p &lt; 0.002, a shift of at least max(10 s, 5 %).</summary>
  public static TrendConstants Default { get; } = new(20, 0.002, 10, 0.05);

  /// <summary>The minimum effect for a job whose baseline median is <paramref name="median"/>.</summary>
  /// <param name="median">The baseline median, in seconds.</param>
  /// <returns><c>max(MinSeconds, MinRelative · median)</c>.</returns>
  public double MinEffect(double median) => Math.Max(MinSeconds, MinRelative * median);
}

/// <summary>What the trend check concludes for one job.</summary>
public enum TrendVerdict
{
  /// <summary>No shift that is both significant and above the minimum effect.</summary>
  NoShift,

  /// <summary>Significantly slower than the baseline by at least the minimum effect: reported.</summary>
  Slower,

  /// <summary>Significantly faster by at least the minimum effect: a suggestion to re-pin, never an alarm.</summary>
  Faster,
}

/// <summary>One job's comparison of recent runs with its baseline.</summary>
/// <param name="Path">The path.</param>
/// <param name="Job">The job.</param>
/// <param name="RecentCount">How many recent runs had the job.</param>
/// <param name="BaselineCount">How many baseline runs had it.</param>
/// <param name="BaselineMedian">The baseline median, in seconds.</param>
/// <param name="RecentMedian">The recent median (nearest rank), in seconds.</param>
/// <param name="Shift">The Hodges–Lehmann shift, recent minus baseline, in seconds.</param>
/// <param name="Low">The lower end of the approximate 95 % interval of the shift.</param>
/// <param name="High">The upper end of that interval.</param>
/// <param name="PSlower">The exact one-sided p-value that recent runs are slower.</param>
/// <param name="PFaster">The exact one-sided p-value that recent runs are faster.</param>
/// <param name="MinEffect">The minimum effect for this job, in seconds.</param>
/// <param name="Verdict">The conclusion.</param>
public sealed record TrendRow(
  string Path,
  string Job,
  int RecentCount,
  int BaselineCount,
  double BaselineMedian,
  double RecentMedian,
  double Shift,
  double Low,
  double High,
  double PSlower,
  double PFaster,
  double MinEffect,
  TrendVerdict Verdict);

/// <summary>The trend check's result over every job.</summary>
/// <param name="Rows">One row per job and path with both a baseline and recent runs.</param>
/// <param name="Recent">The recent runs compared, oldest first.</param>
/// <param name="Enough">Whether there were <see cref="TrendConstants.Runs"/> recent runs; when false, nothing is concluded.</param>
public sealed record TrendResult(IReadOnlyList<TrendRow> Rows, IReadOnlyList<WorkflowRun> Recent, bool Enough)
{
  /// <summary>Whether any job is reported slower.</summary>
  public bool Regressed => Enough && Rows.Any(row => row.Verdict == TrendVerdict.Slower);
}

/// <summary>One-sided p-values of a rank test.</summary>
/// <param name="Slower">P that the recent sample is at least this much larger.</param>
/// <param name="Faster">P that it is at least this much smaller.</param>
public sealed record TailProbabilities(double Slower, double Faster);

/// <summary>A shift estimate with its interval, in seconds.</summary>
/// <param name="Shift">The Hodges–Lehmann shift.</param>
/// <param name="Low">The lower end of the approximate 95 % interval.</param>
/// <param name="High">The upper end.</param>
public sealed record ShiftEstimate(double Shift, double Low, double High);

/// <summary>The rank test and the shift estimate the trend check uses.</summary>
public static class RankTest
{
  /// <summary>
  /// The exact one-sided Mann–Whitney p-values, conditional on ties: the share of all ways to choose which
  /// <c>recent.Count</c> of the pooled values are "recent" whose rank sum is at least (slower) or at most (faster) the
  /// observed one. Mid-ranks are doubled so every rank sum is a whole number, and the counts come from a dynamic
  /// programme over the pooled values, so the result is deterministic.
  /// </summary>
  /// <param name="recent">The recent durations, not empty.</param>
  /// <param name="baseline">The baseline durations, not empty.</param>
  /// <returns>P that recent is this much slower or more, and P that it is this much faster or more.</returns>
  public static TailProbabilities MannWhitney(IReadOnlyCollection<double> recent, IReadOnlyCollection<double> baseline)
  {
    if (recent.Count == 0 || baseline.Count == 0)
    {
      throw new ArgumentException("both samples need at least one value");
    }
    (double Value, bool Recent)[] pooled =
    [
      .. recent.Select(value => (value, true)).Concat(baseline.Select(value => (value, false))).OrderBy(item => item.Item1),
    ];
    var doubledRanks = new int[pooled.Length];
    for (var start = 0; start < pooled.Length;)
    {
      var end = start;
      while (end + 1 < pooled.Length && Math.Abs(pooled[end + 1].Value - pooled[start].Value) < 1e-9)
      {
        end++;
      }
      // Ranks start + 1 … end + 1 share their mean; doubled, that is start + end + 2.
      for (var index = start; index <= end; index++)
      {
        doubledRanks[index] = start + end + 2;
      }
      start = end + 1;
    }
    var observed = pooled.Select((item, index) => item.Recent ? doubledRanks[index] : 0).Sum();
    var size = recent.Count;
    var maxSum = doubledRanks.Sum();
    // ways[k, s]: the number of ways to choose k of the values seen so far with doubled rank sum s.
    var ways = new double[size + 1, maxSum + 1];
    ways[0, 0] = 1;
    foreach (var rank in doubledRanks)
    {
      for (var k = size; k >= 1; k--)
      {
        for (var sum = maxSum; sum >= rank; sum--)
        {
          ways[k, sum] += ways[k - 1, sum - rank];
        }
      }
    }
    double total = 0, atLeast = 0, atMost = 0;
    for (var sum = 0; sum <= maxSum; sum++)
    {
      var count = ways[size, sum];
      total += count;
      atLeast += sum >= observed ? count : 0;
      atMost += sum <= observed ? count : 0;
    }
    return new TailProbabilities(atLeast / total, atMost / total);
  }

  /// <summary>
  /// The Hodges–Lehmann shift, the median of every recent − baseline difference, with an approximate 95 % interval
  /// from the order statistics of those differences (the normal approximation to the Mann–Whitney critical value).
  /// </summary>
  /// <param name="recent">The recent durations, not empty.</param>
  /// <param name="baseline">The baseline durations, not empty.</param>
  /// <returns>The shift and the interval, in seconds.</returns>
  public static ShiftEstimate HodgesLehmann(IReadOnlyCollection<double> recent, IReadOnlyCollection<double> baseline)
  {
    double[] differences = [.. recent.SelectMany(late => baseline.Select(early => late - early)).Order()];
    if (differences.Length == 0)
    {
      throw new ArgumentException("both samples need at least one value");
    }
    var middle = differences.Length / 2;
    var shift = differences.Length % 2 == 1 ? differences[middle] : (differences[middle - 1] + differences[middle]) / 2;
    double m = recent.Count;
    double n = baseline.Count;
    var k = (int)Math.Floor((m * n / 2) - (1.959964 * Math.Sqrt(m * n * (m + n + 1) / 12)));
    k = Math.Clamp(k, 0, (differences.Length - 1) / 2);
    return new ShiftEstimate(shift, differences[k], differences[differences.Length - 1 - k]);
  }
}

/// <summary>The trend check: recent push runs on main against the pinned baseline.</summary>
public static class Trend
{
  /// <summary>The title of the one issue the check opens and then comments on.</summary>
  public const string IssueTitle = "CI run-time trend: jobs slower than the pinned baseline on main";

  /// <summary>The label of that issue.</summary>
  public const string IssueLabel = "performance";

  /// <summary>The recent runs to compare: successful push runs on main not in the baseline, the newest N, oldest first.</summary>
  /// <param name="baseline">The baseline.</param>
  /// <param name="listed">Listed runs, in any order.</param>
  /// <param name="constants">The trend constants.</param>
  /// <returns>Up to N runs.</returns>
  public static IReadOnlyList<WorkflowRun> RecentRuns(BaselineFile baseline, IEnumerable<WorkflowRun> listed, TrendConstants constants)
  {
    List<WorkflowRun> pinnedRuns = [.. baseline.Paths.Values.SelectMany(path => path.Runs)];
    HashSet<long> pinned = [.. pinnedRuns.Select(run => run.Id)];
    // Only runs after the baseline's last run: older pushes measure the code before it, not a trend since.
    DateTimeOffset since = pinnedRuns.Count == 0 ? DateTimeOffset.MinValue : pinnedRuns.Max(run => run.CreatedAt);
    return
    [
      .. listed
        .Where(run => BaselineRuns.IsSuccessful(run) && string.Equals(run.Event, "push", StringComparison.Ordinal))
        .Where(run => string.Equals(run.HeadBranch, "main", StringComparison.Ordinal) && !pinned.Contains(run.Id))
        .Where(run => run.CreatedAt > since)
        .OrderByDescending(run => run.CreatedAt)
        .Take(constants.Runs)
        .OrderBy(run => run.CreatedAt),
    ];
  }

  /// <summary>Compares each job's recent durations with its baseline on the same path.</summary>
  /// <param name="baseline">The baseline, with each job's sample.</param>
  /// <param name="recent">The recent runs and their samples.</param>
  /// <param name="constants">The trend constants.</param>
  /// <returns>The rows, by path then job; no verdict but <see cref="TrendVerdict.NoShift"/> while there are too few runs.</returns>
  public static TrendResult Evaluate(BaselineFile baseline, IReadOnlyCollection<SampledRun> recent, TrendConstants constants)
  {
    var enough = recent.Count >= constants.Runs;
    List<TrendRow> rows = [];
    IEnumerable<IGrouping<(string Path, string Job), PathSample>> groups = recent
      .SelectMany(run => run.Samples)
      .GroupBy(sample => (sample.Path, sample.Job))
      .OrderBy(group => group.Key.Path, StringComparer.Ordinal)
      .ThenBy(group => group.Key.Job, StringComparer.Ordinal);
    foreach (IGrouping<(string Path, string Job), PathSample> group in groups)
    {
      if (!baseline.Paths.TryGetValue(group.Key.Path, out PathBaseline? path)
        || !path.Jobs.TryGetValue(group.Key.Job, out JobBaseline? job)
        || job.Seconds.Count == 0)
      {
        continue;
      }
      double[] late = [.. group.Select(sample => sample.Seconds).Order()];
      TailProbabilities tails = RankTest.MannWhitney(late, job.Seconds);
      ShiftEstimate estimate = RankTest.HodgesLehmann(late, job.Seconds);
      var minEffect = constants.MinEffect(job.Median);
      TrendVerdict verdict = enough ? Judge(tails, estimate.Shift, minEffect, constants.PValue) : TrendVerdict.NoShift;
      rows.Add(new TrendRow(
        group.Key.Path,
        group.Key.Job,
        late.Length,
        job.Seconds.Count,
        job.Median,
        Statistics.Percentile(late, 0.5),
        estimate.Shift,
        estimate.Low,
        estimate.High,
        tails.Slower,
        tails.Faster,
        minEffect,
        verdict));
    }
    return new TrendResult(rows, [.. recent.Select(run => run.Run)], enough);
  }

  /// <summary>Slower or faster only when the test is significant and the shift reaches the minimum effect.</summary>
  /// <param name="tails">The one-sided p-values.</param>
  /// <param name="shift">The Hodges–Lehmann shift, in seconds.</param>
  /// <param name="minEffect">The minimum effect, in seconds.</param>
  /// <param name="pValue">The significance level.</param>
  /// <returns>The verdict.</returns>
  public static TrendVerdict Judge(TailProbabilities tails, double shift, double minEffect, double pValue)
  {
    if (tails.Slower < pValue && shift >= minEffect)
    {
      return TrendVerdict.Slower;
    }
    return tails.Faster < pValue && -shift >= minEffect ? TrendVerdict.Faster : TrendVerdict.NoShift;
  }

  /// <summary>The Markdown report: the window, one row per job, and what follows from it.</summary>
  /// <param name="result">The result.</param>
  /// <param name="baseline">The baseline it was compared with.</param>
  /// <param name="constants">The trend constants.</param>
  /// <returns>Markdown.</returns>
  public static string Report(TrendResult result, BaselineFile baseline, TrendConstants constants)
  {
    var text = new StringBuilder();
    var p = constants.PValue.ToString(CultureInfo.InvariantCulture);
    var minSeconds = constants.MinSeconds.ToString(CultureInfo.InvariantCulture);
    var minPercent = (constants.MinRelative * 100).ToString(CultureInfo.InvariantCulture);
    text.Append(CultureInfo.InvariantCulture, $"Trend check (ADR 0045): the last {result.Recent.Count} successful push runs on `main`")
      .Append(CultureInfo.InvariantCulture, $" not in the baseline, against `.github/ci-baseline.json` ({baseline.Record}).")
      .Append(CultureInfo.InvariantCulture, $" A job is reported when a one-sided exact Mann–Whitney test gives p < {p}")
      .Append(CultureInfo.InvariantCulture, $" and the Hodges–Lehmann shift is at least max({minSeconds} s,")
      .Append(CultureInfo.InvariantCulture, $" {minPercent} % of the baseline median).")
      .AppendLine().AppendLine();
    if (result.Recent.Count > 0)
    {
      text.Append(CultureInfo.InvariantCulture, $"Recent window: {result.Recent[0].CreatedAt.ToUniversalTime():yyyy-MM-dd HH:mm}Z to ")
        .Append(CultureInfo.InvariantCulture, $"{result.Recent[^1].CreatedAt.ToUniversalTime():yyyy-MM-dd HH:mm}Z, commits ")
        .Append(CultureInfo.InvariantCulture, $"`{Short(result.Recent[0].HeadSha)}` to `{Short(result.Recent[^1].HeadSha)}`.")
        .AppendLine().AppendLine();
    }
    if (!result.Enough)
    {
      text.Append(CultureInfo.InvariantCulture, $"Not enough runs since the baseline: {result.Recent.Count} of {constants.Runs}.")
        .AppendLine(" Nothing is concluded.");
      return text.ToString();
    }
    text.Append("| Path | Job | n recent | n baseline | baseline median | recent median | shift (≈95 % interval) |")
      .AppendLine(" p slower | p faster | verdict |");
    text.AppendLine("| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |");
    foreach (TrendRow row in result.Rows)
    {
      text.Append(CultureInfo.InvariantCulture, $"| {row.Path} | {row.Job} | {row.RecentCount} | {row.BaselineCount} |")
        .Append(CultureInfo.InvariantCulture, $" {CiTimings.Report.Clock(row.BaselineMedian)} |")
        .Append(CultureInfo.InvariantCulture, $" {CiTimings.Report.Clock(row.RecentMedian)} |")
        .Append(CultureInfo.InvariantCulture, $" {Signed(row.Shift)} s ({Signed(row.Low)} to {Signed(row.High)}) |")
        .Append(CultureInfo.InvariantCulture, $" {P(row.PSlower)} | {P(row.PFaster)} | {Verdict(row.Verdict)} |")
        .AppendLine();
    }
    text.AppendLine();
    List<TrendRow> slower = [.. result.Rows.Where(row => row.Verdict == TrendVerdict.Slower)];
    List<TrendRow> faster = [.. result.Rows.Where(row => row.Verdict == TrendVerdict.Faster)];
    if (slower.Count == 0)
    {
      text.AppendLine("No job is slower than its baseline by a shift that is both significant and above the minimum effect.");
    }
    foreach (TrendRow row in slower)
    {
      var minEffect = Math.Round(row.MinEffect).ToString(CultureInfo.InvariantCulture);
      text.Append(CultureInfo.InvariantCulture, $"- **{row.Job}** ({row.Path}) is slower by {Signed(row.Shift)} s")
        .Append(CultureInfo.InvariantCulture, $" (minimum effect {minEffect} s, p = {P(row.PSlower)}). ")
        .Append("Sample its steps with `ci-timings --job` over the recent window and look for the commit that moved it; if the time ")
        .AppendLine("is necessary, re-pin the baseline deliberately with a benchmark record.");
    }
    foreach (TrendRow row in faster)
    {
      text.Append(CultureInfo.InvariantCulture, $"- Suggestion: **{row.Job}** ({row.Path}) is faster by {Signed(-row.Shift)} s (p = ")
        .Append(CultureInfo.InvariantCulture, $"{P(row.PFaster)}); a deliberate re-pin would tighten its threshold.")
        .AppendLine();
    }
    IEnumerable<string> ids = result.Recent.Select(run => run.Id.ToString(CultureInfo.InvariantCulture));
    text.AppendLine().Append("Runs: ").AppendJoin(", ", ids).AppendLine();
    return text.ToString();

  }

  /// <summary>What to do on GitHub: nothing without a regression; else comment on the open trend issue or create it.</summary>
  /// <param name="result">The result.</param>
  /// <param name="openIssues">Open issues with the label, as (number, title).</param>
  /// <returns>Null for nothing, 0 to create the issue, or the number of the issue to comment on.</returns>
  public static int? IssueAction(TrendResult result, IEnumerable<(int Number, string Title)> openIssues)
  {
    if (!result.Regressed)
    {
      return null;
    }
    return openIssues
      .Where(issue => string.Equals(issue.Title, IssueTitle, StringComparison.Ordinal))
      .Select(issue => (int?)issue.Number)
      .Min() ?? 0;
  }

  private static string Short(string sha) => sha.Length > 8 ? sha[..8] : sha;

  private static string Signed(double seconds) =>
    (seconds > 0 ? "+" : "") + Math.Round(seconds, 1).ToString("0.#", CultureInfo.InvariantCulture);

  private static string P(double p) => p < 0.0001 ? "< 0.0001" : p.ToString("0.0000", CultureInfo.InvariantCulture);

  private static string Verdict(TrendVerdict verdict) => verdict switch
  {
    TrendVerdict.Slower => "**slower**",
    TrendVerdict.Faster => "faster (re-pin?)",
    _ => "no shift",
  };
}
