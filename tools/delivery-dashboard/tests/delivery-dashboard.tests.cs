#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.3
#:package Shouldly@4.3.0
#:include ../../ci-timings/CiTimings.cs
#:include ../../ci-timings/Baseline.cs
#:include ../Snapshot.cs
#:include ../SnapshotRules.cs
#:include ../QualitySection.cs
#:include ../QualityRules.cs
#:include ../AgentSection.cs
#:include ../AgentRules.cs
#:include QualityTests.cs
#:include AgentTests.cs

// Tests for the delivery dashboard's snapshot tool. Run: dotnet run tools/delivery-dashboard/tests/delivery-dashboard.tests.cs
// The GitHub CLI is never called: the tests build runs and samples by hand.

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
    var empty = new Snapshot(1, new DateOnly(2026, 11, 9), Noon, "mgasca/calendar", CiSnapshot.Build("ci.yml", []));

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
    var json = ValidJson().Replace("\"version\": 1", "\"version\": 2", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.version: must be 1");
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
    var json = SnapshotJson.Write(new Snapshot(1, new DateOnly(2026, 11, 9), Noon, "mgasca/calendar", CiSnapshot.Build("ci.yml", [])))
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
