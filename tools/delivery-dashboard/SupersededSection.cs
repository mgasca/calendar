using System.Globalization;
using System.Text.Json;
using CiTimings;

namespace DeliveryDashboard;

/// <summary>One week of superseded pull request runs, beside the control group of the same week.</summary>
/// <param name="Week">The Monday (UTC) the week starts, as <see cref="SnapshotJson.DateFormat"/>.</param>
/// <param name="Pairs">Pull request runs cancelled by a newer push that week (by the time the newer run was created).</param>
/// <param name="WaitRuns">Of the newer runs, those that reported a first job starting.</param>
/// <param name="WaitMedianSeconds">How long the newer run waited for its first job; null when <paramref name="WaitRuns"/> is 0.</param>
/// <param name="WaitP90Seconds">The 90th percentile of that wait; null when <paramref name="WaitRuns"/> is 0.</param>
/// <param name="WaitMaxSeconds">The longest of those waits; null when <paramref name="WaitRuns"/> is 0.</param>
/// <param name="PushGapMedianSeconds">How far apart the two pushes were, median; null when there is no pair.</param>
/// <param name="ControlRuns">Successful pull request runs of the week that superseded nothing and reported a first job.</param>
/// <param name="ControlWaitMedianSeconds">Their creation-to-first-job wait, median; null when there is none.</param>
public sealed record SupersededWeek(
  string Week,
  int Pairs,
  int WaitRuns,
  double? WaitMedianSeconds,
  double? WaitP90Seconds,
  double? WaitMaxSeconds,
  double? PushGapMedianSeconds,
  int ControlRuns,
  double? ControlWaitMedianSeconds);

/// <summary>What the section was computed from.</summary>
/// <param name="Pairs">Superseded pairs in the weeks.</param>
/// <param name="Ignored">Cancelled runs left out because they had already ended when the newer run was created (cancelled by hand).</param>
/// <param name="ControlRuns">Control runs in the weeks.</param>
/// <param name="Cap">The most pairs one snapshot measures, because each costs two jobs calls.</param>
/// <param name="MinPairs">Fewest pairs in a week for the page to show a statistic for it.</param>
/// <param name="Window">When the newer runs were created, oldest and newest; null without a pair.</param>
public sealed record SupersededSample(int Pairs, int Ignored, int ControlRuns, int Cap, int MinPairs, SampleWindow? Window);

/// <summary>Whether each family of numbers was measured or inferred.</summary>
/// <param name="Detection">That a run was superseded is inferred: a later pull request run of the branch exists.</param>
/// <param name="Timing">The waits and gaps are differences of timestamps GitHub recorded: measured.</param>
public sealed record SupersededBasis(string Detection, string Timing);

/// <summary>The superseded-run section (#618): time lost to pull request runs a newer push cancelled. Aggregates only.</summary>
/// <param name="Basis">Measured or inferred.</param>
/// <param name="Sample">The sample.</param>
/// <param name="Weeks">One row per week with a pair or a control run, oldest first.</param>
public sealed record SupersededSection(SupersededBasis Basis, SupersededSample Sample, IReadOnlyList<SupersededWeek> Weeks);

/// <summary>Builds the section from measured pairs and the control group.</summary>
public static class SupersededCalculator
{
  /// <summary>The fewest pairs in a week before a statistic is shown for it.</summary>
  public const int MinPairs = 3;

  /// <summary>The Monday (UTC) of the week a time falls in.</summary>
  /// <param name="time">The time.</param>
  /// <returns>The date of that Monday.</returns>
  public static DateOnly WeekStart(DateTimeOffset time)
  {
    var day = DateOnly.FromDateTime(time.UtcDateTime);
    return day.AddDays(-(((int)day.DayOfWeek + 6) % 7));
  }

