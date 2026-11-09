using System.Globalization;
using System.Text.Json;

namespace DeliveryDashboard;

/// <summary>Writes the flow section as JSON in a fixed property order.</summary>
public static class FlowJson
{
  /// <summary>Writes the section's value (the property name is written by the caller).</summary>
  /// <param name="writer">The writer.</param>
  /// <param name="flow">The section.</param>
  public static void Write(Utf8JsonWriter writer, FlowSection flow)
  {
    writer.WriteStartObject();
    writer.WriteString("basis", flow.Basis);
    writer.WriteNumber("minSample", FlowMetrics.MinSample);
    writer.WriteStartObject("window");
    writer.WriteString("from", Time(flow.Window.From));
    writer.WriteString("to", Time(flow.Window.To));
    writer.WriteEndObject();
    writer.WriteStartObject("openPullRequests");
    writer.WriteNumber("count", flow.Open.Count);
    writer.WriteNumber("drafts", flow.Open.Drafts);
    Distribution(writer, "age", flow.Open.Age);
    writer.WriteEndObject();
    writer.WriteStartObject("waitingForReview");
    writer.WriteNumber("count", flow.Waiting.Count);
    if (flow.Waiting.OldestSeconds is { } oldest)
    {
      writer.WriteNumber("oldestSeconds", oldest);
    }
    else
    {
      writer.WriteNull("oldestSeconds");
    }
    writer.WriteEndObject();
    Duration(writer, "leadTime", flow.LeadTime);
    Duration(writer, "issueToMerge", flow.IssueToMerge);
    writer.WriteStartObject("stacks");
    writer.WriteNumber("mergedIntoBase", flow.Stacks.MergedIntoBase);
    writer.WriteStartArray("open");
    foreach (StackInfo stack in flow.Stacks.Stacks)
    {
      writer.WriteStartObject();
      writer.WriteNumber("depth", stack.Depth);
      writer.WriteStartArray("pullRequests");
      foreach (var number in stack.PullRequests)
      {
        writer.WriteNumberValue(number);
      }
      writer.WriteEndArray();
      writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
    writer.WriteStartArray("epics");
    foreach (EpicProgress epic in flow.Epics)
    {
      writer.WriteStartObject();
      writer.WriteNumber("issue", epic.Issue);
      writer.WriteNumber("total", epic.Total);
      writer.WriteNumber("done", epic.Done);
      writer.WriteEndObject();
    }
    writer.WriteEndArray();
    writer.WriteEndObject();
  }

  private static void Duration(Utf8JsonWriter writer, string name, DurationSection section)
  {
    writer.WriteStartObject(name);
    writer.WriteNumber("sample", section.Sample);
    Distribution(writer, "stat", section.Stat);
    writer.WriteEndObject();
  }

  private static void Distribution(Utf8JsonWriter writer, string name, Distribution? stat)
  {
    if (stat is null)
    {
      writer.WriteNull(name);
      return;
    }
    writer.WriteStartObject(name);
    writer.WriteNumber("count", stat.Count);
    writer.WriteNumber("medianSeconds", stat.MedianSeconds);
    writer.WriteNumber("p90Seconds", stat.P90Seconds);
    writer.WriteNumber("maxSeconds", stat.MaxSeconds);
    writer.WriteEndObject();
  }

  private static string Time(DateTimeOffset time) =>
    time.ToUniversalTime().ToString(SnapshotJson.TimeFormat, CultureInfo.InvariantCulture);
}

/// <summary>The schema rules of the flow section; the privacy scan of <see cref="SnapshotRules"/> covers every string in it.</summary>
public static partial class SnapshotRules
{
  private static readonly string[] FlowKeys =
    ["basis", "minSample", "window", "openPullRequests", "waitingForReview", "leadTime", "issueToMerge", "stacks", "epics"];

  private static readonly string[] FlowOpenKeys = ["count", "drafts", "age"];
  private static readonly string[] FlowWaitingKeys = ["count", "oldestSeconds"];
  private static readonly string[] FlowDurationKeys = ["sample", "stat"];
  private static readonly string[] FlowStatKeys = ["count", "medianSeconds", "p90Seconds", "maxSeconds"];
  private static readonly string[] FlowStacksKeys = ["mergedIntoBase", "open"];
  private static readonly string[] FlowStackKeys = ["depth", "pullRequests"];
  private static readonly string[] FlowEpicKeys = ["issue", "total", "done"];

