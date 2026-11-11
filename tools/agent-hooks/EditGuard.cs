namespace AgentHooks;

/// <summary>Refuses hand edits of generated files.</summary>
public static class EditGuard
{
  private static readonly string[] GeneratedSuffixes =
  [
    "contracts/openapi.json",
    "frontend/packages/api-client/src/schema.gen.ts",
    "packages.lock.json",
    "Cargo.lock",
    "pnpm-lock.yaml",
  ];

  /// <summary>A deny verdict for a generated file, or null.</summary>
  public static Verdict? Evaluate(string filePath)
  {
    var normalized = filePath.Replace('\\', '/');
    return GeneratedSuffixes.Any(s => normalized.EndsWith(s, StringComparison.Ordinal))
      ? new Verdict(
        "deny",
        $"{Path.GetFileName(filePath)} is generated. Run `just contracts` for the API contract and TS client, `dotnet restore` "
        + "for packages.lock.json, `cargo add`, `cargo update` or a build for Cargo.lock, or `pnpm install` for pnpm-lock.yaml, "
        + "and commit the result instead of editing it.")
      : null;
  }
}
