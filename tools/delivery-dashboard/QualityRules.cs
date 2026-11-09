using System.Text.Json;

namespace DeliveryDashboard;

/// <summary>The checks of the optional <c>quality</c> section (story 0053, issue #599).</summary>
public static partial class SnapshotRules
{
  private static readonly string[] QualityKeys = ["workflow", "basis", "sample", "rule", "guard", "scopes"];
  private static readonly string[] QualityBasisKeys = ["runs", "superseded", "jobs", "guards"];
  private static readonly string[] QualitySampleKeys = ["runs", "ignoredRuns", "window"];
  private static readonly string[] QualityRuleKeys = ["confidence", "minTrials"];
  private static readonly string[] QualityGuardKeys = ["job", "step"];
  private static readonly string[] QualityScopeKeys =
    ["scope", "listQuery", "runs", "failedRunIds", "rerunRunIds", "jobs", "guardDays"];
  private static readonly string[] QualityRunKeys =
    ["total", "passed", "passedAfterRerun", "failed", "cancelled", "superseded", "other", "reruns"];
  private static readonly string[] QualityRateKeys = ["job", "required", "trials", "failures", "verdict", "rate", "low", "high"];
  private static readonly string[] QualityIntervalKeys = ["rate", "low", "high"];
  private static readonly string[] QualityGuardDayKeys = ["date", "trials", "failures"];
  private static readonly string[] QualityVerdicts = [QualityRates.Conclusive, QualityRates.Inconclusive];
  private static readonly string[] QualityScopes = [QualityCollector.Main, QualityCollector.PullRequest];

  private static void CheckQuality(JsonElement quality, List<string> errors)
  {
    const string Root = "$.quality";
    if (!Keys(quality, Root, QualityKeys, errors))
    {
      return;
    }
    Text(quality.GetProperty("workflow"), $"{Root}.workflow", WorkflowFile, "a workflow file name", errors);
    JsonElement basis = quality.GetProperty("basis");
    if (Keys(basis, $"{Root}.basis", QualityBasisKeys, errors))
    {
      foreach (var key in QualityBasisKeys)
      {
        OneOf(basis.GetProperty(key), $"{Root}.basis.{key}", Bases, errors);
      }
    }
    CheckQualitySample(quality.GetProperty("sample"), errors);
    var minTrials = CheckQualityRule(quality.GetProperty("rule"), errors);
    JsonElement guard = quality.GetProperty("guard");
    if (Keys(guard, $"{Root}.guard", QualityGuardKeys, errors))
    {
      Name(guard.GetProperty("job"), $"{Root}.guard.job", errors);
      Name(guard.GetProperty("step"), $"{Root}.guard.step", errors);
    }
    JsonElement scopes = quality.GetProperty("scopes");
    if (scopes.ValueKind != JsonValueKind.Array)
    {
      errors.Add($"{Root}.scopes: must be an array");
      return;
    }
    var index = 0;
    foreach (JsonElement scope in scopes.EnumerateArray())
    {
      CheckQualityScope(scope, $"{Root}.scopes[{index}]", minTrials, errors);
      index++;
    }
  }

  private static void CheckQualitySample(JsonElement sample, List<string> errors)
  {
    if (!Keys(sample, "$.quality.sample", QualitySampleKeys, errors))
    {
      return;
    }
    var runs = Count(sample.GetProperty("runs"), "$.quality.sample.runs", 0, errors);
    Count(sample.GetProperty("ignoredRuns"), "$.quality.sample.ignoredRuns", 0, errors);
    JsonElement window = sample.GetProperty("window");
    if (window.ValueKind == JsonValueKind.Null)
    {
      if (runs > 0)
      {
        errors.Add("$.quality.sample.window: must be set when runs is above 0");
      }
    }
    else if (Keys(window, "$.quality.sample.window", WindowKeys, errors))
    {
      Time(window.GetProperty("from"), "$.quality.sample.window.from", errors);
      Time(window.GetProperty("to"), "$.quality.sample.window.to", errors);
    }
  }

  private static int CheckQualityRule(JsonElement rule, List<string> errors)
  {
    if (!Keys(rule, "$.quality.rule", QualityRuleKeys, errors))
    {
      return int.MaxValue;
    }
    JsonElement confidence = rule.GetProperty("confidence");
    if (confidence.ValueKind != JsonValueKind.Number || !confidence.TryGetDouble(out var level) || level <= 0 || level >= 1)
    {
      errors.Add("$.quality.rule.confidence: must be a number above 0 and below 1");
    }
    return Math.Max(1, Count(rule.GetProperty("minTrials"), "$.quality.rule.minTrials", 1, errors));
  }

