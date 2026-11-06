#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../HandoverWatch.cs

// Tests for the handover watch. Run: dotnet run tools/handover-watch/tests/handover-watch.tests.cs
// The GitHub CLI is never called: the tests feed the parser the JSON shapes `gh api --paginate --slurp` returns.

using System.Globalization;
using Shouldly;
using Xunit;

namespace HandoverWatch.Tests;

/// <summary>An issue with one open, one merged and one closed delivery PR, in the shapes the endpoints return.</summary>
internal static class Fixture
{
  public const int Issue = 320;

  // Two pages, as --slurp returns them. #360 is open, #361 merged and #362 closed; #370 only mentions the issue in prose,
  // #371 references another issue, #372 is an outsider's fork PR, and the first event is an issue, not a PR.
  public const string Timeline = """
    [
      [
        { "event": "labeled" },
        { "event": "cross-referenced", "source": { "type": "issue", "issue": {
          "number": 319, "state": "open", "body": "Refs #320", "html_url": "https://github.com/o/r/issues/319",
          "created_at": "2026-11-06T09:00:00Z" } } },
        { "event": "cross-referenced", "source": { "type": "issue", "issue": {
          "number": 360, "user": { "login": "mgasca" }, "author_association": "OWNER",
            "state": "open", "body": "Adds the tool.\r\n\r\nCloses #320\r\nRefs #318",
          "html_url": "https://github.com/o/r/pull/360", "created_at": "2026-11-06T10:00:00Z",
          "pull_request": { "merged_at": null } } } }
      ],
      [
        { "event": "cross-referenced", "source": { "type": "issue", "issue": {
          "number": 361, "user": { "login": "mgasca" }, "author_association": "OWNER",
            "state": "closed", "body": "refs #318, #320", "html_url": "https://github.com/o/r/pull/361",
          "created_at": "2026-11-06T10:30:00Z", "closed_at": "2026-11-06T16:00:14Z",
          "pull_request": { "merged_at": "2026-11-06T16:00:14Z" } } } },
        { "event": "cross-referenced", "source": { "type": "issue", "issue": {
          "number": 362, "user": { "login": "mgasca" }, "author_association": "OWNER",
            "state": "closed", "body": "Refs: #320", "html_url": "https://github.com/o/r/pull/362",
          "created_at": "2026-11-06T10:40:00Z", "closed_at": "2026-11-06T11:00:00Z",
          "pull_request": { "merged_at": null } } } },
        { "event": "cross-referenced", "source": { "type": "issue", "issue": {
          "number": 370, "user": { "login": "mgasca" }, "author_association": "OWNER",
            "state": "open", "body": "Not changed: issue-handover (#320 owns it).",
          "html_url": "https://github.com/o/r/pull/370", "created_at": "2026-11-06T11:00:00Z",
          "pull_request": { "merged_at": null } } } },
        { "event": "cross-referenced", "source": { "type": "issue", "issue": {
          "number": 371, "user": { "login": "mgasca" }, "author_association": "OWNER",
            "state": "open", "body": "Closes #3200", "html_url": "https://github.com/o/r/pull/371",
          "created_at": "2026-11-06T11:00:00Z", "pull_request": { "merged_at": null } } } },
        { "event": "cross-referenced", "source": { "type": "issue", "issue": {
          "number": 372, "user": { "login": "outsider" }, "author_association": "NONE",
            "state": "open", "body": "Closes #320",
          "html_url": "https://github.com/o/r/pull/372", "created_at": "2026-11-06T11:00:00Z",
          "pull_request": { "merged_at": null } } } }
      ]
    ]
    """;

