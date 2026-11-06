#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../HandoverWatch.cs

// Tests for the handover watch. Run: dotnet run tools/handover-watch/tests/handover-watch.tests.cs
// The GitHub CLI is never called: the tests feed the snapshot the JSON that `gh api graphql` returns for Query.First and
// Query.Next, with GitHub's field names and value types (fullDatabaseId as a string, a bot's login without "[bot]").

using System.Globalization;
using Shouldly;
using Xunit;

namespace HandoverWatch.Tests;

/// <summary>An issue with one open, one merged and one closed delivery PR, as the first query returns it.</summary>
internal static class Fixture
{
  public const int Issue = 320;

  // #360 is open (its empty lists shown), #361 merged with every kind of item, #362 closed. #370 only mentions the issue in
  // prose, #371 references another issue, #372 is an outsider's PR and #373 comes from another repository; the first
  // cross-reference is from an issue, not a PR. A list left out of a PR is empty.
  public const string First = """
    { "data": { "repository": { "target": {
      "id": "I_320",
      "comments": { "pageInfo": { "hasNextPage": false, "endCursor": "Y2" }, "nodes": [
        { "fullDatabaseId": "6689158337", "author": { "__typename": "User", "login": "mgasca" },
          "createdAt": "2026-11-06T15:56:49Z", "url": "https://github.com/o/r/issues/320#issuecomment-6689158337",
          "body": "Design for #320.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" },
        { "fullDatabaseId": "6689200000", "author": { "__typename": "User", "login": "mgasca" },
          "createdAt": "2026-11-06T16:10:00Z", "url": "https://github.com/o/r/issues/320#issuecomment-6689200000",
          "body": "> Design for #320.\n>\n> 🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nApproved, go ahead." }
      ] },
      "timelineItems": { "pageInfo": { "hasNextPage": false, "endCursor": "VDk" }, "nodes": [
        { "isCrossRepository": false, "source": {} },
        { "isCrossRepository": false, "source": {
          "id": "PR_360", "number": 360, "state": "OPEN", "createdAt": "2026-11-06T10:00:00Z", "closedAt": null, "mergedAt": null,
          "url": "https://github.com/o/r/pull/360", "body": "Adds the tool.\r\n\r\nCloses #320\r\nRefs #318",
          "authorAssociation": "OWNER", "author": { "__typename": "User", "login": "mgasca" },
          "comments": { "pageInfo": { "hasNextPage": false, "endCursor": null }, "nodes": [] },
          "reviews": { "pageInfo": { "hasNextPage": false, "endCursor": null }, "nodes": [] },
          "reviewThreads": { "pageInfo": { "hasNextPage": false, "endCursor": null }, "nodes": [] } } },
        { "isCrossRepository": false, "source": {
          "id": "PR_361", "number": 361, "state": "MERGED", "createdAt": "2026-11-06T10:30:00Z",
          "closedAt": "2026-11-06T16:00:14Z", "mergedAt": "2026-11-06T16:00:14Z",
          "url": "https://github.com/o/r/pull/361", "body": "refs #318, #320",
          "authorAssociation": "OWNER", "author": { "__typename": "User", "login": "mgasca" },
          "comments": { "pageInfo": { "hasNextPage": false, "endCursor": "Y1" }, "nodes": [
            { "fullDatabaseId": "6689300000", "author": { "__typename": "Bot", "login": "calendar-preview" },
              "createdAt": "2026-11-06T16:20:00Z", "url": "https://github.com/o/r/pull/361#issuecomment-6689300000",
              "body": "Preview ready." }
          ] },
          "reviews": { "pageInfo": { "hasNextPage": false, "endCursor": "UjU" }, "nodes": [
            { "fullDatabaseId": "5802140128", "author": { "__typename": "User", "login": "mgasca" }, "state": "COMMENTED",
              "body": "", "submittedAt": "2026-11-06T15:08:07Z",
              "url": "https://github.com/o/r/pull/361#pullrequestreview-5802140128" },
            { "fullDatabaseId": "5802168888", "author": { "__typename": "User", "login": "mgasca" }, "state": "COMMENTED",
              "body": null, "submittedAt": "2026-11-06T15:10:18Z",
              "url": "https://github.com/o/r/pull/361#pullrequestreview-5802168888" },
            { "fullDatabaseId": "5802200000", "author": { "__typename": "User", "login": "mgasca" }, "state": "APPROVED",
              "body": "", "submittedAt": "2026-11-06T15:30:00Z",
              "url": "https://github.com/o/r/pull/361#pullrequestreview-5802200000" },
            { "fullDatabaseId": "5802100000", "author": { "__typename": "User", "login": "mgasca" }, "state": "CHANGES_REQUESTED",
              "body": "Split it.", "submittedAt": "2026-11-06T14:00:00Z",
              "url": "https://github.com/o/r/pull/361#pullrequestreview-5802100000" },
            { "fullDatabaseId": "5802300000", "author": { "__typename": "User", "login": "mgasca" }, "state": "PENDING",
              "body": "draft", "submittedAt": null,
              "url": "https://github.com/o/r/pull/361#pullrequestreview-5802300000" }
          ] },
          "reviewThreads": { "pageInfo": { "hasNextPage": false, "endCursor": "VDI" }, "nodes": [
            { "id": "PRRT_1", "comments": { "pageInfo": { "hasNextPage": false, "endCursor": "QzE" }, "nodes": [
              { "fullDatabaseId": "4493903475", "author": { "__typename": "User", "login": "mgasca" }, "state": "SUBMITTED",
                "createdAt": "2026-11-06T15:08:07Z", "url": "https://github.com/o/r/pull/361#discussion_r4493903475",
                "path": "tools/handover-watch/HandoverWatch.cs", "line": 42, "originalLine": 40, "replyTo": null,
                "body": "Why not a set?" }
            ] } },
            { "id": "PRRT_2", "comments": { "pageInfo": { "hasNextPage": false, "endCursor": "QzI" }, "nodes": [
              { "fullDatabaseId": "4493926579", "author": { "__typename": "User", "login": "mgasca" }, "state": "SUBMITTED",
                "createdAt": "2026-11-06T15:10:18Z", "url": "https://github.com/o/r/pull/361#discussion_r4493926579",
                "path": "A.md", "line": null, "originalLine": null, "replyTo": { "fullDatabaseId": "4493903475" },
                "body": "Because order matters.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" },
              { "fullDatabaseId": "4493990000", "author": { "__typename": "User", "login": "mgasca" }, "state": "PENDING",
                "createdAt": "2026-11-06T15:20:00Z", "url": "https://github.com/o/r/pull/361#discussion_r4493990000",
                "path": "A.md", "line": 3, "originalLine": 3, "replyTo": { "fullDatabaseId": "4493903475" },
                "body": "A draft reply nobody else can see." }
            ] } }
          ] } } },
        { "isCrossRepository": false, "source": {
          "id": "PR_362", "number": 362, "state": "CLOSED", "createdAt": "2026-11-06T10:40:00Z",
          "closedAt": "2026-11-06T11:00:00Z", "mergedAt": null, "url": "https://github.com/o/r/pull/362", "body": "Refs: #320",
          "authorAssociation": "OWNER", "author": { "__typename": "User", "login": "mgasca" } } },
        { "isCrossRepository": false, "source": {
          "id": "PR_370", "number": 370, "state": "OPEN", "createdAt": "2026-11-06T11:00:00Z",
          "url": "https://github.com/o/r/pull/370", "body": "Not changed: issue-handover (#320 owns it).",
          "authorAssociation": "OWNER", "author": { "__typename": "User", "login": "mgasca" } } },
        { "isCrossRepository": false, "source": {
          "id": "PR_371", "number": 371, "state": "OPEN", "createdAt": "2026-11-06T11:00:00Z",
          "url": "https://github.com/o/r/pull/371", "body": "Closes #3200",
          "authorAssociation": "OWNER", "author": { "__typename": "User", "login": "mgasca" } } },
        { "isCrossRepository": false, "source": {
          "id": "PR_372", "number": 372, "state": "OPEN", "createdAt": "2026-11-06T11:00:00Z",
          "url": "https://github.com/o/r/pull/372", "body": "Closes #320",
          "authorAssociation": "NONE", "author": { "__typename": "User", "login": "outsider" } } },
        { "isCrossRepository": true, "source": {
          "id": "PR_373", "number": 373, "state": "OPEN", "createdAt": "2026-11-06T11:00:00Z",
          "url": "https://github.com/other/repo/pull/373", "body": "Closes #320",
          "authorAssociation": "OWNER", "author": { "__typename": "User", "login": "mgasca" } } }
      ] }
    } } } }
    """;

