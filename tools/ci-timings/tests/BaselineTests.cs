using System.Globalization;
using Shouldly;
using Xunit;

namespace CiTimings.Tests;

public sealed class ProbabilityTests
{
  [Theory]
  [InlineData(0.5, 0)]
  [InlineData(0.975, 1.959964)]
  [InlineData(0.998, 2.878162)]
  [InlineData(0.01, -2.326348)]
  [InlineData(0.9999, 3.719016)]
  public void NormalQuantile_MatchesTheTable(double p, double z) =>
    Probability.NormalQuantile(p).ShouldBe(z, 1e-5);

  [Theory]
  [InlineData(0)]
  [InlineData(1)]
  public void NormalQuantile_RejectsTheEnds(double p) =>
    Should.Throw<ArgumentOutOfRangeException>(() => Probability.NormalQuantile(p));

  [Fact]
  public void UpperBound_WithNoFailures_IsOneMinusTheRootOfFivePercent() =>
    Probability.UpperBound(0, 20, 0.95).ShouldBe(1 - Math.Pow(0.05, 1.0 / 20), 1e-6);

  [Fact]
  public void UpperBound_WithOneFailureInThirty_MatchesClopperPearson()
  {
    // At the bound p, P(X ≤ 1) = (1 − p)^30 + 30 p (1 − p)^29 is exactly 5 %.
    var p = Probability.UpperBound(1, 30, 0.95);

    p.ShouldBe(0.1486, 1e-4);
    (Math.Pow(1 - p, 30) + (30 * p * Math.Pow(1 - p, 29))).ShouldBe(0.05, 1e-9);
  }

  [Fact]
  public void UpperBound_WhenEveryTrialFailed_IsOne() => Probability.UpperBound(4, 4, 0.95).ShouldBe(1);

  [Fact]
  public void BinomialCdf_SumsTheTerms() => Probability.BinomialCdf(1, 3, 0.5).ShouldBe(0.5, 1e-12);
}

public sealed class BaselinesTests
{
  private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-06T20:04:12Z", CultureInfo.InvariantCulture);

  private static JobTiming Job(string name, double seconds, string conclusion = "success", params StepTiming[] steps) =>
    new(1, name, conclusion, T0, T0.AddSeconds(seconds), steps);

  private static StepTiming Step(string name, string conclusion) => new(14, name, T0, T0, conclusion);

  private static WorkflowRun Run(long id, string runEvent, int minutes = 0, string branch = "main") =>
    new(id, "completed", "success", T0.AddMinutes(minutes), runEvent, branch, $"c{id}");
  [Fact]
  public void Z_ForOnePercentAcrossFiveJobs_IsAbout2Point88() => GateConstants.Default.Z.ShouldBe(2.878, 1e-3);

  [Fact]
  public void Threshold_OfAStableJob_IsTheFloorAboveTheMedian()
  {
    JobBaseline job = Baselines.Derive([50, 50, 50, 50], GateConstants.Default);

    job.LogMad.ShouldBe(0);
    job.Threshold.ShouldBe(65);
  }

  [Fact]
  public void Threshold_OfALongStableJob_IsTheRelativeMarginAboveTheMedian() =>
    Baselines.Derive([200, 200, 200], GateConstants.Default).Threshold.ShouldBe(220);

  [Fact]
  public void Threshold_OfASpreadJob_IsTheLogNormalBound()
  {
    // Logs ln 50, ln 100, ln 200: median ln 100, deviations 0, ln 2, ln 2, so the MAD is ln 2.
    JobBaseline job = Baselines.Derive([200, 50, 100], GateConstants.Default);

    job.Median.ShouldBe(100);
    job.LogMedian.ShouldBe(Math.Round(Math.Log(100), 6));
    job.LogMad.ShouldBe(Math.Round(Math.Log(2), 6));
    job.Threshold.ShouldBe(Math.Ceiling(100 * Math.Exp(GateConstants.Default.Z * 1.4826 * Math.Log(2))));
    job.Max.ShouldBe(200);
  }

  [Fact]
  public void Derive_UsesNearestRankStatistics()
  {
    JobBaseline job = Baselines.Derive([.. Enumerable.Range(1, 20).Select(value => (double)value + 60)], GateConstants.Default);

    job.Count.ShouldBe(20);
    job.Median.ShouldBe(70);
    job.P90.ShouldBe(78);
    job.P95.ShouldBe(79);
  }

  [Fact]
  public void Derive_OfAnEmptySample_Throws() => Should.Throw<ArgumentException>(() => Baselines.Derive([], GateConstants.Default));