  private static void CheckQualityScope(JsonElement scope, string path, int minTrials, List<string> errors)
  {
    if (!Keys(scope, path, QualityScopeKeys, errors))
    {
      return;
    }
    OneOf(scope.GetProperty("scope"), $"{path}.scope", QualityScopes, errors);
    JsonElement query = scope.GetProperty("listQuery");
    if (query.ValueKind != JsonValueKind.String
      || !QualityCollector.ListQueries.Values.Contains(query.GetString(), StringComparer.Ordinal))
    {
      errors.Add($"{path}.listQuery: must be one of the Actions searches the tool writes");
    }
    CheckQualityRuns(scope.GetProperty("runs"), $"{path}.runs", errors);
    QualityIds(scope.GetProperty("failedRunIds"), $"{path}.failedRunIds", errors);
    QualityIds(scope.GetProperty("rerunRunIds"), $"{path}.rerunRunIds", errors);
    JsonElement jobs = scope.GetProperty("jobs");
    if (jobs.ValueKind != JsonValueKind.Array)
    {
      errors.Add($"{path}.jobs: must be an array");
    }
    else
    {
      var index = 0;
      foreach (JsonElement job in jobs.EnumerateArray())
      {
        CheckQualityRate(job, $"{path}.jobs[{index}]", minTrials, errors);
        index++;
      }
    }
    JsonElement days = scope.GetProperty("guardDays");
    if (days.ValueKind != JsonValueKind.Array)
    {
      errors.Add($"{path}.guardDays: must be an array");
      return;
    }
    var dayIndex = 0;
    foreach (JsonElement day in days.EnumerateArray())
    {
      CheckQualityGuardDay(day, $"{path}.guardDays[{dayIndex}]", errors);
      dayIndex++;
    }
  }

  private static void CheckQualityRuns(JsonElement runs, string path, List<string> errors)
  {
    if (!Keys(runs, path, QualityRunKeys, errors))
    {
      return;
    }
    Dictionary<string, int> values = QualityRunKeys.ToDictionary(
      key => key,
      key => Count(runs.GetProperty(key), $"{path}.{key}", 0, errors));
    var sum = QualityRunKeys.Where(key => key is not ("total" or "reruns")).Sum(key => values[key]);
    if (sum != values["total"])
    {
      errors.Add($"{path}.total: must equal the sum of the run classes ({sum})");
    }
    if (values["reruns"] > values["total"] || values["passedAfterRerun"] > values["reruns"])
    {
      errors.Add($"{path}.reruns: must be at most total and at least passedAfterRerun");
    }
  }

  private static void QualityIds(JsonElement ids, string path, List<string> errors)
  {
    if (ids.ValueKind != JsonValueKind.Array || ids.GetArrayLength() > QualityCollector.MaxRunIds)
    {
      errors.Add($"{path}: must be an array of at most {QualityCollector.MaxRunIds} run ids");
      return;
    }
    var index = 0;
    foreach (JsonElement id in ids.EnumerateArray())
    {
      if (id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var value) || value <= 0)
      {
        errors.Add($"{path}[{index}]: must be a positive whole number");
      }
      index++;
    }
  }

  private static void CheckQualityRate(JsonElement job, string path, int minTrials, List<string> errors)
  {
    if (!Keys(job, path, QualityRateKeys, errors))
    {
      return;
    }
    Name(job.GetProperty("job"), $"{path}.job", errors);
    if (job.GetProperty("required").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
    {
      errors.Add($"{path}.required: must be true or false");
    }
    var trials = Count(job.GetProperty("trials"), $"{path}.trials", 1, errors);
    var failures = Count(job.GetProperty("failures"), $"{path}.failures", 0, errors);
    if (failures > trials)
    {
      errors.Add($"{path}.failures: must be at most trials");
    }
    OneOf(job.GetProperty("verdict"), $"{path}.verdict", QualityVerdicts, errors);
    var inconclusive = trials < minTrials;
    if (job.GetProperty("verdict").ValueKind == JsonValueKind.String
      && string.Equals(job.GetProperty("verdict").GetString(), QualityRates.Inconclusive, StringComparison.Ordinal) != inconclusive)
    {
      errors.Add($"{path}.verdict: must be {(inconclusive ? QualityRates.Inconclusive : QualityRates.Conclusive)} for {trials} trials");
    }
    JsonElement[] numbers = [.. QualityIntervalKeys.Select(key => job.GetProperty(key))];
    if (inconclusive)
    {
      if (numbers.Any(number => number.ValueKind != JsonValueKind.Null))
      {
        errors.Add($"{path}: an inconclusive row must carry no rate and no interval");
      }
      return;
    }
    var values = numbers.Select(number => number.ValueKind == JsonValueKind.Number ? (double?)number.GetDouble() : null).ToArray();
    if (values.Any(value => value is null or < 0 or > 1) || !(values[1] <= values[0] && values[0] <= values[2]))
    {
      errors.Add($"{path}: rate, low and high must be numbers from 0 to 1 with low <= rate <= high");
    }
  }

  private static void CheckQualityGuardDay(JsonElement day, string path, List<string> errors)
  {
    if (!Keys(day, path, QualityGuardDayKeys, errors))
    {
      return;
    }
    Date(day.GetProperty("date"), $"{path}.date", errors);
    var trials = Count(day.GetProperty("trials"), $"{path}.trials", 1, errors);
    if (Count(day.GetProperty("failures"), $"{path}.failures", 0, errors) > trials)
    {
      errors.Add($"{path}.failures: must be at most trials");
    }
  }

  private static void Name(JsonElement element, string path, List<string> errors)
  {
    if (element.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(element.GetString()) || element.GetString()!.Length > 100)
    {
      errors.Add($"{path}: must be a non-empty string of at most 100 characters");
    }
  }
}
