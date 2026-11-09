// Tests that job names from pull request runs cannot break or skew the snapshot (review finding on #607).
// Included by delivery-dashboard.tests.cs.

using CiTimings;
using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class QualityJobNameTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static QualityInput Run(long id, string @event, string branch, params string[] jobs) =>
    new(
      new AttemptRun(new WorkflowRun(id, "completed", "success", Noon.AddMinutes(id), @event, branch, "abc"), 1),
      [.. jobs.Select(name => new AttemptJob(name, "success", 1, []))]);

  [Theory]
  [InlineData("/home/someone/dev")]
  [InlineData("someone@example.com")]
  [InlineData("session_1a2b3c4d")]
  [InlineData("CI result")]
  public void A_job_name_only_a_pull_request_run_has_is_dropped_and_the_snapshot_still_validates(string name)
  {
    // A fork's pull request can bring its own ci.yml, so only names that the runs on main also have are kept.
    QualityInput onMain = Run(1, "push", "main", "Backend");
    QualityInput fromFork = Run(2, "pull_request", "fork-branch", "Backend", name);

    QualitySection section = QualityCollector.Build("ci.yml", [onMain, fromFork]);

    section.Scopes.Single(scope => scope.Scope == "pullRequest").Jobs.Select(job => job.Job).ShouldBe(["Backend"]);
    var snapshot = new Snapshot(
      SnapshotJson.CurrentVersion, new DateOnly(2026, 11, 9), Noon, "mgasca/calendar", CiSnapshot.Build("ci.yml", []), section);
    SnapshotRules.Validate(SnapshotJson.Write(snapshot)).ShouldBeEmpty();
  }

  [Fact]
  public void A_job_name_that_main_also_has_stays_and_the_required_check_is_flagged()
  {
    QualityInput onMain = Run(1, "push", "main", "Backend", "CI result");
    QualityInput pullRequest = Run(2, "pull_request", "feature", "Backend", "CI result");

    QualityScope scope = QualityCollector.Build("ci.yml", [onMain, pullRequest]).Scopes.Single(item => item.Scope == "pullRequest");

    scope.Jobs.Select(job => job.Job).ShouldBe(["Backend", "CI result"]);
    scope.Jobs.Single(job => job.Required).Job.ShouldBe("CI result");
  }
}
