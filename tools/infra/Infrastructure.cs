using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace InfraTool;

/// <summary>An injectable Azure CLI process.</summary>
public interface IAzureProcess
{
  /// <summary>Runs az, returning output only on success.</summary>
  Task<string> RunAsync(params string[] args);
}

/// <summary>Runs Azure CLI without shell interpolation.</summary>
public sealed class AzureProcess : IAzureProcess
{
  /// <inheritdoc />
  public async Task<string> RunAsync(params string[] args)
  {
#pragma warning disable S4036 // az is deliberately resolved from the user toolchain PATH.
    var info = new ProcessStartInfo("az") { RedirectStandardOutput = true, RedirectStandardError = true };
#pragma warning restore S4036
    info.Environment["AZURE_BICEP_USE_BINARY_FROM_PATH"] = "false";
    foreach (var arg in args) { info.ArgumentList.Add(arg); }
    using var process = Process.Start(info) ?? throw new InvalidOperationException("Unable to start az.");
    var stdout = process.StandardOutput.ReadToEndAsync();
    var stderr = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync();
    var output = await stdout;
    _ = await stderr; // Azure error output can contain sensitive input: never relay it.
    if (process.ExitCode != 0) { throw new InvalidOperationException($"Azure CLI failed (exit {process.ExitCode}); check access and parameters."); }
    return output.Trim();
  }
}

/// <summary>Infrastructure command orchestration.</summary>
public static class Infra
{
  private const string PasswordName = "postgres-admin-password";

  /// <summary>Executes a command using an injected Azure CLI.</summary>
  public static async Task<int> RunAsync(string[] args, IAzureProcess az, TextWriter output, TextWriter error)
  {
    try
    {
      if (args.Length < 2) { throw new ArgumentException("Usage: deploy|what-if ENV [--phase foundation|full], db start|stop staging, or secret init-postgres-password ENV [--force]"); }
      if (args[0] == "db")
      {
        if (args.Length != 3 || (args[1] != "start" && args[1] != "stop") || args[2] != "staging") { throw new ArgumentException("db start|stop requires staging."); }
        var server = await ResourceName(az, "staging", "Microsoft.DBforPostgreSQL/flexibleServers");
        await az.RunAsync("postgres", "flexible-server", args[1], "--resource-group", "rg-calendar-staging", "--name", server, "--output", "none");
        return 0;
      }
      if (args[0] == "secret")
      {
        if (args.Length is < 3 or > 4 || args[1] != "init-postgres-password" || (args.Length == 4 && args[3] != "--force")) { throw new ArgumentException("Invalid secret command."); }
        ValidateEnvironment(args[2]);
        var vault = await ResourceName(az, args[2], "Microsoft.KeyVault/vaults");
        var names = await SecretNames(az, vault);
        if (names.Contains(PasswordName, StringComparer.OrdinalIgnoreCase) && args.Length != 4) { throw new InvalidOperationException("Password already exists; use --force to replace it."); }
        var password = "Aa1!" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        await WithPrivateFile(password, async path => { await az.RunAsync("keyvault", "secret", "set", "--vault-name", vault, "--name", PasswordName, "--file", path, "--output", "none"); });
        await output.WriteLineAsync("PostgreSQL password stored in Key Vault.");
        return 0;
      }
      if (args[0] != "deploy" && args[0] != "what-if") { throw new ArgumentException("Unknown command."); }
      ValidateEnvironment(args[1]);
      if (args.Length != 2 && (args.Length != 4 || args[2] != "--phase" || (args[3] != "foundation" && args[3] != "full"))) { throw new ArgumentException("Invalid phase; use foundation or full."); }
      var phase = args.Length == 2 ? "full" : args[3];
      var clientId = Environment.GetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID");
      if (!Guid.TryParse(clientId, out var clientGuid)) { throw new ArgumentException("Set AZURE_DEPLOYER_CLIENT_ID to the environment's deployment identity client ID (GUID)."); }
      var principalId = await az.RunAsync("rest", "--method", "get", "--url", $"https://graph.microsoft.com/v1.0/servicePrincipals(appId='{clientGuid:D}')", "--query", "id", "-o", "tsv");
      if (!Guid.TryParse(principalId, out _)) { throw new InvalidOperationException("Azure returned an invalid deployment principal object ID."); }
      var json = await az.RunAsync("bicep", "build-params", "--file", $"infra/parameters/{args[1]}.bicepparam", "--stdout");
      var compiled = JsonNode.Parse(json)?["parametersJson"]?.GetValue<string>() ?? throw new InvalidOperationException("Invalid Bicep compiler output.");
      var parameters = JsonNode.Parse(compiled)?["parameters"]?.AsObject() ?? throw new InvalidOperationException("Invalid compiled parameters.");
      parameters["deployDatabaseAndApp"] = new JsonObject { ["value"] = phase == "full" };
      parameters["deployerPrincipalId"] = new JsonObject { ["value"] = principalId };
      var image = Environment.GetEnvironmentVariable("CALENDAR_CONTAINER_IMAGE");
      if (!string.IsNullOrWhiteSpace(image))
      {
        parameters["containerImage"] = new JsonObject { ["value"] = image };
      }
      else if (!parameters.ContainsKey("containerImage"))
      {
        parameters["containerImage"] = new JsonObject { ["value"] = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" };
      }
      string? secretValue = null;
      if (phase == "full")
      {
        var vault = await ResourceName(az, args[1], "Microsoft.KeyVault/vaults");
        var names = await SecretNames(az, vault);
        if (!names.Contains(PasswordName, StringComparer.OrdinalIgnoreCase)) { throw new InvalidOperationException("Postgres password missing; owner must run secret init-postgres-password first."); }
        var password = await az.RunAsync("keyvault", "secret", "show", "--vault-name", vault, "--name", PasswordName, "--query", "value", "-o", "tsv");
        secretValue = password;
        parameters["postgresAdministratorPassword"] = new JsonObject { ["value"] = password };
        parameters["keyVaultSecretNames"] = new JsonObject { ["value"] = new JsonArray(names.Select(n => (JsonNode?)JsonValue.Create(n)).ToArray()) };
      }
      var document = new JsonObject { ["parameters"] = parameters.DeepClone() };
      await WithPrivateFile(document.ToJsonString(), async path =>
      {
        var result = await az.RunAsync("deployment", "group", args[0] == "deploy" ? "create" : "what-if", "--resource-group", $"rg-calendar-{args[1]}", "--template-file", "infra/main.bicep", "--parameters", "@" + path, "--no-prompt");
        if (args[0] == "what-if") { await output.WriteLineAsync(secretValue is null || secretValue.Length == 0 ? result : result.Replace(secretValue, "[redacted]", StringComparison.Ordinal)); }
      });
      return 0;
    }
    catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or IOException or JsonException)
    {
      await error.WriteLineAsync(ex.Message);
      return 1;
    }
  }

