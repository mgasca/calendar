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
/// <param name="ChangedAt">When it reached that state: merged_at, closed_at or created_at.</param>
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

/// <summary>Reads the JSON that <c>gh api --paginate --slurp</c> returns for the timeline, comment and review endpoints.</summary>
public static class Parser
{
  private const string Body = "body";
  private const string CreatedAt = "created_at";
  private const string HtmlUrl = "html_url";
  private const string MergedAt = "merged_at";
  private const string Number = "number";

  /// <summary>Author associations whose PRs count as delivery PRs without --pr.</summary>
  private static readonly HashSet<string> TrustedAuthors = new(["OWNER", "MEMBER", "COLLABORATOR"], StringComparer.Ordinal);

  /// <summary>
  /// The delivery PRs in an issue's timeline: PRs that cross-reference it with a keyword in their body, opened by the owner, a
  /// member or a collaborator. Anyone can open a PR that says <c>Refs #N</c>; such a PR is watched only when named with --pr.
  /// </summary>
  /// <param name="issue">The watched issue.</param>
  /// <param name="json">The slurped pages of <c>GET /repos/{owner}/{repo}/issues/{issue}/timeline</c>.</param>
  /// <returns>One entry per PR, by number, with its current state.</returns>
  public static IReadOnlyList<PullRequest> DeliveryPullRequests(int issue, string json)
  {
    IReadOnlyList<PullRequest> found = ReadPages(json, timelineEvent =>
    {
      if (!string.Equals(Text(timelineEvent, "event"), "cross-referenced", StringComparison.Ordinal)
        || !timelineEvent.TryGetProperty("source", out JsonElement source)
        || !source.TryGetProperty("issue", out JsonElement referrer)
        || !referrer.TryGetProperty("pull_request", out JsonElement pullRequest)
        || pullRequest.ValueKind != JsonValueKind.Object
        || !TrustedAuthors.Contains(Text(referrer, "author_association"))
        || !References.Names(Text(referrer, Body), issue))
      {
        return null;
      }
      return ToPullRequest(referrer, Time(pullRequest, MergedAt));
    });
    return [.. found.GroupBy(static pr => pr.Number).Select(static group => group.Last()).OrderBy(static pr => pr.Number)];
  }

  /// <summary>Parses <c>GET /repos/{owner}/{repo}/pulls/{number}</c>, for a PR named with <c>--pr</c>.</summary>
  /// <param name="json">The PR object.</param>
  /// <returns>The PR with its current state.</returns>
  public static PullRequest ParsePullRequest(string json)
  {
    using var document = JsonDocument.Parse(json);
    return ToPullRequest(document.RootElement, Time(document.RootElement, MergedAt));
  }

  /// <summary>Parses issue comments: those of the issue itself, or the conversation comments of a PR.</summary>
  /// <param name="number">The issue or PR the comments belong to.</param>
  /// <param name="kind"><see cref="Kinds.IssueComment"/> or <see cref="Kinds.PrComment"/>.</param>
  /// <param name="json">The slurped pages of <c>GET /repos/{owner}/{repo}/issues/{number}/comments</c>.</param>
  /// <returns>Every comment.</returns>
  public static IReadOnlyList<WatchItem> ParseComments(int number, string kind, string json) =>
    ReadPages(json, comment => Item(kind, number, comment, CreatedAt));

  /// <summary>Parses the inline review comments of a PR.</summary>
  /// <param name="number">The PR.</param>
  /// <param name="json">The slurped pages of <c>GET /repos/{owner}/{repo}/pulls/{number}/comments</c>.</param>
  /// <returns>Every inline comment, with its location and the comment it answers.</returns>
  public static IReadOnlyList<WatchItem> ParseReviewComments(int number, string json) =>
    ReadPages(json, comment =>
    {
      WatchItem? item = Item(Kinds.ReviewComment, number, comment, CreatedAt);
      if (item is null)
      {
        return null;
      }
      var path = Text(comment, "path");
      var line = Long(comment, "line") ?? Long(comment, "original_line");
      return item with
      {
        Location = line is null ? path : string.Create(CultureInfo.InvariantCulture, $"{path}:{line}"),
        ReplyTo = Long(comment, "in_reply_to_id"),
      };
    });

  /// <summary>Parses the reviews of a PR, leaving out pending reviews and empty review wrappers.</summary>
  /// <remarks>
  /// GitHub wraps inline comments in a COMMENTED review with an empty body; the comments are listed on their own, so the
  /// wrapper is skipped. An approval or change request with an empty body is kept, because its state is the message.
  /// </remarks>
  /// <param name="number">The PR.</param>
  /// <param name="json">The slurped pages of <c>GET /repos/{owner}/{repo}/pulls/{number}/reviews</c>.</param>
  /// <returns>The submitted reviews that say something.</returns>
  public static IReadOnlyList<WatchItem> ParseReviews(int number, string json) =>
    ReadPages(json, review =>
    {
      var state = Text(review, "state");
      var emptyWrapper = string.Equals(state, "COMMENTED", StringComparison.Ordinal) && string.IsNullOrWhiteSpace(Text(review, Body));
      if (emptyWrapper || string.Equals(state, "PENDING", StringComparison.Ordinal))
      {
        return null;
      }
      return Item(Kinds.Review, number, review, "submitted_at") is { } item ? item with { ReviewState = state } : null;
    });

