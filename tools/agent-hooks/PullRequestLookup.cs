using System.Text.Json;

namespace AgentHooks;

/// <summary>A pull request as <c>gh pr view --json number,state</c> reports it.</summary>
public sealed record PullRequest(int Number, string State)
{
  /// <summary>True when the PR is finished, so a push to its branch reaches nothing.</summary>
  public bool IsMergedOrClosed => State is "MERGED" or "CLOSED";
}

/// <summary>A pull request's base branch and body, as <c>gh pr view --json number,baseRefName,body</c> reports them.</summary>
public sealed record PullRequestText(int Number, string BaseRefName, string Body);

/// <summary>Asks <c>gh</c> for the pull request of a branch; any answer other than a PR is null, so the guard fails open.</summary>
public static class PullRequestLookup
{
  /// <summary>How long gh may take (a call takes about 1.2 s; the hook's own limit is 30 s).</summary>
  public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

  /// <summary>
  /// How long the PR link check's lookup may take: it only reminds, so it gives up sooner (the call took 0.67-0.92 s over
  /// eight runs on 2026-11-06).
  /// </summary>
  public static readonly TimeSpan InformTimeout = TimeSpan.FromSeconds(3);

  private static readonly string[] States = ["OPEN", "MERGED", "CLOSED"];

  private static readonly Dictionary<string, string> Environment = new(StringComparer.Ordinal)
  {
    ["GH_PROMPT_DISABLED"] = "1",
    ["GH_NO_UPDATE_NOTIFIER"] = "1",
  };

  /// <summary>
  /// Runs <c>gh pr view &lt;branch&gt; --json number,state</c> in <paramref name="cwd"/>, so gh resolves the repository from
  /// that checkout's remotes; when a branch has several PRs, gh prefers the open one. Null when there is no PR (gh exits
  /// 1), gh is missing, unauthenticated, offline or slower than <paramref name="timeout"/>, or its output is not a PR.
  /// </summary>
  public static PullRequest? Find(string cwd, string branch, string gh, TimeSpan timeout)
  {
    ExternalCommand.Output? output = ExternalCommand.Run(gh, ["pr", "view", branch, "--json", "number,state"], cwd, timeout, Environment);
    return output is { ExitCode: 0 } ? Parse(output.Stdout) : null;
  }

  /// <summary>
  /// Runs <c>gh pr view [&lt;selector&gt;] [--repo &lt;repo&gt;] --json number,baseRefName,body</c> in <paramref name="cwd"/>;
  /// without a selector gh picks the current branch's PR. Null on the same failures as <see cref="Find"/>.
  /// </summary>
  public static PullRequestText? FindText(string cwd, string? selector, string? repo, string gh, TimeSpan timeout)
  {
    List<string> args = ["pr", "view"];
    if (selector is not null)
    {
      args.Add(selector);
    }
    if (repo is not null)
    {
      args.AddRange(["--repo", repo]);
    }
    args.AddRange(["--json", "number,baseRefName,body"]);
    ExternalCommand.Output? output = ExternalCommand.Run(gh, args, cwd, timeout, Environment);
    return output is { ExitCode: 0 } ? ParseText(output.Stdout) : null;
  }

  /// <summary>The PR's number, base and body in gh's JSON, or null when any of them is missing.</summary>
  public static PullRequestText? ParseText(string json)
  {
    try
    {
      using var doc = JsonDocument.Parse(json);
      JsonElement root = doc.RootElement;
      return root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty("number", out JsonElement number) && number.ValueKind == JsonValueKind.Number
        && number.TryGetInt32(out var value)
        && root.TryGetProperty("baseRefName", out JsonElement baseRef) && baseRef.ValueKind == JsonValueKind.String
        && root.TryGetProperty("body", out JsonElement body) && body.ValueKind == JsonValueKind.String
          ? new PullRequestText(value, baseRef.GetString()!, body.GetString()!)
          : null;
    }
    catch (JsonException)
    {
      return null;
    }
  }

  /// <summary>The PR in gh's JSON, or null when the text is not an object with a number and a known state.</summary>
  public static PullRequest? Parse(string json)
  {
    try
    {
      using var doc = JsonDocument.Parse(json);
      JsonElement root = doc.RootElement;
      return root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty("number", out JsonElement number) && number.ValueKind == JsonValueKind.Number
        && number.TryGetInt32(out var value)
        && root.TryGetProperty("state", out JsonElement state) && state.ValueKind == JsonValueKind.String
        && States.Contains(state.GetString())
          ? new PullRequest(value, state.GetString()!)
          : null;
    }
    catch (JsonException)
    {
      return null;
    }
  }
}
