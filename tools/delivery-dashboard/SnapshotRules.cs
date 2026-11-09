using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DeliveryDashboard;

/// <summary>
/// Checks a snapshot file against the schema and the privacy rules of story 0053: the repository is public, so a snapshot
/// holds aggregates and public data only. Every field must be in the schema, and no string may look like a machine path,
/// a session or task handle, a UUID or an e-mail address.
/// </summary>
public static partial class SnapshotRules
{
  private static readonly TimeSpan RegexTimeout = TimeSpan.FromSeconds(1);
  private const RegexOptions Options = RegexOptions.CultureInvariant | RegexOptions.IgnoreCase;

  private static readonly Regex AbsolutePath = new(
    @"(?:^|[\s""'(=])(?:/(?:home|tmp|Users|var|root|etc|mnt|opt|usr)\b|[A-Za-z]:\\)", Options, RegexTimeout);

  private static readonly Regex Handle = new(@"\b(?:session|task|agent|local|subagent)[_-][0-9a-z]{6,}\b", Options, RegexTimeout);

  private static readonly Regex Uuid = new(
    @"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", Options, RegexTimeout);

  private static readonly Regex Email = new(@"[\w.+-]+@[\w-]+\.[\w.-]+", Options, RegexTimeout);
  private static readonly Regex RepositoryName = new(@"^[\w.-]+/[\w.-]+$", Options, RegexTimeout);
  private static readonly Regex WorkflowFile = new(@"^[\w.-]+\.ya?ml$", Options, RegexTimeout);

  private static readonly string[] RootKeys = ["version", "date", "generatedAt", "repository", "ci"];
  // Sections added after version 1: absent from older files, validated when present.
  private static readonly string[] OptionalRootKeys = ["quality", "agents"];
  private static readonly string[] CiKeysV1 = ["workflow", "basis", "runs", "window", "jobs"];
  private static readonly string[] CiKeysV2 = [.. CiKeysV1, "trend", "queue"];
  private static readonly string[] WindowKeys = ["from", "to"];
  private static readonly string[] JobKeysV1 = ["job", "path", "count", "minSeconds", "medianSeconds", "p90Seconds", "maxSeconds"];
  private static readonly string[] JobKeysV2 = [.. JobKeysV1, "baseline", "trend"];
  private static readonly string[] TrendKeys = ["runs", "required", "window"];
  private static readonly string[] QueueKeys = ["runs", "medianSeconds", "p90Seconds", "maxSeconds"];
  private static readonly string[] BaselineKeys = ["count", "medianSeconds", "thresholdSeconds"];
  private static readonly string[] JobTrendKeys =
    ["verdict", "recentRuns", "shiftSeconds", "lowSeconds", "highSeconds", "minEffectSeconds"];
  private static readonly string[] Verdicts = ["noShift", "slower", "faster", "inconclusive"];
  private static readonly string[] Bases = ["measured", "inferred"];
  private static readonly string[] Paths = ["check", "publication"];
  private static readonly string[] SecondKeys = ["minSeconds", "medianSeconds", "p90Seconds", "maxSeconds"];

  /// <summary>Checks a snapshot's JSON text.</summary>
  /// <param name="json">The file's contents.</param>
  /// <returns>One message per problem, each starting with the JSON path of the field; empty when the snapshot is valid.</returns>
  public static IReadOnlyList<string> Validate(string json)
  {
    JsonDocument document;
    try
    {
      document = JsonDocument.Parse(json);
    }
    catch (JsonException error)
    {
      return [$"$: not valid JSON ({error.Message})"];
    }
    using (document)
    {
      List<string> errors = [];
      JsonElement root = document.RootElement;
      Scan(root, "$", errors);
      if (Keys(root, "$", RootKeys, errors, OptionalRootKeys))
      {
        CheckRoot(root, errors);
      }
      return errors;
    }
  }

  private static void CheckRoot(JsonElement root, List<string> errors)
  {
    if (!root.GetProperty("version").TryGetInt32(out var version)
      || version < SnapshotJson.OldestVersion || version > SnapshotJson.CurrentVersion)
    {
      errors.Add($"$.version: must be {SnapshotJson.OldestVersion} to {SnapshotJson.CurrentVersion}");
      return;
    }
    Date(root.GetProperty("date"), "$.date", errors);
    Time(root.GetProperty("generatedAt"), "$.generatedAt", errors);
    Text(root.GetProperty("repository"), "$.repository", RepositoryName, "owner/name", errors);
    JsonElement ci = root.GetProperty("ci");
    var v2 = version >= 2;
    if (Keys(ci, "$.ci", v2 ? CiKeysV2 : CiKeysV1, errors))
    {
      CheckCi(ci, v2, errors);
    }
    if (root.TryGetProperty("quality", out JsonElement quality))
    {
      CheckQuality(quality, errors);
    }
    if (root.TryGetProperty("agents", out JsonElement agents))
    {
      CheckAgents(agents, errors);
    }
  }

