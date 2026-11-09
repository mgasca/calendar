#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.3
#:package Shouldly@4.3.0
#:include ../CiTimings.cs
#:include ../Baseline.cs
#:include ../Trend.cs
#:include BaselineTests.cs
#:include GateTests.cs
#:include TrendTests.cs

// Tests for the CI timing sampler. Run: dotnet run tools/ci-timings/tests/ci-timings.tests.cs
// The GitHub CLI is never called: the tests feed the parser the JSON shapes gh returns.

using System.Globalization;
using Shouldly;
using Xunit;

namespace CiTimings.Tests;

public sealed class ParserTests
{
  private const string JobsJson = """
    {
      "jobs": [
        {
          "name": "Frontend", "conclusion": "success",
          "started_at": "2026-11-05T17:01:12Z", "completed_at": "2026-11-05T17:05:49Z",
          "steps": [
            { "number": 1, "name": "Set up job", "started_at": "2026-11-05T17:01:12Z", "completed_at": "2026-11-05T17:01:14Z" },
            { "number": 2, "name": "Run pnpm lint", "started_at": "2026-11-05T17:01:20Z", "completed_at": "2026-11-05T17:01:36Z" },
            { "number": 3, "name": "Skipped", "conclusion": "skipped", "started_at": null, "completed_at": null }
          ]
        },
        { "name": "Pending", "conclusion": null, "started_at": "2026-11-05T17:01:12Z", "completed_at": null, "steps": [] },
        { "name": "Cancel superseded runs", "conclusion": "skipped",
          "started_at": "2026-11-05T17:01:13Z", "completed_at": "2026-11-05T17:01:12Z", "steps": [] }
      ]
    }
    """;

  [Fact]
  public void ParseRuns_ReadsTheRunListFields()
  {
    IReadOnlyList<WorkflowRun> runs = Parser.ParseRuns("""
      [
        { "databaseId": 42070425996, "status": "completed", "conclusion": "success",
          "createdAt": "2026-11-05T17:01:12Z", "event": "push" },
        { "databaseId": 42070425997, "status": "in_progress", "conclusion": "",
          "createdAt": "2026-11-05T17:02:12Z", "event": "pull_request" }
      ]
      """);

    runs.Count.ShouldBe(2);
    var created = DateTimeOffset.Parse("2026-11-05T17:01:12Z", CultureInfo.InvariantCulture);
    runs[0].ShouldBe(new WorkflowRun(42070425996, "completed", "success", created, "push"));
    runs[1].Conclusion.ShouldBe(string.Empty);
  }

  [Fact]
  public void ParseRuns_ReadsTheHeadBranchWhenListed() =>
    Parser.ParseRuns("""
      [{ "databaseId": 1, "status": "completed", "conclusion": "cancelled", "createdAt": "2026-11-06T14:47:51Z",
         "event": "pull_request", "headBranch": "docs/story-0033" }]
      """).ShouldHaveSingleItem().HeadBranch.ShouldBe("docs/story-0033");

  [Fact]
  public void ParseRuns_ReadsTheHeadShaWhenListed() =>
    Parser.ParseRuns("""
      [{ "databaseId": 1, "status": "completed", "conclusion": "success", "createdAt": "2026-11-06T20:04:12Z",
         "event": "push", "headBranch": "main", "headSha": "209f497f" }]
      """).ShouldHaveSingleItem().HeadSha.ShouldBe("209f497f");

  [Fact]
  public void ParseJobs_KeepsCompletedJobsAndSteps_AndLeavesOutPendingAndSkippedJobs()
  {
    IReadOnlyList<JobTiming> jobs = Parser.ParseJobs(7, JobsJson);

    JobTiming frontend = jobs.ShouldHaveSingleItem();
    frontend.RunId.ShouldBe(7);
    frontend.Name.ShouldBe("Frontend");
    frontend.Seconds.ShouldBe(277);
    frontend.Steps.Select(step => step.Name).ShouldBe(["Set up job", "Run pnpm lint"]);
    frontend.Steps[1].Seconds.ShouldBe(16);
  }

