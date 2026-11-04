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

  /// <summary>The reason to keep working, or null when the contract and client look in step.</summary>
  public static string? Evaluate(IReadOnlyList<string> changedFiles)
  {
    var sourcesChanged = changedFiles.Any(f => ContractSources.Any(s => f.StartsWith(s, StringComparison.Ordinal)));
    var contractChanged = changedFiles.Contains(Contract, StringComparer.Ordinal);
    var clientChanged = changedFiles.Contains(Client, StringComparer.Ordinal);
    if (sourcesChanged && !contractChanged)
    {
      return "API contract sources changed but contracts/openapi.json did not. Run `just contracts` and commit the result "
        + "(CI fails on a stale contract); if the contract is unchanged, say so and stop.";
    }
    if (contractChanged && !clientChanged)
    {
      return "contracts/openapi.json changed but the TS client did not. Run `just contracts` so schema.gen.ts is regenerated, "
        + "and commit both.";
    }
    return null;
  }
}
