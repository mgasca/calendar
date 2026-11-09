using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using CiTimings;

namespace DeliveryDashboard;

/// <summary>What the tool read from one count comment.</summary>
/// <param name="Kind"><see cref="CountKind"/>: no count, a valid count or a malformed one.</param>
/// <param name="Tasks">Tasks started; 0 when the comment gives none.</param>
/// <param name="Subagents">Subagents started; 0 when the comment gives none.</param>
public sealed record CountParse(string Kind, int Tasks, int Subagents);

/// <summary>The kinds of <see cref="CountParse"/>.</summary>
public static class CountKind
{
  /// <summary>The comment is not a count comment.</summary>
  public const string None = "none";

  /// <summary>The comment gives numbers for tasks, subagents or both.</summary>
  public const string Valid = "valid";

  /// <summary>The comment names a count but gives no usable number.</summary>
  public const string Malformed = "malformed";
}

/// <summary>
/// Reads the numbers-only count comments of the <c>issue-handover</c> skill. The comments in the repository end with
/// <c>Tasks started: N. Subagents started: M.</c>; the line may sit anywhere in a comment.
/// </summary>
public static partial class CountComments
{
  /// <summary>The largest number of tasks or subagents one comment can state; more is treated as malformed.</summary>
  public const int MaxPerComment = 1000;

