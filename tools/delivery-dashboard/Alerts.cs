using System.Globalization;
using System.Text;
using System.Text.Json;

namespace DeliveryDashboard;

/// <summary>The thresholds that turn a snapshot into an alert; each is a number on the page that someone should look at.</summary>
/// <param name="WaitingReviewSeconds">The oldest pull request waiting for a first review, in seconds.</param>
/// <param name="LeadTimeMedianSeconds">The median lead time to <c>main</c>, in seconds.</param>
/// <param name="StackDepth">The deepest open stack, in pull requests.</param>
/// <param name="FailureRateLow">A failure rate whose 95 % interval lies wholly above this fraction.</param>
public sealed record AlertThresholds(double WaitingReviewSeconds, double LeadTimeMedianSeconds, int StackDepth, double FailureRateLow)
{
  /// <summary>14 days waiting, a 24 hour median lead time, a stack deeper than 4, a failure rate surely above 10 %.</summary>
  public static AlertThresholds Default { get; } = new(14 * 86400, 24 * 3600, 4, 0.10);
}

/// <summary>One breached threshold, in words for the issue.</summary>
/// <param name="Kind"><c>flow</c> or <c>quality</c>: which issue it belongs to.</param>
/// <param name="Text">What was measured and what the threshold is.</param>
public sealed record Breach(string Kind, string Text);

/// <summary>What to do on GitHub for one kind of alert.</summary>
/// <param name="Kind"><c>flow</c> or <c>quality</c>.</param>
/// <param name="Title">The issue's title.</param>
/// <param name="Issue">0 to create the issue, else the number of the open issue to comment on.</param>
/// <param name="Body">The Markdown to post.</param>
public sealed record AlertAction(string Kind, string Title, int Issue, string Body);

/// <summary>Evaluates a snapshot against the thresholds and decides the GitHub actions; pure, so tests build the snapshots.</summary>
public static class Alerts
{
  /// <summary>The label of the open issue each alert reuses: the one the trend check (ADR-0045) uses.</summary>
  public const string IssueLabel = "performance";

  /// <summary>The title of the one flow issue.</summary>
  public const string FlowTitle = "Delivery dashboard: flow thresholds breached";

  /// <summary>The title of the one quality issue.</summary>
  public const string QualityTitle = "Delivery dashboard: failure-rate thresholds breached on main";

  /// <summary>Finds the breached thresholds in a snapshot; a missing section or an inconclusive number breaches nothing.</summary>
  /// <param name="json">The snapshot's text, already checked by <see cref="SnapshotRules"/>.</param>
  /// <param name="thresholds">The thresholds.</param>
  /// <returns>The breaches, flow first.</returns>
  public static IReadOnlyList<Breach> Evaluate(string json, AlertThresholds thresholds)
  {
    using var document = JsonDocument.Parse(json);
    JsonElement root = document.RootElement;
    List<Breach> breaches = [];
    if (root.TryGetProperty("flow", out JsonElement flow) && flow.ValueKind == JsonValueKind.Object)
    {
      Flow(flow, thresholds, breaches);
    }
    if (root.TryGetProperty("quality", out JsonElement quality) && quality.ValueKind == JsonValueKind.Object)
    {
      Quality(quality, thresholds, breaches);
    }
    return breaches;
  }