  /// <summary>Everything one run fetches: the comments and reviews, then the PR states.</summary>
  public static List<WatchItem> AllItems()
  {
    Snapshot snapshot = Read(First);
    return [.. snapshot.Items, .. Watch.StateItems(snapshot.PullRequests)];
  }

  public static Snapshot Read(string json, params int[] named)
  {
    var snapshot = new Snapshot(Issue);
    snapshot.ReadFirst(json, named);
    return snapshot;
  }

  /// <summary>A first response holding only the issue's comments.</summary>
  public static string IssueComments(string nodes) =>
    $$"""{ "data": { "repository": { "target": { "id": "I_320", "comments": { "nodes": [ {{nodes}} ] } } } } }""";

  /// <summary>A first response whose only cross-reference is PR #361 (opened by the owner, Closes #320) with these lists.</summary>
  public static string OnePullRequest(string lists) => $$"""
    { "data": { "repository": { "target": { "id": "I_320", "timelineItems": { "nodes": [
      { "isCrossRepository": false, "source": { "id": "PR_361", "number": 361, "state": "OPEN",
        "createdAt": "2026-11-06T10:00:00Z", "url": "https://github.com/o/r/pull/361", "body": "Closes #320",
        "authorAssociation": "OWNER", "author": { "__typename": "User", "login": "mgasca" }, {{lists}} } }
    ] } } } } }
    """;

