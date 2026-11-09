using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class FlowMetricTests
{
  private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);
  private static readonly DateTimeOffset Start = Now.AddDays(-30);

  private static MergedPr Merged(
    int number,
    double openedDaysAgo,
    double mergedDaysAgo,
    string baseRef = "main",
    params ClosedIssue[] closes) =>
    new(number, Now.AddDays(-openedDaysAgo), Now.AddDays(-mergedDaysAgo), baseRef, closes);

  private static OpenPr Open(int number, double daysAgo, string head, string baseRef = "main", bool draft = false, int reviews = 0) =>
    new(number, Now.AddDays(-daysAgo), draft, reviews, baseRef, head);

  private static FlowSection Build(IReadOnlyList<OpenPr> open, IReadOnlyList<MergedPr> merged, bool full = false) =>
    FlowMetrics.Build(Now, Start, full, "main", open, merged, []);

  [Fact]
  public void Lead_time_runs_from_opened_to_merged_into_main_and_stack_steps_are_counted_apart()
  {
    // A squash-merged stack: A (on main) merged on day 20; B was opened on A's branch on day 24 and, once A merged, retargeted to
    // main and merged on day 18; C was stacked on B's branch and merged into it on day 21, before B reached main.
    List<MergedPr> history =
    [
      Merged(1, openedDaysAgo: 22, mergedDaysAgo: 20),
      Merged(2, openedDaysAgo: 21, mergedDaysAgo: 18),
      Merged(3, openedDaysAgo: 21.5, mergedDaysAgo: 21, baseRef: "feat/b"),
      Merged(4, 10, 9),
      Merged(5, 8, 6),
      Merged(6, 5, 4),
    ];

    FlowSection flow = Build([], history);

    flow.LeadTime.Sample.ShouldBe(5);
    flow.Stacks.MergedIntoBase.ShouldBe(1);
    // B's clock includes the time it waited for A: 3 days from opening to reaching main.
    flow.LeadTime.Stat!.MaxSeconds.ShouldBe(3 * 86400);
    flow.LeadTime.Stat.MedianSeconds.ShouldBe(2 * 86400);
  }

  [Fact]
  public void A_sample_below_the_minimum_keeps_its_count_and_no_distribution()
  {
    FlowSection flow = Build([], [Merged(1, 3, 2), Merged(2, 3, 1)]);

    flow.LeadTime.Sample.ShouldBe(2);
    flow.LeadTime.Stat.ShouldBeNull();
  }

  [Fact]
  public void Merges_outside_the_window_are_left_out_and_a_full_page_shrinks_the_window_to_what_was_seen()
  {
    List<MergedPr> history = [Merged(1, 40, 35), .. Enumerable.Range(2, 6).Select(number => Merged(number, 10, 5 + number))];

    FlowSection flow = Build([], history);
    flow.LeadTime.Sample.ShouldBe(6);
    flow.Window.From.ShouldBe(Start);

    // The page was full: nothing older than its oldest merge was seen, so the window starts there.
    FlowSection full = Build([], [.. history.Where(pr => pr.Number != 1)], full: true);
    full.Window.From.ShouldBe(Now.AddDays(-12));
  }

  [Fact]
  public void An_issue_closed_by_two_pull_requests_counts_once_up_to_the_last_merge_into_main()
  {
    var issue = new ClosedIssue(50, Now.AddDays(-20));
    List<MergedPr> history =
    [
      Merged(1, 19, 15, "main", issue),
      Merged(2, 14, 10, "main", issue),
      Merged(3, 13, 12, "feat/x", issue),
      Merged(4, 9, 8, "main", new ClosedIssue(51, Now.AddDays(-9))),
      Merged(5, 7, 6, "main", new ClosedIssue(52, Now.AddDays(-8))),
      Merged(6, 5, 4, "main", new ClosedIssue(53, Now.AddDays(-7))),
      Merged(7, 5, 3, "main", new ClosedIssue(54, Now.AddDays(-6))),
    ];

    FlowSection flow = Build([], history);

    flow.IssueToMerge.Sample.ShouldBe(5);
    flow.IssueToMerge.Stat!.MaxSeconds.ShouldBe(10 * 86400);
  }

  [Fact]
  public void Pull_requests_waiting_for_review_are_open_ready_and_unreviewed()
  {
    FlowSection flow = Build(
      [
        Open(1, 4, "a"),
        Open(2, 2, "b", draft: true),
        Open(3, 6, "c", reviews: 1),
        Open(4, 1, "d"),
      ],
      []);

    flow.Open.Count.ShouldBe(4);
    flow.Open.Drafts.ShouldBe(1);
    flow.Waiting.Count.ShouldBe(2);
    flow.Waiting.OldestSeconds.ShouldBe(4 * 86400);
    flow.Open.Age.ShouldBeNull();
  }

  [Fact]
  public void No_open_pull_requests_have_no_oldest_waiting_age() => Build([], []).Waiting.OldestSeconds.ShouldBeNull();

  [Fact]
  public void A_chain_of_open_pull_requests_is_one_stack_and_its_depth_is_the_longest_chain()
  {
    FlowSection flow = Build(
      [
        Open(10, 5, "feat/a"),
        Open(11, 4, "feat/b", baseRef: "feat/a"),
        Open(12, 3, "feat/c", baseRef: "feat/b"),
        Open(13, 3, "feat/d", baseRef: "feat/a"),
        Open(20, 2, "feat/solo"),
        Open(30, 2, "x/one"),
        Open(31, 1, "x/two", baseRef: "x/one"),
      ],
      []);

    flow.Stacks.Stacks.Select(stack => (stack.Depth, string.Join(",", stack.PullRequests))).ShouldBe([(3, "10,11,12,13"), (2, "30,31")]);
  }

  [Fact]
  public void Two_pull_requests_naming_each_others_branch_do_not_loop()
  {
    IReadOnlyList<StackInfo> stacks = FlowMetrics.Stacks([Open(1, 1, "a", baseRef: "b"), Open(2, 1, "b", baseRef: "a")]);

    stacks.ShouldBeEmpty();
  }

  [Fact]
  public void The_task_list_of_an_epic_names_each_issue_once_and_reads_the_box()
  {
    string[] lines =
    [
      "## Slices",
      "- [ ] **0. Decision**",
      "- [x] #596 **1. Snapshot**",
      "- [ ] #597 **2. Page** and #598",
      "  - [ ] #599 nested",
      "* [X] #596 again",
      "- [ ] text only",
    ];
    var body = string.Join('\n', lines);

    FlowMetrics.TaskList(body).ShouldBe([(596, true), (597, false), (599, false)]);
  }

  [Fact]
  public void Epic_progress_counts_the_closed_issues_of_its_task_list()
  {
    FlowSection flow = FlowMetrics.Build(
      Now,
      Start,
      false,
      "main",
      [],
      [],
      [new EpicInput(595, [(596, true), (597, false), (598, false)])]);

    flow.Epics.ShouldBe([new EpicProgress(595, 3, 1)]);
  }
}