  private static void CheckFlow(JsonElement flow, List<string> errors)
  {
    if (!Keys(flow, "$.flow", FlowKeys, errors))
    {
      return;
    }
    OneOf(flow.GetProperty("basis"), "$.flow.basis", Bases, errors);
    var minSample = Count(flow.GetProperty("minSample"), "$.flow.minSample", 1, errors);
    JsonElement window = flow.GetProperty("window");
    if (Keys(window, "$.flow.window", WindowKeys, errors))
    {
      Time(window.GetProperty("from"), "$.flow.window.from", errors);
      Time(window.GetProperty("to"), "$.flow.window.to", errors);
    }
    JsonElement open = flow.GetProperty("openPullRequests");
    if (Keys(open, "$.flow.openPullRequests", FlowOpenKeys, errors))
    {
      var count = Count(open.GetProperty("count"), "$.flow.openPullRequests.count", 0, errors);
      var drafts = Count(open.GetProperty("drafts"), "$.flow.openPullRequests.drafts", 0, errors);
      if (drafts > count)
      {
        errors.Add("$.flow.openPullRequests.drafts: must not exceed count");
      }
      FlowStat(open.GetProperty("age"), "$.flow.openPullRequests.age", count, minSample, errors);
    }
    JsonElement waiting = flow.GetProperty("waitingForReview");
    if (Keys(waiting, "$.flow.waitingForReview", FlowWaitingKeys, errors))
    {
      var count = Count(waiting.GetProperty("count"), "$.flow.waitingForReview.count", 0, errors);
      JsonElement oldest = waiting.GetProperty("oldestSeconds");
      if (oldest.ValueKind == JsonValueKind.Null)
      {
        if (count > 0)
        {
          errors.Add("$.flow.waitingForReview.oldestSeconds: must be set when count is above 0");
        }
      }
      else
      {
        Seconds(oldest, "$.flow.waitingForReview.oldestSeconds", errors);
      }
    }
    foreach (var name in new[] { "leadTime", "issueToMerge" })
    {
      JsonElement section = flow.GetProperty(name);
      if (Keys(section, $"$.flow.{name}", FlowDurationKeys, errors))
      {
        var sample = Count(section.GetProperty("sample"), $"$.flow.{name}.sample", 0, errors);
        FlowStat(section.GetProperty("stat"), $"$.flow.{name}.stat", sample, minSample, errors);
      }
    }
    CheckFlowStacks(flow.GetProperty("stacks"), errors);
    CheckFlowEpics(flow.GetProperty("epics"), errors);
  }

  /// <summary>A distribution is present exactly when the sample reaches the minimum, so a thin sample is never shown as a rate.</summary>
  private static void FlowStat(JsonElement stat, string path, int sample, int minSample, List<string> errors)
  {
    if (stat.ValueKind == JsonValueKind.Null)
    {
      if (sample >= minSample)
      {
        errors.Add($"{path}: must be set when the sample reaches {minSample}");
      }
      return;
    }
    if (sample < minSample)
    {
      errors.Add($"{path}: must be null while the sample is below {minSample} (inconclusive)");
    }
    if (!Keys(stat, path, FlowStatKeys, errors))
    {
      return;
    }
    if (Count(stat.GetProperty("count"), $"{path}.count", 1, errors) != sample)
    {
      errors.Add($"{path}.count: must equal the sample");
    }
    var values = FlowStatKeys.Skip(1).Select(key => Seconds(stat.GetProperty(key), $"{path}.{key}", errors)).ToArray();
    if (values.All(value => value is not null) && !IsAscending(values!))
    {
      errors.Add($"{path}: medianSeconds <= p90Seconds <= maxSeconds must hold");
    }
  }

  private static void CheckFlowStacks(JsonElement stacks, List<string> errors)
  {
    if (!Keys(stacks, "$.flow.stacks", FlowStacksKeys, errors))
    {
      return;
    }
    Count(stacks.GetProperty("mergedIntoBase"), "$.flow.stacks.mergedIntoBase", 0, errors);
    JsonElement open = stacks.GetProperty("open");
    if (open.ValueKind != JsonValueKind.Array)
    {
      errors.Add("$.flow.stacks.open: must be an array");
      return;
    }
    var index = 0;
    foreach (JsonElement stack in open.EnumerateArray())
    {
      var path = $"$.flow.stacks.open[{index}]";
      index++;
      if (!Keys(stack, path, FlowStackKeys, errors))
      {
        continue;
      }
      var depth = Count(stack.GetProperty("depth"), $"{path}.depth", 2, errors);
      JsonElement numbers = stack.GetProperty("pullRequests");
      if (numbers.ValueKind != JsonValueKind.Array || numbers.GetArrayLength() < depth || numbers.GetArrayLength() < 2)
      {
        errors.Add($"{path}.pullRequests: must be an array of at least depth pull request numbers");
        continue;
      }
      foreach (JsonElement number in numbers.EnumerateArray())
      {
        Count(number, $"{path}.pullRequests[]", 1, errors);
      }
    }
  }

  private static void CheckFlowEpics(JsonElement epics, List<string> errors)
  {
    if (epics.ValueKind != JsonValueKind.Array)
    {
      errors.Add("$.flow.epics: must be an array");
      return;
    }
    var index = 0;
    foreach (JsonElement epic in epics.EnumerateArray())
    {
      var path = $"$.flow.epics[{index}]";
      index++;
      if (!Keys(epic, path, FlowEpicKeys, errors))
      {
        continue;
      }
      Count(epic.GetProperty("issue"), $"{path}.issue", 1, errors);
      var total = Count(epic.GetProperty("total"), $"{path}.total", 0, errors);
      if (Count(epic.GetProperty("done"), $"{path}.done", 0, errors) > total)
      {
        errors.Add($"{path}.done: must not exceed total");
      }
    }
  }
}