  [GeneratedRegex(@"\b(task|subagent)s?\s+started\s*[:=]\s*([^\s.,;]*)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 1000)]
  private static partial Regex Label();

  /// <summary>Reads one comment body.</summary>
  /// <param name="body">The comment's text; quoted lines (starting with <c>&gt;</c>) are ignored.</param>
  /// <returns>No count, a valid count, or a malformed one that contributes nothing.</returns>
  public static CountParse Parse(string body)
  {
    var tasks = 0;
    var subagents = 0;
    var found = false;
    foreach (var line in body.Split('\n'))
    {
      if (line.TrimStart().StartsWith('>'))
      {
        continue;
      }
      foreach (GroupCollection groups in Label().Matches(line).Select(match => match.Groups))
      {
        found = true;
        var text = groups[2].Value;
        if (text.Length == 0 || text.Length > 4 || !text.All(char.IsAsciiDigit)
          || !int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) || value > MaxPerComment)
        {
          return new CountParse(CountKind.Malformed, 0, 0);
        }
        if (string.Equals(groups[1].Value, "task", StringComparison.OrdinalIgnoreCase))
        {
          tasks += value;
        }
        else
        {
          subagents += value;
        }
      }
    }
    return found ? new CountParse(CountKind.Valid, tasks, subagents) : new CountParse(CountKind.None, 0, 0);
  }
}

/// <summary>A pull request that mentions an issue.</summary>
/// <param name="Number">The pull request's number.</param>
/// <param name="Reviews">How many reviews were submitted on it.</param>
public sealed record PullRequestMention(int Number, int Reviews);

/// <summary>An issue as read from GitHub; its comment bodies are read but never stored.</summary>
/// <param name="Number">The issue number.</param>
/// <param name="UpdatedAt">When it was last updated.</param>
/// <param name="CommentTotal">How many comments it has.</param>
/// <param name="CommentBodies">The bodies of the comments that were read (at most the first 100).</param>
/// <param name="PullRequests">The pull requests that mention it, once each.</param>
public sealed record IssueInput(
  int Number,
  DateTimeOffset UpdatedAt,
  int CommentTotal,
  IReadOnlyList<string> CommentBodies,
  IReadOnlyList<PullRequestMention> PullRequests);

/// <summary>The agent proxies of one issue, by number.</summary>
/// <param name="Issue">The issue number.</param>
/// <param name="CountComments">Valid count comments.</param>
/// <param name="Malformed">Count comments that could not be read.</param>
/// <param name="Tasks">Tasks started, summed over the valid count comments; null when there is none (no cost data).</param>
/// <param name="Subagents">Subagents started, likewise.</param>
/// <param name="Comments">Comments on the issue.</param>
/// <param name="Reviews">Reviews submitted on the pull requests that mention it.</param>
/// <param name="PullRequests">Pull requests that mention it.</param>
public sealed record AgentIssue(
  int Issue,
  int CountComments,
  int Malformed,
  int? Tasks,
  int? Subagents,
  int Comments,
  int Reviews,
  int PullRequests);

/// <summary>Sums over the listed issues, activity.</summary>
/// <param name="Issues">Issues listed.</param>
/// <param name="WithCounts">Of them, issues with at least one valid count comment.</param>
/// <param name="Comments">Comments on them.</param>
/// <param name="Reviews">Reviews on the pull requests that mention them.</param>
/// <param name="PullRequests">Mentions of them by pull requests, summed per issue.</param>
public sealed record AgentActivityTotals(int Issues, int WithCounts, int Comments, int Reviews, int PullRequests);

/// <summary>Sums over the listed issues, self-reported counts.</summary>
/// <param name="CountComments">Valid count comments.</param>
/// <param name="Malformed">Count comments that could not be read.</param>
/// <param name="Tasks">Tasks started.</param>
/// <param name="Subagents">Subagents started.</param>
public sealed record AgentCountTotals(int CountComments, int Malformed, int Tasks, int Subagents);

/// <summary>Whether each family of numbers was measured or inferred.</summary>
/// <param name="Activity">Comment, review and pull request counts are read from GitHub: measured.</param>
/// <param name="Counts">Tasks and subagents are what the agent wrote in a comment: inferred.</param>
public sealed record AgentBasis(string Activity, string Counts);

/// <summary>What the section was computed from.</summary>
/// <param name="Scanned">Issues read, whether or not they are listed.</param>
/// <param name="Window">The oldest and newest update among them; null when none was read.</param>
public sealed record AgentSample(int Scanned, SampleWindow? Window);

/// <summary>The agent section: proxies for agent-driven delivery, from GitHub only. Not token or money cost.</summary>
/// <param name="Basis">Measured or inferred.</param>
/// <param name="Sample">The sample.</param>
/// <param name="Activity">Activity sums.</param>
/// <param name="Counts">Count sums.</param>
/// <param name="Issues">The issues with at least one comment or pull request, newest number first.</param>
public sealed record AgentsSection(
  AgentBasis Basis,
  AgentSample Sample,
  AgentActivityTotals Activity,
  AgentCountTotals Counts,
  IReadOnlyList<AgentIssue> Issues);

/// <summary>Builds the agent section.</summary>
public static class AgentCollector
{
  /// <summary>How many of the most recently updated issues are read.</summary>
  public const int DefaultIssues = 100;

  /// <summary>Builds the section.</summary>
  /// <param name="issues">The issues read.</param>
  /// <returns>The section; an issue without a comment and without a pull request is scanned but not listed.</returns>
  public static AgentsSection Build(IReadOnlyList<IssueInput> issues)
  {
    List<AgentIssue> rows =
    [
      .. issues.Select(Row).Where(row => row.Comments > 0 || row.PullRequests > 0).OrderByDescending(row => row.Issue),
    ];
    SampleWindow? window = issues.Count == 0 ? null : new SampleWindow(issues.Min(i => i.UpdatedAt), issues.Max(i => i.UpdatedAt));
    return new AgentsSection(
      new AgentBasis(CiSnapshot.Measured, "inferred"),
      new AgentSample(issues.Count, window),
      new AgentActivityTotals(
        rows.Count,
        rows.Count(row => row.CountComments > 0),
        rows.Sum(row => row.Comments),
        rows.Sum(row => row.Reviews),
        rows.Sum(row => row.PullRequests)),
      new AgentCountTotals(
        rows.Sum(row => row.CountComments),
        rows.Sum(row => row.Malformed),
        rows.Sum(row => row.Tasks ?? 0),
        rows.Sum(row => row.Subagents ?? 0)),
      rows);
  }