  [Fact]
  public void Threshold_IsNotPushedUpAWholeSecondByRoundingNoise() =>
    Baselines.Threshold(50, Math.Log(50), 0, GateConstants.Default with { FloorSeconds = 5.000000000001 }).ShouldBe(55);

  [Fact]
  public void PathOf_IsPublicationWheneverTheDocsSitePublicationStepSucceeded()
  {
    JobTiming published = Job("Docs site", 100, "success", Step(Baselines.PublicationStep, "success"));

    Baselines.PathOf([Job("Backend", 80), published]).ShouldBe(Baselines.PublicationPath);
  }

  [Fact]
  public void PathOf_IsCheckWhenThePublicationStepWasSkipped_WhateverTheEvent()
  {
    JobTiming skipped = Job("Docs site", 80, "success", Step(Baselines.PublicationStep, "skipped"));

    Baselines.PathOf([Job("Backend", 80), skipped]).ShouldBe(Baselines.CheckPath);
  }

  [Fact]
  public void PathOf_IgnoresAStepOfTheSameNameInAnotherJob() =>
    Baselines.PathOf([Job("Backend", 80, "success", Step(Baselines.PublicationStep, "success"))]).ShouldBe(Baselines.CheckPath);

  [Fact]
  public void Samples_KeepOnlyGatedJobsThatSucceeded_AllOnTheRunsPath()
  {
    IEnumerable<PathSample> samples = Baselines.Samples(
      Run(7, "pull_request"),
      [
        Job("Backend", 80), Job("Frontend", 40, "failure"), Job("CI result", 3), Job("Cancel superseded runs", 2),
        Job("Docs site", 99, "success", Step(Baselines.PublicationStep, "success")),
      ]);

    samples.ShouldBe([new PathSample(7, "Backend", "publication", 80), new PathSample(7, "Docs site", "publication", 99)]);
  }

  [Theory]
  [InlineData("push", "main", true)]
  [InlineData("workflow_dispatch", "main", true)]
  [InlineData("pull_request", "main", false)]
  [InlineData("push", "feature", false)]
  [InlineData("workflow_dispatch", "feature", false)]
  public void IsMain_KeepsPushAndDispatchRunsOnMain(string runEvent, string branch, bool expected) =>
    BaselineRuns.IsMain(Run(1, runEvent, 0, branch)).ShouldBe(expected);

  [Fact]
  public void IsSuccessful_KeepsOnlyCompletedSuccesses()
  {
    BaselineRuns.IsSuccessful(Run(1, "push")).ShouldBeTrue();
    BaselineRuns.IsSuccessful(Run(1, "push") with { Conclusion = "failure" }).ShouldBeFalse();
    BaselineRuns.IsSuccessful(Run(1, "push") with { Status = "in_progress", Conclusion = "" }).ShouldBeFalse();
  }

  [Fact]
  public void Build_SplitsPathsMarksThinPathsProvisionalAndSetsJFromTheJobs()
  {
    List<SampledRun> sampled =
    [
      .. Enumerable.Range(1, 3).Select(index => new SampledRun(
        Run(index, "workflow_dispatch", index),
        [new PathSample(index, "Backend", "check", 80 + index), new PathSample(index, "Tooling", "check", 60)])),
      new SampledRun(
        Run(9, "push", 9),
        [new PathSample(9, "Backend", "publication", 90), new PathSample(9, "Docs site", "publication", 99)]),
    ];

    BaselineFile file = BaselineRuns.Build("ci.yml", "docs/benchmarks/0014-x.md", 3, GateConstants.Default, sampled);

    file.Constants.Jobs.ShouldBe(3);
    file.Paths.Keys.ShouldBe(["check", "publication"]);
    file.Paths["check"].Status.ShouldBe("pinned");
    file.Paths["check"].Runs.Select(run => run.Id).ShouldBe([1, 2, 3]);
    file.Paths["check"].Jobs["Backend"].Median.ShouldBe(82);
    file.Paths["publication"].Status.ShouldBe("provisional");
    file.Paths["publication"].Runs.ShouldHaveSingleItem().Id.ShouldBe(9);
    file.Paths["publication"].Jobs.Keys.ShouldBe(["Backend", "Docs site"]);
  }

  [Fact]
  public void Build_WithNoSampleOnAPath_LeavesThePathOut() =>
    Baselines.Build("publication", [Run(1, "workflow_dispatch")], [new PathSample(1, "Backend", "check", 80)], 30, GateConstants.Default)
      .ShouldBeNull();
}