  /// <summary>Flattens <c>--paginate --slurp</c> output (an array of pages) into its elements; a single page also works.</summary>
  /// <typeparam name="T">The record each element maps to.</typeparam>
  /// <param name="json">An array of arrays, or one array.</param>
  /// <param name="map">Maps an element, or returns null to leave it out.</param>
  /// <returns>The mapped elements in page order.</returns>
  public static IReadOnlyList<T> ReadPages<T>(string json, Func<JsonElement, T?> map)
    where T : class
  {
    using var document = JsonDocument.Parse(json);
    var items = new List<T>();
    foreach (JsonElement page in document.RootElement.EnumerateArray())
    {
      if (page.ValueKind == JsonValueKind.Array)
      {
        items.AddRange(page.EnumerateArray().Select(map).OfType<T>());
      }
      else if (map(page) is { } item)
      {
        items.Add(item);
      }
    }
    return items;
  }

  private static WatchItem? Item(string kind, int number, JsonElement element, string timeProperty)
  {
    if (Long(element, "id") is not { } id || Time(element, timeProperty) is not { } at)
    {
      return null;
    }
    var hasUser = element.TryGetProperty("user", out JsonElement user) && user.ValueKind == JsonValueKind.Object;
    return new WatchItem(
      kind,
      id.ToString(CultureInfo.InvariantCulture),
      number,
      hasUser ? Text(user, "login") : string.Empty,
      hasUser && string.Equals(Text(user, "type"), "Bot", StringComparison.Ordinal),
      at,
      Text(element, HtmlUrl),
      Text(element, Body));
  }

  private static PullRequest ToPullRequest(JsonElement pullRequest, DateTimeOffset? mergedAt)
  {
    var number = pullRequest.GetProperty(Number).GetInt32();
    DateTimeOffset created = Time(pullRequest, CreatedAt) ?? DateTimeOffset.MinValue;
    var author = pullRequest.TryGetProperty("user", out JsonElement user) && user.ValueKind == JsonValueKind.Object
      ? Text(user, "login")
      : string.Empty;
    var url = Text(pullRequest, HtmlUrl);
    if (mergedAt is { } merged)
    {
      return new PullRequest(number, "merged", merged, url) { Author = author };
    }
    return string.Equals(Text(pullRequest, "state"), "closed", StringComparison.Ordinal)
      ? new PullRequest(number, "closed", Time(pullRequest, "closed_at") ?? created, url) { Author = author }
      : new PullRequest(number, "open", created, url) { Author = author };
  }

  private static string Text(JsonElement element, string property) =>
    element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.String
      ? value.GetString() ?? string.Empty
      : string.Empty;

  private static long? Long(JsonElement element, string property) =>
    element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number)
      ? number
      : null;

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

  /// <summary>At most this many gh processes run at once, so a watch of many PRs stays polite to the API.</summary>
  private static readonly SemaphoreSlim Slots = new(6);

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

  /// <summary>Every page of a list endpoint of this repository, as one slurped JSON array of pages.</summary>
  /// <param name="workingDirectory">A directory of the checkout, so gh resolves <c>{owner}/{repo}</c> from its remote.</param>
  /// <param name="path">The endpoint below <c>repos/{owner}/{repo}/</c>, for example <c>issues/320/comments</c>.</param>
  /// <returns>The JSON.</returns>
  public static Task<string> PagesAsync(string workingDirectory, string path) =>
    RunAsync(["api", $"repos/{{owner}}/{{repo}}/{path}?per_page=100", "--paginate", "--slurp"], workingDirectory);

  /// <summary>One object endpoint of this repository.</summary>
  /// <param name="workingDirectory">A directory of the checkout, so gh resolves <c>{owner}/{repo}</c> from its remote.</param>
  /// <param name="path">The endpoint below <c>repos/{owner}/{repo}/</c>, for example <c>pulls/361</c>.</param>
  /// <returns>The JSON.</returns>
  public static Task<string> ObjectAsync(string workingDirectory, string path) =>
    RunAsync(["api", $"repos/{{owner}}/{{repo}}/{path}"], workingDirectory);

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
      throw new InvalidOperationException($"gh {string.Join(' ', arguments)} failed ({result.ExitCode}): {result.Error.Trim()}");
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
    await Slots.WaitAsync();
    try
    {
      using Process process = Process.Start(start) ?? throw new InvalidOperationException("gh did not start");
      Task<string> output = process.StandardOutput.ReadToEndAsync();
      Task<string> error = process.StandardError.ReadToEndAsync();
      await process.WaitForExitAsync();
      return (process.ExitCode, await output, await error);
    }
    finally
    {
      Slots.Release();
    }
  }
}