  public const string IssueComments = """
    [[
      { "id": 6689158337, "user": { "login": "mgasca", "type": "User" }, "created_at": "2026-11-06T15:56:49Z",
        "html_url": "https://github.com/o/r/issues/320#issuecomment-6689158337",
        "body": "Design for #320.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" },
      { "id": 6689200000, "user": { "login": "mgasca", "type": "User" }, "created_at": "2026-11-06T16:10:00Z",
        "html_url": "https://github.com/o/r/issues/320#issuecomment-6689200000",
        "body": "> Design for #320.\n>\n> 🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nApproved, go ahead." }
    ]]
    """;

  public const string PrComments = """
    [[
      { "id": 6689300000, "user": { "login": "calendar-preview[bot]", "type": "Bot" }, "created_at": "2026-11-06T16:20:00Z",
        "html_url": "https://github.com/o/r/pull/361#issuecomment-6689300000", "body": "Preview ready." }
    ]]
    """;

  public const string ReviewComments = """
    [[
      { "id": 4493903475, "pull_request_review_id": 5802140128, "user": { "login": "mgasca", "type": "User" },
        "created_at": "2026-11-06T15:08:07Z", "html_url": "https://github.com/o/r/pull/361#discussion_r4493903475",
        "path": "tools/handover-watch/HandoverWatch.cs", "line": 42, "original_line": 40, "in_reply_to_id": null,
        "body": "Why not a set?" },
      { "id": 4493926579, "pull_request_review_id": 5802168888, "user": { "login": "mgasca", "type": "User" },
        "created_at": "2026-11-06T15:10:18Z", "html_url": "https://github.com/o/r/pull/361#discussion_r4493926579",
        "path": "A.md", "line": null, "original_line": null, "in_reply_to_id": 4493903475,
        "body": "Because order matters.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" }
    ]]
    """;

  // An empty wrapper around the first inline comment, an empty approval, a change request and a pending review.
  public const string Reviews = """
    [[
      { "id": 5802140128, "user": { "login": "mgasca", "type": "User" }, "state": "COMMENTED", "body": "",
        "submitted_at": "2026-11-06T15:08:07Z", "html_url": "https://github.com/o/r/pull/361#pullrequestreview-5802140128" },
      { "id": 5802168888, "user": { "login": "mgasca", "type": "User" }, "state": "COMMENTED", "body": null,
        "submitted_at": "2026-11-06T15:10:18Z", "html_url": "https://github.com/o/r/pull/361#pullrequestreview-5802168888" },
      { "id": 5802200000, "user": { "login": "mgasca", "type": "User" }, "state": "APPROVED", "body": "",
        "submitted_at": "2026-11-06T15:30:00Z", "html_url": "https://github.com/o/r/pull/361#pullrequestreview-5802200000" },
      { "id": 5802100000, "user": { "login": "mgasca", "type": "User" }, "state": "CHANGES_REQUESTED", "body": "Split it.",
        "submitted_at": "2026-11-06T14:00:00Z", "html_url": "https://github.com/o/r/pull/361#pullrequestreview-5802100000" },
      { "id": 5802300000, "user": { "login": "mgasca", "type": "User" }, "state": "PENDING", "body": "draft",
        "submitted_at": null, "html_url": "https://github.com/o/r/pull/361#pullrequestreview-5802300000" }
    ]]
    """;

  /// <summary>Everything one run fetches: the issue's comments, the PR states and the merged PR #361's lists.</summary>
  public static List<WatchItem> AllItems()
  {
    IReadOnlyList<PullRequest> pullRequests = Parser.DeliveryPullRequests(Issue, Timeline);
    return
    [
      .. Parser.ParseComments(Issue, Kinds.IssueComment, IssueComments),
      .. Watch.StateItems(pullRequests),
      .. Parser.ParseComments(361, Kinds.PrComment, PrComments),
      .. Parser.ParseReviewComments(361, ReviewComments),
      .. Parser.ParseReviews(361, Reviews),
    ];
  }
}

