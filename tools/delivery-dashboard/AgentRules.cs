using System.Text.Json;

namespace DeliveryDashboard;

/// <summary>The checks of the optional <c>agents</c> section (story 0053, issue #600).</summary>
public static partial class SnapshotRules
{
  private static readonly string[] AgentsKeys = ["basis", "sample", "activity", "counts", "issues"];
  private static readonly string[] AgentsBasisKeys = ["activity", "counts"];
  private static readonly string[] AgentsSampleKeys = ["scanned", "window"];
  private static readonly string[] AgentsActivityKeys = ["issues", "withCounts", "comments", "reviews", "pullRequests"];
  private static readonly string[] AgentsCountKeys = ["countComments", "malformed", "tasks", "subagents"];
  private static readonly string[] AgentsIssueKeys =
    ["issue", "countComments", "malformed", "tasks", "subagents", "comments", "reviews", "pullRequests"];

  private static void CheckAgents(JsonElement agents, List<string> errors)
  {
    const string Root = "$.agents";
    if (!Keys(agents, Root, AgentsKeys, errors))
    {
      return;
    }
    JsonElement basis = agents.GetProperty("basis");
    if (Keys(basis, $"{Root}.basis", AgentsBasisKeys, errors))
    {
      foreach (var key in AgentsBasisKeys)
      {
        OneOf(basis.GetProperty(key), $"{Root}.basis.{key}", Bases, errors);
      }
    }
    var scanned = CheckAgentsSample(agents.GetProperty("sample"), errors);
    Dictionary<string, int> activity = AgentNumbers(agents.GetProperty("activity"), $"{Root}.activity", AgentsActivityKeys, errors);
    Dictionary<string, int> counts = AgentNumbers(agents.GetProperty("counts"), $"{Root}.counts", AgentsCountKeys, errors);
    JsonElement issues = agents.GetProperty("issues");
    if (issues.ValueKind != JsonValueKind.Array)
    {
      errors.Add($"{Root}.issues: must be an array");
      return;
    }
    List<Dictionary<string, int>> rows = [];
    HashSet<int> seen = [];
    var index = 0;
    foreach (JsonElement issue in issues.EnumerateArray())
    {
      Dictionary<string, int>? row = CheckAgentsIssue(issue, $"{Root}.issues[{index}]", errors);
      if (row is not null)
      {
        rows.Add(row);
        if (!seen.Add(row["issue"]))
        {
          errors.Add($"{Root}.issues[{index}].issue: must be listed once");
        }
      }
      index++;
    }
    if (issues.GetArrayLength() > scanned)
    {
      errors.Add($"{Root}.issues: cannot hold more issues than sample.scanned ({scanned})");
    }
    if (rows.Count == issues.GetArrayLength() && activity.Count == AgentsActivityKeys.Length && counts.Count == AgentsCountKeys.Length)
    {
      CheckAgentTotals(activity, counts, rows, errors);
    }
  }

  private static int CheckAgentsSample(JsonElement sample, List<string> errors)
  {
    if (!Keys(sample, "$.agents.sample", AgentsSampleKeys, errors))
    {
      return 0;
    }
    var scanned = Count(sample.GetProperty("scanned"), "$.agents.sample.scanned", 0, errors);
    JsonElement window = sample.GetProperty("window");
    if (window.ValueKind == JsonValueKind.Null)
    {
      if (scanned > 0)
      {
        errors.Add("$.agents.sample.window: must be set when scanned is above 0");
      }
    }
    else if (Keys(window, "$.agents.sample.window", WindowKeys, errors))
    {
      Time(window.GetProperty("from"), "$.agents.sample.window.from", errors);
      Time(window.GetProperty("to"), "$.agents.sample.window.to", errors);
    }
    return scanned;
  }

  private static Dictionary<string, int> AgentNumbers(JsonElement element, string path, string[] keys, List<string> errors)
  {
    Dictionary<string, int> values = [];
    if (Keys(element, path, keys, errors))
    {
      foreach (var key in keys)
      {
        values[key] = Count(element.GetProperty(key), $"{path}.{key}", 0, errors);
      }
    }
    return values;
  }

  private static Dictionary<string, int>? CheckAgentsIssue(JsonElement issue, string path, List<string> errors)
  {
    if (!Keys(issue, path, AgentsIssueKeys, errors))
    {
      return null;
    }
    Dictionary<string, int> row = [];
    foreach (var key in AgentsIssueKeys.Where(key => key is not ("tasks" or "subagents")))
    {
      row[key] = Count(issue.GetProperty(key), $"{path}.{key}", key == "issue" ? 1 : 0, errors);
    }
    var hasCounts = row["countComments"] > 0;
    foreach (var key in new[] { "tasks", "subagents" })
    {
      JsonElement value = issue.GetProperty(key);
      if (!hasCounts)
      {
        if (value.ValueKind != JsonValueKind.Null)
        {
          errors.Add($"{path}.{key}: must be null without a count comment");
        }
        row[key] = 0;
      }
      else
      {
        row[key] = Count(value, $"{path}.{key}", 0, errors);
      }
    }
    if (row["comments"] == 0 && row["pullRequests"] == 0)
    {
      errors.Add($"{path}: an issue with no comment and no pull request is not listed");
    }
    return row;
  }

  private static void CheckAgentTotals(
    Dictionary<string, int> activity,
    Dictionary<string, int> counts,
    List<Dictionary<string, int>> rows,
    List<string> errors)
  {
    void Same(string path, int actual, int expected)
    {
      if (actual != expected)
      {
        errors.Add($"{path}: must equal the sum over the listed issues ({expected})");
      }
    }

    Same("$.agents.activity.issues", activity["issues"], rows.Count);
    Same("$.agents.activity.withCounts", activity["withCounts"], rows.Count(row => row["countComments"] > 0));
    Same("$.agents.activity.comments", activity["comments"], rows.Sum(row => row["comments"]));
    Same("$.agents.activity.reviews", activity["reviews"], rows.Sum(row => row["reviews"]));
    Same("$.agents.activity.pullRequests", activity["pullRequests"], rows.Sum(row => row["pullRequests"]));
    foreach (var key in AgentsCountKeys)
    {
      Same($"$.agents.counts.{key}", counts[key], rows.Sum(row => row[key]));
    }
  }
}
