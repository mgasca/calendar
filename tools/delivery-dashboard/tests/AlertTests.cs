using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class AlertEvaluationTests
{
  private static string Snapshot(double oldestWaiting = 3600, double? leadMedian = 1200, int depth = 2, string quality = "[]") =>
    $$"""
    {
      "flow": {
        "waitingForReview": { "count": 1, "oldestSeconds": {{oldestWaiting}} },
        "leadTime": { "sample": 40, "stat": {{(leadMedian is null ? "null" : $"{{ \"medianSeconds\": {leadMedian} }}")}} },
        "stacks": { "open": [ { "depth": {{depth}}, "pullRequests": [1, 2] } ] }
      },
      "quality": { "scopes": {{quality}} }
    }
    """;

  private static string Scope(string scope, string verdict, double low, double rate = 0.4) =>
    $$"""
    [ { "scope": "{{scope}}", "jobs": [ { "job": "Backend", "verdict": "{{verdict}}", "rate": {{rate}}, "low": {{low}}, "trials": 30 } ] } ]
    """;

  private static IReadOnlyList<Breach> Evaluate(string json) => Alerts.Evaluate(json, AlertThresholds.Default);

  [Fact]
  public void A_calm_snapshot_breaches_nothing() => Evaluate(Snapshot()).ShouldBeEmpty();

  [Fact]
  public void A_review_waiting_longer_than_the_threshold_is_a_flow_breach()
  {
    Evaluate(Snapshot(oldestWaiting: 14 * 86400)).ShouldBeEmpty();
    Evaluate(Snapshot(oldestWaiting: (14 * 86400) + 1)).Select(breach => breach.Kind).ShouldBe(["flow"]);
  }

  [Fact]
  public void A_slow_median_lead_time_is_a_flow_breach_and_an_inconclusive_one_is_not()
  {
    Evaluate(Snapshot(leadMedian: (24 * 3600) + 1)).Select(breach => breach.Text).ShouldHaveSingleItem().ShouldContain("lead time");
    Evaluate(Snapshot(leadMedian: null)).ShouldBeEmpty();
  }

  [Fact]
  public void A_stack_deeper_than_the_threshold_is_a_flow_breach() =>
    Evaluate(Snapshot(depth: 5)).Select(breach => breach.Text).ShouldHaveSingleItem().ShouldContain("5 pull requests");

  [Fact]
  public void A_failure_rate_surely_above_the_threshold_on_main_is_a_quality_breach()
  {
    Breach breach = Evaluate(Snapshot(quality: Scope("main", "conclusive", low: 0.15))).ShouldHaveSingleItem();

    breach.Kind.ShouldBe("quality");
    breach.Text.ShouldContain("`Backend` fails 40 %");
  }

  [Theory]
  [InlineData("main", "conclusive", 0.10)]
  [InlineData("main", "inconclusive", 0.50)]
  [InlineData("pullRequest", "conclusive", 0.50)]
  public void A_rate_that_may_be_below_the_threshold_or_is_inconclusive_or_is_not_on_main_breaches_nothing(
    string scope,
    string verdict,
    double low) =>
    Evaluate(Snapshot(quality: Scope(scope, verdict, low))).ShouldBeEmpty();

  [Fact]
  public void A_snapshot_without_the_sections_breaches_nothing() => Evaluate("{}").ShouldBeEmpty();
}

public sealed class AlertActionTests
{
  private static readonly Breach[] AllFlow =
  [
    new("flow", "waiting"),
    new("flow", "lead time"),
    new("flow", "stack"),
  ];

  [Fact]
  public void Several_breaches_of_one_kind_open_exactly_one_issue()
  {
    IReadOnlyList<AlertAction> actions = Alerts.Actions(AllFlow, [], "https://example.org/dashboard/flow/");

    AlertAction action = actions.ShouldHaveSingleItem();
    action.Issue.ShouldBe(0);
    action.Title.ShouldBe(Alerts.FlowTitle);
    action.Body.ShouldContain("- waiting");
    action.Body.ShouldContain("- stack");
    action.Body.ShouldContain("https://example.org/dashboard/flow/");
  }

  [Fact]
  public void An_open_issue_with_the_title_is_commented_on_instead_of_a_second_one_opened()
  {
    IReadOnlyList<AlertAction> actions = Alerts.Actions(
      AllFlow,
      [(42, "Something else"), (31, Alerts.FlowTitle), (30, Alerts.FlowTitle), (12, Alerts.QualityTitle)],
      string.Empty);

    actions.ShouldHaveSingleItem().Issue.ShouldBe(30);
  }

  [Fact]
  public void One_breach_of_each_kind_gives_one_action_each_and_none_gives_nothing()
  {
    Alerts.Actions([new Breach("quality", "q"), new Breach("flow", "f"), new Breach("quality", "q2")], [], string.Empty)
      .Select(action => (action.Kind, action.Issue)).ShouldBe([("flow", 0), ("quality", 0)]);
    Alerts.Actions([], [(1, Alerts.FlowTitle)], string.Empty).ShouldBeEmpty();
  }

  [Fact]
  public void The_alert_says_it_is_the_only_one_and_how_it_was_posted()
  {
    var body = Alerts.Actions(AllFlow, [], string.Empty).Single().Body;

    body.ShouldContain("the only alert");
    body.ShouldContain(".github/workflows/dashboard-snapshot.yml");
  }
}

public sealed class RetentionTests
{
  private const long Limit = 1000;

  private static string Tree(params (string Path, long Size)[] files) =>
    string.Join('\n', files.Select(file => $"100644 blob 0123456789abcdef0123456789abcdef01234567 {file.Size,7}\t{file.Path}"));

  [Fact]
  public void The_size_of_the_snapshots_is_summed_and_other_paths_and_garbage_are_ignored()
  {
    Retention.Verdict verdict = Retention.Check(
      Tree(("snapshots/2026-11-08.json", 300), ("snapshots/2026-11-09.json", 200), ("README.md", 5000)) + "\nnot a tree line\n",
      Limit);

    verdict.Files.ShouldBe(2);
    verdict.Bytes.ShouldBe(500);
    verdict.Status.ShouldBe("ok");
  }

  [Fact]
  public void The_incoming_snapshot_counts_so_the_check_fails_before_the_limit_is_passed()
  {
    var tree = Tree(("snapshots/2026-11-08.json", 990));

    Retention.Check(tree, Limit).Status.ShouldBe("warning");
    Retention.Check(tree, Limit, incomingBytes: 20).Status.ShouldBe("over");
    Retention.Check(tree, Limit, incomingBytes: 10).Status.ShouldBe("warning");
  }

  [Fact]
  public void Past_eighty_percent_is_a_warning_and_below_it_is_ok()
  {
    Retention.Check(Tree(("snapshots/a.json", 799)), Limit).Status.ShouldBe("ok");
    Retention.Check(Tree(("snapshots/a.json", 800)), Limit).Status.ShouldBe("warning");
  }

  [Fact]
  public void An_empty_tree_is_ok() => Retention.Check(string.Empty, Limit).Status.ShouldBe("ok");

  [Fact]
  public void The_default_limit_is_fifty_megabytes() => Retention.LimitBytes.ShouldBe(52428800);
}