  private static AgentIssue Row(IssueInput issue)
  {
    List<CountParse> parsed = [.. issue.CommentBodies.Select(CountComments.Parse)];
    List<CountParse> valid = [.. parsed.Where(item => item.Kind == CountKind.Valid)];
    List<PullRequestMention> pullRequests = [.. issue.PullRequests.DistinctBy(mention => mention.Number)];
    return new AgentIssue(
      issue.Number,
      valid.Count,
      parsed.Count(item => item.Kind == CountKind.Malformed),
      valid.Count == 0 ? null : valid.Sum(item => item.Tasks),
      valid.Count == 0 ? null : valid.Sum(item => item.Subagents),
      Math.Max(issue.CommentTotal, issue.CommentBodies.Count),
      pullRequests.Sum(mention => mention.Reviews),
      pullRequests.Count);
  }

  /// <summary>Reads the newest updated issues with their comments and the pull requests that mention them, with the GitHub CLI.</summary>
  /// <param name="repository"><c>owner/name</c>.</param>
  /// <param name="count">How many issues, at most 100.</param>
  /// <returns>The issues, most recently updated first.</returns>
  public static async Task<IReadOnlyList<IssueInput>> CollectAsync(string repository, int count)
  {
    var parts = repository.Split('/');
    var json = await Gh.RunAsync(
    [
      "api", "graphql",
      "-f", $"query={Query}",
      "-f", $"owner={parts[0]}",
      "-f", $"name={parts[1]}",
      "-F", string.Create(CultureInfo.InvariantCulture, $"count={Math.Clamp(count, 1, 100)}"),
    ]);
    return AgentParser.ParseIssues(json, repository);
  }

  private const string Query = """
    query($owner: String!, $name: String!, $count: Int!) {
      repository(owner: $owner, name: $name) {
        issues(first: $count, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number
            updatedAt
            comments(first: 100) { totalCount nodes { body } }
            timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT]) {
              nodes {
                ... on CrossReferencedEvent {
                  source { ... on PullRequest { number reviews { totalCount } repository { nameWithOwner } } }
                }
              }
            }
          }
        }
      }
    }
    """;
}

/// <summary>Reads the GraphQL answer, tolerating missing fields.</summary>
public static class AgentParser
{
  /// <summary>Parses the answer of the query in <see cref="AgentCollector"/>.</summary>
  /// <param name="json">The JSON answer.</param>
  /// <param name="repository"><c>owner/name</c>; pull requests of other repositories are not counted.</param>
  /// <returns>The issues with a number and an update time; others are skipped.</returns>
  public static IReadOnlyList<IssueInput> ParseIssues(string json, string repository)
  {
    using var document = JsonDocument.Parse(json);
    List<IssueInput> issues = [];
    foreach (JsonElement node in Nodes(Path(document.RootElement, "data", "repository", "issues")))
    {
      var issueNumber = Number(node, "number");
      if (issueNumber is null || !node.TryGetProperty("updatedAt", out JsonElement updated)
        || !updated.TryGetDateTimeOffset(out DateTimeOffset updatedAt))
      {
        continue;
      }
      JsonElement comments = Path(node, "comments");
      List<string> bodies = [.. Nodes(comments).Select(item => Text(item, "body"))];
      List<PullRequestMention> mentions = [];
      foreach (JsonElement item in Nodes(Path(node, "timelineItems")))
      {
        JsonElement source = Path(item, "source");
        var prNumber = Number(source, "number");
        var origin = Text(Path(source, "repository"), "nameWithOwner");
        var sameRepository = string.Equals(origin, repository, StringComparison.OrdinalIgnoreCase);
        if (prNumber is not null && sameRepository)
        {
          mentions.Add(new PullRequestMention(prNumber.Value, Number(Path(source, "reviews"), "totalCount") ?? 0));
        }
      }
      issues.Add(new IssueInput(issueNumber.Value, updatedAt, Number(comments, "totalCount") ?? 0, bodies, mentions));
    }
    return issues;
  }

