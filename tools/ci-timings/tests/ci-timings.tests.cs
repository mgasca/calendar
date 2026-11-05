#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../CiTimings.cs

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
        { "name": "Pending", "conclusion": null, "started_at": "2026-11-05T17:01:12Z", "completed_at": null, "steps": [] }
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
  public void ParseJobs_KeepsCompletedJobsAndSteps_AndSkipsTheRest()
  {
    IReadOnlyList<JobTiming> jobs = Parser.ParseJobs(7, JobsJson);

    JobTiming frontend = jobs.ShouldHaveSingleItem();
    frontend.RunId.ShouldBe(7);
    frontend.Name.ShouldBe("Frontend");
    frontend.Seconds.ShouldBe(277);
    frontend.Steps.Select(step => step.Name).ShouldBe(["Set up job", "Run pnpm lint"]);
    frontend.Steps[1].Seconds.ShouldBe(16);
  }
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