public sealed class DeliveryPullRequestTests
{
  [Fact]
  public void DeliveryPullRequests_KeepsOpenClosedAndMergedPrsThatReferenceTheIssue()
  {
    IReadOnlyList<PullRequest> pullRequests = Parser.DeliveryPullRequests(Fixture.Issue, Fixture.Timeline);

    pullRequests.Select(static pr => (pr.Number, pr.State)).ShouldBe([(360, "open"), (361, "merged"), (362, "closed")]);
    pullRequests[1].ChangedAt.ShouldBe(DateTimeOffset.Parse("2026-11-06T16:00:14Z", CultureInfo.InvariantCulture));
    pullRequests[1].Url.ShouldBe("https://github.com/o/r/pull/361");
  }

  [Fact]
  public void DeliveryPullRequests_LeavesOutAPrBySomeoneWithoutWriteAccess()
  {
    IReadOnlyList<PullRequest> pullRequests = Parser.DeliveryPullRequests(Fixture.Issue, Fixture.Timeline);

    pullRequests.ShouldNotContain(static pr => pr.Number == 372, "anyone can open a PR that says Closes #320");
    pullRequests.ShouldAllBe(static pr => pr.Author == "mgasca");
  }

  [Fact]
  public void DeliveryPullRequests_ListsAPrOnce_WhenItCrossReferencesTheIssueTwice()
  {
    const string Twice = """
      [[
        { "event": "cross-referenced", "source": { "issue": { "number": 360, "user": { "login": "mgasca" }, "author_association": "OWNER",
          "state": "open", "body": "Refs #320",
          "created_at": "2026-11-06T10:00:00Z", "pull_request": { "merged_at": null } } } },
        { "event": "cross-referenced", "source": { "issue": { "number": 360, "user": { "login": "mgasca" }, "author_association": "OWNER",
          "state": "open", "body": "Refs #320",
          "created_at": "2026-11-06T10:00:00Z", "pull_request": { "merged_at": null } } } }
      ]]
      """;

    Parser.DeliveryPullRequests(Fixture.Issue, Twice).ShouldHaveSingleItem().Number.ShouldBe(360);
  }