  private static int? Number(JsonElement element, string name) =>
    element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out JsonElement value) && value.TryGetInt32(out var number)
      ? number
      : null;

  private static JsonElement Path(JsonElement element, params string[] names)
  {
    foreach (var name in names)
    {
      if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out element))
      {
        return default;
      }
    }
    return element;
  }

  private static IEnumerable<JsonElement> Nodes(JsonElement connection)
  {
    JsonElement nodes = Path(connection, "nodes");
    return nodes.ValueKind == JsonValueKind.Array ? nodes.EnumerateArray().Where(node => node.ValueKind == JsonValueKind.Object) : [];
  }

  private static string Text(JsonElement element, string name)
  {
    JsonElement value = Path(element, name);
    return value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : string.Empty;
  }
}

/// <summary>Writes the agent section.</summary>
public static class AgentsJson
{
  /// <summary>Writes the section as the value of the current property.</summary>
  /// <param name="writer">The writer, positioned after the property name.</param>
  /// <param name="agents">The section.</param>
  public static void Write(Utf8JsonWriter writer, AgentsSection agents)
  {
    writer.WriteStartObject();
    writer.WriteStartObject("basis");
    writer.WriteString("activity", agents.Basis.Activity);
    writer.WriteString("counts", agents.Basis.Counts);
    writer.WriteEndObject();
    writer.WriteStartObject("sample");
    writer.WriteNumber("scanned", agents.Sample.Scanned);
    if (agents.Sample.Window is null)
    {
      writer.WriteNull("window");
    }
    else
    {
      writer.WriteStartObject("window");
      writer.WriteString("from", Time(agents.Sample.Window.From));
      writer.WriteString("to", Time(agents.Sample.Window.To));
      writer.WriteEndObject();
    }
    writer.WriteEndObject();
    writer.WriteStartObject("activity");
    writer.WriteNumber("issues", agents.Activity.Issues);
    writer.WriteNumber("withCounts", agents.Activity.WithCounts);
    writer.WriteNumber("comments", agents.Activity.Comments);
    writer.WriteNumber("reviews", agents.Activity.Reviews);
    writer.WriteNumber("pullRequests", agents.Activity.PullRequests);
    writer.WriteEndObject();
    writer.WriteStartObject("counts");
    writer.WriteNumber("countComments", agents.Counts.CountComments);
    writer.WriteNumber("malformed", agents.Counts.Malformed);
    writer.WriteNumber("tasks", agents.Counts.Tasks);
    writer.WriteNumber("subagents", agents.Counts.Subagents);
    writer.WriteEndObject();
    writer.WriteStartArray("issues");
    foreach (AgentIssue issue in agents.Issues)
    {
      writer.WriteStartObject();
      writer.WriteNumber("issue", issue.Issue);
      writer.WriteNumber("countComments", issue.CountComments);
      writer.WriteNumber("malformed", issue.Malformed);
      NumberOrNull(writer, "tasks", issue.Tasks);
      NumberOrNull(writer, "subagents", issue.Subagents);
      writer.WriteNumber("comments", issue.Comments);
      writer.WriteNumber("reviews", issue.Reviews);
      writer.WriteNumber("pullRequests", issue.PullRequests);
      writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
  }

  private static void NumberOrNull(Utf8JsonWriter writer, string name, int? value)
  {
    if (value is null)
    {
      writer.WriteNull(name);
    }
    else
    {
      writer.WriteNumber(name, value.Value);
    }
  }

  private static string Time(DateTimeOffset time) =>
    time.ToUniversalTime().ToString(SnapshotJson.TimeFormat, CultureInfo.InvariantCulture);
}
