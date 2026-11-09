// Tests of the agent section (story 0053, issue #600). Included by delivery-dashboard.tests.cs. The GitHub CLI is never
// called: the tests build comments and issues by hand.

using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class CountCommentTests
{
  [Theory]
  [InlineData("Tasks started: 2. Subagents started: 3.", 2, 3)]
  [InlineData("Tasks started: 0. Subagents started: 0.", 0, 0)]
  [InlineData("Design is posted.\n\nTasks started: 1. Subagents started: 4.\n\n🤖 Generated with Claude Code", 1, 4)]
  [InlineData("tasks started: 5", 5, 0)]
  [InlineData("SUBAGENTS STARTED = 7", 0, 7)]
  [InlineData("Task started: 1, Subagent started: 1", 1, 1)]
  [InlineData("Tasks started: 1\nSubagents started: 2", 1, 2)]
  public void A_count_comment_is_read_wherever_the_line_sits(string body, int tasks, int subagents) =>
    CountComments.Parse(body).ShouldBe(new CountParse(CountKind.Valid, tasks, subagents));

  [Theory]
  [InlineData("")]
  [InlineData("Looks good to me.")]
  [InlineData("Several tasks started later, and subagents started too.")]
  [InlineData("> Tasks started: 2. Subagents started: 3.\n\nQuoted in a reply, not a count.")]
  public void A_comment_without_a_count_is_not_a_count_comment(string body) =>
    CountComments.Parse(body).ShouldBe(new CountParse(CountKind.None, 0, 0));

  [Theory]
  [InlineData("Tasks started: many. Subagents started: 1.")]
  [InlineData("Tasks started: -3.")]
  [InlineData("Tasks started: .")]
  [InlineData("Tasks started:")]
  [InlineData("Tasks started: 1e3")]
  [InlineData("Tasks started: 1001. Subagents started: 0.")]
  [InlineData("Subagents started: 99999999999999")]
  [InlineData("Tasks started: 2. Subagents started: lots.")]
  public void A_count_comment_with_an_unusable_number_is_malformed_and_contributes_nothing(string body) =>
    CountComments.Parse(body).ShouldBe(new CountParse(CountKind.Malformed, 0, 0));
}