  private static void Flow(JsonElement flow, AlertThresholds thresholds, List<Breach> breaches)
  {
    JsonElement oldest = flow.GetProperty("waitingForReview").GetProperty("oldestSeconds");
    if (oldest.ValueKind == JsonValueKind.Number && oldest.GetDouble() > thresholds.WaitingReviewSeconds)
    {
      var waited = Days(oldest.GetDouble());
      breaches.Add(new Breach(
        "flow",
        $"The oldest pull request waiting for a first review has waited {waited} (threshold {Days(thresholds.WaitingReviewSeconds)})."));
    }
    JsonElement lead = flow.GetProperty("leadTime");
    JsonElement stat = lead.GetProperty("stat");
    if (stat.ValueKind == JsonValueKind.Object && stat.GetProperty("medianSeconds").GetDouble() > thresholds.LeadTimeMedianSeconds)
    {
      var median = Hours(stat.GetProperty("medianSeconds").GetDouble());
      var sample = lead.GetProperty("sample").GetInt32();
      breaches.Add(new Breach(
        "flow",
        $"The median lead time to `main` is {median} over {sample} pull requests (threshold {Hours(thresholds.LeadTimeMedianSeconds)})."));
    }
    var deepest = flow.GetProperty("stacks").GetProperty("open").EnumerateArray()
      .Select(stack => stack.GetProperty("depth").GetInt32())
      .DefaultIfEmpty(0)
      .Max();
    if (deepest > thresholds.StackDepth)
    {
      breaches.Add(new Breach("flow", $"The deepest open stack has {deepest} pull requests (threshold {thresholds.StackDepth})."));
    }
  }

  private static void Quality(JsonElement quality, AlertThresholds thresholds, List<Breach> breaches)
  {
    foreach (JsonElement scope in quality.GetProperty("scopes").EnumerateArray())
    {
      if (scope.GetProperty("scope").GetString() != "main")
      {
        continue;
      }
      foreach (JsonElement job in scope.GetProperty("jobs").EnumerateArray())
      {
        if (job.GetProperty("verdict").GetString() != "conclusive" || job.GetProperty("low").ValueKind != JsonValueKind.Number)
        {
          continue;
        }
        var low = job.GetProperty("low").GetDouble();
        if (low > thresholds.FailureRateLow)
        {
          var name = Name(job.GetProperty("job").GetString());
          var rate = Percent(job.GetProperty("rate").GetDouble());
          var trials = job.GetProperty("trials").GetInt32();
          breaches.Add(new Breach(
            "quality",
            $"`{name}` fails {rate} of its {trials} attempts on `main`, and even the low end of the 95 % interval, " +
            $"{Percent(low)}, is above the threshold of {Percent(thresholds.FailureRateLow)}."));
        }
      }
    }
  }

  /// <summary>Decides what to post: per kind with a breach, a comment on the one open issue with that title or a new issue.</summary>
  /// <param name="breaches">The breaches.</param>
  /// <param name="openIssues">Open issues with the label, as (number, title).</param>
  /// <param name="pageUrl">Where the dashboard's pages are published, or an empty string.</param>
  /// <returns>At most one action per kind, so at most one issue is opened or commented on for each.</returns>
  public static IReadOnlyList<AlertAction> Actions(
    IReadOnlyList<Breach> breaches,
    IEnumerable<(int Number, string Title)> openIssues,
    string pageUrl)
  {
    List<(int Number, string Title)> open = [.. openIssues];
    List<AlertAction> actions = [];
    foreach (var kind in new[] { "flow", "quality" })
    {
      List<Breach> ofKind = [.. breaches.Where(breach => breach.Kind == kind)];
      if (ofKind.Count == 0)
      {
        continue;
      }
      var title = kind == "flow" ? FlowTitle : QualityTitle;
      var issue = open
        .Where(item => string.Equals(item.Title, title, StringComparison.Ordinal))
        .Select(item => item.Number)
        .DefaultIfEmpty(0)
        .Min();
      actions.Add(new AlertAction(kind, title, issue, Body(ofKind, pageUrl)));
    }
    return actions;
  }