  /// <summary>A connection of nodes, with or without a next page.</summary>
  public static string Connection(string nodes, string? nextCursor = null) =>
    nextCursor is null
      ? $$"""{ "pageInfo": { "hasNextPage": false, "endCursor": "z" }, "nodes": [ {{nodes}} ] }"""
      : $$"""{ "pageInfo": { "hasNextPage": true, "endCursor": "{{nextCursor}}" }, "nodes": [ {{nodes}} ] }""";

  /// <summary>A conversation comment by the owner.</summary>
  public static string Comment(long id, string at) => $$"""
    { "fullDatabaseId": "{{id}}", "author": { "__typename": "User", "login": "mgasca" }, "createdAt": "{{at}}",
      "url": "u{{id}}", "body": "c{{id}}" }
    """;
}

/// <summary>Stands in for gh: answers the first query with a fixed response and each follow-up page from a lookup.</summary>
/// <param name="first">The response to the first query.</param>
/// <param name="page">The JSON of the owning node for a node ID and cursor, holding the next page of its list.</param>
internal sealed class FakeGitHub(string first, Func<string, string, string> page)
{
  public List<GraphQlRequest> Requests { get; } = [];

  public Task<string> SendAsync(GraphQlRequest request)
  {
    Requests.Add(request);
    if (request.InRepository)
    {
      return Task.FromResult(first);
    }
    var variables = request.Variables.ToDictionary(static pair => pair.Key, static pair => pair.Value);
    IEnumerable<string> aliases = Enumerable.Range(0, variables.Count / 2)
      .Select(index => string.Create(
        CultureInfo.InvariantCulture,
        $"\"p{index}\": {page(variables[$"n{index}"], variables[$"a{index}"])}"));
    return Task.FromResult($$"""{ "data": { {{string.Join(", ", aliases)}} } }""");
  }
}

public sealed class SnapshotTests
{
  [Fact]
  public void ReadFirst_KeepsOpenClosedAndMergedPrsThatReferenceTheIssue()
  {
    IReadOnlyList<PullRequest> pullRequests = Fixture.Read(Fixture.First).PullRequests;

    pullRequests.Select(static pr => (pr.Number, pr.State)).ShouldBe([(360, "open"), (361, "merged"), (362, "closed")]);
    pullRequests[1].ChangedAt.ShouldBe(DateTimeOffset.Parse("2026-11-06T16:00:14Z", CultureInfo.InvariantCulture));
    pullRequests[1].Url.ShouldBe("https://github.com/o/r/pull/361");
    pullRequests[2].ChangedAt.ShouldBe(DateTimeOffset.Parse("2026-11-06T11:00:00Z", CultureInfo.InvariantCulture));
  }

  [Fact]
  public void ReadFirst_LeavesOutAPrBySomeoneWithoutWriteAccess()
  {
    IReadOnlyList<PullRequest> pullRequests = Fixture.Read(Fixture.First).PullRequests;

    pullRequests.ShouldNotContain(static pr => pr.Number == 372, "anyone can open a PR that says Closes #320");
    pullRequests.ShouldAllBe(static pr => pr.Author == "mgasca");
  }

  [Fact]
  public void ReadFirst_LeavesOutAPrFromAnotherRepository() =>
    Fixture.Read(Fixture.First).PullRequests.ShouldNotContain(
      static pr => pr.Number == 373,
      "#320 in another repository's PR is that repository's issue");

  [Fact]
  public void ReadFirst_ListsAPrOnce_WhenItCrossReferencesTheIssueTwice()
  {
    var twice = Fixture.First.Replace(
      "{ \"isCrossRepository\": false, \"source\": {} },",
      """
      { "isCrossRepository": false, "source": { "id": "PR_360", "number": 360, "state": "OPEN",
        "createdAt": "2026-11-06T10:00:00Z", "body": "Refs #320", "authorAssociation": "OWNER" } },
      """,
      StringComparison.Ordinal);

    Fixture.Read(twice).PullRequests.Count(static pr => pr.Number == 360).ShouldBe(1);
  }

