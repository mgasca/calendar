// Tests of the superseded-run section (story 0053, issue #618). Included by delivery-dashboard.tests.cs. The GitHub CLI is
// never called: the tests build pairs, runs and jobs by hand.

using CiTimings;
using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class SupersededTests
{
  // Monday 2026-11-02 and Monday 2026-11-09 (UTC).
  private static readonly DateTimeOffset WeekOne = new(2026, 11, 3, 10, 0, 0, TimeSpan.Zero);
  private static readonly DateTimeOffset WeekTwo = new(2026, 11, 10, 10, 0, 0, TimeSpan.Zero);

  private static SupersededPair Pair(DateTimeOffset at, double? wait, double gap = 60, long id = 1) =>
    new(id, id + 1000, at, gap, wait, wait, null, null, null, 30, string.Empty);

  [Theory]
  [InlineData("2026-11-02T00:00:00Z", "2026-11-02")]
  [InlineData("2026-11-08T23:59:59Z", "2026-11-02")]
  [InlineData("2026-11-09T00:00:00Z", "2026-11-09")]
  [InlineData("2026-11-10T10:00:00Z", "2026-11-09")]
  public void A_week_starts_on_the_Monday_in_UTC(string time, string monday) =>
    SupersededCalculator.WeekStart(DateTimeOffset.Parse(time, System.Globalization.CultureInfo.InvariantCulture))
      .ToString(SnapshotJson.DateFormat, System.Globalization.CultureInfo.InvariantCulture).ShouldBe(monday);

  [Fact]
  public void Pairs_are_counted_and_timed_per_week_beside_the_control()
  {
    SupersededSection? section = SupersededCalculator.Build(
      [
        Pair(WeekOne, 10, 100, 1), Pair(WeekOne.AddHours(1), 20, 200, 2), Pair(WeekOne.AddHours(2), 30, 300, 3),
        Pair(WeekTwo, 50, 400, 4),
      ],
      ignored: 2,
      [(WeekOne, 4), (WeekOne.AddHours(3), 6), (WeekTwo, 8)],
      cap: 30);

    section.ShouldNotBeNull();
    section.Sample.Pairs.ShouldBe(4);
    section.Sample.Ignored.ShouldBe(2);
    section.Sample.ControlRuns.ShouldBe(3);
    section.Weeks.Select(week => week.Week).ShouldBe(["2026-11-02", "2026-11-09"]);
    section.Weeks[0].ShouldBe(new SupersededWeek("2026-11-02", 3, 3, 20, 30, 30, 200, 2, 4));
    section.Weeks[1].ShouldBe(new SupersededWeek("2026-11-09", 1, 1, 50, 50, 50, 400, 1, 8));
    section.Sample.Window.ShouldBe(new SampleWindow(WeekOne, WeekTwo));
  }

  [Fact]
  public void A_week_with_only_control_runs_shows_no_superseded_statistic()
  {
    SupersededSection? section = SupersededCalculator.Build([], 0, [(WeekOne, 5)], 30);

    section.ShouldNotBeNull();
    section.Weeks.ShouldHaveSingleItem().ShouldBe(new SupersededWeek("2026-11-02", 0, 0, null, null, null, null, 1, 5));
    section.Sample.Window.ShouldBeNull();
  }

  [Fact]
  public void Pairs_that_never_reported_a_first_job_count_but_add_no_wait()
  {
    SupersededSection? section = SupersededCalculator.Build([Pair(WeekOne, null), Pair(WeekOne, 12, id: 2)], 0, [], 30);

    section.ShouldNotBeNull();
    section.Weeks[0].Pairs.ShouldBe(2);
    section.Weeks[0].WaitRuns.ShouldBe(1);
    section.Weeks[0].WaitMedianSeconds.ShouldBe(12);
  }

  [Theory]
  [InlineData(29, 0, false)]
  [InlineData(30, 0, true)]
  [InlineData(5, 54, false)]
  [InlineData(5, 55, true)]
  [InlineData(0, 60, true)]
  public void Pairs_left_out_as_manual_cancels_still_count_toward_the_examination_bound(int measured, int ignored, bool done) =>
    SupersededCollector.Done(measured, ignored, 30).ShouldBe(done);

  [Fact]
  public void Nothing_sampled_gives_no_section() => SupersededCalculator.Build([], 0, [], 30).ShouldBeNull();

  private static WorkflowRun Run(long id, string conclusion, DateTimeOffset created, string branch = "feature") =>
    new(id, "completed", conclusion, created, "pull_request", branch);

  private static JobTiming Job(long run, DateTimeOffset started, DateTimeOffset completed, string conclusion) =>
    new(run, "Backend", conclusion, started, completed, []);

  [Fact]
  public void A_pair_is_a_cancelled_run_and_the_next_run_of_the_branch_and_a_control_run_is_in_none()
  {
    var t = new DateTimeOffset(2026, 11, 3, 9, 0, 0, TimeSpan.Zero);
    WorkflowRun cancelled = Run(1, "cancelled", t);
    WorkflowRun newer = Run(2, "success", t.AddMinutes(2));
    WorkflowRun other = Run(3, "success", t.AddMinutes(1), "other-branch");

    IReadOnlyList<(WorkflowRun Cancelled, WorkflowRun Superseding)> pairs = Supersession.Pair([cancelled, newer, other]);

    pairs.ShouldHaveSingleItem().ShouldBe((cancelled, newer));
    SupersededPair? measured = Supersession.Measure(
      cancelled,
      newer,
      [Job(1, t.AddSeconds(5), t.AddMinutes(3), "cancelled")],
      [Job(2, t.AddMinutes(2).AddSeconds(14), t.AddMinutes(8), "success")]);
    measured.ShouldNotBeNull();
    measured.Wait.ShouldBe(14);
    measured.PushGap.ShouldBe(120);
  }

  [Fact]
  public void A_run_cancelled_by_hand_before_the_newer_run_is_not_a_pair()
  {
    var t = new DateTimeOffset(2026, 11, 3, 9, 0, 0, TimeSpan.Zero);
    SupersededPair? measured = Supersession.Measure(
      Run(1, "cancelled", t),
      Run(2, "success", t.AddMinutes(10)),
      [Job(1, t.AddSeconds(5), t.AddMinutes(1), "cancelled")],
      [Job(2, t.AddMinutes(10), t.AddMinutes(12), "success")]);

    measured.ShouldBeNull();
  }

  private static string Valid(Func<SupersededSection?, SupersededSection?>? change = null)
  {
    SupersededSection? section = SupersededCalculator.Build(
      [Pair(WeekOne, 10), Pair(WeekOne.AddHours(1), 20, id: 2), Pair(WeekOne.AddHours(2), 30, id: 3)], 1, [(WeekOne, 4)], 30);
    var snapshot = new Snapshot(
      SnapshotJson.CurrentVersion,
      new DateOnly(2026, 11, 9),
      WeekTwo,
      "mgasca/calendar",
      CiSnapshot.Build("ci.yml", []),
      Superseded: change is null ? section : change(section));
    return SnapshotJson.Write(snapshot);
  }

  [Fact]
  public void A_snapshot_with_the_section_validates() => SnapshotRules.Validate(Valid()).ShouldBeEmpty();

  [Fact]
  public void A_version_3_snapshot_without_a_sample_carries_null_and_validates() =>
    SnapshotRules.Validate(Valid(_ => null)).ShouldBeEmpty();

  [Fact]
  public void The_section_holds_aggregates_and_no_run_ids()
  {
    var json = Valid();

    json.ShouldNotContain("1001");
    json.ShouldNotContain("\"branch");
    json.ShouldNotContain("feature");
  }

  [Fact]
  public void Version_2_may_not_carry_the_section()
  {
    var json = Valid().Replace("\"version\": 3", "\"version\": 2", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.superseded: field is not in the schema before version 3");
  }

  [Fact]
  public void Version_3_requires_the_section()
  {
    var json = Valid(_ => null).Replace(",\n  \"superseded\": null", string.Empty, StringComparison.Ordinal);

    json.ShouldNotContain("superseded");
    SnapshotRules.Validate(json).ShouldContain("$.superseded: field is missing (null when not sampled)");
  }

  [Theory]
  [InlineData("\"detection\": \"inferred\"", "\"detection\": \"guessed\"", "$.superseded.basis.detection")]
  [InlineData("\"pairs\": 3,\n      \"ignored\"", "\"pairs\": 4,\n      \"ignored\"", "$.superseded.weeks")]
  [InlineData("\"cap\": 30", "\"cap\": 2", "$.superseded.sample.pairs")]
  [InlineData("\"week\": \"2026-11-02\"", "\"week\": \"2026-11-03\"", "$.superseded.weeks[0].week")]
  [InlineData("\"waitP90Seconds\": 30", "\"waitP90Seconds\": 5", "$.superseded.weeks[0]")]
  [InlineData("\"waitRuns\": 3", "\"waitRuns\": 4", "$.superseded.weeks[0].waitRuns")]
  [InlineData(
    "\"controlRuns\": 1,\n        \"controlWait",
    "\"controlRuns\": 0,\n        \"controlWait",
    "$.superseded.weeks[0].controlWaitMedianSeconds")]
  public void A_bad_value_fails_at_its_path(string good, string bad, string path)
  {
    var valid = Valid();
    var json = valid.Replace(good, bad, StringComparison.Ordinal);

    json.ShouldNotBe(valid);
    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith(path, StringComparison.Ordinal));
  }
}