  [Fact]
  public void ParseJobs_KeepsEachStepsConclusion()
  {
    IReadOnlyList<JobTiming> jobs = Parser.ParseJobs(7, """
      { "jobs": [{ "name": "Backend", "conclusion": "cancelled",
        "started_at": "2026-11-06T14:47:53Z", "completed_at": "2026-11-06T14:49:24Z",
        "steps": [{ "number": 8, "name": "Run dotnet test", "conclusion": "cancelled",
          "started_at": "2026-11-06T14:49:02Z", "completed_at": "2026-11-06T14:49:21Z" }] }] }
      """);

    jobs.ShouldHaveSingleItem().Steps.ShouldHaveSingleItem().Conclusion.ShouldBe("cancelled");
  }
}

// The example pair is run 42237120711, superseded by run 42237172093 at 14:48:11 on 2026-11-06 (#348), cut to the
// steps that bound when its runners heard of the cancel.
public sealed class SupersessionTests
{
  private static readonly DateTimeOffset T0 = At("14:48:11");

  [Fact]
  public void Pair_MatchesEachCancelledPullRequestRunWithTheNextRunOfItsBranch_NewestFirst()
  {
    WorkflowRun first = Run(1, "cancelled", "14:26:33", "docs/nav");
    WorkflowRun second = Run(2, "cancelled", "14:27:02", "docs/nav");
    WorkflowRun otherBranch = Run(3, "success", "14:27:30", "fix/pages");
    WorkflowRun third = Run(4, "success", "14:28:36", "docs/nav");
    WorkflowRun push = Run(5, "cancelled", "14:29:00", "main", "push");
    WorkflowRun lastOfItsBranch = Run(6, "cancelled", "14:30:00", "fix/pages");

    Supersession.Pair([third, push, first, otherBranch, lastOfItsBranch, second])
      .Select(pair => (pair.Cancelled.Id, pair.Superseding.Id))
      .ShouldBe([(2L, 4L), (1L, 2L)]);
  }

  [Fact]
  public void Measure_BoundsWhenTheRunnersHeardOfTheCancel()
  {
    SupersededPair pair = Supersession.Measure(
      Run(42237120711, "cancelled", "14:47:51", "docs/story-0033"),
      Run(42237172093, "success", "14:48:11", "docs/story-0033"),
      [
        // Kept going after T0: three steps ran to success, so the runner had not heard of the cancel at 14:48:54.
        Job("Tooling", "cancelled", "14:47:53", "14:48:58", Step("ADRs follow conventions", "success", "14:48:54", "14:48:56")),
        // Started a step at 14:49:08 that ended cancelled at 14:49:09: the cancel had arrived by then.
        Job(
          "Docs site",
          "cancelled",
          "14:47:53",
          "14:49:11",
          Step("Verify ADR site at a project subpath", "success", "14:48:52", "14:49:08"),
          Step("Decide whether this pull request is docs-only", "cancelled", "14:49:08", "14:49:09"),
          Step("Post Run actions/checkout@v7", "success", "14:49:09", "14:49:10")),
        Job("Backend", "cancelled", "14:47:53", "14:49:24", Step("Run dotnet test", "cancelled", "14:49:02", "14:49:21")),
        Job("Frontend", "success", "14:47:56", "14:48:10"),
        Job("CI result", "failure", "14:49:26", "14:49:29", Step("All jobs succeeded", "failure", "14:49:27", "14:49:28")),
      ],
      [
        Job("Backend", "success", "14:49:31", "14:51:00") with { CreatedAt = At("14:49:30") },
        Job("Docs site", "success", "14:49:33", "14:50:40") with { CreatedAt = At("14:49:30") },
        Job("CI result", "success", "14:51:03", "14:51:07") with { CreatedAt = At("14:51:01") },
      ])
      .ShouldNotBeNull();

    pair.SupersededAt.ShouldBe(T0);
    pair.PushGap.ShouldBe(20);
    pair.Wait.ShouldBe(80);
    pair.AllStarted.ShouldBe(82, "CI result waits on needs, so it is not one of the first jobs");
    pair.CancelNotHeardAt.ShouldBe(57, "the docs-only step started at 14:49:08; a post step that starts later does not count");
    pair.CancelHeardBy.ShouldBe(58);
    pair.CancelledJobsEnd.ShouldBe(73);
    pair.RunEnd.ShouldBe(78, "CI result runs whatever happens (if: always()), so the run ends after it");
    pair.JobsNotCancelled.ShouldBe("Frontend success, CI result failure");
  }

