using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using CiTimings;

namespace DeliveryDashboard;

/// <summary>An open pull request, as the flow metrics need it: numbers, times and branch names only.</summary>
/// <param name="Number">The pull request number.</param>
/// <param name="CreatedAt">When it was opened.</param>
/// <param name="IsDraft">Whether it is a draft.</param>
/// <param name="Reviews">How many reviews were submitted on it.</param>
/// <param name="BaseRef">The branch it targets.</param>
/// <param name="HeadRef">The branch it comes from.</param>
public sealed record OpenPr(int Number, DateTimeOffset CreatedAt, bool IsDraft, int Reviews, string BaseRef, string HeadRef);

/// <summary>An issue a merged pull request closes.</summary>
/// <param name="Number">The issue number.</param>
/// <param name="CreatedAt">When the issue was opened.</param>
public sealed record ClosedIssue(int Number, DateTimeOffset CreatedAt);

/// <summary>A merged pull request, as the flow metrics need it.</summary>
/// <param name="Number">The pull request number.</param>
/// <param name="CreatedAt">When it was opened.</param>
/// <param name="MergedAt">When it was merged.</param>
/// <param name="BaseRef">The branch it was merged into.</param>
/// <param name="Closes">The issues it closes.</param>
public sealed record MergedPr(
  int Number,
  DateTimeOffset CreatedAt,
  DateTimeOffset MergedAt,
  string BaseRef,
  IReadOnlyList<ClosedIssue> Closes);

/// <summary>An open epic and the state of the issues its task list names.</summary>
/// <param name="Number">The epic's issue number.</param>
/// <param name="Items">The listed issues, as (number, whether it is closed).</param>
public sealed record EpicInput(int Number, IReadOnlyList<(int Issue, bool Closed)> Items);

/// <summary>Durations over a sample, in seconds; only built from at least <see cref="FlowMetrics.MinSample"/> values.</summary>
/// <param name="Count">The sample size.</param>
/// <param name="MedianSeconds">The median (nearest rank).</param>
/// <param name="P90Seconds">The 90th percentile (nearest rank).</param>
/// <param name="MaxSeconds">The longest.</param>
public sealed record Distribution(int Count, double MedianSeconds, double P90Seconds, double MaxSeconds);

/// <summary>The open pull requests and how long they have been open.</summary>
/// <param name="Count">All open pull requests.</param>
/// <param name="Drafts">How many are drafts.</param>
/// <param name="Age">The age of the open pull requests; null when there are too few.</param>
public sealed record OpenSection(int Count, int Drafts, Distribution? Age);

/// <summary>Open, non-draft pull requests that have no submitted review yet.</summary>
/// <param name="Count">How many.</param>
/// <param name="OldestSeconds">The age of the oldest; null when none.</param>
public sealed record WaitingSection(int Count, double? OldestSeconds);

/// <summary>A duration metric over merged pull requests or closed issues, with its sample.</summary>
/// <param name="Sample">How many items were measured.</param>
/// <param name="Stat">The distribution; null when the sample is below <see cref="FlowMetrics.MinSample"/> (inconclusive).</param>
public sealed record DurationSection(int Sample, Distribution? Stat);

/// <summary>A chain of open pull requests, each targeting the branch of the one below.</summary>
/// <param name="Depth">The longest chain, in pull requests.</param>
/// <param name="PullRequests">The numbers of every pull request in the stack, ascending.</param>
public sealed record StackInfo(int Depth, IReadOnlyList<int> PullRequests);

/// <summary>Open stacks and stack merges.</summary>
/// <param name="Stacks">The open stacks of two or more pull requests, by lowest number.</param>
/// <param name="MergedIntoBase">Pull requests merged in the window into a branch other than the default branch.</param>
public sealed record StacksSection(IReadOnlyList<StackInfo> Stacks, int MergedIntoBase);

/// <summary>An epic's progress, from the issues its task list names.</summary>
/// <param name="Issue">The epic's issue number.</param>
/// <param name="Total">How many issues its task list names.</param>
/// <param name="Done">How many of them are closed.</param>
public sealed record EpicProgress(int Issue, int Total, int Done);

/// <summary>The flow section: how smoothly pull requests and issues move, from public data only.</summary>
/// <param name="Basis">Always <c>measured</c>: computed from GitHub's recorded times.</param>
/// <param name="Window">The span merged pull requests were taken from.</param>
/// <param name="Open">The open pull requests.</param>
/// <param name="Waiting">Pull requests waiting for a first review.</param>
/// <param name="LeadTime">Opened to merged into the default branch.</param>
/// <param name="IssueToMerge">Issue opened to the merge of the pull request that closed it.</param>
/// <param name="Stacks">Open stacks and stack merges.</param>
/// <param name="Epics">Progress of each open epic.</param>
public sealed record FlowSection(
  string Basis,
  SampleWindow Window,
  OpenSection Open,
  WaitingSection Waiting,
  DurationSection LeadTime,
  DurationSection IssueToMerge,
  StacksSection Stacks,
  IReadOnlyList<EpicProgress> Epics);