  [Fact]
  public void ReadFirst_WatchesANamedPr_WhoeverOpenedIt_AndANamedPrOnTheTimelineOnce()
  {
    const string Json = """
      { "data": { "repository": {
        "target": { "id": "I_320", "timelineItems": { "nodes": [
          { "isCrossRepository": false, "source": { "id": "PR_361", "number": 361, "state": "OPEN", "body": "Closes #320",
            "createdAt": "2026-11-06T10:00:00Z", "authorAssociation": "OWNER",
            "comments": { "nodes": [ { "fullDatabaseId": "1", "createdAt": "2026-11-06T10:00:00Z", "body": "x" } ] } } } ] } },
        "pr361": { "id": "PR_361", "number": 361, "state": "OPEN", "body": "Closes #320", "createdAt": "2026-11-06T10:00:00Z",
          "comments": { "nodes": [ { "fullDatabaseId": "1", "createdAt": "2026-11-06T10:00:00Z", "body": "x" } ] } },
        "pr372": { "id": "PR_372", "number": 372, "state": "OPEN", "body": "", "createdAt": "2026-11-06T11:00:00Z",
          "authorAssociation": "NONE", "author": { "__typename": "User", "login": "outsider" } }
      } } }
      """;

    Snapshot snapshot = Fixture.Read(Json, 361, 372);

    snapshot.PullRequests.Select(static pr => pr.Number).ShouldBe([361, 372]);
    snapshot.Items.ShouldHaveSingleItem().Key.ShouldBe("pr-comment:1");
  }

  [Fact]
  public void ReadFirst_SkipsEmptyReviewWrappersAndPendingReviews_ButKeepsAnEmptyApproval()
  {
    IEnumerable<WatchItem> reviews = Fixture.Read(Fixture.First).Items.Where(static item => item.Kind == Kinds.Review);

    reviews.Select(static review => (review.Id, review.ReviewState)).ShouldBe(
    [
      ("5802200000", "APPROVED"),
      ("5802100000", "CHANGES_REQUESTED"),
    ]);
  }

  [Fact]
  public void ReadFirst_LeavesOutAPendingReviewComment() =>
    Fixture.Read(Fixture.First).Items.ShouldNotContain(static item => item.Id == "4493990000", "a draft only its author sees");

  [Fact]
  public void ReviewComments_CarryTheirLocationAndTheCommentTheyAnswer()
  {
    List<WatchItem> comments = [.. Fixture.Read(Fixture.First).Items.Where(static item => item.Kind == Kinds.ReviewComment)];

    comments[0].Location.ShouldBe("tools/handover-watch/HandoverWatch.cs:42");
    comments[0].ReplyTo.ShouldBeNull();
    comments[1].Location.ShouldBe("A.md", "a comment on a file, not a line, has no line number");
    comments[1].ReplyTo.ShouldBe(4493903475);
  }

  [Fact]
  public void ReviewComment_OnAnOutdatedLine_UsesTheOriginalLine()
  {
    var json = Fixture.OnePullRequest("""
      "reviewThreads": { "nodes": [ { "id": "PRRT_1", "comments": { "nodes": [
        { "fullDatabaseId": "9", "createdAt": "2026-11-06T10:00:00Z", "path": "B.md", "line": null, "originalLine": 7 } ] } } ] }
      """);

    Fixture.Read(json).Items.ShouldHaveSingleItem().Location.ShouldBe("B.md:7");
  }

  [Fact]
  public void Ids_AboveTwoToThe31_AreReadFromTheStringGitHubSends()
  {
    WatchItem reply = Fixture.Read(Fixture.First).Items.Single(static item => item.Id == "4493926579");

    long.Parse(reply.Id, CultureInfo.InvariantCulture).ShouldBeGreaterThan(int.MaxValue);
    reply.ReplyTo.ShouldBe(4493903475);
  }

  [Fact]
  public void BotLogin_GetsTheSuffixTheWebShows_Once()
  {
    var json = Fixture.IssueComments("""
      { "fullDatabaseId": "1", "createdAt": "2026-11-06T10:00:00Z", "author": { "__typename": "Bot", "login": "github-actions" } },
      { "fullDatabaseId": "2", "createdAt": "2026-11-06T10:00:00Z", "author": { "__typename": "Bot", "login": "x[bot]" } },
      { "fullDatabaseId": "3", "createdAt": "2026-11-06T10:00:00Z", "author": { "__typename": "User", "login": "mgasca" } }
      """);

    Fixture.Read(json).Items.Select(static item => (item.Author, item.IsBot)).ShouldBe(
    [
      ("github-actions[bot]", true),
      ("x[bot]", true),
      ("mgasca", false),
    ]);
  }

  [Fact]
  public void Item_WithoutAnAuthor_HasAnEmptyLogin() =>
    Fixture.Read(Fixture.IssueComments("""{ "fullDatabaseId": "1", "createdAt": "2026-11-06T10:00:00Z", "author": null }"""))
      .Items.ShouldHaveSingleItem().Author.ShouldBe(string.Empty, "a deleted account comes back with a null author");

  [Fact]
  public void ReadFirst_ReportsGitHubErrors()
  {
    const string Json = """
      { "errors": [ { "message": "Could not resolve to an issue or pull request with the number of 99999." } ], "data": null }
      """;

    Should.Throw<InvalidOperationException>(() => Fixture.Read(Json)).Message.ShouldContain("number of 99999");
  }

  [Fact]
  public void ReadFirst_Fails_WhenTheIssueIsMissing() =>
    Should.Throw<InvalidOperationException>(() => Fixture.Read("""{ "data": { "repository": { "target": null } } }"""))
      .Message.ShouldBe("#320 was not found");