  /// <summary>Groups pairs and control runs by week.</summary>
  /// <param name="pairs">Measured pairs (see <see cref="Supersession.Measure"/>).</param>
  /// <param name="ignored">Cancelled runs left out as cancelled by hand.</param>
  /// <param name="control">Runs that superseded nothing: when each was created and its wait for the first job.</param>
  /// <param name="cap">The pair cap in force.</param>
  /// <returns>The section; null when there is no pair and no control run.</returns>
  public static SupersededSection? Build(
    IReadOnlyList<SupersededPair> pairs,
    int ignored,
    IReadOnlyList<(DateTimeOffset Created, double Wait)> control,
    int cap)
  {
    if (pairs.Count == 0 && control.Count == 0)
    {
      return null;
    }
    var weeks = pairs.Select(pair => WeekStart(pair.SupersededAt))
      .Concat(control.Select(run => WeekStart(run.Created)))
      .Distinct()
      .Order()
      .Select(week => Week(week, pairs, control))
      .ToList();
    SampleWindow? window = pairs.Count == 0
      ? null
      : new SampleWindow(pairs.Min(pair => pair.SupersededAt), pairs.Max(pair => pair.SupersededAt));
    return new SupersededSection(
      new SupersededBasis("inferred", "measured"),
      new SupersededSample(pairs.Count, ignored, control.Count, cap, MinPairs, window),
      weeks);
  }

  private static SupersededWeek Week(
    DateOnly week,
    IReadOnlyList<SupersededPair> pairs,
    IReadOnlyList<(DateTimeOffset Created, double Wait)> control)
  {
    List<SupersededPair> inWeek = [.. pairs.Where(pair => WeekStart(pair.SupersededAt) == week)];
    List<double> waits = [.. inWeek.Where(pair => pair.Wait is not null).Select(pair => pair.Wait!.Value)];
    List<double> controlWaits = [.. control.Where(run => WeekStart(run.Created) == week).Select(run => run.Wait)];
    Summary wait = Statistics.Summarize(waits);
    return new SupersededWeek(
      week.ToString(SnapshotJson.DateFormat, CultureInfo.InvariantCulture),
      inWeek.Count,
      waits.Count,
      waits.Count == 0 ? null : Round(wait.Median),
      waits.Count == 0 ? null : Round(wait.P90),
      waits.Count == 0 ? null : Round(wait.Max),
      inWeek.Count == 0 ? null : Round(Statistics.Summarize(inWeek.Select(pair => pair.PushGap)).Median),
      controlWaits.Count,
      controlWaits.Count == 0 ? null : Round(Statistics.Summarize(controlWaits).Median));
  }

  private static double Round(double seconds) => Math.Round(seconds, 1, MidpointRounding.AwayFromZero);
}

/// <summary>Reads pull request runs from GitHub for the superseded section.</summary>
public static class SupersededCollector
{
  /// <summary>The most pairs one snapshot measures: each costs two jobs calls, and the control group up to as many.</summary>
  public const int DefaultCap = 30;

  /// <summary>Lists pull request runs of the workflow, newest first, pairs them and measures the newest pairs.</summary>
  /// <param name="repository"><c>owner/name</c>.</param>
  /// <param name="workflow">The workflow file.</param>
  /// <param name="cap">The most pairs, and the most control runs, to measure.</param>
  /// <returns>The section; null when GitHub lists no pull request run.</returns>
  public static async Task<SupersededSection?> CollectAsync(string repository, string workflow, int cap = DefaultCap)
  {
    var listJson = await Gh.RunAsync(
    [
      "run", "list", "--workflow", workflow, "--event", "pull_request", "--repo", repository,
      "--limit", (cap * 6).ToString(CultureInfo.InvariantCulture),
      "--json", "databaseId,status,conclusion,createdAt,event,headBranch",
    ]);
    IReadOnlyList<WorkflowRun> listed = Parser.ParseRuns(listJson);
    var jobsByRun = new Dictionary<long, IReadOnlyList<JobTiming>>();

    async Task<IReadOnlyList<JobTiming>> JobsOf(long runId)
    {
      if (!jobsByRun.TryGetValue(runId, out IReadOnlyList<JobTiming>? jobs))
      {
        jobs = Parser.ParseJobs(runId, await Gh.RunAsync(["api", $"repos/{repository}/actions/runs/{runId}/jobs?per_page=50"]));
        jobsByRun[runId] = jobs;
      }
      return jobs;
    }

    List<SupersededPair> pairs = [];
    var ignored = 0;
    foreach ((WorkflowRun cancelled, WorkflowRun superseding) in Supersession.Pair(listed))
    {
      if (pairs.Count == cap)
      {
        break;
      }
      SupersededPair? pair = Supersession.Measure(cancelled, superseding, await JobsOf(cancelled.Id), await JobsOf(superseding.Id));
      if (pair is null)
      {
        ignored++;
      }
      else
      {
        pairs.Add(pair);
      }
    }
    return SupersededCalculator.Build(pairs, ignored, await ControlAsync(listed, pairs, cap, JobsOf), cap);
  }