/// <summary>The flow metrics, with the definition of what starts and stops each clock.</summary>
public static partial class FlowMetrics
{
  /// <summary>The smallest sample a distribution is shown for; below it only the count is kept.</summary>
  public const int MinSample = 5;

  /// <summary>Builds the section.</summary>
  /// <param name="now">When the snapshot is taken.</param>
  /// <param name="windowStart">The earliest merge time considered.</param>
  /// <param name="mergedListFull">Whether <paramref name="merged"/> hit GitHub's page size, so older merges were not seen.</param>
  /// <param name="defaultBranch">The branch deliveries are measured to (<c>main</c>).</param>
  /// <param name="open">The open pull requests.</param>
  /// <param name="merged">The merged pull requests, newest first, already limited to the window.</param>
  /// <param name="epics">The open epics.</param>
  /// <returns>The section.</returns>
  public static FlowSection Build(
    DateTimeOffset now,
    DateTimeOffset windowStart,
    bool mergedListFull,
    string defaultBranch,
    IReadOnlyList<OpenPr> open,
    IReadOnlyList<MergedPr> merged,
    IReadOnlyList<EpicInput> epics)
  {
    // When the list GitHub returned is full, older merges are unseen, so the window starts at the oldest merge seen.
    DateTimeOffset from = mergedListFull && merged.Count > 0 ? new[] { windowStart, merged.Min(pr => pr.MergedAt) }.Max() : windowStart;
    List<MergedPr> inWindow = [.. merged.Where(pr => pr.MergedAt >= from && pr.MergedAt <= now)];
    // Lead time and issue-to-merge measure reaching the default branch: a pull request merged into another pull
    // request's branch is a stack step, counted on its own, and the pull request below it carries the delivery.
    List<MergedPr> toDefault = [.. inWindow.Where(pr => pr.BaseRef == defaultBranch)];
    var intoBase = inWindow.Count - toDefault.Count;

    List<double> ages = [.. open.Select(pr => Seconds(now - pr.CreatedAt))];
    List<OpenPr> waiting = [.. open.Where(pr => !pr.IsDraft && pr.Reviews == 0)];

    // An issue that several merged pull requests close counts once, up to the last of those merges into the default branch.
    List<double> issueSeconds =
    [
      .. toDefault
        .SelectMany(pr => pr.Closes.Select(issue => (issue, pr.MergedAt)))
        .GroupBy(item => item.issue.Number)
        .Select(group => Seconds(group.Max(item => item.MergedAt) - group.First().issue.CreatedAt)),
    ];

    return new FlowSection(
      CiSnapshot.Measured,
      new SampleWindow(from, now),
      new OpenSection(open.Count, open.Count(pr => pr.IsDraft), Distribute(ages)),
      new WaitingSection(waiting.Count, waiting.Count == 0 ? null : waiting.Max(pr => Seconds(now - pr.CreatedAt))),
      new DurationSection(toDefault.Count, Distribute([.. toDefault.Select(pr => Seconds(pr.MergedAt - pr.CreatedAt))])),
      new DurationSection(issueSeconds.Count, Distribute(issueSeconds)),
      new StacksSection(Stacks(open), intoBase),
      [.. epics.OrderBy(epic => epic.Number).Select(epic => new EpicProgress(
        epic.Number, epic.Items.Count, epic.Items.Count(item => item.Closed)))]);
  }

  /// <summary>Finds the open stacks: a pull request whose base branch is another open pull request's head branch is above it.</summary>
  /// <param name="open">The open pull requests.</param>
  /// <returns>The stacks of at least two pull requests, by lowest number.</returns>
  public static IReadOnlyList<StackInfo> Stacks(IReadOnlyList<OpenPr> open)
  {
    Dictionary<string, OpenPr> byHead = [];
    foreach (OpenPr pr in open.OrderBy(item => item.Number))
    {
      byHead.TryAdd(pr.HeadRef, pr);
    }
    Dictionary<int, List<OpenPr>> children = [];
    HashSet<int> hasParent = [];
    foreach (OpenPr pr in open)
    {
      if (byHead.TryGetValue(pr.BaseRef, out OpenPr? parent) && parent.Number != pr.Number)
      {
        if (!children.TryGetValue(parent.Number, out List<OpenPr>? list))
        {
          children[parent.Number] = list = [];
        }
        list.Add(pr);
        hasParent.Add(pr.Number);
      }
    }
    List<StackInfo> stacks = [];
    foreach (OpenPr root in open.Where(pr => !hasParent.Contains(pr.Number) && children.ContainsKey(pr.Number)))
    {
      HashSet<int> members = [];
      var depth = Descend(root.Number, children, members);
      stacks.Add(new StackInfo(depth, [.. members.Order()]));
    }
    return [.. stacks.OrderBy(stack => stack.PullRequests[0])];
  }