  private static void CheckCi(JsonElement ci, bool v2, List<string> errors)
  {
    Text(ci.GetProperty("workflow"), "$.ci.workflow", WorkflowFile, "a workflow file name", errors);
    OneOf(ci.GetProperty("basis"), "$.ci.basis", Bases, errors);
    var runs = Count(ci.GetProperty("runs"), "$.ci.runs", 0, errors);
    JsonElement window = ci.GetProperty("window");
    if (window.ValueKind == JsonValueKind.Null)
    {
      if (runs > 0)
      {
        errors.Add("$.ci.window: must be set when runs is above 0");
      }
    }
    else
    {
      Window(window, "$.ci.window", errors);
    }
    if (v2)
    {
      CheckTrend(ci.GetProperty("trend"), errors);
      CheckQueue(ci.GetProperty("queue"), errors);
    }
    JsonElement jobs = ci.GetProperty("jobs");
    if (jobs.ValueKind != JsonValueKind.Array)
    {
      errors.Add("$.ci.jobs: must be an array");
      return;
    }
    var index = 0;
    foreach (JsonElement job in jobs.EnumerateArray())
    {
      CheckJob(job, $"$.ci.jobs[{index}]", v2, errors);
      index++;
    }
  }

  private static void Window(JsonElement window, string path, List<string> errors)
  {
    if (Keys(window, path, WindowKeys, errors))
    {
      Time(window.GetProperty("from"), $"{path}.from", errors);
      Time(window.GetProperty("to"), $"{path}.to", errors);
    }
  }

  private static void CheckTrend(JsonElement trend, List<string> errors)
  {
    if (trend.ValueKind == JsonValueKind.Null || !Keys(trend, "$.ci.trend", TrendKeys, errors))
    {
      return;
    }
    var runs = Count(trend.GetProperty("runs"), "$.ci.trend.runs", 0, errors);
    Count(trend.GetProperty("required"), "$.ci.trend.required", 1, errors);
    JsonElement window = trend.GetProperty("window");
    if (window.ValueKind == JsonValueKind.Null)
    {
      if (runs > 0)
      {
        errors.Add("$.ci.trend.window: must be set when runs is above 0");
      }
      return;
    }
    Window(window, "$.ci.trend.window", errors);
  }

  private static void CheckQueue(JsonElement queue, List<string> errors)
  {
    if (queue.ValueKind == JsonValueKind.Null || !Keys(queue, "$.ci.queue", QueueKeys, errors))
    {
      return;
    }
    Count(queue.GetProperty("runs"), "$.ci.queue.runs", 1, errors);
    var values = SecondKeys.Skip(1)
      .Select(key => Seconds(queue.GetProperty(key), $"$.ci.queue.{key}", errors))
      .ToArray();
    if (values.All(value => value is not null) && !IsAscending(values!))
    {
      errors.Add("$.ci.queue: medianSeconds <= p90Seconds <= maxSeconds must hold");
    }
  }

  private static void CheckJobBaseline(JsonElement baseline, string path, List<string> errors)
  {
    if (baseline.ValueKind == JsonValueKind.Null || !Keys(baseline, path, BaselineKeys, errors))
    {
      return;
    }
    Count(baseline.GetProperty("count"), $"{path}.count", 1, errors);
    Seconds(baseline.GetProperty("medianSeconds"), $"{path}.medianSeconds", errors);
    Seconds(baseline.GetProperty("thresholdSeconds"), $"{path}.thresholdSeconds", errors);
  }

  private static void CheckJobTrend(JsonElement trend, string path, List<string> errors)
  {
    if (trend.ValueKind == JsonValueKind.Null || !Keys(trend, path, JobTrendKeys, errors))
    {
      return;
    }
    OneOf(trend.GetProperty("verdict"), $"{path}.verdict", Verdicts, errors);
    Count(trend.GetProperty("recentRuns"), $"{path}.recentRuns", 0, errors);
    Seconds(trend.GetProperty("minEffectSeconds"), $"{path}.minEffectSeconds", errors);
    foreach (var key in new[] { "shiftSeconds", "lowSeconds", "highSeconds" })
    {
      if (trend.GetProperty(key).ValueKind != JsonValueKind.Number)
      {
        errors.Add($"{path}.{key}: must be a number of seconds");
      }
    }
  }

