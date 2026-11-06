using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace HandoverWatch;

/// <summary>The kinds of record the watch prints; each is also the prefix of its line in the seen-ID record.</summary>
public static class Kinds
{
  /// <summary>A comment on the watched issue.</summary>
  public const string IssueComment = "issue-comment";

  /// <summary>A conversation comment on a delivery PR.</summary>
  public const string PrComment = "pr-comment";

  /// <summary>An inline review comment on a delivery PR.</summary>
  public const string ReviewComment = "review-comment";

  /// <summary>A submitted review of a delivery PR.</summary>
  public const string Review = "review";

  /// <summary>A delivery PR's state (open, closed or merged), printed when first seen and on each change.</summary>
  public const string PrState = "pr-state";
}

/// <summary>The command line: the issue to watch, extra PRs and whether to record what is printed.</summary>
/// <param name="Issue">The issue number.</param>
/// <param name="PullRequests">PRs to watch besides the ones the issue's timeline yields.</param>
/// <param name="Peek">Print without recording anything as seen.</param>
public sealed record Options(int Issue, IReadOnlyList<int> PullRequests, bool Peek)
{
  /// <summary>The usage line printed on a usage error.</summary>
  public const string Usage = "usage: handover-watch <issue> [--pr N]... [--peek]";

  /// <summary>Parses the arguments: one issue number, any number of <c>--pr N</c>, and <c>--peek</c>.</summary>
  /// <param name="args">The arguments after <c>--</c>.</param>
  /// <returns>The options, or null when the arguments are not valid.</returns>
  public static Options? Parse(IReadOnlyList<string> args)
  {
    int? issue = null;
    List<int> pullRequests = [];
    var peek = false;
    var pending = new Queue<string>(args);
    while (pending.TryDequeue(out var arg))
    {
      switch (arg)
      {
        case "--pr" when pending.TryDequeue(out var value) && TryNumber(value, out var pr):
          pullRequests.Add(pr);
          break;
        case "--peek":
          peek = true;
          break;
        case var value when issue is null && TryNumber(value, out var number):
          issue = number;
          break;
        default:
          return null;
      }
    }
    return issue is null ? null : new Options(issue.Value, [.. pullRequests.Distinct()], peek);
  }

  private static bool TryNumber(string text, out int number) =>
    int.TryParse(text.TrimStart('#'), NumberStyles.None, CultureInfo.InvariantCulture, out number) && number > 0;
}

/// <summary>A delivery pull request and the state the watch reports for it.</summary>
/// <param name="Number">The PR number.</param>
/// <param name="State">open, closed (without merging) or merged.</param>
/// <param name="ChangedAt">When it reached that state: when it was merged, closed or, while open, created.</param>
/// <param name="Url">The PR's web address.</param>
public sealed record PullRequest(int Number, string State, DateTimeOffset ChangedAt, string Url)
{
  /// <summary>Gets the login of the PR's author.</summary>
  public string Author { get; init; } = string.Empty;
}

/// <summary>One comment, review or PR state the watch can print.</summary>
/// <param name="Kind">One of <see cref="Kinds"/>.</param>
/// <param name="Id">The GitHub ID; for a PR state, the PR number and the state (<c>361:merged</c>).</param>
/// <param name="Number">The issue or PR it belongs to.</param>
/// <param name="Author">The author's login (empty for a PR state).</param>
/// <param name="IsBot">Whether GitHub reports the author as a bot.</param>
/// <param name="At">When it was created, submitted or, for a PR state, reached.</param>
/// <param name="Url">Its web address.</param>
/// <param name="Body">The text as GitHub stored it (empty for a PR state).</param>
public sealed record WatchItem(
  string Kind,
  string Id,
  int Number,
  string Author,
  bool IsBot,
  DateTimeOffset At,
  string Url,
  string Body)
{
  /// <summary>Gets the state of a review (APPROVED, CHANGES_REQUESTED, COMMENTED or DISMISSED).</summary>
  public string? ReviewState { get; init; }

  /// <summary>Gets the <c>path:line</c> an inline review comment is attached to.</summary>
  public string? Location { get; init; }

  /// <summary>Gets the ID of the inline review comment this one answers.</summary>
  public long? ReplyTo { get; init; }

  /// <summary>Gets the item's line in the seen-ID record, <c>kind:id</c>.</summary>
  public string Key => $"{Kind}:{Id}";

  /// <summary>Gets a value indicating whether the body ends with an agent footer (see <see cref="Footer"/>).</summary>
  public bool HasAgentFooter => Footer.EndsWithAgentFooter(Body);
}

/// <summary>A GraphQL document and its string variables, as one <c>gh api graphql</c> call sends them.</summary>
/// <param name="Text">The query.</param>
/// <param name="Variables">String variables, sent raw with <c>-f</c>.</param>
/// <param name="InRepository">Whether the query takes <c>$owner</c> and <c>$name</c>, which gh fills in from the checkout.</param>
public sealed record GraphQlRequest(string Text, IReadOnlyList<KeyValuePair<string, string>> Variables, bool InRepository);

/// <summary>The lists a tick reads, each of which can run past one page.</summary>
public enum ListKind
{
  /// <summary>The watched issue's comments.</summary>
  IssueComments,

  /// <summary>The issue's cross-references, which yield the delivery PRs.</summary>
  CrossReferences,

  /// <summary>A delivery PR's conversation comments.</summary>
  PrComments,

  /// <summary>A delivery PR's reviews.</summary>
  Reviews,

  /// <summary>A delivery PR's review threads.</summary>
  ReviewThreads,