  private static int Descend(int number, Dictionary<int, List<OpenPr>> children, HashSet<int> members)
  {
    // A branch cycle (two pull requests naming each other's branch) cannot be a stack; the set stops the walk.
    if (!members.Add(number) || !children.TryGetValue(number, out List<OpenPr>? below))
    {
      return 1;
    }
    return 1 + below.Max(child => Descend(child.Number, children, members));
  }

  private static Distribution? Distribute(List<double> seconds)
  {
    if (seconds.Count < MinSample)
    {
      return null;
    }
    Summary summary = Statistics.Summarize(seconds);
    return new Distribution(summary.Count, Round(summary.Median), Round(summary.P90), Round(summary.Max));
  }

  private static double Seconds(TimeSpan span) => Math.Max(0, span.TotalSeconds);

  private static double Round(double seconds) => Math.Round(seconds, 0, MidpointRounding.AwayFromZero);

  /// <summary>The issue numbers a task list names, with whether the box is ticked: the first <c>#N</c> of each <c>- [ ]</c> line.</summary>
  /// <param name="body">The epic's body.</param>
  /// <returns>(issue number, ticked) per line, in order, each number once.</returns>
  public static IReadOnlyList<(int Issue, bool Ticked)> TaskList(string body)
  {
    List<(int, bool)> items = [];
    HashSet<int> seen = [];
    foreach (GroupCollection groups in TaskLine().Matches(body).Select(match => match.Groups))
    {
      var number = int.Parse(groups["number"].Value, CultureInfo.InvariantCulture);
      if (seen.Add(number))
      {
        items.Add((number, groups["box"].Value != " "));
      }
    }
    return items;
  }

  [GeneratedRegex(
    @"^[ \t]*[-*][ \t]+\[(?<box>[ xX])\][^\r\n]*?#(?<number>\d{1,7})\b",
    RegexOptions.Multiline | RegexOptions.CultureInvariant,
    1000)]
  private static partial Regex TaskLine();
}

/// <summary>What the first GraphQL call returns.</summary>
/// <param name="DefaultBranch">The default branch's name.</param>
/// <param name="Open">The open pull requests.</param>
/// <param name="Merged">The merged pull requests, newest merge first.</param>
/// <param name="Epics">The open epics as (number, body).</param>
public sealed record FlowAnswer(
  string DefaultBranch,
  IReadOnlyList<OpenPr> Open,
  IReadOnlyList<MergedPr> Merged,
  IReadOnlyList<(int Number, string Body)> Epics);

/// <summary>Reads GitHub's GraphQL answers into the flow inputs; pure, so tests feed it constructed JSON.</summary>
public static class FlowParser
{
  /// <summary>The query for open and merged pull requests and the open epics: one call.</summary>
  public const string Query = """
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef { name }
        open: pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
          nodes { number createdAt isDraft baseRefName headRefName reviews { totalCount } }
        }
        merged: pullRequests(states: MERGED, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { number createdAt mergedAt baseRefName closingIssuesReferences(first: 10) { nodes { number createdAt } } }
        }
        epics: issues(states: OPEN, labels: ["epic"], first: 20) { nodes { number body } }
      }
    }
    """;

  /// <summary>The pull requests, epics and default branch from the answer to <see cref="Query"/>.</summary>
  /// <param name="json">The answer.</param>
  /// <returns>The inputs; the epics are (number, body) until their issues' states are known.</returns>
  public static FlowAnswer Parse(string json)
  {
    using var document = JsonDocument.Parse(json);
    JsonElement repository = document.RootElement.GetProperty("data").GetProperty("repository");
    List<OpenPr> open =
    [
      .. repository.GetProperty("open").GetProperty("nodes").EnumerateArray().Select(node => new OpenPr(
        node.GetProperty("number").GetInt32(),
        node.GetProperty("createdAt").GetDateTimeOffset(),
        node.GetProperty("isDraft").GetBoolean(),
        node.GetProperty("reviews").GetProperty("totalCount").GetInt32(),
        node.GetProperty("baseRefName").GetString() ?? string.Empty,
        node.GetProperty("headRefName").GetString() ?? string.Empty)),
    ];
    List<MergedPr> merged =
    [
      .. repository.GetProperty("merged").GetProperty("nodes").EnumerateArray()
        .Where(node => node.GetProperty("mergedAt").ValueKind == JsonValueKind.String)
        .Select(node => new MergedPr(
          node.GetProperty("number").GetInt32(),
          node.GetProperty("createdAt").GetDateTimeOffset(),
          node.GetProperty("mergedAt").GetDateTimeOffset(),
          node.GetProperty("baseRefName").GetString() ?? string.Empty,
          [
            .. node.GetProperty("closingIssuesReferences").GetProperty("nodes").EnumerateArray()
              .Select(issue => new ClosedIssue(issue.GetProperty("number").GetInt32(), issue.GetProperty("createdAt").GetDateTimeOffset())),
          ]))
        .OrderByDescending(pr => pr.MergedAt),
    ];
    List<(int, string)> epics =
    [
      .. repository.GetProperty("epics").GetProperty("nodes").EnumerateArray()
        .Select(node => (node.GetProperty("number").GetInt32(), node.GetProperty("body").GetString() ?? string.Empty)),
    ];
    return new FlowAnswer(repository.GetProperty("defaultBranchRef").GetProperty("name").GetString() ?? "main", open, merged, epics);
  }

