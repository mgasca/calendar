using System.Globalization;
using Shouldly;
using Xunit;

namespace CiTimings.Tests;

public sealed class RankTestTests
{
  [Fact]
  public void MannWhitney_WhenEveryRecentValueIsLarger_IsOneOverTheNumberOfSplits()
  {
    // C(6, 3) = 20 equally likely splits; only one puts all three recent values on top.
    TailProbabilities tails = RankTest.MannWhitney([4, 5, 6], [1, 2, 3]);

    tails.Slower.ShouldBe(0.05, 1e-12);
    tails.Faster.ShouldBe(1, 1e-12);
  }

  [Fact]
  public void MannWhitney_WithTies_UsesMidRanks()
  {
    // Pooled 1, 2, 2: doubled mid-ranks 2, 5, 5. The recent 2 has 5; of the three single choices, two reach 5.
    TailProbabilities tails = RankTest.MannWhitney([2], [1, 2]);

    tails.Slower.ShouldBe(2.0 / 3, 1e-12);
    tails.Faster.ShouldBe(1, 1e-12);
  }

  [Fact]
  public void MannWhitney_OfIdenticalSamples_IsOneBothWays()
  {
    TailProbabilities tails = RankTest.MannWhitney([80, 80, 80], [80, 80, 80, 80]);

    tails.Slower.ShouldBe(1, 1e-12);
    tails.Faster.ShouldBe(1, 1e-12);
  }

  [Fact]
  public void MannWhitney_OfAnEmptySample_Throws() => Should.Throw<ArgumentException>(() => RankTest.MannWhitney([], [1]));

  [Fact]
  public void HodgesLehmann_IsTheMedianOfThePairwiseDifferences()
  {
    // Differences 9, 8, 11, 10: the median of an even count is the mean of the middle two.
    RankTest.HodgesLehmann([10, 12], [1, 2]).Shift.ShouldBe(9.5);
    RankTest.HodgesLehmann([10, 12, 14], [1]).Shift.ShouldBe(11);
  }

  [Fact]
  public void HodgesLehmann_IntervalContainsTheShift()
  {
    ShiftEstimate estimate = RankTest.HodgesLehmann(TrendTests.Recent(20, 20), TrendTests.History(30));

    estimate.Low.ShouldBeLessThanOrEqualTo(estimate.Shift);
    estimate.High.ShouldBeGreaterThanOrEqualTo(estimate.Shift);
    estimate.Shift.ShouldBe(20, 2);
  }
}

public sealed class TrendTests
{
  private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-06T20:04:12Z", CultureInfo.InvariantCulture);

  /// <summary>A baseline history: whole seconds from 75 to 85 around a median of 80, in a fixed scrambled order.</summary>
  public static double[] History(int count) => [.. Enumerable.Range(0, count).Select(index => 80.0 + ((index * 7) % 11) - 5)];

  /// <summary>Later runs from the same spread in another order, plus a shift.</summary>
  public static double[] Recent(int count, double shift) =>
    [.. Enumerable.Range(0, count).Select(index => 80.0 + ((index * 3) % 11) - 5 + shift)];

  private static WorkflowRun Run(long id, string runEvent = "push", string conclusion = "success", string branch = "main") =>
    new(id, "completed", conclusion, T0.AddMinutes(id), runEvent, branch, $"sha{id:D4}0000");

  private static BaselineFile Baseline(double[] backend, double[]? frontend = null)
  {
    List<SampledRun> sampled = [];
    for (var index = 0; index < backend.Length; index++)
    {
      List<PathSample> samples = [new(index + 1, "Backend", "publication", backend[index])];
      if (frontend is not null)
      {
        samples.Add(new(index + 1, "Frontend", "publication", frontend[index]));
      }
      sampled.Add(new SampledRun(Run(index + 1), samples));
    }
    return BaselineRuns.Build("ci.yml", "docs/benchmarks/0014-ci-job-baseline.md", 30, GateConstants.Default, sampled);
  }

  private static List<SampledRun> Later(double[] backend, double[]? frontend = null)
  {
    List<SampledRun> runs = [];
    for (var index = 0; index < backend.Length; index++)
    {
      List<PathSample> samples = [new(1000 + index, "Backend", "publication", backend[index])];
      if (frontend is not null)
      {
        samples.Add(new(1000 + index, "Frontend", "publication", frontend[index]));
      }
      runs.Add(new SampledRun(Run(1000 + index), samples));
    }
    return runs;
  }

