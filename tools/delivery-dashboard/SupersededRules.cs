using System.Globalization;
using System.Text.Json;

namespace DeliveryDashboard;

/// <summary>The checks of the <c>superseded</c> section (story 0053, issue #618), present from schema version 3.</summary>
public static partial class SnapshotRules
{
  private static readonly string[] SupersededKeys = ["basis", "sample", "weeks"];
  private static readonly string[] SupersededBasisKeys = ["detection", "timing"];
  private static readonly string[] SupersededSampleKeys = ["pairs", "ignored", "controlRuns", "cap", "minPairs", "window"];
  private static readonly string[] SupersededWeekKeys =
  [
    "week", "pairs", "waitRuns", "waitMedianSeconds", "waitP90Seconds", "waitMaxSeconds",
    "pushGapMedianSeconds", "controlRuns", "controlWaitMedianSeconds",
  ];

  private static void CheckSuperseded(JsonElement superseded, List<string> errors)
  {
    const string Root = "$.superseded";
    if (superseded.ValueKind == JsonValueKind.Null || !Keys(superseded, Root, SupersededKeys, errors))
    {
      return;
    }
    JsonElement basis = superseded.GetProperty("basis");
    if (Keys(basis, $"{Root}.basis", SupersededBasisKeys, errors))
    {
      foreach (var key in SupersededBasisKeys)
      {
        OneOf(basis.GetProperty(key), $"{Root}.basis.{key}", Bases, errors);
      }
    }
    JsonElement sample = superseded.GetProperty("sample");
    var pairs = 0;
    var controlRuns = 0;
    var cap = 0;
    if (Keys(sample, $"{Root}.sample", SupersededSampleKeys, errors))
    {
      pairs = Count(sample.GetProperty("pairs"), $"{Root}.sample.pairs", 0, errors);
      Count(sample.GetProperty("ignored"), $"{Root}.sample.ignored", 0, errors);
      controlRuns = Count(sample.GetProperty("controlRuns"), $"{Root}.sample.controlRuns", 0, errors);
      cap = Count(sample.GetProperty("cap"), $"{Root}.sample.cap", 1, errors);
      Count(sample.GetProperty("minPairs"), $"{Root}.sample.minPairs", 1, errors);
      JsonElement window = sample.GetProperty("window");
      if (window.ValueKind == JsonValueKind.Null)
      {
        if (pairs > 0)
        {
          errors.Add($"{Root}.sample.window: must be set when pairs is above 0");
        }
      }
      else
      {
        Window(window, $"{Root}.sample.window", errors);
      }
      if (cap > 0 && pairs > cap)
      {
        errors.Add($"{Root}.sample.pairs: cannot exceed sample.cap ({cap})");
      }
    }
    JsonElement weeks = superseded.GetProperty("weeks");
    if (weeks.ValueKind != JsonValueKind.Array)
    {
      errors.Add($"{Root}.weeks: must be an array");
      return;
    }
    var pairSum = 0;
    var controlSum = 0;
    var rows = 0;
    var previous = string.Empty;
    foreach (JsonElement week in weeks.EnumerateArray())
    {
      var path = $"{Root}.weeks[{rows++}]";
      if (!Keys(week, path, SupersededWeekKeys, errors))
      {
        continue;
      }
      var start = CheckSupersededWeek(week, path, errors);
      if (start is not null)
      {
        if (string.CompareOrdinal(start, previous) <= 0)
        {
          errors.Add($"{path}.week: weeks must be listed once, oldest first");
        }
        previous = start;
      }
      pairSum += week.GetProperty("pairs").TryGetInt32(out var pairCount) ? pairCount : 0;
      controlSum += week.GetProperty("controlRuns").TryGetInt32(out var controlCount) ? controlCount : 0;
    }
    if (pairSum != pairs)
    {
      errors.Add($"{Root}.weeks: pairs add up to {pairSum}, but sample.pairs is {pairs}");
    }
    if (controlSum != controlRuns)
    {
      errors.Add($"{Root}.weeks: controlRuns add up to {controlSum}, but sample.controlRuns is {controlRuns}");
    }
  }

  private static string? CheckSupersededWeek(JsonElement week, string path, List<string> errors)
  {
    string? start = null;
    JsonElement date = week.GetProperty("week");
    if (date.ValueKind == JsonValueKind.String
      && DateOnly.TryParseExact(
        date.GetString(), SnapshotJson.DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly day)
      && day.DayOfWeek == DayOfWeek.Monday)
    {
      start = date.GetString();
    }
    else
    {
      errors.Add($"{path}.week: must be the Monday of the week as {SnapshotJson.DateFormat}");
    }
    var pairs = Count(week.GetProperty("pairs"), $"{path}.pairs", 0, errors);
    var waitRuns = Count(week.GetProperty("waitRuns"), $"{path}.waitRuns", 0, errors);
    if (waitRuns > pairs)
    {
      errors.Add($"{path}.waitRuns: cannot exceed pairs ({pairs})");
    }
    var controlRuns = Count(week.GetProperty("controlRuns"), $"{path}.controlRuns", 0, errors);
    List<double?> waits = [];
    foreach (var key in new[] { "waitMedianSeconds", "waitP90Seconds", "waitMaxSeconds" })
    {
      waits.Add(OptionalSeconds(week.GetProperty(key), $"{path}.{key}", waitRuns > 0, "waitRuns", errors));
    }
    if (waits.All(value => value is not null) && !(waits[0] <= waits[1] && waits[1] <= waits[2]))
    {
      errors.Add($"{path}: waitMedianSeconds <= waitP90Seconds <= waitMaxSeconds must hold");
    }
    OptionalSeconds(week.GetProperty("pushGapMedianSeconds"), $"{path}.pushGapMedianSeconds", pairs > 0, "pairs", errors);
    OptionalSeconds(
      week.GetProperty("controlWaitMedianSeconds"), $"{path}.controlWaitMedianSeconds", controlRuns > 0, "controlRuns", errors);
    return start;
  }

  /// <summary>A number of seconds that must be set exactly when <paramref name="required"/>, and null otherwise.</summary>
  private static double? OptionalSeconds(JsonElement element, string path, bool required, string because, List<string> errors)
  {
    if (element.ValueKind == JsonValueKind.Null)
    {
      if (required)
      {
        errors.Add($"{path}: must be set when {because} is above 0");
      }
      return null;
    }
    if (!required)
    {
      errors.Add($"{path}: must be null when {because} is 0");
    }
    return Seconds(element, path, errors);
  }
}
