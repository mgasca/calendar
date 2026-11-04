using System.Text.Json;

namespace AgentHooks;

/// <summary>Maps a subcommand and its stdin to a result. The entry point only does I/O.</summary>
public static class HookRunner
{
  /// <summary>The subcommands the tool accepts.</summary>
  public static readonly string[] Subcommands = ["pre-bash", "pre-edit", "post-edit", "stop", "warm"];

  /// <summary>Runs one hook. Malformed JSON and unknown subcommands exit 2 so the mistake is visible.</summary>
  public static HookResult Run(string subcommand, string stdin, IRepoProbe probe, string sdkVersion)
  {
    if (!Subcommands.Contains(subcommand))
    {
      return new HookResult(
        2,
        Stderr: $"agent-hooks: unknown subcommand '{subcommand}'. Usage: agent-hooks <{string.Join('|', Subcommands)}>");
    }
    HookInput input;
    try
    {
      input = HookInput.Parse(stdin);
    }
    catch (JsonException e)
    {
      return new HookResult(2, Stderr: $"agent-hooks {subcommand}: stdin is not the hook JSON ({e.Message})");
    }
    return subcommand switch
    {
      "pre-bash" => PreBash(input, probe),
      "pre-edit" => PreEdit(input),
      "post-edit" => PostEdit(input, probe),
      "stop" => Stop(input, probe),
      _ => new HookResult(0, HookOutput.Context("SessionStart", $"agent-hooks active (tools/agent-hooks, .NET runtime {sdkVersion}).")),
    };
  }

  private static HookResult PreBash(HookInput input, IRepoProbe probe)
  {
    if (input.Command is null)
    {
      return new HookResult(0, Stderr: "agent-hooks pre-bash: no tool_input.command; letting it through");
    }
    Verdict? verdict = BashGuard.Evaluate(input.Command, input.Cwd, probe);
    return verdict is null ? HookResult.Pass : new HookResult(0, HookOutput.PreToolUse(verdict));
  }

  private static HookResult PreEdit(HookInput input)
  {
    if (input.FilePath is null)
    {
      return new HookResult(0, Stderr: "agent-hooks pre-edit: no tool_input.file_path; letting it through");
    }
    Verdict? verdict = EditGuard.Evaluate(input.FilePath);
    return verdict is null ? HookResult.Pass : new HookResult(0, HookOutput.PreToolUse(verdict));
  }

  private static HookResult PostEdit(HookInput input, IRepoProbe probe)
  {
    if (input.FilePath is null)
    {
      return HookResult.Pass;
    }
    var note = LineLengthCheck.Describe(input.FilePath, probe.ReadFile(input.Cwd, input.FilePath));
    return note is null ? HookResult.Pass : new HookResult(0, HookOutput.Context("PostToolUse", note));
  }

  private static HookResult Stop(HookInput input, IRepoProbe probe)
  {
    if (input.StopHookActive)
    {
      return HookResult.Pass;
    }
    var reason = ContractCheck.Evaluate(probe.ChangedFiles(input.Cwd));
    return reason is null ? HookResult.Pass : new HookResult(0, HookOutput.StopBlock(reason));
  }
}
