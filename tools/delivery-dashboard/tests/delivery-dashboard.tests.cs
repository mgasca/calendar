#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.3
#:package Shouldly@4.3.0
#:include ../../ci-timings/CiTimings.cs
#:include ../../ci-timings/Baseline.cs
#:include ../../ci-timings/Trend.cs
#:include ../Snapshot.cs
#:include ../SnapshotRules.cs
#:include ../QualitySection.cs
#:include ../QualityRules.cs
#:include QualityTests.cs

// Tests for the delivery dashboard's snapshot tool. Run: dotnet run tools/delivery-dashboard/tests/delivery-dashboard.tests.cs
// The GitHub CLI is never called: the tests build runs and samples by hand.

using System.Runtime.CompilerServices;
using CiTimings;
using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class CiSnapshotTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static SampledRun Run(long id, int hoursAgo, params (string Job, string Path, double Seconds)[] samples) =>
    new(
      new WorkflowRun(id, "completed", "success", Noon.AddHours(-hoursAgo), "push", "main", "abc"),
      [.. samples.Select(sample => new PathSample(id, sample.Job, sample.Path, sample.Seconds))]);

  [Fact]
  public void Groups_samples_by_job_and_path_and_sorts_them()
  {
    CiSection section = CiSnapshot.Build(
      "ci.yml",
      [
        Run(1, 3, ("Frontend", "publication", 60), ("Backend", "publication", 80)),
        Run(2, 2, ("Frontend", "publication", 70), ("Backend", "publication", 90), ("Backend", "check", 70)),
        Run(3, 1, ("Frontend", "publication", 50), ("Backend", "publication", 100)),
      ]);

    section.Jobs.Select(job => (job.Job, job.Path, job.Count)).ShouldBe(
    [
      ("Backend", "check", 1),
      ("Backend", "publication", 3),
      ("Frontend", "publication", 3),
    ]);
    JobStat backend = section.Jobs.Single(job => job is { Job: "Backend", Path: "publication" });
    backend.MinSeconds.ShouldBe(80);
    backend.MedianSeconds.ShouldBe(90);
    backend.MaxSeconds.ShouldBe(100);
  }

  [Fact]
  public void The_window_spans_the_oldest_and_newest_run_and_every_number_is_marked_measured()
  {
    CiSection section = CiSnapshot.Build("ci.yml", [Run(1, 5, ("Backend", "check", 80)), Run(2, 1, ("Backend", "check", 82))]);

    section.Runs.ShouldBe(2);
    section.Basis.ShouldBe("measured");
    section.Window.ShouldBe(new SampleWindow(Noon.AddHours(-5), Noon.AddHours(-1)));
  }

  [Fact]
  public void No_runs_give_no_window_and_no_rows()
  {
    CiSection section = CiSnapshot.Build("ci.yml", []);

    section.Runs.ShouldBe(0);
    section.Window.ShouldBeNull();
    section.Jobs.ShouldBeEmpty();
  }

  [Fact]
  public void Seconds_are_rounded_to_a_tenth()
  {
    CiSection section = CiSnapshot.Build("ci.yml", [Run(1, 1, ("Backend", "check", 79.96))]);

    section.Jobs.Single().MedianSeconds.ShouldBe(80.0);
  }
}