  [Theory]
  [InlineData("Closes #320", true)]
  [InlineData("fixed #320", true)]
  [InlineData("Resolves: #320", true)]
  [InlineData("REF #320.", true)]
  [InlineData("Refs #318 and #320", true)]
  [InlineData("Refs #318, #319 & #320", true)]
  [InlineData("Not changed: issue-handover (#320 owns it)", false)]
  [InlineData("Closes #3200", false)]
  [InlineData("Closes #32", false)]
  [InlineData("Closes other/repo#320", false)]
  [InlineData("prefixes #320", false)]
  public void References_NeedsAKeywordBeforeTheNumber(string body, bool expected) =>
    References.Names(body, Fixture.Issue).ShouldBe(expected);
}

public sealed class FetchTests
{
  [Fact]
  public async Task RunAsync_SendsOneQuery_WhenNoListHasAnotherPage()
  {
    var gitHub = new FakeGitHub(Fixture.First, static (_, _) => throw new InvalidOperationException("no follow-up expected"));

    Snapshot snapshot = await Fetch.RunAsync(new Options(Fixture.Issue, [], Peek: false), gitHub.SendAsync);

    gitHub.Requests.ShouldHaveSingleItem().InRepository.ShouldBeTrue();
    snapshot.PullRequests.Count.ShouldBe(3);
  }

  [Fact]
  public async Task RunAsync_ReadsTheNextPageOfEveryLongList_InOneFollowUp()
  {
    // Long lists: the issue's comments, its cross-references, #361's comments and one of its review threads.
    var first = $$"""
      { "data": { "repository": { "target": {
        "id": "I_320",
        "comments": {{Fixture.Connection(Fixture.Comment(1, "2026-11-06T10:00:00Z"), nextCursor: "ic1")}},
        "timelineItems": { "pageInfo": { "hasNextPage": true, "endCursor": "t1" }, "nodes": [
          { "isCrossRepository": false, "source": { "id": "PR_361", "number": 361, "state": "OPEN", "body": "Refs #320",
            "createdAt": "2026-11-06T10:00:00Z", "authorAssociation": "OWNER",
            "comments": {{Fixture.Connection(Fixture.Comment(20, "2026-11-06T10:20:00Z"), nextCursor: "pc1")}},
            "reviewThreads": { "nodes": [ { "id": "PRRT_1", "comments": {{Fixture.Connection(
              """{ "fullDatabaseId": "10", "createdAt": "2026-11-06T10:10:00Z", "path": "A.md", "line": 1 }""",
              nextCursor: "tc1")}} } ] } } } ] }
      } } } }
      """;
    var pages = new Dictionary<(string, string), string>
    {
      [("I_320", "ic1")] = $$"""{ "comments": {{Fixture.Connection(Fixture.Comment(2, "2026-11-06T10:02:00Z"))}} }""",
      [("I_320", "t1")] = $$"""
        { "timelineItems": { "nodes": [ { "isCrossRepository": false, "source": { "id": "PR_380", "number": 380,
          "state": "OPEN", "body": "Closes #320", "createdAt": "2026-11-06T12:00:00Z", "authorAssociation": "MEMBER",
          "comments": {{Fixture.Connection(Fixture.Comment(30, "2026-11-06T12:30:00Z"))}} } } ] } }
        """,
      [("PR_361", "pc1")] = $$"""{ "comments": {{Fixture.Connection(Fixture.Comment(21, "2026-11-06T10:21:00Z"))}} }""",
      [("PRRT_1", "tc1")] = $$"""
        { "comments": {{Fixture.Connection(
          """{ "fullDatabaseId": "11", "createdAt": "2026-11-06T10:11:00Z", "path": "A.md", "replyTo": { "fullDatabaseId": "10" } }""")}} }
        """,
    };
    var gitHub = new FakeGitHub(first, (node, cursor) => pages[(node, cursor)]);

    Snapshot snapshot = await Fetch.RunAsync(new Options(Fixture.Issue, [], Peek: false), gitHub.SendAsync);

    gitHub.Requests.Count.ShouldBe(2, "every next page is asked for in one follow-up");
    gitHub.Requests[1].Variables.Where(static pair => pair.Key.StartsWith('a')).Select(static pair => pair.Value)
      .ShouldBe(["ic1", "pc1", "tc1", "t1"], ignoreOrder: true);
    snapshot.PullRequests.Select(static pr => pr.Number).ShouldBe([361, 380]);
    snapshot.Items.Select(static item => item.Key).ShouldBe(
    [
      "issue-comment:1", "issue-comment:2", "pr-comment:20", "pr-comment:21", "pr-comment:30",
      "review-comment:10", "review-comment:11",
    ],
    ignoreOrder: true);
    snapshot.Items.Single(static item => item.Id == "30").Number.ShouldBe(380);
    snapshot.Items.Single(static item => item.Id == "11").Number.ShouldBe(361);
  }