  private static string Body(IReadOnlyList<Breach> breaches, string pageUrl)
  {
    var text = new StringBuilder();
    text.AppendLine("The daily delivery snapshot crossed a threshold of the delivery dashboard (story 0053, ADR-0049):").AppendLine();
    foreach (Breach breach in breaches)
    {
      text.Append("- ").AppendLine(breach.Text);
    }
    text.AppendLine().Append("Every number is from the latest snapshot, with its sample and window on the dashboard page");
    text.AppendLine(pageUrl.Length == 0 ? "." : $": {pageUrl}");
    text.AppendLine().AppendLine(
      "This issue is the only alert for these thresholds. It is updated while they stay crossed and is closed by a person; " +
      "no other issue is opened.");
    text.AppendLine().AppendLine("Posted by the daily `Dashboard snapshot` workflow (`.github/workflows/dashboard-snapshot.yml`).");
    return text.ToString();
  }

  private static string Name(string? job) => (job ?? "?").Replace('`', '\'');

  private static string Days(double seconds) => $"{(seconds / 86400).ToString("0.#", CultureInfo.InvariantCulture)} days";

  private static string Hours(double seconds) => $"{(seconds / 3600).ToString("0.#", CultureInfo.InvariantCulture)} h";

  private static string Percent(double fraction) => $"{(fraction * 100).ToString("0.#", CultureInfo.InvariantCulture)} %";
}

/// <summary>The size rule of the data branch: keep every daily snapshot until the tree passes a limit, and fail before it does.</summary>
public static class Retention
{
  /// <summary>The limit on the size of <c>snapshots/</c>, in bytes: 50 MB, about 11 years at today's 12 KB a day.</summary>
  public const long LimitBytes = 50L * 1024 * 1024;

  /// <summary>The fraction of the limit at which a warning starts.</summary>
  public const double WarnFraction = 0.8;

  /// <summary>The verdict of a size check.</summary>
  /// <param name="Files">How many snapshot files the tree holds.</param>
  /// <param name="Bytes">Their total size.</param>
  /// <param name="Status"><c>ok</c>, <c>warning</c> or <c>over</c>.</param>
  /// <param name="Message">A sentence for the job summary.</param>
  public sealed record Verdict(int Files, long Bytes, string Status, string Message);

  /// <summary>Sums the size of <c>snapshots/*.json</c> from the output of <c>git ls-tree -r -l</c> and judges it.</summary>
  /// <param name="lsTree">Lines such as <c>100644 blob SHA     12065\tsnapshots/2026-11-09.json</c>.</param>
  /// <param name="limitBytes">The limit.</param>
  /// <param name="incomingBytes">The size of the snapshot about to be added, so the check fails before the limit is passed.</param>
  /// <returns>The verdict.</returns>
  public static Verdict Check(string lsTree, long limitBytes, long incomingBytes = 0)
  {
    var files = 0;
    long bytes = 0;
    foreach (var line in lsTree.Split('\n', StringSplitOptions.RemoveEmptyEntries))
    {
      var tab = line.IndexOf('\t', StringComparison.Ordinal);
      if (tab < 0 || !line[(tab + 1)..].StartsWith("snapshots/", StringComparison.Ordinal))
      {
        continue;
      }
      var fields = line[..tab].Split(' ', StringSplitOptions.RemoveEmptyEntries);
      if (fields.Length == 4 && fields[1] == "blob"
        && long.TryParse(fields[3], NumberStyles.None, CultureInfo.InvariantCulture, out var size))
      {
        files++;
        bytes += size;
      }
    }
    files += incomingBytes > 0 ? 1 : 0;
    bytes += incomingBytes;
    var percent = (100.0 * bytes / limitBytes).ToString("0.#", CultureInfo.InvariantCulture);
    var summary = $"{files} snapshot files, {bytes} bytes: {percent} % of the {limitBytes} byte limit.";
    if (bytes > limitBytes)
    {
      var advice = "Over the limit: thin the data branch as the runbook says before the next snapshot.";
      return new Verdict(files, bytes, "over", $"{summary} {advice}");
    }
    return bytes >= limitBytes * WarnFraction
      ? new Verdict(files, bytes, "warning", $"{summary} Past {WarnFraction * 100:0} % of the limit: plan the thinning in the runbook.")
      : new Verdict(files, bytes, "ok", summary);
  }
}
