using System.Text.RegularExpressions;

namespace AgentHooks;

/// <summary>
/// Reminds, never blocks, when a PR to main names no issue it closes or refers to, so its merge would leave the issue open
/// (#274, #275, #276). Claude Code only (ADR-0044): the prose rule in AGENTS.md is what other agents follow.
/// </summary>
public static partial class PullRequestLinkCheck
{
  private const string MainBranch = "main";
  private const string Rule = "Reminder, not a block (AGENTS.md, Stories and issues: the PR that completes an issue carries `Closes #N`)";

  // gh pr create and gh pr edit flags that take the next word as their value; the others are switches.
  private static readonly string[] OptionsWithValue =
  [
    "-B", "--base", "-b", "--body", "-F", "--body-file", "-t", "--title", "-H", "--head", "-R", "--repo", "-T", "--template",
    "-a", "--assignee", "-l", "--label", "-m", "--milestone", "-p", "--project", "-r", "--reviewer", "--recover",
    "--add-assignee", "--add-label", "--add-project", "--add-reviewer", "--remove-assignee", "--remove-label",
    "--remove-project", "--remove-reviewer",
  ];

  /// <summary>The note for the first <c>gh pr create</c> or <c>gh pr edit</c> in the command that needs one, or null.</summary>
  public static string? Describe(string command, string cwd, IRepoProbe probe)
  {
    foreach (ShellCommand.Segment segment in ShellCommand.Split(command, cwd))
    {
      IReadOnlyList<string> tokens = segment.Tokens;
      if (tokens.Count < 3 || tokens[0] != "gh" || tokens[1] != "pr" || tokens[2] is not ("create" or "edit"))
      {
        continue;
      }
      Call call = Parse(tokens);
      var note = tokens[2] == "create" ? Create(call, segment, probe) : Edit(call, segment, probe);
      if (note is not null)
      {
        return note;
      }
    }
    return null;
  }

  /// <summary>The flags of one <c>gh pr</c> call, the last value of each winning as in gh, and its positional words.</summary>
  private sealed record Call(Dictionary<string, string> Options, List<string> Positionals);

  private static Call Parse(IReadOnlyList<string> tokens)
  {
    var options = new Dictionary<string, string>(StringComparer.Ordinal);
    var positionals = new List<string>();
    var i = 3;
    while (i < tokens.Count)
    {
      var token = tokens[i];
      var equals = token.IndexOf('=', StringComparison.Ordinal);
      if (token.StartsWith("--", StringComparison.Ordinal) && equals > 2)
      {
        options[Canonical(token[..equals])] = token[(equals + 1)..];
        i++;
      }
      else if (OptionsWithValue.Contains(token) && i + 1 < tokens.Count)
      {
        options[Canonical(token)] = tokens[i + 1];
        i += 2;
      }
      else
      {
        if (!token.StartsWith('-'))
        {
          positionals.Add(token);
        }
        i++;
      }
    }
    return new Call(options, positionals);
  }

  /// <summary>The long name of a short flag that matters here, so <c>-B</c> and <c>--base</c> are one option.</summary>
  private static string Canonical(string flag) => flag switch
  {
    "-B" => "--base",
    "-b" => "--body",
    "-F" => "--body-file",
    "-R" => "--repo",
    _ => flag,
  };

  /// <summary>The new body the call sets: inline, or the text of its body file; null when it sets none or it cannot be read.</summary>
  private static string? NewBody(Call call, ShellCommand.Segment segment, IRepoProbe probe)
  {
    if (call.Options.TryGetValue("--body", out var inline))
    {
      return inline;
    }
    return call.Options.TryGetValue("--body-file", out var file) ? BashGuard.BodyFile(segment, file, probe) : null;
  }

  private static string? Create(Call call, ShellCommand.Segment segment, IRepoProbe probe)
  {
    var body = NewBody(call, segment, probe);
    if (body is null)
    {
      // --fill, --template, --web, --editor or no body at all: the text is not known before gh runs.
      return null;
    }
    var target = call.Options.GetValueOrDefault("--base") ?? probe.DefaultBranch(segment.Cwd) ?? MainBranch;
    return target == MainBranch ? Missing(body, "this PR targets main", retarget: false) : null;
  }