  [Fact]
  public async Task RunAsync_Fails_WhenAListNeverEnds()
  {
    var first = $$"""
      { "data": { "repository": { "target": { "id": "I_320",
        "comments": {{Fixture.Connection(Fixture.Comment(1, "2026-11-06T10:00:00Z"), nextCursor: "c")}} } } } }
      """;
    var gitHub = new FakeGitHub(first, static (_, cursor) => $$"""{ "comments": {{Fixture.Connection("", nextCursor: cursor + "c")}} }""");

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(
      () => Fetch.RunAsync(new Options(Fixture.Issue, [], Peek: false), gitHub.SendAsync));

    error.Message.ShouldContain("more than 20 follow-up pages");
    gitHub.Requests.Count.ShouldBe(1 + Fetch.MaxFollowUps);
  }
}

public sealed class QueryTests
{
  [Fact]
  public void First_AsksForTheIssueAndEachNamedPr_InOneQuery()
  {
    GraphQlRequest request = Query.First(320, [361, 372]);

    request.InRepository.ShouldBeTrue();
    request.Variables.ShouldBeEmpty();
    request.Text.ShouldContain("target: issueOrPullRequest(number: 320)");
    request.Text.ShouldContain("pr361: pullRequest(number: 361)");
    request.Text.ShouldContain("pr372: pullRequest(number: 372)");
    request.Text.ShouldContain("timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT])");
    request.Text.ShouldContain("reviewThreads(first: 50)");
    request.Text.ShouldNotContain("databaseId ", Case.Sensitive, "IDs above 2^31 need fullDatabaseId");
    ShouldBeBalanced(request.Text);
  }

  [Fact]
  public void Next_DeclaresANodeAndCursorVariablePerPage()
  {
    GraphQlRequest request = Query.Next(
    [
      new PendingPage(ListKind.Reviews, "PR_361", "r1", 361),
      new PendingPage(ListKind.ThreadComments, "PRRT_1", "c1", 361),
    ]);

    request.InRepository.ShouldBeFalse();
    request.Text.ShouldStartWith("query($n0: ID!, $a0: String!, $n1: ID!, $a1: String!) {");
    request.Text.ShouldContain("p0: node(id: $n0) { ... on PullRequest { reviews(first: 100, after: $a0)");
    request.Text.ShouldContain("p1: node(id: $n1) { ... on PullRequestReviewThread { comments(first: 50, after: $a1)");
    request.Variables.ShouldBe([new("n0", "PR_361"), new("a0", "r1"), new("n1", "PRRT_1"), new("a1", "c1")]);
    ShouldBeBalanced(request.Text);
  }

  [Fact]
  public void Arguments_LetGhFillInTheRepository_AndSendOtherVariablesRaw()
  {
    Gh.Arguments(Query.First(320, [])).Take(6).ShouldBe(["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}"]);
    Gh.Arguments(Query.First(320, []))[^1].ShouldStartWith("query=query($owner: String!, $name: String!)");

    IReadOnlyList<string> next = Gh.Arguments(Query.Next([new PendingPage(ListKind.PrComments, "PR_1", "true", 1)]));
    next.ShouldNotContain("-F", "a cursor or ID must not be read as a typed value");
    next.Take(6).ShouldBe(["api", "graphql", "-f", "n0=PR_1", "-f", "a0=true"]);
  }

  private static void ShouldBeBalanced(string text)
  {
    text.Count(static c => c == '{').ShouldBe(text.Count(static c => c == '}'));
    text.Count(static c => c == '(').ShouldBe(text.Count(static c => c == ')'));
  }
}

public sealed class WatchTests
{
  [Fact]
  public void FirstRun_ListsEveryCommentReviewAndPrStateOnce_InTimeOrder()
  {
    IReadOnlyList<WatchItem> fresh = Watch.NewItems(Fixture.AllItems(), SeenRecord.Parse(string.Empty));

    fresh.Select(static item => item.Key).ShouldBe(
    [
      "pr-state:360:open",
      "pr-state:362:closed",
      "review:5802100000",
      "review-comment:4493903475",
      "review-comment:4493926579",
      "review:5802200000",
      "issue-comment:6689158337",
      "pr-state:361:merged",
      "issue-comment:6689200000",
      "pr-comment:6689300000",
    ]);
  }

  [Fact]
  public void SecondRun_WithWhatTheFirstRecorded_ListsNothing()
  {
    IReadOnlyList<WatchItem> first = Watch.NewItems(Fixture.AllItems(), SeenRecord.Parse(string.Empty));

    IReadOnlyList<WatchItem> second = Watch.NewItems(Fixture.AllItems(), SeenRecord.Parse(SeenRecord.Lines(first)));

    second.ShouldBeEmpty();
    Report.Render(Fixture.Issue, Fixture.Read(Fixture.First).PullRequests, second)
      .ShouldBe("#320 · PRs #360 open, #361 merged, #362 closed · nothing new\n");
  }