  /// <summary>The inline comments of one review thread.</summary>
  ThreadComments,
}

/// <summary>A list that has more pages: the node that owns it, the cursor after the last item read and the issue or PR.</summary>
/// <param name="Kind">Which list.</param>
/// <param name="NodeId">The GraphQL ID of the issue, PR or review thread that owns the list.</param>
/// <param name="Cursor">The <c>endCursor</c> of the last page read.</param>
/// <param name="Number">The issue or PR the list's items belong to.</param>
public sealed record PendingPage(ListKind Kind, string NodeId, string Cursor, int Number);

/// <summary>
/// The GraphQL documents of a tick. The first query asks for the issue's comments, its cross-references with only the fields
/// that decide whether a PR is a delivery PR, and any PR named with <c>--pr</c> in full. Each later query asks, in one call,
/// for the delivery PRs found so far in full and for the next page of every list longer than a page. A PR that is not a
/// delivery PR therefore costs only its number, state and body, however many comments it has.
/// </summary>
public static class Query
{
  /// <summary>Items per page of the issue's comments and cross-references, and of each PR's comments and reviews.</summary>
  public const int PageSize = 100;

  /// <summary>Review threads per page of a PR. Small because each holds a list: no PR in the repository has more than 3.</summary>
  public const int ThreadPageSize = 10;

  /// <summary>
  /// Comments per page of a review thread. With these sizes a PR asks for at most about 710 nodes, so even a hundred aliased PRs
  /// stay under GitHub's limit of 500,000, and the documented cost formula gives about 3 points per PR.
  /// </summary>
  public const int ThreadCommentPageSize = 50;

  private const string PageInfo = "pageInfo { hasNextPage endCursor }";
  private const string Author = "author { __typename login }";
  private const string CommentFields = $"fullDatabaseId createdAt url body {Author}";
  private const string ReviewFields = $"fullDatabaseId state submittedAt url body {Author}";
  private const string ThreadCommentFields =
    $"fullDatabaseId state createdAt url body path line originalLine replyTo {{ fullDatabaseId }} {Author}";

  /// <summary>What a cross-reference brings of its PR: what <see cref="Snapshot.IsDeliveryPullRequest"/> and the state need.</summary>
  private const string PullRequestHeader = $"id number state createdAt closedAt mergedAt url body authorAssociation {Author}";

  private const string Repository = "repository(owner: $owner, name: $name)";

  /// <summary>The first query of a tick.</summary>
  /// <param name="issue">The watched issue (or PR).</param>
  /// <param name="pullRequests">The PRs named with <c>--pr</c>, each fetched in full as an alias <c>prN</c>.</param>
  /// <returns>The request.</returns>
  public static GraphQlRequest First(int issue, IReadOnlyList<int> pullRequests)
  {
    var issueFields = $"id {Comments(FirstPage(PageSize))} {CrossReferences(FirstPage(PageSize))}";
    var text = new StringBuilder($"query($owner: String!, $name: String!) {{ {Repository} {{ ");
    text.Append(CultureInfo.InvariantCulture, $"target: issueOrPullRequest(number: {issue}) {{ ");
    text.Append(CultureInfo.InvariantCulture, $"... on Issue {{ {issueFields} }} ... on PullRequest {{ {issueFields} }} }} ");
    AppendPullRequests(text, pullRequests, $"{PullRequestHeader} {PullRequestLists}");
    return new GraphQlRequest(text.Append("} }").ToString(), [], InRepository: true);
  }

  /// <summary>
  /// One follow-up query: the next page of every list that has one, as aliases <c>p0</c>, <c>p1</c>, …, and the delivery PRs
  /// found but not yet read, in full, as aliases <c>prN</c> under <c>repository</c>.
  /// </summary>
  /// <param name="pages">The lists to continue.</param>
  /// <param name="pullRequests">The delivery PRs to read in full.</param>
  /// <returns>The request, with the node IDs and cursors as variables.</returns>
  public static GraphQlRequest Next(IReadOnlyList<PendingPage> pages, IReadOnlyList<int> pullRequests)
  {
    List<string> declarations = [];
    if (pullRequests.Count > 0)
    {
      declarations.Add("$owner: String!, $name: String!");
    }
    declarations.AddRange(
      pages.Select(static (_, index) => string.Create(CultureInfo.InvariantCulture, $"$n{index}: ID!, $a{index}: String!")));
    var text = new StringBuilder($"query({string.Join(", ", declarations)}) {{ ");
    List<KeyValuePair<string, string>> variables = [];
    for (var index = 0; index < pages.Count; index++)
    {
      PendingPage page = pages[index];
      var arguments = string.Create(CultureInfo.InvariantCulture, $"first: {SizeOf(page.Kind)}, after: $a{index}");
      text.Append(CultureInfo.InvariantCulture, $"{NextAlias(index)}: node(id: $n{index}) {{ {Selection(page.Kind, arguments)} }} ");
      variables.Add(new(string.Create(CultureInfo.InvariantCulture, $"n{index}"), page.NodeId));
      variables.Add(new(string.Create(CultureInfo.InvariantCulture, $"a{index}"), page.Cursor));
    }
    if (pullRequests.Count > 0)
    {
      text.Append(CultureInfo.InvariantCulture, $"{Repository} {{ ");
      AppendPullRequests(text, pullRequests, PullRequestLists);
      text.Append("} ");
    }
    return new GraphQlRequest(text.Append('}').ToString(), variables, InRepository: pullRequests.Count > 0);
  }