  private static string? Edit(Call call, ShellCommand.Segment segment, IRepoProbe probe)
  {
    var target = call.Options.GetValueOrDefault("--base");
    var hasNewBody = call.Options.ContainsKey("--body") || call.Options.ContainsKey("--body-file");
    if ((target is not null && target != MainBranch) || (target is null && !hasNewBody))
    {
      return null;
    }
    var body = NewBody(call, segment, probe);
    if (hasNewBody && body is null)
    {
      return null;
    }
    // gh is asked only when the call leaves the base or the body to the PR as it stands.
    PullRequestText? Current() =>
      probe.PullRequestTextFor(segment.Cwd, call.Positionals.FirstOrDefault(), call.Options.GetValueOrDefault("--repo"));
    if (target == MainBranch)
    {
      // A retarget: the body that will stand is the new one, or the PR's current one.
      body ??= Current()?.Body;
      return body is null ? null : Missing(body, "this PR is being retargeted to main", retarget: true);
    }
    PullRequestText? pr = Current();
    return body is not null && pr?.BaseRefName == MainBranch ? Missing(body, $"PR #{pr.Number} targets main", retarget: false) : null;
  }

  /// <summary>
  /// The note when the body lacks the links the case needs: a PR to main needs <c>Closes</c> or <c>Refs</c>; a retarget to
  /// main needs <c>Closes</c>, because the stacked PR that completes an issue gets its <c>Closes</c> then.
  /// </summary>
  private static string? Missing(string body, string subject, bool retarget)
  {
    List<string> closes = Numbers(ClosesRegex(), body);
    List<string> refs = Numbers(RefsRegex(), body);
    if (closes.Count > 0 || (refs.Count > 0 && !retarget))
    {
      return null;
    }
    if (refs.Count > 0)
    {
      return $"{Rule}: {subject} and its body has `Refs {Join(refs)}` but no `Closes #N`. A stacked PR gets its `Closes` when it "
        + "is retargeted to main: if this PR completes an issue, add `Closes #N` to the body now, or the merge leaves it open.";
    }
    List<string> mentioned = [.. Numbers(MentionRegex(), body).Except(closes)];
    var mentions = mentioned.Count > 0 ? $" (it mentions {Join(mentioned)}, which links nothing)" : string.Empty;
    return $"{Rule}: {subject} and its body has neither `Closes #N` nor `Refs #N`{mentions}. If it completes an issue, add "
      + "`Closes #N`; if it delivers part of one, add `Refs #N`; otherwise the merge leaves the issue open.";
  }

  private static List<string> Numbers(Regex regex, string body) =>
    [.. regex.Matches(body).SelectMany(m => NumberRegex().Matches(m.Value).Select(n => "#" + n.Groups[1].Value)).Distinct()];

  private static string Join(List<string> numbers) => string.Join(", ", numbers);

  // GitHub's closing keywords, each before one issue: #N, owner/repo#N or an issue URL.
  [GeneratedRegex(
    @"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:[\w.-]+/[\w.-]+#\d+|#\d+|https://github\.com/[\w.-]+/[\w.-]+/issues/\d+)",
    RegexOptions.IgnoreCase)]
  private static partial Regex ClosesRegex();

  // `Refs` (or `Ref`) before one or more issues, separated by commas or "and".
  [GeneratedRegex(@"\brefs?:?\s+(?:[\w.-]+/[\w.-]+)?#\d+(?:\s*(?:,|and)\s*(?:[\w.-]+/[\w.-]+)?#\d+)*", RegexOptions.IgnoreCase)]
  private static partial Regex RefsRegex();

  [GeneratedRegex(@"(?<![\w/&])#\d+\b")]
  private static partial Regex MentionRegex();

  [GeneratedRegex(@"(?:#|/issues/)(\d+)")]
  private static partial Regex NumberRegex();
}