  [Fact]
  public void MergedPr_IsStillWatched_AndANewReplyOnItIsListed()
  {
    HashSet<string> seen = SeenRecord.Parse(SeenRecord.Lines(Watch.NewItems(Fixture.AllItems(), SeenRecord.Parse(string.Empty))));
    var withReply = Fixture.First.Replace(
      "\"body\": \"Why not a set?\" }",
      """
      "body": "Why not a set?" },
      { "fullDatabaseId": "4494000000", "author": { "__typename": "User", "login": "mgasca" }, "state": "SUBMITTED",
        "createdAt": "2026-11-06T18:00:00Z", "url": "https://github.com/o/r/pull/361#discussion_r4494000000",
        "path": "SKILL.md", "line": 7, "replyTo": { "fullDatabaseId": "4493926579" }, "body": "Fair, keep it." }
      """,
      StringComparison.Ordinal);
    Snapshot snapshot = Fixture.Read(withReply);

    IReadOnlyList<WatchItem> fresh = Watch.NewItems([.. snapshot.Items, .. Watch.StateItems(snapshot.PullRequests)], seen);

    WatchItem item = fresh.ShouldHaveSingleItem();
    item.Key.ShouldBe("review-comment:4494000000");
    item.Number.ShouldBe(361);
    item.ReplyTo.ShouldBe(4493926579);
  }

  [Fact]
  public void PrState_IsNewAgain_WhenThePrChangesState()
  {
    PullRequest open = new(360, "open", DateTimeOffset.Parse("2026-11-06T10:00:00Z", CultureInfo.InvariantCulture), "u");
    HashSet<string> seen = SeenRecord.Parse(SeenRecord.Lines(Watch.StateItems([open])));

    IReadOnlyList<WatchItem> fresh = Watch.NewItems(Watch.StateItems([open with { State = "merged" }]), seen);

    fresh.ShouldHaveSingleItem().Key.ShouldBe("pr-state:360:merged");
  }

  [Fact]
  public void NewItems_ListsAnItemFetchedTwiceOnce()
  {
    IReadOnlyList<WatchItem> once = Fixture.Read(Fixture.IssueComments(Fixture.Comment(1, "2026-11-06T10:00:00Z"))).Items;
    List<WatchItem> twice = [.. once, .. once];

    Watch.NewItems(twice, SeenRecord.Parse(string.Empty)).ShouldHaveSingleItem();
  }

  [Fact]
  public void SeenRecord_IgnoresBlankLinesAndSurroundingWhitespace()
  {
    HashSet<string> seen = SeenRecord.Parse("review:1\n\n  issue-comment:2 \r\n");

    seen.ShouldBe(["review:1", "issue-comment:2"], ignoreOrder: true);
  }

  [Fact]
  public void SeenRecord_LivesUnderPlanPerIssue() =>
    SeenRecord.PathFor("/repo", 320).ShouldBe(Path.Combine("/repo", ".plan", "handover-watch", "320.seen"));
}

public sealed class FooterTests
{
  [Theory]
  [InlineData("Done.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)", true)]
  [InlineData("Done.\r\n\r\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\r\n\r\n", true)]
  [InlineData("> Question?\n>\n> 🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nYes, go ahead.", false)]
  [InlineData("Yes, go ahead.\n\n> Question?\n>\n> 🤖 Generated with [Claude Code](https://claude.com/claude-code)", false)]
  [InlineData("🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nAnd a human line after it.", false)]
  [InlineData("", false)]
  public void AgentFooter_CountsOnlyAsTheLastUnquotedLine(string body, bool expected) =>
    Footer.EndsWithAgentFooter(body).ShouldBe(expected);

  [Fact]
  public void QuotedFooterInAHumanReply_IsNotAnAgentPost()
  {
    IEnumerable<WatchItem> comments = Fixture.Read(Fixture.First).Items.Where(static item => item.Kind == Kinds.IssueComment);

    comments.Select(static comment => comment.HasAgentFooter).ShouldBe([true, false]);
  }
}

public sealed class ReportTests
{
  // One record per item: header, link, body indented by two spaces. Line endings are LF whatever the checkout uses.
  private const string Rendered = """
    #320 · PRs #361 merged · 4 new
    === review-comment:4493903475 · PR #361 · mgasca · agent-footer: no · 2026-11-06T15:08:07Z · tools/handover-watch/HandoverWatch.cs:42
    https://github.com/o/r/pull/361#discussion_r4493903475
      Why not a set?
    === review-comment:4493926579 · PR #361 · mgasca · agent-footer: yes · 2026-11-06T15:10:18Z · A.md · reply-to review-comment:4493903475
    https://github.com/o/r/pull/361#discussion_r4493926579
      Because order matters.

      🤖 Generated with [Claude Code](https://claude.com/claude-code)
    === review:5802200000 · PR #361 · mgasca · agent-footer: no · APPROVED · 2026-11-06T15:30:00Z
    https://github.com/o/r/pull/361#pullrequestreview-5802200000
    === pr-comment:6689300000 · PR #361 · calendar-preview[bot] (bot) · agent-footer: no · 2026-11-06T16:20:00Z
    https://github.com/o/r/pull/361#issuecomment-6689300000
      Preview ready.

    """;