  /// <summary>The alias of a PR read in full.</summary>
  /// <param name="number">The PR number.</param>
  /// <returns>For example <c>pr361</c>.</returns>
  public static string PullRequestAlias(int number) => string.Create(CultureInfo.InvariantCulture, $"pr{number}");

  /// <summary>The alias of a follow-up page.</summary>
  /// <param name="index">The page's position in <see cref="Next"/>.</param>
  /// <returns>For example <c>p0</c>.</returns>
  public static string NextAlias(int index) => string.Create(CultureInfo.InvariantCulture, $"p{index}");

  /// <summary>The field of the owning node that holds a list.</summary>
  /// <param name="kind">The list.</param>
  /// <returns>The GraphQL field name.</returns>
  public static string FieldOf(ListKind kind) => kind switch
  {
    ListKind.CrossReferences => "timelineItems",
    ListKind.Reviews => "reviews",
    ListKind.ReviewThreads => "reviewThreads",
    _ => "comments",
  };

  // A delivery PR found on the timeline already brought its header, so the follow-up asks only for its lists.
  private static string PullRequestLists =>
    $"id number {Comments(FirstPage(PageSize))} {Reviews(FirstPage(PageSize))} {ReviewThreads(FirstPage(ThreadPageSize))}";

  private static void AppendPullRequests(StringBuilder text, IReadOnlyList<int> pullRequests, string fields)
  {
    foreach (var number in pullRequests)
    {
      text.Append(CultureInfo.InvariantCulture, $"{PullRequestAlias(number)}: pullRequest(number: {number}) {{ {fields} }} ");
    }
  }

  private static int SizeOf(ListKind kind) => kind switch
  {
    ListKind.ReviewThreads => ThreadPageSize,
    ListKind.ThreadComments => ThreadCommentPageSize,
    _ => PageSize,
  };

  private static string FirstPage(int size) => string.Create(CultureInfo.InvariantCulture, $"first: {size}");

  private static string Selection(ListKind kind, string arguments) => kind switch
  {
    ListKind.IssueComments or ListKind.PrComments =>
      $"... on Issue {{ {Comments(arguments)} }} ... on PullRequest {{ {Comments(arguments)} }}",
    ListKind.CrossReferences =>
      $"... on Issue {{ {CrossReferences(arguments)} }} ... on PullRequest {{ {CrossReferences(arguments)} }}",
    ListKind.Reviews => $"... on PullRequest {{ {Reviews(arguments)} }}",
    ListKind.ReviewThreads => $"... on PullRequest {{ {ReviewThreads(arguments)} }}",
    _ => $"... on PullRequestReviewThread {{ {ThreadComments(arguments)} }}",
  };

  private static string Comments(string arguments) => $"comments({arguments}) {{ {PageInfo} nodes {{ {CommentFields} }} }}";

  private static string Reviews(string arguments) => $"reviews({arguments}) {{ {PageInfo} nodes {{ {ReviewFields} }} }}";

  private static string ReviewThreads(string arguments) =>
    $"reviewThreads({arguments}) {{ {PageInfo} nodes {{ id {ThreadComments(FirstPage(ThreadCommentPageSize))} }} }}";

  private static string ThreadComments(string arguments) =>
    $"comments({arguments}) {{ {PageInfo} nodes {{ {ThreadCommentFields} }} }}";

  private static string CrossReferences(string arguments) =>
    $"timelineItems({arguments}, itemTypes: [CROSS_REFERENCED_EVENT]) {{ {PageInfo} nodes {{ ... on CrossReferencedEvent {{ "
    + $"isCrossRepository source {{ ... on PullRequest {{ {PullRequestHeader} }} }} }} }} }}";
}

/// <summary>Runs the queries of one tick: the first, then follow-ups until every delivery PR and every list is read.</summary>
public static class Fetch
{
  /// <summary>
  /// Follow-up rounds before the tick stops following what is left. What was read is still reported, and
  /// <see cref="Snapshot.Unfinished"/> names the lists that were cut short, so a flood of items cannot silence the watch.
  /// </summary>
  public const int MaxFollowUps = 20;

  /// <summary>Fetches everything the watch reports on.</summary>
  /// <param name="options">The issue and the PRs named with <c>--pr</c>.</param>
  /// <param name="send">Sends one request and returns the response JSON (gh in the tool, canned responses in the tests).</param>
  /// <returns>The delivery PRs and their items, with every page read or named in <see cref="Snapshot.Unfinished"/>.</returns>
  /// <exception cref="InvalidOperationException">GitHub reported an error, or the issue or a PR does not exist.</exception>
  public static async Task<Snapshot> RunAsync(Options options, Func<GraphQlRequest, Task<string>> send)
  {
    var snapshot = new Snapshot(options.Issue);
    snapshot.ReadFirst(await send(Query.First(options.Issue, options.PullRequests)), options.PullRequests);
    var rounds = 0;
    while (snapshot.HasPending)
    {
      if (++rounds > MaxFollowUps)
      {
        snapshot.StopFollowing();
        break;
      }
      IReadOnlyList<PendingPage> pages = snapshot.TakePending();
      IReadOnlyList<int> pullRequests = snapshot.TakeUnread();
      snapshot.ReadNext(pages, pullRequests, await send(Query.Next(pages, pullRequests)));
    }
    return snapshot;
  }
}

/// <summary>What a tick has read so far: the delivery PRs, their items and what is still to read.</summary>
/// <param name="issue">The watched issue.</param>
public sealed class Snapshot(int issue)
{
  /// <summary>Author associations whose PRs count as delivery PRs without --pr.</summary>
  private static readonly HashSet<string> TrustedAuthors = new(["OWNER", "MEMBER", "COLLABORATOR"], StringComparer.Ordinal);