  [Fact]
  public void AHistoryShiftedByTwentySeconds_IsReportedSlower()
  {
    TrendResult result = Trend.Evaluate(Baseline(History(30)), Later(Recent(20, 20)), TrendConstants.Default);

    TrendRow row = result.Rows.ShouldHaveSingleItem();
    row.Verdict.ShouldBe(TrendVerdict.Slower);
    row.PSlower.ShouldBeLessThan(0.002);
    row.Shift.ShouldBe(20, 2);
    row.MinEffect.ShouldBe(10);
    result.Regressed.ShouldBeTrue();
  }

  [Fact]
  public void AnUnshiftedHistory_IsNotReported()
  {
    TrendResult result = Trend.Evaluate(Baseline(History(30)), Later(Recent(20, 0)), TrendConstants.Default);

    TrendRow row = result.Rows.ShouldHaveSingleItem();
    row.Verdict.ShouldBe(TrendVerdict.NoShift);
    row.PSlower.ShouldBeGreaterThan(0.002);
    result.Regressed.ShouldBeFalse();
  }

  [Fact]
  public void ASignificantShiftBelowTheMinimumEffect_IsNotReported()
  {
    // A very stable job (60 or 61 s) that is now 64 s every time: p is tiny, but 3.5 s is below max(10 s, 3 s).
    double[] stable = [.. Enumerable.Range(0, 30).Select(index => 60.0 + (index % 2))];
    TrendResult result = Trend.Evaluate(Baseline(stable), Later([.. Enumerable.Repeat(64.0, 20)]), TrendConstants.Default);

    TrendRow row = result.Rows.ShouldHaveSingleItem();
    row.PSlower.ShouldBeLessThan(0.0001);
    row.Shift.ShouldBeLessThan(10);
    row.Verdict.ShouldBe(TrendVerdict.NoShift);
  }

  [Fact]
  public void TheMinimumEffect_GrowsWithALongJob()
  {
    // On a 300 s job the minimum effect is 5 % = 15 s, so a 12 s shift is not reported even though it is significant.
    double[] longJob = [.. History(30).Select(seconds => seconds + 220)];
    double[] later = [.. Recent(20, 12).Select(seconds => seconds + 220)];
    TrendResult result = Trend.Evaluate(Baseline(longJob), Later(later), TrendConstants.Default);

    TrendRow row = result.Rows.ShouldHaveSingleItem();
    row.MinEffect.ShouldBe(15);
    row.PSlower.ShouldBeLessThan(0.002);
    row.Verdict.ShouldBe(TrendVerdict.NoShift);
  }

  [Fact]
  public void AFasterHistory_IsOnlyASuggestion()
  {
    TrendResult result = Trend.Evaluate(Baseline(History(30)), Later(Recent(20, -20)), TrendConstants.Default);

    result.Rows.ShouldHaveSingleItem().Verdict.ShouldBe(TrendVerdict.Faster);
    result.Regressed.ShouldBeFalse();
    Trend.IssueAction(result, []).ShouldBeNull();
    Trend.Report(result, Baseline(History(30)), TrendConstants.Default).ShouldContain("Suggestion: **Backend** (publication) is faster");
  }

  [Fact]
  public void EachJobIsJudgedOnItsOwn()
  {
    TrendResult result = Trend.Evaluate(
      Baseline(History(30), History(30)),
      Later(Recent(20, 25), Recent(20, 0)),
      TrendConstants.Default);

    result.Rows.Select(row => (row.Job, row.Verdict)).ShouldBe([("Backend", TrendVerdict.Slower), ("Frontend", TrendVerdict.NoShift)]);
  }

  [Fact]
  public void WithFewerRunsThanN_NothingIsConcluded()
  {
    TrendResult result = Trend.Evaluate(Baseline(History(30)), Later(Recent(19, 40)), TrendConstants.Default);

    result.Enough.ShouldBeFalse();
    result.Regressed.ShouldBeFalse();
    result.Rows.ShouldAllBe(row => row.Verdict == TrendVerdict.NoShift);
    Trend.Report(result, Baseline(History(30)), TrendConstants.Default).ShouldContain("Not enough runs since the baseline: 19 of 20.");
  }

  [Fact]
  public void AJobWithoutABaselineOnItsPath_IsLeftOut()
  {
    List<SampledRun> later = [.. Later(Recent(20, 40)).Select(run => run with { Samples = [run.Samples[0] with { Path = "check" }] })];

    Trend.Evaluate(Baseline(History(30)), later, TrendConstants.Default).Rows.ShouldBeEmpty();
  }