  private static void ValidateEnvironment(string env)
  {
    if (env != "staging" && env != "production") { throw new ArgumentException("Environment must be staging or production."); }
  }

  private static async Task<string> ResourceName(IAzureProcess az, string env, string type)
  {
    var json = await az.RunAsync("resource", "list", "--resource-group", $"rg-calendar-{env}", "--resource-type", type, "--query", "[].name", "-o", "json");
    var names = JsonNode.Parse(json)?.AsArray().Select(n => n?.GetValue<string>() ?? "").ToArray() ?? [];
    if (names.Length != 1) { throw new InvalidOperationException($"Expected exactly one {type} resource in rg-calendar-{env}."); }
    return names[0];
  }

  private static async Task<string[]> SecretNames(IAzureProcess az, string vault)
  {
    var json = await az.RunAsync("keyvault", "secret", "list", "--vault-name", vault, "--query", "[].id", "-o", "json");
    return JsonNode.Parse(json)?.AsArray().Select(n => (n?.GetValue<string>() ?? "").Split('/')[^1]).ToArray() ?? [];
  }

  private static async Task WithPrivateFile(string data, Func<string, Task> action)
  {
    if (OperatingSystem.IsWindows()) { throw new InvalidOperationException("Infrastructure tooling requires Linux or WSL."); }
    var path = Path.Combine(Path.GetTempPath(), "calendar-infra-" + Guid.NewGuid().ToString("N"));
    try
    {
      using (var file = new FileStream(path, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite }))
      using (var writer = new StreamWriter(file)) { await writer.WriteAsync(data); }
      await action(path);
    }
    finally { File.Delete(path); }
  }
}