  private readonly Dictionary<int, PullRequest> _pullRequests = [];
  private readonly HashSet<int> _read = [];
  private readonly List<int> _unread = [];
  private readonly List<WatchItem> _items = [];
  private readonly List<PendingPage> _pending = [];
  private readonly List<string> _unfinished = [];

  /// <summary>Gets the delivery PRs, by number.</summary>
  public IReadOnlyList<PullRequest> PullRequests => [.. _pullRequests.Values.OrderBy(static pr => pr.Number)];

  /// <summary>Gets the comments and reviews read so far, in reading order; an item can appear twice.</summary>
  public IReadOnlyList<WatchItem> Items => _items;

  /// <summary>Gets the lists the tick stopped following before their end, empty when everything was read.</summary>
  public IReadOnlyList<string> Unfinished => _unfinished;

  /// <summary>Gets a value indicating whether a list has a page not read yet, or a delivery PR has not been read in full.</summary>
  public bool HasPending => _pending.Count > 0 || _unread.Count > 0;

  /// <summary>Hands over the lists that have another page, once each, and forgets them.</summary>
  /// <returns>The pages to request next.</returns>
  public IReadOnlyList<PendingPage> TakePending()
  {
    List<PendingPage> pages = [.. _pending.Distinct()];
    _pending.Clear();
    return pages;
  }

  /// <summary>Hands over the delivery PRs found on the timeline that are not read in full yet, and forgets them.</summary>
  /// <returns>The PR numbers to request in full next.</returns>
  public IReadOnlyList<int> TakeUnread()
  {
    List<int> numbers = [.. _unread.Where(number => !_read.Contains(number)).Distinct()];
    _unread.Clear();
    return numbers;
  }

  /// <summary>Gives up on what is still to read and names it in <see cref="Unfinished"/>.</summary>
  public void StopFollowing()
  {
    _unfinished.AddRange(TakePending().Select(Describe).Distinct(StringComparer.Ordinal));
    _unfinished.AddRange(TakeUnread().Select(static number => string.Create(CultureInfo.InvariantCulture, $"the lists of PR #{number}")));
  }

  /// <summary>
  /// Reads the first query's response: the issue's comments, the delivery PRs among its cross-references (see
  /// <see cref="IsDeliveryPullRequest"/>), which a later query reads in full, and every PR named with <c>--pr</c>, whoever
  /// opened it.
  /// </summary>
  /// <param name="json">The response of <see cref="Query.First"/>.</param>
  /// <param name="named">The PRs named with <c>--pr</c>.</param>
  /// <exception cref="InvalidOperationException">GitHub reported an error, or the issue or a named PR does not exist.</exception>
  public void ReadFirst(string json, IReadOnlyList<int> named)
  {
    using var document = JsonDocument.Parse(json);
    JsonElement repository = Data(document).GetProperty("repository");
    JsonElement target = Node(repository, "target") ?? throw new InvalidOperationException($"#{issue} was not found");
    ReadPullRequests(repository, named);
    ReadList(target, ListKind.IssueComments, Text(target, "id"), issue);
    ReadList(target, ListKind.CrossReferences, Text(target, "id"), issue);
  }

  /// <summary>Reads a follow-up response: aliases <c>p0</c>, … answer <paramref name="pages"/> in order, <c>prN</c> the PRs.</summary>
  /// <param name="pages">The pages that were requested.</param>
  /// <param name="pullRequests">The PRs that were requested in full.</param>
  /// <param name="json">The response of <see cref="Query.Next"/>.</param>
  /// <exception cref="InvalidOperationException">GitHub reported an error, or a requested node is missing.</exception>
  public void ReadNext(IReadOnlyList<PendingPage> pages, IReadOnlyList<int> pullRequests, string json)
  {
    using var document = JsonDocument.Parse(json);
    JsonElement data = Data(document);
    for (var index = 0; index < pages.Count; index++)
    {
      PendingPage page = pages[index];
      JsonElement owner = Node(data, Query.NextAlias(index))
        ?? throw new InvalidOperationException($"the next page of {Describe(page)} was not returned");
      ReadList(owner, page.Kind, page.NodeId, page.Number);
    }
    if (pullRequests.Count > 0)
    {
      ReadPullRequests(Node(data, "repository") ?? throw new InvalidOperationException("GitHub GraphQL: no repository"), pullRequests);
    }
  }

  /// <summary>
  /// Whether a cross-reference is from a delivery PR: a PR of this repository whose body names the issue with a reference
  /// keyword, opened by the owner, a member or a collaborator. Anyone can open a PR that says <c>Refs #N</c>; such a PR is
  /// watched only when named with --pr. A PR of another repository is left out, because <c>#N</c> there is not this issue.
  /// </summary>
  /// <param name="crossReference">A <c>CrossReferencedEvent</c> node.</param>
  /// <param name="issue">The watched issue.</param>
  /// <returns>Whether the PR it comes from is watched.</returns>
  public static bool IsDeliveryPullRequest(JsonElement crossReference, int issue) =>
    crossReference.TryGetProperty("isCrossRepository", out JsonElement crossRepository)
      && crossRepository.ValueKind == JsonValueKind.False
      && Node(crossReference, "source") is { } source
      && source.TryGetProperty("number", out _)
      && TrustedAuthors.Contains(Text(source, "authorAssociation"))
      && References.Names(Text(source, "body"), issue);