  [Fact]
  public void Render_PrintsAHeaderLinkAndIndentedBodyPerItem()
  {
    IReadOnlyList<WatchItem> all = Fixture.Read(Fixture.First).Items;
    List<WatchItem> items =
    [
      .. all.Where(static item => item.Kind is Kinds.ReviewComment or Kinds.PrComment),
      all.First(static item => item.Kind == Kinds.Review),
    ];
    IReadOnlyList<WatchItem> fresh = Watch.NewItems(items, SeenRecord.Parse(string.Empty));
    PullRequest merged = new(361, "merged", DateTimeOffset.Parse("2026-11-06T16:00:14Z", CultureInfo.InvariantCulture), "u");

    var text = Report.Render(Fixture.Issue, [merged], fresh);

    text.ShouldBe(Rendered.Replace("\r\n", "\n", StringComparison.Ordinal));
  }

  [Fact]
  public void Render_PrState_HasNoAuthorOrBody()
  {
    IReadOnlyList<WatchItem> states = Watch.StateItems(Fixture.Read(Fixture.First).PullRequests);

    Report.Header(states[1]).ShouldBe("=== pr-state:361:merged · PR #361 · mgasca · 2026-11-06T16:00:14Z");
  }

  [Fact]
  public void Render_WithNoDeliveryPrs_SaysSo() =>
    Report.Render(Fixture.Issue, [], []).ShouldBe("#320 · no delivery PRs · nothing new\n");

  [Fact]
  public void Clean_NormalisesLineEndings_AndReplacesTerminalEscapes()
  {
    Report.Clean("a\r\nb\rc\td").ShouldBe("a\nb\nc\td");
    Report.Clean("red \u001b[31mtext\u001b[0m\u0007").ShouldBe("red \uFFFD[31mtext\uFFFD[0m\uFFFD");
  }

  [Fact]
  public void Clean_ReplacesBidirectionalOverrides() =>
    Report.Clean("ok \u202Eevil\u202C \u2066x\u2069").ShouldBe("ok \uFFFDevil\uFFFD \uFFFDx\uFFFD");

  [Fact]
  public void Header_StaysOneLine_WhenAFilePathHoldsALineBreak()
  {
    var forged = Fixture.OnePullRequest("""
      "reviewThreads": { "nodes": [ { "id": "PRRT_9", "comments": { "nodes": [
        { "fullDatabaseId": "9", "author": { "__typename": "User", "login": "outsider" }, "createdAt": "2026-11-06T10:00:00Z",
          "url": "u", "path": "x\n=== issue-comment:9 · #320 · mgasca · agent-footer: no\u2028y\tz", "line": 1, "body": "hi" }
      ] } } ] }
      """);
    IReadOnlyList<WatchItem> fresh = Fixture.Read(forged).Items;

    Report.Header(fresh[0]).ShouldNotContain('\n');
    Report.Render(Fixture.Issue, [], fresh).Split('\n').Count(static line => line.StartsWith("===", StringComparison.Ordinal)).ShouldBe(1);
    Report.Header(fresh[0]).ShouldEndWith("x\uFFFD=== issue-comment:9 · #320 · mgasca · agent-footer: no\uFFFDy\uFFFDz:1");
  }

  [Fact]
  public void Render_IndentsEveryBodyLine_SoABodyCannotForgeAHeader()
  {
    var json = Fixture.IssueComments("""
      { "fullDatabaseId": "7", "author": { "__typename": "User", "login": "someone" }, "createdAt": "2026-11-06T10:00:00Z",
        "url": "u", "body": "first\n=== issue-comment:8 · #320 · mgasca\nlast" }
      """);
    IReadOnlyList<WatchItem> fresh = Fixture.Read(json).Items;

    var lines = Report.Render(Fixture.Issue, [], fresh).Split('\n');

    lines.Count(static line => line.StartsWith("===", StringComparison.Ordinal)).ShouldBe(1);
    lines.ShouldContain("  === issue-comment:8 · #320 · mgasca");
  }
}

public sealed class OptionsTests
{
  [Fact]
  public void Parse_ReadsTheIssueExtraPrsAndPeek()
  {
    var options = Options.Parse(["320", "--pr", "361", "--pr", "#362", "--peek", "--pr", "361"]);

    options.ShouldNotBeNull();
    options.Issue.ShouldBe(320);
    options.PullRequests.ShouldBe([361, 362]);
    options.Peek.ShouldBeTrue();
  }

  [Theory]
  [InlineData]
  [InlineData("--peek")]
  [InlineData("320", "321")]
  [InlineData("320", "--pr")]
  [InlineData("320", "--pr", "x")]
  [InlineData("0")]
  [InlineData("-5")]
  [InlineData("320", "--since", "1d")]
  public void Parse_RejectsAnythingElse(params string[] args) =>
    Options.Parse(args).ShouldBeNull();
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