  private static async Task<IReadOnlyList<(DateTimeOffset Created, double Wait)>> ControlAsync(
    IReadOnlyList<WorkflowRun> listed,
    List<SupersededPair> pairs,
    int cap,
    Func<long, Task<IReadOnlyList<JobTiming>>> jobsOf)
  {
    HashSet<long> superseding = [.. pairs.Select(pair => pair.SupersedingRunId)];
    HashSet<long> cancelled = [.. pairs.Select(pair => pair.CancelledRunId)];
    DateTimeOffset since = pairs.Count == 0 ? DateTimeOffset.MinValue : pairs.Min(pair => pair.SupersededAt);
    List<(DateTimeOffset, double)> control = [];
    foreach (WorkflowRun run in listed.Where(run => string.Equals(run.Conclusion, "success", StringComparison.Ordinal)
      && !superseding.Contains(run.Id) && !cancelled.Contains(run.Id) && run.CreatedAt >= since).Take(cap))
    {
      IReadOnlyList<JobTiming> jobs = await jobsOf(run.Id);
      if (jobs.Count > 0)
      {
        control.Add((run.CreatedAt, (jobs.Min(job => job.StartedAt) - run.CreatedAt).TotalSeconds));
      }
    }
    return control;
  }
}

/// <summary>Writes the superseded section.</summary>
public static class SupersededJson
{
  /// <summary>Writes the section, or null, as the value of the current property.</summary>
  /// <param name="writer">The writer, positioned after the property name.</param>
  /// <param name="section">The section, or null when it was not sampled.</param>
  public static void Write(Utf8JsonWriter writer, SupersededSection? section)
  {
    if (section is null)
    {
      writer.WriteNullValue();
      return;
    }
    writer.WriteStartObject();
    writer.WriteStartObject("basis");
    writer.WriteString("detection", section.Basis.Detection);
    writer.WriteString("timing", section.Basis.Timing);
    writer.WriteEndObject();
    writer.WriteStartObject("sample");
    writer.WriteNumber("pairs", section.Sample.Pairs);
    writer.WriteNumber("ignored", section.Sample.Ignored);
    writer.WriteNumber("controlRuns", section.Sample.ControlRuns);
    writer.WriteNumber("cap", section.Sample.Cap);
    writer.WriteNumber("minPairs", section.Sample.MinPairs);
    if (section.Sample.Window is null)
    {
      writer.WriteNull("window");
    }
    else
    {
      writer.WriteStartObject("window");
      writer.WriteString("from", Time(section.Sample.Window.From));
      writer.WriteString("to", Time(section.Sample.Window.To));
      writer.WriteEndObject();
    }
    writer.WriteEndObject();
    writer.WriteStartArray("weeks");
    foreach (SupersededWeek week in section.Weeks)
    {
      writer.WriteStartObject();
      writer.WriteString("week", week.Week);
      writer.WriteNumber("pairs", week.Pairs);
      writer.WriteNumber("waitRuns", week.WaitRuns);
      Number(writer, "waitMedianSeconds", week.WaitMedianSeconds);
      Number(writer, "waitP90Seconds", week.WaitP90Seconds);
      Number(writer, "waitMaxSeconds", week.WaitMaxSeconds);
      Number(writer, "pushGapMedianSeconds", week.PushGapMedianSeconds);
      writer.WriteNumber("controlRuns", week.ControlRuns);
      Number(writer, "controlWaitMedianSeconds", week.ControlWaitMedianSeconds);
      writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
  }

  private static void Number(Utf8JsonWriter writer, string name, double? value)
  {
    if (value is null)
    {
      writer.WriteNull(name);
    }
    else
    {
      writer.WriteNumber(name, value.Value);
    }
  }

  private static string Time(DateTimeOffset time) =>
    time.ToUniversalTime().ToString(SnapshotJson.TimeFormat, CultureInfo.InvariantCulture);
}