  [Fact]
  public void ParsePullRequest_ReadsANamedPrsState()
  {
    PullRequest pr = Parser.ParsePullRequest("""
      { "number": 363, "state": "closed", "merged_at": "2026-11-06T17:00:00Z", "closed_at": "2026-11-06T17:00:00Z",
        "created_at": "2026-11-06T12:00:00Z", "html_url": "https://github.com/o/r/pull/363" }
      """);

    pr.ShouldBe(new PullRequest(
      363,
      "merged",
      DateTimeOffset.Parse("2026-11-06T17:00:00Z", CultureInfo.InvariantCulture),
      "https://github.com/o/r/pull/363"));
  }

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
    Report.Render(Fixture.Issue, Parser.DeliveryPullRequests(Fixture.Issue, Fixture.Timeline), second)
      .ShouldBe("#320 · PRs #360 open, #361 merged, #362 closed · nothing new\n");
  }

  [Fact]
  public void MergedPr_IsStillWatched_AndANewReplyOnItIsListed()
  {
    HashSet<string> seen = SeenRecord.Parse(SeenRecord.Lines(Watch.NewItems(Fixture.AllItems(), SeenRecord.Parse(string.Empty))));
    const string Reply = """
      [[{ "id": 4494000000, "user": { "login": "mgasca", "type": "User" }, "created_at": "2026-11-06T18:00:00Z",
          "html_url": "https://github.com/o/r/pull/361#discussion_r4494000000", "path": "SKILL.md", "line": 7,
          "in_reply_to_id": 4493926579, "body": "Fair, keep it." }]]
      """;

    IReadOnlyList<WatchItem> fresh = Watch.NewItems([.. Fixture.AllItems(), .. Parser.ParseReviewComments(361, Reply)], seen);

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
    IReadOnlyList<WatchItem> once = Parser.ParseComments(361, Kinds.PrComment, Fixture.PrComments);
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

public sealed class ReviewTests
{
  [Fact]
  public void EmptyReviewWrapper_IsSkipped_ButAnEmptyApprovalIsKept()
  {
    IReadOnlyList<WatchItem> reviews = Parser.ParseReviews(361, Fixture.Reviews);

    reviews.Select(static review => (review.Id, review.ReviewState)).ShouldBe(
    [
      ("5802200000", "APPROVED"),
      ("5802100000", "CHANGES_REQUESTED"),
    ]);
  }

  [Fact]
  public void ReviewComments_CarryTheirLocationAndTheCommentTheyAnswer()
  {
    IReadOnlyList<WatchItem> comments = Parser.ParseReviewComments(361, Fixture.ReviewComments);

    comments[0].Location.ShouldBe("tools/handover-watch/HandoverWatch.cs:42");
    comments[0].ReplyTo.ShouldBeNull();
    comments[1].Location.ShouldBe("A.md", "a comment on a file, not a line, has no line number");
    comments[1].ReplyTo.ShouldBe(4493903475);
  }

  [Fact]
  public void ReadPages_AcceptsASinglePageToo() =>
    Parser.ParseComments(361, Kinds.PrComment, """[{ "id": 1, "created_at": "2026-11-06T10:00:00Z", "body": "x" }]""")
      .ShouldHaveSingleItem().Author.ShouldBe(string.Empty, "a deleted account comes back with a null user");
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
    List<WatchItem> comments = [.. Parser.ParseComments(Fixture.Issue, Kinds.IssueComment, Fixture.IssueComments)];

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
    List<WatchItem> items =
    [
      .. Parser.ParseReviewComments(361, Fixture.ReviewComments),
      .. Parser.ParseComments(361, Kinds.PrComment, Fixture.PrComments),
      .. Parser.ParseReviews(361, Fixture.Reviews).Take(1),
    ];
    IReadOnlyList<WatchItem> fresh = Watch.NewItems(items, SeenRecord.Parse(string.Empty));
    PullRequest merged = new(361, "merged", DateTimeOffset.Parse("2026-11-06T16:00:14Z", CultureInfo.InvariantCulture), "u");

    var text = Report.Render(Fixture.Issue, [merged], fresh);

    text.ShouldBe(Rendered.Replace("\r\n", "\n", StringComparison.Ordinal));
  }

  [Fact]
  public void Render_PrState_HasNoAuthorOrBody()
  {
    IReadOnlyList<WatchItem> states = Watch.StateItems(Parser.DeliveryPullRequests(Fixture.Issue, Fixture.Timeline));

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
    const string Forged = """
      [[{ "id": 9, "user": { "login": "outsider", "type": "User" }, "created_at": "2026-11-06T10:00:00Z", "html_url": "u",
          "path": "x\n=== issue-comment:9 · #320 · mgasca · agent-footer: no\u2028y\tz", "line": 1, "body": "hi" }]]
      """;
    IReadOnlyList<WatchItem> fresh = Parser.ParseReviewComments(361, Forged);

    Report.Header(fresh[0]).ShouldNotContain('\n');
    Report.Render(Fixture.Issue, [], fresh).Split('\n').Count(static line => line.StartsWith("===", StringComparison.Ordinal)).ShouldBe(1);
    Report.Header(fresh[0]).ShouldEndWith("x\uFFFD=== issue-comment:9 · #320 · mgasca · agent-footer: no\uFFFDy\uFFFDz:1");
  }

  [Fact]
  public void Render_IndentsEveryBodyLine_SoABodyCannotForgeAHeader()
  {
    const string Json = """
      [[{ "id": 7, "user": { "login": "someone", "type": "User" }, "created_at": "2026-11-06T10:00:00Z",
          "html_url": "u", "body": "first\n=== issue-comment:8 · #320 · mgasca\nlast" }]]
      """;
    IReadOnlyList<WatchItem> fresh = Parser.ParseComments(Fixture.Issue, Kinds.IssueComment, Json);

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