  [Fact]
  public void Measure_LeavesTheBoundsEmpty_WhenNoStepShowsThem()
  {
    SupersededPair pair = Supersession.Measure(
      Run(1, "cancelled", "14:47:51", "b"),
      Run(2, "success", "14:48:11", "b"),
      [Job("Backend", "cancelled", "14:47:53", "14:48:20", Step("Run dotnet build", "success", "14:48:00", "14:48:18"))],
      [])
      .ShouldNotBeNull();

    pair.CancelNotHeardAt.ShouldBeNull("the only step started before T0");
    pair.CancelHeardBy.ShouldBeNull();
    pair.Wait.ShouldBeNull("the superseding run has no started job");
    pair.AllStarted.ShouldBeNull();
    pair.CancelledJobsEnd.ShouldBe(9);
  }

  [Fact]
  public void Measure_SkipsARunThatHadEndedBeforeTheNextPush() =>
    Supersession.Measure(
      Run(1, "cancelled", "14:40:00", "b"),
      Run(2, "success", "14:48:11", "b"),
      [Job("Backend", "cancelled", "14:40:02", "14:41:00")],
      [Job("Backend", "success", "14:48:13", "14:50:00")])
      .ShouldBeNull("a run cancelled by hand before the next push was not superseded");

  [Fact]
  public void FirstJobsStarted_IsNull_WithoutJobCreationTimes() =>
    Supersession.FirstJobsStarted([Job("Backend", "success", "14:49:31", "14:51:00")]).ShouldBeNull();

  [Theory]
  [InlineData("Set up job", true)]
  [InlineData("Post Run actions/cache@v6", true)]
  [InlineData("Stop containers", true)]
  [InlineData("Run dotnet test", false)]
  [InlineData("Postgres smoke test", false)]
  public void IsBookkeeping_RecognisesTheRunnersOwnSteps(string name, bool expected) =>
    Supersession.IsBookkeeping(name).ShouldBe(expected);

  internal static DateTimeOffset At(string time) =>
    DateTimeOffset.Parse($"2026-11-06T{time}Z", CultureInfo.InvariantCulture);

  internal static WorkflowRun Run(long id, string conclusion, string created, string branch, string trigger = "pull_request") =>
    new(id, "completed", conclusion, At(created), trigger, branch);

  internal static JobTiming Job(string name, string conclusion, string started, string completed, params StepTiming[] steps) =>
    new(1, name, conclusion, At(started), At(completed), steps);

  internal static StepTiming Step(string name, string conclusion, string started, string completed) =>
    new(1, name, At(started), At(completed), conclusion);
}

public sealed class StatisticsTests
{
  [Fact]
  public void Summarize_UsesNearestRankPercentiles()
  {
    Summary stats = Statistics.Summarize([5, 1, 4, 2, 3]);

    stats.ShouldBe(new Summary(5, 1, 3, 5, 5, 3));
  }

  [Fact]
  public void Summarize_EvenCount_TakesTheLowerMiddle() =>
    Statistics.Summarize([10, 20, 30, 40]).Median.ShouldBe(20, "nearest rank never interpolates, so a median is always a sampled value");

  [Fact]
  public void Summarize_EmptySample_IsZeros() =>
    Statistics.Summarize([]).ShouldBe(new Summary(0, 0, 0, 0, 0, 0));
}

public sealed class ReportTests
{
  private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-05T17:00:00Z", CultureInfo.InvariantCulture);

  [Fact]
  public void JobsTable_GroupsByName_SlowestMedianFirst()
  {
    var table = Report.JobsTable(
    [
      Job(1, "Backend", 118),
      Job(1, "Frontend", 266),
      Job(2, "Frontend", 280),
      Job(2, "Backend", 83),
    ]);

    table.ShouldBe("""
      | Job | n | min | median | p90 | max |
      | --- | --: | --: | --: | --: | --: |
      | Frontend | 2 | 4:26 | 4:26 | 4:40 | 4:40 |
      | Backend | 2 | 1:23 | 1:23 | 1:58 | 1:58 |

      """);
  }