  /// <summary>The query for the state of the listed issues, as aliases, so one call answers for every epic.</summary>
  /// <param name="numbers">The issue numbers.</param>
  /// <returns>The query text.</returns>
  public static string StateQuery(IEnumerable<int> numbers)
  {
    IEnumerable<string> fields = numbers.Distinct().Order()
      .Select(number => string.Create(CultureInfo.InvariantCulture, $"i{number}: issue(number: {number}) {{ state }}"));
    return "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { " + string.Join(' ', fields) + " } }";
  }

  /// <summary>Whether each issue is closed, from the answer to <see cref="StateQuery"/>.</summary>
  /// <param name="json">The answer.</param>
  /// <returns>Closed issue numbers; an issue that is missing (a pull request number, a deleted issue) is not listed.</returns>
  public static IReadOnlySet<int> ClosedIssues(string json)
  {
    using var document = JsonDocument.Parse(json);
    HashSet<int> closed = [];
    foreach (JsonProperty issue in document.RootElement.GetProperty("data").GetProperty("repository").EnumerateObject())
    {
      if (issue.Value.ValueKind == JsonValueKind.Object && issue.Value.GetProperty("state").GetString() == "CLOSED"
        && int.TryParse(issue.Name.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var number))
      {
        closed.Add(number);
      }
    }
    return closed;
  }
}

/// <summary>Collects the flow section from GitHub with two GraphQL calls.</summary>
public static class FlowCollector
{
  /// <summary>How many days back merged pull requests are taken from.</summary>
  public const int WindowDays = 30;

  /// <summary>The most issues one epic's task list may contribute; the state query stays one call.</summary>
  public const int MaxEpicItems = 40;

  /// <summary>The page size of the merged pull request list; <see cref="FlowParser.Query"/> asks for this many.</summary>
  public const int PageSize = 100;

  /// <summary>Collects and builds the section.</summary>
  /// <param name="repository"><c>owner/name</c>.</param>
  /// <param name="now">When the snapshot is taken.</param>
  /// <returns>The section.</returns>
  public static async Task<FlowSection> CollectAsync(string repository, DateTimeOffset now)
  {
    var parts = repository.Split('/');
    string[] identity = ["-F", $"owner={parts[0]}", "-F", $"name={parts[1]}"];
    var answer = await Gh.RunAsync(["api", "graphql", "-f", $"query={FlowParser.Query}", .. identity]);
    FlowAnswer parsed = FlowParser.Parse(answer);
    List<(int Number, List<int> Issues)> lists =
      [
        .. parsed.Epics.Select(epic => (
          epic.Number,
          FlowMetrics.TaskList(epic.Body).Select(item => item.Issue).Take(MaxEpicItems).ToList())),
      ];
    IReadOnlySet<int> closed = new HashSet<int>();
    List<int> listed = [.. lists.SelectMany(list => list.Issues)];
    if (listed.Count > 0)
    {
      var stateQuery = $"query={FlowParser.StateQuery(listed)}";
      closed = FlowParser.ClosedIssues(await Gh.RunAsync(["api", "graphql", "-f", stateQuery, .. identity]));
    }
    List<EpicInput> inputs =
      [.. lists.Select(list => new EpicInput(list.Number, [.. list.Issues.Select(issue => (issue, closed.Contains(issue)))]))];
    // GitHub returns the newest-updated merged pull requests; when that page is full, the window starts at its oldest merge.
    DateTimeOffset start = now.AddDays(-WindowDays);
    return FlowMetrics.Build(now, start, parsed.Merged.Count >= PageSize, parsed.DefaultBranch, parsed.Open, parsed.Merged, inputs);
  }
}