public sealed class AgentCollectorTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static IssueInput Issue(
    int number,
    string[] comments,
    PullRequestMention[]? pullRequests = null,
    int? total = null,
    int hoursAgo = 0) =>
    new(number, Noon.AddHours(-hoursAgo), total ?? comments.Length, comments, pullRequests ?? []);

  [Fact]
  public void An_issue_without_count_comments_is_listed_with_no_cost_data_and_does_not_fail()
  {
    AgentsSection section = AgentCollector.Build([Issue(7, ["Please look.", "Done."], [new PullRequestMention(70, 2)])]);

    section.Issues.ShouldBe([new AgentIssue(7, 0, 0, null, null, 2, 2, 1)]);
    section.Activity.WithCounts.ShouldBe(0);
    section.Counts.ShouldBe(new AgentCountTotals(0, 0, 0, 0));
  }

  [Fact]
  public void Count_comments_are_summed_per_issue_and_malformed_ones_are_counted_but_not_summed()
  {
    AgentsSection section = AgentCollector.Build(
    [
      Issue(
        5,
        [
          "Plan.\n\nTasks started: 1. Subagents started: 2.",
          "Tasks started: 3. Subagents started: 0.",
          "Tasks started: many.",
          "Review?",
        ]),
    ]);

    section.Issues.ShouldBe([new AgentIssue(5, 2, 1, 4, 2, 4, 0, 0)]);
    section.Counts.ShouldBe(new AgentCountTotals(2, 1, 4, 2));
    section.Activity.WithCounts.ShouldBe(1);
  }

  [Fact]
  public void An_issue_with_only_malformed_count_comments_has_no_cost_data()
  {
    AgentIssue row = AgentCollector.Build([Issue(5, ["Tasks started: x."])]).Issues.Single();

    row.Malformed.ShouldBe(1);
    row.CountComments.ShouldBe(0);
    row.Tasks.ShouldBeNull();
    row.Subagents.ShouldBeNull();
  }

  [Fact]
  public void A_pull_request_that_mentions_an_issue_twice_counts_once_with_its_reviews()
  {
    PullRequestMention[] mentions = [new(70, 3), new(70, 3), new(71, 1)];

    AgentIssue row = AgentCollector.Build([Issue(7, [], mentions)]).Issues.Single();

    row.PullRequests.ShouldBe(2);
    row.Reviews.ShouldBe(4);
  }

  [Fact]
  public void The_comment_total_is_kept_when_only_the_first_hundred_were_read() =>
    AgentCollector.Build([Issue(7, ["a"], total: 140)]).Issues.Single().Comments.ShouldBe(140);

  [Fact]
  public void An_issue_with_no_comment_and_no_pull_request_is_scanned_but_not_listed()
  {
    AgentsSection section = AgentCollector.Build([Issue(1, []), Issue(2, ["x"])]);

    section.Sample.Scanned.ShouldBe(2);
    section.Issues.Select(issue => issue.Issue).ShouldBe([2]);
  }

  [Fact]
  public void Issues_are_listed_newest_number_first_and_the_window_spans_the_updates()
  {
    AgentsSection section = AgentCollector.Build(
      [Issue(3, ["a"], hoursAgo: 9), Issue(9, ["a"], hoursAgo: 1), Issue(5, ["a"], hoursAgo: 4)]);

    section.Issues.Select(issue => issue.Issue).ShouldBe([9, 5, 3]);
    section.Sample.Window.ShouldBe(new SampleWindow(Noon.AddHours(-9), Noon.AddHours(-1)));
    section.Activity.ShouldBe(new AgentActivityTotals(3, 0, 3, 0, 0));
  }

  [Fact]
  public void Activity_is_measured_and_self_reported_counts_are_inferred()
  {
    AgentsSection section = AgentCollector.Build([]);

    section.Basis.ShouldBe(new AgentBasis("measured", "inferred"));
    section.Sample.ShouldBe(new AgentSample(0, null));
  }
}

public sealed class AgentParserTests
{
  private const string Repo = "mgasca/calendar";

  [Fact]
  public void The_answer_is_read_into_issues_with_their_comments_and_pull_requests()
  {
    const string Json = """
      {"data":{"repository":{"issues":{"nodes":[
        {"number":599,"updatedAt":"2026-11-09T10:00:00Z",
         "comments":{"totalCount":2,"nodes":[{"body":"Tasks started: 1. Subagents started: 0."},{"body":"hi"}]},
         "timelineItems":{"nodes":[
           {"source":{"number":607,"reviews":{"totalCount":2},"repository":{"nameWithOwner":"mgasca/calendar"}}},
           {"source":{"number":12,"reviews":{"totalCount":9},"repository":{"nameWithOwner":"someone/else"}}},
           {"source":{}},
           {}
         ]}}
      ]}}}}
      """;

    IssueInput issue = AgentParser.ParseIssues(Json, Repo).Single();

    issue.Number.ShouldBe(599);
    issue.CommentTotal.ShouldBe(2);
    issue.CommentBodies.Count.ShouldBe(2);
    issue.PullRequests.ShouldBe([new PullRequestMention(607, 2)]);
  }

  [Fact]
  public void Missing_fields_and_incomplete_issues_are_tolerated()
  {
    const string Json = """
      {"data":{"repository":{"issues":{"nodes":[
        {"number":1,"updatedAt":"2026-11-09T10:00:00Z"},
        {"updatedAt":"2026-11-09T10:00:00Z"},
        {"number":3},
        {"number":4,"updatedAt":"2026-11-09T10:00:00Z","comments":{"nodes":[{"body":null},{}]},"timelineItems":null}
      ]}}}}
      """;

    AgentParser.ParseIssues(Json, Repo).Select(issue => issue.Number).ShouldBe([1, 4]);
  }