  [Fact]
  public void RecentRuns_AreTheNewestSuccessfulPushesOnMainNotInTheBaseline_OldestFirst()
  {
    BaselineFile baseline = Baseline(History(3));
    List<WorkflowRun> listed =
    [
      Run(1), Run(2), Run(3),
      Run(4), Run(5), Run(6), Run(7),
      Run(8, "workflow_dispatch"), Run(9, conclusion: "failure"), Run(10, branch: "feature"), Run(11, "pull_request"),
    ];

    Trend.RecentRuns(baseline, listed, TrendConstants.Default with { Runs = 3 }).Select(run => run.Id).ShouldBe([5, 6, 7]);
  }

  [Fact]
  public void RecentRuns_LeaveOutRunsFromBeforeTheBaselineEnds()
  {
    // Baseline runs 5 to 7; runs 1 to 4 are older pushes (from before a fix, say) and must not count as recent.
    BaselineFile baseline = BaselineRuns.Build(
      "ci.yml",
      "r.md",
      1,
      GateConstants.Default,
      [.. new long[] { 5, 6, 7 }.Select(id => new SampledRun(Run(id), [new PathSample(id, "Backend", "publication", 80)]))]);
    List<WorkflowRun> listed = [Run(1), Run(2), Run(3), Run(4), Run(5), Run(6), Run(7), Run(8), Run(9)];

    Trend.RecentRuns(baseline, listed, TrendConstants.Default).Select(run => run.Id).ShouldBe([8, 9]);
  }

  [Fact]
  public void IssueAction_CreatesWhenNoneIsOpen_CommentsOnTheOpenOne_AndDoesNothingWithoutARegression()
  {
    TrendResult slower = Trend.Evaluate(Baseline(History(30)), Later(Recent(20, 20)), TrendConstants.Default);
    TrendResult same = Trend.Evaluate(Baseline(History(30)), Later(Recent(20, 0)), TrendConstants.Default);

    Trend.IssueAction(slower, [(7, "Something else")]).ShouldBe(0);
    Trend.IssueAction(slower, [(7, "Something else"), (412, Trend.IssueTitle), (415, Trend.IssueTitle)]).ShouldBe(412);
    Trend.IssueAction(same, [(412, Trend.IssueTitle)]).ShouldBeNull();
  }

  [Fact]
  public void Report_NamesTheJobTheShiftTheWindowAndTheRuns()
  {
    BaselineFile baseline = Baseline(History(30));
    TrendResult result = Trend.Evaluate(baseline, Later(Recent(20, 20)), TrendConstants.Default);

    var report = Trend.Report(result, baseline, TrendConstants.Default);

    report.ShouldContain("p < 0.002");
    report.ShouldContain("max(10 s, 5 % of the baseline median)");
    report.ShouldContain("| publication | Backend | 20 | 30 | 1:20 | 1:39 | +20 s");
    report.ShouldContain("| **slower** |");
    report.ShouldContain("- **Backend** (publication) is slower by +20 s (minimum effect 10 s");
    report.ShouldContain("commits `sha10000` to `sha10190`");
    report.ShouldContain("Runs: 1000, 1001,");
  }
}

public sealed class IssueParserTests
{
  [Fact]
  public void ParseIssues_ReadsNumberAndTitle() =>
    Parser.ParseIssues("""[{ "number": 412, "title": "CI run-time trend: jobs slower than the pinned baseline on main" }]""")
      .ShouldBe([(412, Trend.IssueTitle)]);
}

public sealed class TrendWorkflowTests
{
  private static string Workflow([System.Runtime.CompilerServices.CallerFilePath] string path = "")
  {
    DirectoryInfo? directory = new FileInfo(path).Directory;
    while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, ".github", "workflows")))
    {
      directory = directory.Parent;
    }
    return File.ReadAllText(Path.Combine(directory!.FullName, ".github", "workflows", "ci-trend.yml"));
  }

  [Fact]
  public void TheTrendWorkflow_RunsOnScheduleAndDispatchOnly_NeverForAPullRequest()
  {
    var workflow = Workflow();

    workflow.ShouldContain("\n  schedule:\n");
    workflow.ShouldContain("\n  workflow_dispatch:\n");
    workflow.ShouldNotContain("pull_request");
    workflow.ShouldNotContain("\n  push:");
  }

  [Fact]
  public void TheTrendWorkflow_HasLeastPermissions_AndRunsTheTrendModeWithIssues()
  {
    var workflow = Workflow();

    workflow.ShouldContain("permissions: {}");
    workflow.ShouldContain("      actions: read\n      contents: read\n      issues: write\n");
    workflow.ShouldNotContain("write-all");
    workflow.ShouldContain("dotnet run tools/ci-timings/ci-timings.cs -- --trend --issue --repo \"$GITHUB_REPOSITORY\"");
    workflow.ShouldContain("shell: bash");
  }
}