public sealed class BaselineIoTests
{
  private static BaselineFile Sample()
  {
    var t0 = DateTimeOffset.Parse("2026-11-06T20:04:12Z", CultureInfo.InvariantCulture);
    List<SampledRun> sampled =
    [
      .. new[] { 80.0, 79, 95, 76, 81 }.Select((seconds, index) => new SampledRun(
        new WorkflowRun(100 + index, "completed", "success", t0.AddMinutes(index * 20), "workflow_dispatch", "main", $"sha{index}"),
        [new PathSample(100 + index, "Backend", "check", seconds), new PathSample(100 + index, "Frontend", "check", 45 - index)])),
    ];
    return BaselineRuns.Build("ci.yml", "docs/benchmarks/0014-ci-job-baseline.md", 30, GateConstants.Default, sampled);
  }

  [Fact]
  public void Write_ThenRead_GivesTheSameBaseline()
  {
    BaselineFile written = Sample();

    BaselineFile read = BaselineIo.Read(BaselineIo.Write(written));

    read.Workflow.ShouldBe("ci.yml");
    read.Record.ShouldBe(written.Record);
    read.MinRuns.ShouldBe(30);
    read.Constants.ShouldBe(written.Constants);
    read.Paths["check"].Status.ShouldBe("provisional");
    read.Paths["check"].Jobs.ShouldBe(written.Paths["check"].Jobs);
    read.Paths["check"].Runs.Select(run => (run.Id, run.HeadSha, run.Event, run.CreatedAt))
      .ShouldBe(written.Paths["check"].Runs.Select(run => (run.Id, run.HeadSha, run.Event, run.CreatedAt)));
  }

  [Fact]
  public void Write_IsDeterministicAndStatesTheWindowAndConstants()
  {
    var json = BaselineIo.Write(Sample());

    json.ShouldBe(BaselineIo.Write(Sample()));
    json.ShouldEndWith("}\n");
    json.ShouldContain("\"from\": \"2026-11-06T20:04:12Z\"");
    json.ShouldContain("\"to\": \"2026-11-06T21:24:12Z\"");
    json.ShouldContain("\"firstCommit\": \"sha0\"");
    json.ShouldContain("\"lastCommit\": \"sha4\"");
    json.ShouldContain("\"z\": 2.5758");
    json.ShouldContain("\"floorSeconds\": 15");
    json.ShouldContain("exp(logMedian + z * 1.4826 * logMad)");
    json.ShouldContain("job's start-to-end seconds");
  }

  [Fact]
  public void Evaluate_CountsOnlyDurationsAboveTheThreshold_AndSkipsJobsWithoutABaseline()
  {
    BaselineFile baseline = Sample();
    var threshold = baseline.Paths["check"].Jobs["Backend"].Threshold;

    BackTest test = BaselineIo.Evaluate(
      baseline,
      [
        new PathSample(1, "Backend", "check", threshold),
        new PathSample(2, "Backend", "check", threshold + 1),
        new PathSample(2, "Frontend", "check", 500),
        new PathSample(3, "Backend", "publication", 900),
        new PathSample(3, "Tooling", "check", 900),
      ]);

    test.Runs.ShouldBe(2);
    test.FailedRuns.ShouldBe(1);
    test.JobChecks[("Backend", "check")].ShouldBe((2, 1));
    test.JobChecks[("Frontend", "check")].ShouldBe((1, 1));
    test.JobChecks.ContainsKey(("Backend", "publication")).ShouldBeFalse();
    test.Exceedances.Select(item => (item.RunId, item.Job)).ShouldBe([(2L, "Backend"), (2L, "Frontend")]);
  }

  [Fact]
  public void BackTestTable_ReportsTheRateAndItsUpperBound()
  {
    BaselineFile baseline = Sample();

    var text = BaselineReport.BackTestTable(BaselineIo.Evaluate(baseline, [new PathSample(1, "Backend", "check", 60)]));

    text.ShouldContain("| check | Backend | 1 | 0 | 0.0 % | 95.0 % |");
    text.ShouldContain("**0 of 1**");
  }

  [Fact]
  public void BackTestTable_WithNothingChecked_SaysSo() =>
    BaselineReport.BackTestTable(BaselineIo.Evaluate(Sample(), [])).ShouldContain("No held-out run");

  [Fact]
  public void Table_AndWindow_ListEveryPathAndJob()
  {
    BaselineFile baseline = Sample();

    BaselineReport.Table(baseline).ShouldContain("| check | Backend | 5 | 1:20 |");
    BaselineReport.Window(baseline)
      .ShouldContain("| check | provisional | 5 | workflow_dispatch | 2026-11-06 20:04Z | 2026-11-06 21:24Z | 1.3 h | 5 |");
  }
}