  [Fact]
  public void StepsTable_GroupsStepsOfOneJob_InStepOrder()
  {
    var table = Report.StepsTable(
    [
      Job(1, "Frontend", 266, ("Run pnpm lint", 2, 16.4), ("Set up job", 1, 2)),
      Job(2, "Frontend", 280, ("Run pnpm lint", 2, 10), ("Set up job", 1, 1)),
      Job(2, "Backend", 83, ("Run pnpm lint", 2, 999)),
    ],
    "Frontend");

    table.ShouldBe("""
      | Step | n | min s | median s | p90 s | max s | mean s |
      | --- | --: | --: | --: | --: | --: | --: |
      | 1. Set up job | 2 | 1 | 1 | 2 | 2 | 1.5 |
      | 2. Run pnpm lint | 2 | 10 | 10 | 16 | 16 | 13.2 |

      """);
  }

  [Fact]
  public void SupersededTable_ShowsOneRowPerPair_WithADashForAMissingBound()
  {
    var table = Report.SupersededTable(
    [
      new SupersededPair(11, 12, T0, 20.4, 80, 82, 57, 58, 73, 78, "CI result failure"),
      new SupersededPair(21, 22, T0, 40, 2, null, null, 46.6, 50, 50, ""),
    ]);

    table.ShouldBe("""
      | Cancelled | Superseding | Push gap s | Wait s | All started s | Cancel heard s | Old jobs end s | Old run ends s | Not cancelled |
      | --- | --- | --: | --: | --: | --: | --: | --: | --- |
      | 11 | 12 | 20 | 80 | 82 | 57..58 | 73 | 78 | CI result failure |
      | 21 | 22 | 40 | 2 | – | –..47 | 50 | 50 | – |

      """);
  }

  [Fact]
  public void SupersessionSummary_CountsEachSegmentOverThePairsThatHaveIt()
  {
    var table = Report.SupersessionSummary(
    [
      new SupersededPair(11, 12, T0, 20, 80, 82, 57, 58, 73, 78, ""),
      new SupersededPair(21, 22, T0, 40, 2, 9, null, 46, 50, 50, ""),
    ],
    [2, 3, 2],
    [9, 4]);

    table.ShouldBe("""
      | Seconds after the superseding run was created | n | min | median | p90 | max |
      | --- | --: | --: | --: | --: | --: |
      | Wait: the superseding run's first job starts | 2 | 2 | 2 | 80 | 80 |
      | All of the superseding run's first jobs have started | 2 | 9 | 9 | 82 | 82 |
      | The old run's runners had not yet heard of the cancel (lower bound) | 1 | 57 | 57 | 57 | 57 |
      | The old run's runners had heard of it (upper bound) | 2 | 46 | 46 | 58 | 58 |
      | The old run's cancelled jobs end | 2 | 50 | 50 | 73 | 73 |
      | The old run ends | 2 | 50 | 50 | 78 | 78 |
      | Control: a pull request run that superseded nothing, created → first job | 3 | 2 | 2 | 3 | 3 |
      | Control: the same runs, created → all first jobs started | 2 | 4 | 4 | 9 | 9 |

      """);
  }

  [Fact]
  public void SupersessionSummary_ShowsDashesForASegmentWithNoValues() =>
    Report.SupersessionSummary([], [], []).ShouldContain("| The old run ends | 0 | – | – | – | – |");

  [Fact]
  public void Clock_RendersMinutesAndSeconds()
  {
    Report.Clock(266).ShouldBe("4:26");
    Report.Clock(59.6).ShouldBe("1:00");
    Report.Clock(0).ShouldBe("0:00");
  }

  private static JobTiming Job(long runId, string name, double seconds, params (string Name, int Number, double Seconds)[] steps) =>
    new(
      runId,
      name,
      "success",
      T0,
      T0.AddSeconds(seconds),
      [.. steps.Select(step => new StepTiming(step.Number, step.Name, T0, T0.AddSeconds(step.Seconds)))]);
}

public sealed class GhTests
{
  [Fact]
  public void IsTransient_RetriesServerErrorsOnly()
  {
    Gh.IsTransient("gh: Server Error (HTTP 502)").ShouldBeTrue();
    Gh.IsTransient("gh: Not Found (HTTP 404)").ShouldBeFalse();
    Gh.IsTransient("To get started with GitHub CLI, please run:  gh auth login").ShouldBeFalse();
  }
}
