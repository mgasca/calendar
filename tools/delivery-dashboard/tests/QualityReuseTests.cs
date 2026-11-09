// Tests that the quality section reuses jobs responses fetched for the CI section (#614). Included by delivery-dashboard.tests.cs.

using CiTimings;
using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class QualityReuseTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static AttemptRun Attempt(long id, int attempt) =>
    new(new WorkflowRun(id, "completed", "success", Noon, "push", "main", "abc"), attempt);

  [Fact]
  public void Jobs_fetched_for_the_CI_section_are_reused_only_for_a_run_never_re_run()
  {
    var known = new Dictionary<long, string> { [1] = "{\"jobs\":[]}", [2] = "{\"jobs\":[]}" };

    QualityCollector.ReusableJobs(Attempt(1, 1), known).ShouldBe("{\"jobs\":[]}");
    QualityCollector.ReusableJobs(Attempt(2, 2), known).ShouldBeNull();
    QualityCollector.ReusableJobs(Attempt(3, 1), known).ShouldBeNull();
    QualityCollector.ReusableJobs(Attempt(1, 1), null).ShouldBeNull();
  }
}