public sealed class FlowParserTests
{
  private const string Answer = """
    { "data": { "repository": {
      "defaultBranchRef": { "name": "main" },
      "open": { "nodes": [
        { "number": 7, "createdAt": "2026-11-08T10:00:00Z", "isDraft": false,
          "baseRefName": "main", "headRefName": "feat/x", "reviews": { "totalCount": 0 } }
      ] },
      "merged": { "nodes": [
        { "number": 5, "createdAt": "2026-11-01T10:00:00Z", "mergedAt": "2026-11-02T10:00:00Z", "baseRefName": "main",
          "closingIssuesReferences": { "nodes": [ { "number": 3, "createdAt": "2026-10-30T10:00:00Z" } ] } },
        { "number": 6, "createdAt": "2026-11-03T10:00:00Z", "mergedAt": "2026-11-04T10:00:00Z", "baseRefName": "main",
          "closingIssuesReferences": { "nodes": [] } },
        { "number": 8, "createdAt": "2026-11-03T10:00:00Z", "mergedAt": null, "baseRefName": "main",
          "closingIssuesReferences": { "nodes": [] } }
      ] },
      "epics": { "nodes": [ { "number": 1, "body": "- [ ] #3 one\n- [ ] #4 two" } ] }
    } } }
    """;

  [Fact]
  public void The_answer_becomes_pull_requests_merges_newest_first_and_epics_and_unmerged_nodes_are_dropped()
  {
    FlowAnswer parsed = FlowParser.Parse(Answer);

    parsed.DefaultBranch.ShouldBe("main");
    parsed.Open.Single().ShouldBe(new OpenPr(7, new DateTimeOffset(2026, 11, 8, 10, 0, 0, TimeSpan.Zero), false, 0, "main", "feat/x"));
    parsed.Merged.Select(pr => pr.Number).ShouldBe([6, 5]);
    parsed.Merged[1].Closes.Single().Number.ShouldBe(3);
    parsed.Epics.Single().Number.ShouldBe(1);
  }