  private static void CheckJob(JsonElement job, string path, bool v2, List<string> errors)
  {
    if (!Keys(job, path, v2 ? JobKeysV2 : JobKeysV1, errors))
    {
      return;
    }
    JsonElement name = job.GetProperty("job");
    if (name.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(name.GetString()) || name.GetString()!.Length > 100)
    {
      errors.Add($"{path}.job: must be a non-empty string of at most 100 characters");
    }
    OneOf(job.GetProperty("path"), $"{path}.path", Paths, errors);
    Count(job.GetProperty("count"), $"{path}.count", 1, errors);
    var values = SecondKeys
      .Select(key => Seconds(job.GetProperty(key), $"{path}.{key}", errors))
      .ToArray();
    if (values.All(value => value is not null) && !IsAscending(values!))
    {
      errors.Add($"{path}: minSeconds <= medianSeconds <= p90Seconds <= maxSeconds must hold");
    }
    if (v2)
    {
      CheckJobBaseline(job.GetProperty("baseline"), $"{path}.baseline", errors);
      CheckJobTrend(job.GetProperty("trend"), $"{path}.trend", errors);
    }
  }

  private static bool IsAscending(double?[] values)
  {
    for (var index = 1; index < values.Length; index++)
    {
      if (values[index] < values[index - 1])
      {
        return false;
      }
    }
    return true;
  }

  /// <summary>Walks every property name and string value and reports anything that looks private.</summary>
  private static void Scan(JsonElement element, string path, List<string> errors)
  {
    switch (element.ValueKind)
    {
      case JsonValueKind.Object:
        foreach (JsonProperty property in element.EnumerateObject())
        {
          Private(property.Name, $"{path}.{property.Name} (field name)", errors);
          Scan(property.Value, $"{path}.{property.Name}", errors);
        }
        break;
      case JsonValueKind.Array:
        var index = 0;
        foreach (JsonElement item in element.EnumerateArray())
        {
          Scan(item, $"{path}[{index}]", errors);
          index++;
        }
        break;
      case JsonValueKind.String:
        Private(element.GetString() ?? string.Empty, path, errors);
        break;
      default:
        break;
    }
  }

  private static void Private(string text, string path, List<string> errors)
  {
    if (AbsolutePath.IsMatch(text))
    {
      errors.Add($"{path}: looks like a machine path");
    }
    if (Handle.IsMatch(text))
    {
      errors.Add($"{path}: looks like a session or task handle");
    }
    if (Uuid.IsMatch(text))
    {
      errors.Add($"{path}: looks like a UUID");
    }
    if (Email.IsMatch(text))
    {
      errors.Add($"{path}: looks like an e-mail address");
    }
  }

  /// <summary>Requires an object with exactly the allowed keys; reports the others and the missing ones.</summary>
  private static bool Keys(JsonElement element, string path, string[] allowed, List<string> errors, string[]? optional = null)
  {
    if (element.ValueKind != JsonValueKind.Object)
    {
      errors.Add($"{path}: must be an object");
      return false;
    }
    var present = element.EnumerateObject().Select(property => property.Name).ToList();
    var known = optional is null ? allowed : [.. allowed, .. optional];
    foreach (var extra in present.Where(name => !known.Contains(name, StringComparer.Ordinal)))
    {
      errors.Add($"{path}.{extra}: field is not in the schema");
    }
    var missing = allowed.Where(name => !present.Contains(name, StringComparer.Ordinal)).ToList();
    foreach (var name in missing)
    {
      errors.Add($"{path}.{name}: field is missing");
    }
    return present.All(name => known.Contains(name, StringComparer.Ordinal)) && missing.Count == 0;
  }

  private static void Date(JsonElement element, string path, List<string> errors)
  {
    if (element.ValueKind != JsonValueKind.String
      || !DateOnly.TryParseExact(element.GetString(), SnapshotJson.DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
    {
      errors.Add($"{path}: must be a date as {SnapshotJson.DateFormat}");
    }
  }

  private static void Time(JsonElement element, string path, List<string> errors)
  {
    if (element.ValueKind != JsonValueKind.String
      || !DateTimeOffset.TryParseExact(
        element.GetString(), SnapshotJson.TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _))
    {
      errors.Add($"{path}: must be a UTC time as {SnapshotJson.TimeFormat}");
    }
  }

  private static void Text(JsonElement element, string path, Regex pattern, string description, List<string> errors)
  {
    if (element.ValueKind != JsonValueKind.String || !pattern.IsMatch(element.GetString() ?? string.Empty))
    {
      errors.Add($"{path}: must be {description}");
    }
  }

  private static void OneOf(JsonElement element, string path, string[] allowed, List<string> errors)
  {
    if (element.ValueKind != JsonValueKind.String || !allowed.Contains(element.GetString(), StringComparer.Ordinal))
    {
      errors.Add($"{path}: must be one of {string.Join(", ", allowed)}");
    }
  }

  private static int Count(JsonElement element, string path, int least, List<string> errors)
  {
    if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var value) && value >= least)
    {
      return value;
    }
    errors.Add($"{path}: must be a whole number of at least {least}");
    return 0;
  }

  private static double? Seconds(JsonElement element, string path, List<string> errors)
  {
    if (element.ValueKind == JsonValueKind.Number && element.TryGetDouble(out var value) && value >= 0)
    {
      return value;
    }
    errors.Add($"{path}: must be a number of seconds of at least 0");
    return null;
  }
}