  /// <summary>Names a list for a message, for example <c>the review threads of PR #361</c>.</summary>
  /// <param name="page">The list.</param>
  /// <returns>The description.</returns>
  public static string Describe(PendingPage page) => page.Kind switch
  {
    ListKind.IssueComments => string.Create(CultureInfo.InvariantCulture, $"the comments of #{page.Number}"),
    ListKind.CrossReferences => string.Create(CultureInfo.InvariantCulture, $"the cross-references of #{page.Number}"),
    ListKind.PrComments => string.Create(CultureInfo.InvariantCulture, $"the comments of PR #{page.Number}"),
    ListKind.Reviews => string.Create(CultureInfo.InvariantCulture, $"the reviews of PR #{page.Number}"),
    ListKind.ReviewThreads => string.Create(CultureInfo.InvariantCulture, $"the review threads of PR #{page.Number}"),
    _ => string.Create(CultureInfo.InvariantCulture, $"a review thread of PR #{page.Number}"),
  };

  private static JsonElement Data(JsonDocument document)
  {
    JsonElement root = document.RootElement;
    if (root.TryGetProperty("errors", out JsonElement errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
    {
      var messages = string.Join("; ", errors.EnumerateArray().Select(static error => Text(error, "message")));
      throw new InvalidOperationException($"GitHub GraphQL: {messages}");
    }
    return Node(root, "data") ?? throw new InvalidOperationException("GitHub GraphQL: no data");
  }

  private void ReadPullRequests(JsonElement repository, IReadOnlyList<int> numbers)
  {
    foreach (var number in numbers)
    {
      JsonElement pullRequest = Node(repository, Query.PullRequestAlias(number))
        ?? throw new InvalidOperationException($"PR #{number} was not found");
      ReadPullRequest(pullRequest);
    }
  }

  private void ReadList(JsonElement owner, ListKind kind, string nodeId, int number)
  {
    if (Node(owner, Query.FieldOf(kind)) is not { } list)
    {
      return;
    }
    if (list.TryGetProperty("nodes", out JsonElement nodes) && nodes.ValueKind == JsonValueKind.Array)
    {
      foreach (JsonElement node in nodes.EnumerateArray())
      {
        ReadNode(kind, number, node);
      }
    }
    if (Node(list, "pageInfo") is { } pageInfo
      && pageInfo.TryGetProperty("hasNextPage", out JsonElement hasNext)
      && hasNext.ValueKind == JsonValueKind.True
      && Text(pageInfo, "endCursor") is { Length: > 0 } cursor
      && nodeId.Length > 0)
    {
      _pending.Add(new PendingPage(kind, nodeId, cursor, number));
    }
  }

  private void ReadNode(ListKind kind, int number, JsonElement node)
  {
    switch (kind)
    {
      case ListKind.IssueComments:
        Add(Item(Kinds.IssueComment, number, node, "createdAt"));
        break;
      case ListKind.PrComments:
        Add(Item(Kinds.PrComment, number, node, "createdAt"));
        break;
      case ListKind.CrossReferences when IsDeliveryPullRequest(node, issue):
        FoundOnTimeline(node.GetProperty("source"));
        break;
      case ListKind.Reviews:
        Add(Review(number, node));
        break;
      case ListKind.ReviewThreads:
        ReadList(node, ListKind.ThreadComments, Text(node, "id"), number);
        break;
      case ListKind.ThreadComments:
        Add(ReviewComment(number, node));
        break;
      default:
        break;
    }
  }

  // A delivery PR on the timeline brings only its state; its lists come with the next query, unless it was named and read.
  private void FoundOnTimeline(JsonElement source)
  {
    PullRequest pr = ToPullRequest(source);
    if (_pullRequests.TryAdd(pr.Number, pr))
    {
      _unread.Add(pr.Number);
    }
  }

  // A PR is read in full once a tick, even when it cross-references the issue twice or is also named with --pr. A PR found on
  // the timeline keeps the state read there, because the follow-up asks only for its lists.
  private void ReadPullRequest(JsonElement pullRequest)
  {
    var number = pullRequest.GetProperty("number").GetInt32();
    if (!_read.Add(number))
    {
      return;
    }
    if (!_pullRequests.ContainsKey(number))
    {
      _pullRequests[number] = ToPullRequest(pullRequest);
    }
    var id = Text(pullRequest, "id");
    ReadList(pullRequest, ListKind.PrComments, id, number);
    ReadList(pullRequest, ListKind.Reviews, id, number);
    ReadList(pullRequest, ListKind.ReviewThreads, id, number);
  }

  private void Add(WatchItem? item)
  {
    if (item is not null)
    {
      _items.Add(item);
    }
  }

  // GitHub wraps inline comments in a COMMENTED review with an empty body; the comments are listed on their own, so the
  // wrapper is skipped. An approval or change request with an empty body is kept, because its state is the message.
  private static WatchItem? Review(int number, JsonElement review)
  {
    var state = Text(review, "state");
    var emptyWrapper = string.Equals(state, "COMMENTED", StringComparison.Ordinal) && string.IsNullOrWhiteSpace(Text(review, "body"));
    if (emptyWrapper || string.Equals(state, "PENDING", StringComparison.Ordinal))
    {
      return null;
    }
    return Item(Kinds.Review, number, review, "submittedAt") is { } item ? item with { ReviewState = state } : null;
  }

  // A comment of a pending review is a draft only its author can see, so it is left out like the pending review itself.
  private static WatchItem? ReviewComment(int number, JsonElement comment)
  {
    if (string.Equals(Text(comment, "state"), "PENDING", StringComparison.Ordinal)
      || Item(Kinds.ReviewComment, number, comment, "createdAt") is not { } item)
    {
      return null;
    }
    var path = Text(comment, "path");
    var line = Long(comment, "line") ?? Long(comment, "originalLine");
    return item with
    {
      Location = line is null ? path : string.Create(CultureInfo.InvariantCulture, $"{path}:{line}"),
      ReplyTo = Node(comment, "replyTo") is { } replyTo ? Long(replyTo, "fullDatabaseId") : null,
    };
  }

  private static WatchItem? Item(string kind, int number, JsonElement node, string timeProperty)
  {
    if (Long(node, "fullDatabaseId") is not { } id || Time(node, timeProperty) is not { } at)
    {
      return null;
    }
    (var login, var isBot) = Author(node);
    return new WatchItem(
      kind,
      id.ToString(CultureInfo.InvariantCulture),
      number,
      login,
      isBot,
      at,
      Text(node, "url"),
      Text(node, "body"));
  }

  // GraphQL gives a bot's login without the "[bot]" suffix that REST and the web show (github-actions, not
  // github-actions[bot]), so the suffix is added back and the watch prints what it printed before.
  private static (string Login, bool IsBot) Author(JsonElement node)
  {
    if (Node(node, "author") is not { } author)
    {
      return (string.Empty, false);
    }
    var login = Text(author, "login");
    var isBot = string.Equals(Text(author, "__typename"), "Bot", StringComparison.Ordinal);
    return (isBot && !login.EndsWith("[bot]", StringComparison.Ordinal) ? login + "[bot]" : login, isBot);
  }

  private static PullRequest ToPullRequest(JsonElement pullRequest)
  {
    var number = pullRequest.GetProperty("number").GetInt32();
    DateTimeOffset created = Time(pullRequest, "createdAt") ?? DateTimeOffset.MinValue;
    var author = Author(pullRequest).Login;
    var url = Text(pullRequest, "url");
    if (Time(pullRequest, "mergedAt") is { } merged)
    {
      return new PullRequest(number, "merged", merged, url) { Author = author };
    }
    return string.Equals(Text(pullRequest, "state"), "CLOSED", StringComparison.Ordinal)
      ? new PullRequest(number, "closed", Time(pullRequest, "closedAt") ?? created, url) { Author = author }
      : new PullRequest(number, "open", created, url) { Author = author };
  }

  private static JsonElement? Node(JsonElement element, string property) =>
    element.ValueKind == JsonValueKind.Object
      && element.TryGetProperty(property, out JsonElement value)
      && value.ValueKind == JsonValueKind.Object
      ? value
      : null;

  private static string Text(JsonElement element, string property) =>
    element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.String
      ? value.GetString() ?? string.Empty
      : string.Empty;

  // fullDatabaseId is a BigInt, which GitHub sends as a string; line numbers are plain numbers.
  private static long? Long(JsonElement element, string property)
  {
    if (!element.TryGetProperty(property, out JsonElement value))
    {
      return null;
    }
    if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
    {
      return number;
    }
    return value.ValueKind == JsonValueKind.String
      && long.TryParse(value.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
      ? parsed
      : null;
  }

  private static DateTimeOffset? Time(JsonElement element, string property) =>
    element.TryGetProperty(property, out JsonElement value)
      && value.ValueKind == JsonValueKind.String
      && value.TryGetDateTimeOffset(out DateTimeOffset time)
      ? time
      : null;
}

/// <summary>Whether a PR body names an issue with a reference keyword, the way delivery PRs do.</summary>
public static partial class References
{
  /// <summary>
  /// True when the body has <c>Closes</c>, <c>Fixes</c>, <c>Resolves</c> or <c>Refs</c> (any case or tense) before <c>#issue</c>.
  /// </summary>
  /// <remarks>A list after one keyword counts (<c>Refs #318, #320</c>); a bare mention in prose does not.</remarks>
  /// <param name="body">The PR body.</param>
  /// <param name="issue">The issue number.</param>
  /// <returns>Whether the PR delivers or refers to the issue.</returns>
  public static bool Names(string body, int issue) =>
    Keyword().Matches(body)
      .SelectMany(static match => IssueNumber().Matches(match.Groups["list"].Value))
      .Any(number =>
        int.TryParse(number.Groups[1].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value == issue);

  [GeneratedRegex(
    @"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b:?\s+(?<list>#\d+(?:\s*(?:,|and|&)\s*#\d+)*)",
    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
    matchTimeoutMilliseconds: 1000)]
  private static partial Regex Keyword();

  [GeneratedRegex(@"#(\d+)", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
  private static partial Regex IssueNumber();
}

/// <summary>The agent footer heuristic of the issue-handover skill.</summary>
public static class Footer
{
  /// <summary>How an agent footer line starts.</summary>
  public const string Marker = "🤖 Generated with";

  /// <summary>
  /// True when the last non-blank line starts with <see cref="Marker"/>. A quoted footer (<c>&gt; 🤖 …</c>) never counts, so a
  /// human reply that quotes an agent post is not marked. This is a heuristic, not authentication.
  /// </summary>
  /// <param name="body">A comment or review body.</param>
  /// <returns>Whether the body ends with an agent footer.</returns>
  public static bool EndsWithAgentFooter(string body)
  {
    var last = Report.Clean(body).Split('\n').LastOrDefault(static line => !string.IsNullOrWhiteSpace(line));
    return last is not null && last.Trim().StartsWith(Marker, StringComparison.Ordinal);
  }
}

/// <summary>Which items are new, given the seen-ID record.</summary>
public static class Watch
{
  /// <summary>One <see cref="Kinds.PrState"/> item per PR, keyed by number and state, so each change is new once.</summary>
  /// <param name="pullRequests">The watched PRs.</param>
  /// <returns>The state items.</returns>
  public static IReadOnlyList<WatchItem> StateItems(IEnumerable<PullRequest> pullRequests) =>
    [
      .. pullRequests.Select(static pr => new WatchItem(
        Kinds.PrState,
        string.Create(CultureInfo.InvariantCulture, $"{pr.Number}:{pr.State}"),
        pr.Number,
        pr.Author,
        IsBot: false,
        pr.ChangedAt,
        pr.Url,
        string.Empty)),
    ];

  /// <summary>The items whose key is not in the record, once each, oldest first.</summary>
  /// <param name="items">Everything fetched this run.</param>
  /// <param name="seen">The keys already printed.</param>
  /// <returns>The new items in time order.</returns>
  public static IReadOnlyList<WatchItem> NewItems(IEnumerable<WatchItem> items, IReadOnlySet<string> seen) =>
    [
      .. items
        .Where(item => !seen.Contains(item.Key))
        .DistinctBy(static item => item.Key, StringComparer.Ordinal)
        .OrderBy(static item => item.At)
        .ThenBy(static item => item.Key, StringComparer.Ordinal),
    ];
}

/// <summary>The git-ignored file of keys already printed, one per line, per issue and worktree.</summary>
public static class SeenRecord
{
  /// <summary>Where the record of an issue lives: <c>.plan/handover-watch/&lt;issue&gt;.seen</c> under the repository root.</summary>
  /// <param name="repositoryRoot">The root of the checkout.</param>
  /// <param name="issue">The watched issue.</param>
  /// <returns>The file path.</returns>
  public static string PathFor(string repositoryRoot, int issue) =>
    Path.Combine(repositoryRoot, ".plan", "handover-watch", string.Create(CultureInfo.InvariantCulture, $"{issue}.seen"));

  /// <summary>Reads the record; blank lines and surrounding whitespace are ignored, and an empty record is a first run.</summary>
  /// <param name="text">The file's contents.</param>
  /// <returns>The keys.</returns>
  public static HashSet<string> Parse(string text) =>
    new(text.Split('\n').Select(static line => line.Trim()).Where(static line => line.Length > 0), StringComparer.Ordinal);

  /// <summary>The lines to append for the items just printed.</summary>
  /// <param name="items">The new items.</param>
  /// <returns>One key per line, each ending in a newline.</returns>
  public static string Lines(IEnumerable<WatchItem> items) => string.Concat(items.Select(static item => item.Key + "\n"));
}

/// <summary>Renders what the watch found.</summary>
public static class Report
{
  private const string Separator = " · ";

  /// <summary>
  /// A summary line, then one record per new item: a header line starting with <c>===</c>, the link, and the body indented by
  /// two spaces, so no body line can be mistaken for a header.
  /// </summary>
  /// <param name="issue">The watched issue.</param>
  /// <param name="pullRequests">The watched PRs.</param>
  /// <param name="fresh">The new items, in the order to print.</param>
  /// <returns>The text to print.</returns>
  public static string Render(int issue, IReadOnlyList<PullRequest> pullRequests, IReadOnlyList<WatchItem> fresh)
  {
    var text = new StringBuilder();
    var prs = pullRequests.Count == 0
      ? "no delivery PRs"
      : "PRs " + string.Join(
        ", ",
        pullRequests.Select(static pr => string.Create(CultureInfo.InvariantCulture, $"#{pr.Number} {pr.State}")));
    var count = fresh.Count == 0 ? "nothing new" : string.Create(CultureInfo.InvariantCulture, $"{fresh.Count} new");
    text.Append(CultureInfo.InvariantCulture, $"#{issue}{Separator}{prs}{Separator}{count}").Append('\n');
    foreach (WatchItem item in fresh)
    {
      text.Append(Header(item)).Append('\n');
      text.Append(Clean(item.Url)).Append('\n');
      if (string.IsNullOrWhiteSpace(item.Body))
      {
        continue;
      }
      foreach (var line in Clean(item.Body).TrimEnd('\n').Split('\n'))
      {
        text.Append(line.Length == 0 ? string.Empty : "  " + line).Append('\n');
      }
    }
    return text.ToString();
  }

  /// <summary>The header line of one record.</summary>
  /// <param name="item">The item.</param>
  /// <returns>For example <c>=== review:58 · PR #360 · mgasca · agent-footer: no · APPROVED · 2026-11-06T15:10:18Z</c>.</returns>
  public static string Header(WatchItem item)
  {
    List<string> parts =
    [
      "=== " + item.Key,
      string.Create(
        CultureInfo.InvariantCulture,
        $"{(string.Equals(item.Kind, Kinds.IssueComment, StringComparison.Ordinal) ? "#" : "PR #")}{item.Number}"),
    ];
    parts.Add(item.IsBot ? item.Author + " (bot)" : item.Author);
    if (!string.Equals(item.Kind, Kinds.PrState, StringComparison.Ordinal))
    {
      parts.Add(item.HasAgentFooter ? "agent-footer: yes" : "agent-footer: no");
    }
    if (item.ReviewState is { } state)
    {
      parts.Add(state);
    }
    parts.Add(item.At.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
    if (item.Location is { } location)
    {
      parts.Add(location);
    }
    if (item.ReplyTo is { } replyTo)
    {
      parts.Add(string.Create(CultureInfo.InvariantCulture, $"reply-to {Kinds.ReviewComment}:{replyTo}"));
    }
    return SingleLine(string.Join(Separator, parts));
  }

  /// <summary>
  /// Normalises line endings to <c>\n</c> and replaces other control characters (such as terminal escapes) and bidirectional
  /// overrides with U+FFFD, so printed text shows what it says.
  /// </summary>
  /// <param name="text">Text from GitHub.</param>
  /// <returns>Text that is safe to print.</returns>
  public static string Clean(string text)
  {
    var normalised = text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
    var clean = new StringBuilder(normalised.Length);
    foreach (var character in normalised)
    {
      var unsafeCharacter = (char.IsControl(character) && character is not ('\n' or '\t')) || IsBidiControl(character);
      clean.Append(unsafeCharacter ? '\uFFFD' : character);
    }
    return clean.ToString();
  }

  /// <summary>Like <see cref="Clean"/>, and also replaces line breaks and tabs, for a header line built from GitHub fields.</summary>
  /// <param name="text">A header, which may hold a file path or login from GitHub.</param>
  /// <returns>One line.</returns>
  public static string SingleLine(string text)
  {
    var clean = new StringBuilder(Clean(text));
    for (var index = 0; index < clean.Length; index++)
    {
      if (clean[index] is '\n' or '\t' or '\u2028' or '\u2029')
      {
        clean[index] = '\uFFFD';
      }
    }
    return clean.ToString();
  }

  private static bool IsBidiControl(char character) => character is (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069');
}

/// <summary>Runs the GitHub CLI, found on PATH, and returns its standard output.</summary>
public static class Gh
{
  /// <summary>How many times a call is tried when GitHub answers with a server error.</summary>
  public const int Attempts = 3;

  /// <summary>gh resolved on PATH once, so the process start uses an absolute path.</summary>
  private static readonly Lazy<string> Executable = new(static () =>
    (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
      .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
      .Select(static dir => Path.Combine(dir, OperatingSystem.IsWindows() ? "gh.exe" : "gh"))
      .FirstOrDefault(File.Exists) ?? "/usr/bin/gh");

  /// <summary>Whether gh's stderr reports a server-side failure worth retrying (HTTP 5xx), not a usage or auth error.</summary>
  /// <param name="error">What gh wrote to stderr.</param>
  /// <returns>True for a 5xx answer.</returns>
  public static bool IsTransient(string error) =>
    error.Contains("Server Error", StringComparison.Ordinal) || error.Contains("HTTP 5", StringComparison.Ordinal);

  /// <summary>
  /// The arguments of <c>gh api graphql</c> for a request: <c>$owner</c> and <c>$name</c> as <c>-F</c> fields that gh fills
  /// in from the checkout's remote, the other variables raw with <c>-f</c>, and the query last.
  /// </summary>
  /// <param name="request">The request.</param>
  /// <returns>The arguments, one per element.</returns>
  public static IReadOnlyList<string> Arguments(GraphQlRequest request)
  {
    List<string> arguments = ["api", "graphql"];
    if (request.InRepository)
    {
      arguments.AddRange(["-F", "owner={owner}", "-F", "name={repo}"]);
    }
    foreach ((var name, var value) in request.Variables)
    {
      arguments.AddRange(["-f", $"{name}={value}"]);
    }
    arguments.AddRange(["-f", $"query={request.Text}"]);
    return arguments;
  }

  /// <summary>Sends one GraphQL request for this repository.</summary>
  /// <param name="workingDirectory">A directory of the checkout, so gh resolves <c>{owner}/{repo}</c> from its remote.</param>
  /// <param name="request">The request.</param>
  /// <returns>The response JSON.</returns>
  public static Task<string> GraphQlAsync(string workingDirectory, GraphQlRequest request) =>
    RunAsync(Arguments(request), workingDirectory);

  /// <summary>Runs <c>gh</c> with the given arguments, retrying a server error up to <see cref="Attempts"/> times.</summary>
  /// <param name="arguments">The arguments, one per element.</param>
  /// <param name="workingDirectory">Where gh runs.</param>
  /// <returns>Standard output.</returns>
  /// <exception cref="InvalidOperationException">gh exited with a non-zero code; the message carries its stderr.</exception>
  public static async Task<string> RunAsync(IReadOnlyList<string> arguments, string workingDirectory)
  {
    var attempt = 0;
    while (true)
    {
      attempt++;
      (int ExitCode, string Output, string Error) result = await RunOnceAsync(arguments, workingDirectory);
      if (result.ExitCode == 0)
      {
        return result.Output;
      }
      if (attempt < Attempts && IsTransient(result.Error))
      {
        await Task.Delay(TimeSpan.FromSeconds(2 * attempt));
        continue;
      }
      // The command is named without its flags: the query alone runs to a few kilobytes.
      var command = string.Join(' ', arguments.TakeWhile(static argument => !argument.StartsWith('-')));
      throw new InvalidOperationException($"gh {command} failed ({result.ExitCode}): {result.Error.Trim()}");
    }
  }

  private static async Task<(int ExitCode, string Output, string Error)> RunOnceAsync(
    IReadOnlyList<string> arguments,
    string workingDirectory)
  {
    var start = new ProcessStartInfo(Executable.Value)
    {
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false,
      WorkingDirectory = workingDirectory,
    };
    foreach (var argument in arguments)
    {
      start.ArgumentList.Add(argument);
    }
    using Process process = Process.Start(start) ?? throw new InvalidOperationException("gh did not start");
    Task<string> output = process.StandardOutput.ReadToEndAsync();
    Task<string> error = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync();
    return (process.ExitCode, await output, await error);
  }
}