public sealed class SnapshotRulesTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static Snapshot Sample(string job = "Backend", string repository = "mgasca/calendar") =>
    new(
      SnapshotJson.CurrentVersion,
      new DateOnly(2026, 11, 9),
      Noon,
      repository,
      new CiSection(
        "ci.yml",
        CiSnapshot.Measured,
        2,
        new SampleWindow(Noon.AddHours(-4), Noon.AddHours(-1)),
        [new JobStat(job, "check", 2, 70, 75, 80, 80)]));

  private static string ValidJson() => SnapshotJson.Write(Sample());

  [Fact]
  public void A_snapshot_the_tool_writes_is_valid_and_the_file_is_stable()
  {
    var json = ValidJson();

    SnapshotRules.Validate(json).ShouldBeEmpty();
    SnapshotJson.Write(Sample()).ShouldBe(json);
    json.ShouldEndWith("\n");
  }

  [Fact]
  public void A_snapshot_without_runs_is_valid_with_a_null_window()
  {
    var empty = new Snapshot(
      SnapshotJson.CurrentVersion, new DateOnly(2026, 11, 9), Noon, "mgasca/calendar", CiSnapshot.Build("ci.yml", []));

    SnapshotRules.Validate(SnapshotJson.Write(empty)).ShouldBeEmpty();
  }

  [Theory]
  [InlineData("/home/someone/dev/calendar")]
  [InlineData("/tmp/claude-1000/scratch")]
  [InlineData("/Users/someone/work")]
  [InlineData(@"C:\Users\someone")]
  [InlineData("run at /var/log/ci")]
  public void A_machine_path_in_a_string_fails(string text)
  {
    IReadOnlyList<string> errors = SnapshotRules.Validate(SnapshotJson.Write(Sample(job: text)));

    errors.ShouldContain(error => error.StartsWith("$.ci.jobs[0].job", StringComparison.Ordinal) && error.Contains("machine path"));
  }

  [Theory]
  [InlineData("session_1a2b3c4d")]
  [InlineData("task_ab12cd34")]
  [InlineData("local_00c4a7b6")]
  [InlineData("subagent-9f8e7d6c")]
  public void A_session_or_task_handle_fails(string text) =>
    SnapshotRules.Validate(SnapshotJson.Write(Sample(job: text))).ShouldContain(error => error.Contains("session or task handle"));

  [Fact]
  public void A_uuid_fails()
  {
    var json = SnapshotJson.Write(Sample(job: "00c4a7b6-5386-4014-b060-b918412cd279"));

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("UUID"));
  }

  [Fact]
  public void An_email_address_fails()
  {
    var json = SnapshotJson.Write(Sample(job: "someone@example.com"));

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("e-mail address"));
  }

  [Fact]
  public void An_ordinary_job_name_passes()
  {
    foreach (var name in new[] { "Backend", "Docs site", "Container image", "ADR conventions", "CI result" })
    {
      SnapshotRules.Validate(SnapshotJson.Write(Sample(job: name))).ShouldBeEmpty(name);
    }
  }

  [Fact]
  public void A_field_outside_the_schema_fails_and_names_the_field()
  {
    var json = ValidJson().Replace("\"repository\"", "\"author\": \"x\",\n  \"repository\"", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.author: field is not in the schema");
  }

  [Fact]
  public void An_extra_field_inside_a_job_row_fails()
  {
    var json = ValidJson().Replace("\"count\"", "\"login\": \"x\",\n        \"count\"", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.ci.jobs[0].login: field is not in the schema");
  }

  [Fact]
  public void A_private_field_name_fails()
  {
    var json = ValidJson().Replace("\"repository\"", "\"/home/someone\"", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("(field name)") && error.Contains("machine path"));
  }

  [Fact]
  public void A_missing_field_fails()
  {
    var json = ValidJson().Replace("\"basis\": \"measured\",", string.Empty, StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.ci.basis: field is missing");
  }

  [Fact]
  public void Another_version_fails()
  {
    var json = ValidJson().Replace("\"version\": 2", "\"version\": 3", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.version: must be 1 to 2");
  }

  [Theory]
  [InlineData("\"date\": \"2026-11-09\"", "\"date\": \"09/11/2026\"", "$.date")]
  [InlineData("\"generatedAt\": \"2026-11-09T12:00:00Z\"", "\"generatedAt\": \"yesterday\"", "$.generatedAt")]
  [InlineData("\"repository\": \"mgasca/calendar\"", "\"repository\": \"not a repository\"", "$.repository")]
  [InlineData("\"workflow\": \"ci.yml\"", "\"workflow\": \"../ci.sh\"", "$.ci.workflow")]
  [InlineData("\"basis\": \"measured\"", "\"basis\": \"guessed\"", "$.ci.basis")]
  [InlineData("\"path\": \"check\"", "\"path\": \"elsewhere\"", "$.ci.jobs[0].path")]
  [InlineData("\"count\": 2", "\"count\": 0", "$.ci.jobs[0].count")]
  public void A_bad_value_fails_at_its_path(string good, string bad, string path)
  {
    var json = ValidJson().Replace(good, bad, StringComparison.Ordinal);

    json.ShouldNotBe(ValidJson());
    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith(path, StringComparison.Ordinal));
  }

  [Fact]
  public void Seconds_that_are_not_in_order_fail()
  {
    var json = ValidJson().Replace("\"minSeconds\": 70", "\"minSeconds\": 99", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("minSeconds <= medianSeconds"));
  }

  [Fact]
  public void A_null_window_with_runs_fails()
  {
    var empty = new Snapshot(
      SnapshotJson.CurrentVersion, new DateOnly(2026, 11, 9), Noon, "mgasca/calendar", CiSnapshot.Build("ci.yml", []));
    var json = SnapshotJson.Write(empty)
      .Replace("\"runs\": 0", "\"runs\": 3", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.ci.window: must be set when runs is above 0");
  }

  [Theory]
  [InlineData("")]
  [InlineData("not json")]
  [InlineData("[]")]
  [InlineData("{}")]
  public void A_file_that_is_not_a_snapshot_fails_without_throwing(string json) =>
    SnapshotRules.Validate(json).ShouldNotBeEmpty();
}

public sealed class CiBaselineTrendTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static readonly BaselineFile Pinned = new(
    "ci.yml",
    "docs/benchmarks/0017-ci-baseline-with-changes.md",
    30,
    GateConstants.Default,
    new Dictionary<string, PathBaseline>
    {
      ["check"] = new(
        "check",
        "pinned",
        [new WorkflowRun(900, "completed", "success", Noon.AddDays(-5), "push", "main", "base")],
        new Dictionary<string, JobBaseline>
        {
          ["Backend"] = new(30, 80, 4.38, 0.08, 90, 92, 95, 126, [.. Enumerable.Range(0, 30).Select(index => 76.0 + (index % 9))]),
        }),
    });

  private static List<SampledRun> Recent(int count, double seconds) =>
  [
    .. Enumerable.Range(0, count).Select(index => new SampledRun(
      new WorkflowRun(index + 1, "completed", "success", Noon.AddHours(-count + index), "push", "main", "abc"),
      [new PathSample(index + 1, "Backend", "check", seconds + (index % 3)), new PathSample(index + 1, "Docs site", "check", 50)])),
  ];

  [Fact]
  public void A_job_with_a_pinned_baseline_carries_it_and_a_job_without_one_carries_none()
  {
    CiSection section = CiSnapshot.Build("ci.yml", Recent(20, 80), Pinned);

    section.Jobs.Single(job => job.Job == "Backend").Baseline.ShouldBe(new JobBaselineStat(30, 80, 126));
    section.Jobs.Single(job => job.Job == "Docs site").Baseline.ShouldBeNull();
    section.Jobs.Single(job => job.Job == "Docs site").Trend.ShouldBeNull();
  }

  [Fact]
  public void Twenty_recent_runs_far_above_the_baseline_are_judged_slower()
  {
    CiSection section = CiSnapshot.Build("ci.yml", Recent(20, 125), Pinned);

    JobTrend trend = section.Jobs.Single(job => job.Job == "Backend").Trend!;
    trend.Verdict.ShouldBe("slower");
    trend.ShiftSeconds.ShouldBeGreaterThan(trend.MinEffectSeconds);
    section.Trend!.Runs.ShouldBe(20);
    section.Trend.Required.ShouldBe(20);
  }

  [Fact]
  public void Runs_at_the_baseline_are_no_shift() =>
    CiSnapshot.Build("ci.yml", Recent(20, 79), Pinned).Jobs.Single(job => job.Job == "Backend").Trend!.Verdict.ShouldBe("noShift");

  [Fact]
  public void Too_few_recent_runs_are_inconclusive_not_no_shift()
  {
    CiSection section = CiSnapshot.Build("ci.yml", Recent(5, 125), Pinned);

    section.Jobs.Single(job => job.Job == "Backend").Trend!.Verdict.ShouldBe("inconclusive");
    section.Trend!.Runs.ShouldBe(5);
    section.Trend.Required.ShouldBe(20);
  }

  [Fact]
  public void Without_a_baseline_there_is_no_trend_section()
  {
    CiSection section = CiSnapshot.Build("ci.yml", Recent(20, 80));

    section.Trend.ShouldBeNull();
    section.Jobs.ShouldAllBe(job => job.Baseline == null && job.Trend == null);
  }

  [Fact]
  public void Queue_time_is_the_wait_before_the_first_job_and_ignores_a_start_before_creation()
  {
    var run = new WorkflowRun(1, "completed", "success", Noon, "push", "main", "abc");
    JobTiming Job(int startAfter) => new(1, "Job", "success", Noon.AddSeconds(startAfter), Noon.AddSeconds(startAfter + 10), []);

    CiSnapshot.QueueSeconds(run, [Job(12), Job(5)]).ShouldBe(5);
    CiSnapshot.QueueSeconds(run, [Job(-3)]).ShouldBeNull();
    CiSnapshot.QueueSeconds(run, []).ShouldBeNull();
    CiSnapshot.Build("ci.yml", Recent(3, 80), null, null, [4, 6, 20]).Queue.ShouldBe(new QueueStat(3, 6, 20, 20));
  }

  [Fact]
  public void A_snapshot_with_baseline_trend_and_queue_is_valid()
  {
    var snapshot = new Snapshot(
      SnapshotJson.CurrentVersion,
      new DateOnly(2026, 11, 9),
      Noon,
      "mgasca/calendar",
      CiSnapshot.Build("ci.yml", Recent(20, 125), Pinned, null, [3, 4]));

    var json = SnapshotJson.Write(snapshot);

    SnapshotRules.Validate(json).ShouldBeEmpty();
    json.ShouldContain("\"verdict\": \"slower\"");
  }
}

public sealed class SnapshotVersionTests
{
  private static readonly DateTimeOffset Morning = new(2026, 11, 9, 8, 0, 0, TimeSpan.Zero);

  private const string VersionOne = """
    {
      "version": 1,
      "date": "2026-11-09",
      "generatedAt": "2026-11-09T12:00:00Z",
      "repository": "mgasca/calendar",
      "ci": {
        "workflow": "ci.yml",
        "basis": "measured",
        "runs": 1,
        "window": { "from": "2026-11-09T08:00:00Z", "to": "2026-11-09T08:00:00Z" },
        "jobs": [
          { "job": "Backend", "path": "check", "count": 1, "minSeconds": 70, "medianSeconds": 70, "p90Seconds": 70, "maxSeconds": 70 }
        ]
      }
    }
    """;

  private static string RepoRoot([CallerFilePath] string path = "")
  {
    for (var dir = new DirectoryInfo(Path.GetDirectoryName(path)!); dir is not null; dir = dir.Parent)
    {
      if (File.Exists(Path.Combine(dir.FullName, ".just-version")))
      {
        return dir.FullName;
      }
    }
    throw new InvalidOperationException($"No repo root above {path}.");
  }

  /// <summary>The docs site's tests read the same files, so the two readers cannot drift apart on a valid snapshot.</summary>
  [Fact]
  public void Every_valid_fixture_of_the_docs_site_passes_the_rules()
  {
    var directory = Path.Combine(RepoRoot(), "frontend", "apps", "docs", "src", "lib", "fixtures", "dashboard", "valid", "snapshots");
    var files = Directory.GetFiles(directory, "*.json");

    files.Length.ShouldBeGreaterThan(1);
    foreach (var file in files)
    {
      SnapshotRules.Validate(File.ReadAllText(file)).ShouldBeEmpty(file);
    }
  }

  [Fact]
  public void A_version_1_file_still_validates() => SnapshotRules.Validate(VersionOne).ShouldBeEmpty();

  [Fact]
  public void Version_1_may_not_carry_version_2_fields()
  {
    var json = VersionOne.Replace("\"runs\": 1,", "\"runs\": 1, \"queue\": null,", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.ci.queue: field is not in the schema");
  }

  [Fact]
  public void Version_2_requires_the_new_fields()
  {
    IReadOnlyList<string> errors = SnapshotRules.Validate(VersionOne.Replace("\"version\": 1", "\"version\": 2", StringComparison.Ordinal));

    errors.ShouldContain("$.ci.trend: field is missing");
  }

  [Theory]
  [InlineData("\"verdict\": \"slower\"", "\"verdict\": \"awful\"", "$.ci.jobs[0].trend.verdict")]
  [InlineData("\"required\": 20", "\"required\": 0", "$.ci.trend.required")]
  [InlineData("\"thresholdSeconds\": 126", "\"thresholdSeconds\": -1", "$.ci.jobs[0].baseline.thresholdSeconds")]
  [InlineData("\"p90Seconds\": 7,", "\"p90Seconds\": 1,", "$.ci.queue")]
  public void A_bad_version_2_value_fails_at_its_path(string good, string bad, string path)
  {
    var window = new SampleWindow(Morning, Morning);
    var snapshot = new Snapshot(
      SnapshotJson.CurrentVersion,
      new DateOnly(2026, 11, 9),
      Morning,
      "mgasca/calendar",
      new CiSection(
        "ci.yml",
        "measured",
        1,
        window,
        [new JobStat("Backend", "check", 1, 70, 70, 70, 70, new JobBaselineStat(30, 80, 126), new JobTrend("slower", 20, 30, 20, 40, 10))],
        new TrendSection(20, 20, window),
        new QueueStat(3, 5, 7, 9)));
    var valid = SnapshotJson.Write(snapshot);
    SnapshotRules.Validate(valid).ShouldBeEmpty();
    var json = valid.Replace(good, bad, StringComparison.Ordinal);

    json.ShouldNotBe(valid);
    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith(path, StringComparison.Ordinal));
  }
}