  [Fact]
  public void The_state_query_has_one_alias_per_issue_and_the_answer_lists_the_closed_ones()
  {
    FlowParser.StateQuery([4, 3, 3]).ShouldContain("i3: issue(number: 3)");
    FlowParser.StateQuery([4, 3, 3]).Split("issue(number").Length.ShouldBe(3);

    var answer = """{ "data": { "repository": { "i3": { "state": "CLOSED" }, "i4": { "state": "OPEN" }, "i9": null } } }""";
    FlowParser.ClosedIssues(answer).ShouldBe([3]);
  }
}

public sealed class FlowRulesTests
{
  private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static FlowSection Section()
  {
    List<MergedPr> merged =
    [
      .. Enumerable.Range(1, 6).Select(number => new MergedPr(
        number, Now.AddDays(-10 + number), Now.AddDays(-9 + number), "main", [new ClosedIssue(100 + number, Now.AddDays(-12))])),
    ];
    List<OpenPr> open =
    [
      new OpenPr(20, Now.AddDays(-3), false, 0, "main", "feat/a"),
      new OpenPr(21, Now.AddDays(-2), false, 1, "feat/a", "feat/b"),
    ];
    return FlowMetrics.Build(Now, Now.AddDays(-30), false, "main", open, merged, [new EpicInput(595, [(596, true), (597, false)])]);
  }

  private static string Json(FlowSection? flow = null) => SnapshotJson.Write(Snapshot(flow ?? Section()));

  private static Snapshot Snapshot(FlowSection? flow) =>
    new(SnapshotJson.CurrentVersion, new DateOnly(2026, 11, 9), Now, "mgasca/calendar", CiSnapshot.Build("ci.yml", []), Flow: flow);

  [Fact]
  public void A_snapshot_with_a_flow_section_is_valid_and_one_without_still_is()
  {
    SnapshotRules.Validate(Json()).ShouldBeEmpty();
    var renamed = Json().Replace("\"flow\"", "\"other\"", StringComparison.Ordinal);
    SnapshotRules.Validate(renamed).ShouldContain("$.other: field is not in the schema");
    SnapshotRules.Validate(SnapshotJson.Write(Snapshot(null))).ShouldBeEmpty();
  }

  [Theory]
  [InlineData("\"minSample\"", "\"login\": \"x\", \"minSample\"", "$.flow.login: field is not in the schema")]
  [InlineData("\"drafts\": 0", "\"drafts\": 9", "$.flow.openPullRequests.drafts: must not exceed count")]
  [InlineData("\"done\": 1", "\"done\": 5", "$.flow.epics[0].done: must not exceed total")]
  [InlineData("\"basis\": \"measured\"", "\"basis\": \"guessed\"", "$.flow.basis")]
  public void A_bad_flow_value_fails_at_its_path(string good, string bad, string path)
  {
    var valid = Json();
    var json = valid.Replace(good, bad, StringComparison.Ordinal);

    json.ShouldNotBe(valid);
    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith(path, StringComparison.Ordinal));
  }

  [Fact]
  public void A_distribution_with_a_thin_sample_fails_and_one_missing_from_a_full_sample_fails()
  {
    FlowSection thin = Section() with { LeadTime = new DurationSection(2, new Distribution(2, 1, 1, 1)) };
    SnapshotRules.Validate(Json(thin)).ShouldContain(error => error.Contains("$.flow.leadTime.stat") && error.Contains("inconclusive"));

    FlowSection missing = Section() with { LeadTime = new DurationSection(9, null) };
    SnapshotRules.Validate(Json(missing)).ShouldContain(error => error.Contains("$.flow.leadTime.stat: must be set"));
  }

  [Fact]
  public void The_privacy_scan_covers_the_flow_section()
  {
    var json = Json().Replace("\"epics\"", "\"/home/someone\"", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("$.flow") && error.Contains("machine path"));
  }
}
