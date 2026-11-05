namespace AgentHooks;

/// <summary>At stop time, notices API contract sources that changed without their generated outputs.</summary>
public static class ContractCheck
{
  private static readonly string[] ContractSources =
  [
    "backend/src/Calendar.Api/Contracts/",
    "backend/src/Calendar.Api/Endpoints/",
    "backend/src/Calendar.Api/Program.cs",
  ];

  private const string Contract = "contracts/openapi.json";
  private const string Client = "frontend/packages/api-client/src/schema.gen.ts";

  /// <summary>
  /// The reason to keep working, or null when the contract and client look in step. A generated file written after
  /// every input it depends on was regenerated since the edit, so when git still sees it unchanged, it is unchanged
  /// (#254). <paramref name="lastWriteTimeUtc"/> gives a repo-relative file's last write, or null when it is missing
  /// or unknown; a missing input, such as a deleted source, never counts as regenerated.
  /// </summary>
  public static string? Evaluate(IReadOnlyList<string> changedFiles, Func<string, DateTime?>? lastWriteTimeUtc = null)
  {
    List<string> sources = [.. changedFiles.Where(f => ContractSources.Any(s => f.StartsWith(s, StringComparison.Ordinal)))];
    var contractChanged = changedFiles.Contains(Contract, StringComparer.Ordinal);
    var clientChanged = changedFiles.Contains(Client, StringComparer.Ordinal);
    if (sources.Count > 0 && !contractChanged && !WrittenAfter(Contract, sources, lastWriteTimeUtc))
    {
      return "API contract sources changed but contracts/openapi.json did not. Run `just contracts` and commit the result "
        + "(CI fails on a stale contract); if the contract is unchanged, say so and stop.";
    }
    if (contractChanged && !clientChanged && !WrittenAfter(Client, [Contract], lastWriteTimeUtc))
    {
      return "contracts/openapi.json changed but the TS client did not. Run `just contracts` so schema.gen.ts is regenerated, "
        + "and commit both.";
    }
    return null;
  }

  /// <summary>True when <paramref name="output"/> was written strictly after every one of <paramref name="inputs"/>.</summary>
  private static bool WrittenAfter(string output, IReadOnlyList<string> inputs, Func<string, DateTime?>? lastWriteTimeUtc)
  {
    if (lastWriteTimeUtc?.Invoke(output) is not { } written)
    {
      return false;
    }
    return inputs.All(input => lastWriteTimeUtc(input) is { } edited && written > edited);
  }
}