  [Theory]
  [InlineData("{}")]
  [InlineData("{\"data\":null}")]
  [InlineData("{\"data\":{\"repository\":{\"issues\":{\"nodes\":5}}}}")]
  public void An_answer_without_issues_gives_nothing(string json) =>
    AgentParser.ParseIssues(json, Repo).ShouldBeEmpty();
}

public sealed class AgentRulesTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static AgentsSection Section() =>
    AgentCollector.Build(
    [
      new IssueInput(5, Noon, 2, ["Tasks started: 2. Subagents started: 1.", "ok"], [new PullRequestMention(50, 3)]),
      new IssueInput(4, Noon.AddHours(-1), 1, ["no counts here"], []),
    ]);

  private static string Json(AgentsSection? section = null) =>
    SnapshotJson.Write(
      new Snapshot(1, new DateOnly(2026, 11, 9), Noon, "mgasca/calendar", CiSnapshot.Build("ci.yml", []), null, section ?? Section()));

  [Fact]
  public void A_snapshot_with_an_agents_section_is_valid_and_stable_and_one_without_it_still_is()
  {
    SnapshotRules.Validate(Json()).ShouldBeEmpty();
    Json().ShouldBe(Json());
    SnapshotRules.Validate(Json(AgentCollector.Build([]))).ShouldBeEmpty();
  }

  [Fact]
  public void An_issue_without_count_comments_is_written_with_null_cost_data() =>
    Json().ShouldContain("\"malformed\": 0,\n        \"tasks\": null,\n        \"subagents\": null");

  [Fact]
  public void Comment_text_never_reaches_the_snapshot()
  {
    var bodies = new[] { "Tasks started: 1. Subagents started: 1. See /home/someone/dev and ask someone@example.com", "session_1a2b3c4d" };
    AgentsSection section = AgentCollector.Build([new IssueInput(8, Noon, 2, bodies, [])]);

    var json = Json(section);

    json.ShouldNotContain("someone");
    json.ShouldNotContain("session_");
    SnapshotRules.Validate(json).ShouldBeEmpty();
  }

  [Theory]
  [InlineData("\"issue\": 5,", "\"issue\": 5,\n        \"author\": \"x\",", "$.agents.issues[0].author: field is not in the schema")]
  [InlineData("\"issue\": 5,", "\"/home/someone\": 1,\n        \"issue\": 5,", "machine path")]
  public void A_private_or_unknown_field_in_the_section_fails(string good, string bad, string expected)
  {
    var json = Json().Replace(good, bad, StringComparison.Ordinal);

    json.ShouldNotBe(Json());
    SnapshotRules.Validate(json).ShouldContain(error => error.Contains(expected, StringComparison.Ordinal));
  }

  [Fact]
  public void A_total_that_is_not_the_sum_of_the_issues_fails()
  {
    var json = Json().Replace("\"comments\": 3,", "\"comments\": 9,", StringComparison.Ordinal);

    json.ShouldNotBe(Json());
    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith("$.agents.activity.comments", StringComparison.Ordinal));
  }

  [Fact]
  public void Tasks_without_a_count_comment_fail()
  {
    var json = Json().Replace("\"tasks\": null", "\"tasks\": 4", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("must be null without a count comment"));
  }

  [Fact]
  public void An_issue_listed_twice_or_without_activity_fails()
  {
    var twice = Json().Replace("\"issue\": 4,", "\"issue\": 5,", StringComparison.Ordinal);
    var empty = Json().Replace("\"comments\": 1,", "\"comments\": 0,", StringComparison.Ordinal);

    SnapshotRules.Validate(twice).ShouldContain(error => error.Contains("must be listed once"));
    SnapshotRules.Validate(empty).ShouldContain(error => error.Contains("no comment and no pull request"));
  }

  [Fact]
  public void More_listed_issues_than_scanned_fail()
  {
    var json = Json().Replace("\"scanned\": 2", "\"scanned\": 1", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("sample.scanned"));
  }

  [Fact]
  public void A_bad_basis_fails()
  {
    var json = Json().Replace("\"counts\": \"inferred\"", "\"counts\": \"exact\"", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith("$.agents.basis.counts", StringComparison.Ordinal));
  }
}
