using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace InfraTool;

/// <summary>An injectable Azure CLI process.</summary>
public interface IAzureProcess
{
  /// <summary>Runs az, returning output only on success.</summary>
  Task<string> RunAsync(params string[] args);
  /// <summary>Runs cleanup independently of cancellation.</summary>
  Task<string> RunCleanupAsync(params string[] args) => RunAsync(args);
}

/// <summary>Runs Azure CLI without shell interpolation.</summary>
public sealed class AzureProcess(CancellationToken cancellationToken = default) : IAzureProcess
{
  /// <inheritdoc />
  public Task<string> RunAsync(params string[] args) => ExecuteAsync(args, cancellationToken);
  /// <inheritdoc />
  public Task<string> RunCleanupAsync(params string[] args) => ExecuteAsync(args, CancellationToken.None);

  private static async Task<string> ExecuteAsync(string[] args, CancellationToken token)
  {
#pragma warning disable S4036 // az is deliberately resolved from the user toolchain PATH.
    var info = new ProcessStartInfo("az") { RedirectStandardOutput = true, RedirectStandardError = true };
#pragma warning restore S4036
    info.Environment["AZURE_BICEP_USE_BINARY_FROM_PATH"] = "false";
    foreach (var arg in args) { info.ArgumentList.Add(arg); }
    using var process = Process.Start(info) ?? throw new InvalidOperationException("Unable to start az.");
    var stdout = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
    var stderr = process.StandardError.ReadToEndAsync(CancellationToken.None);
    try { await process.WaitForExitAsync(token); }
    catch (OperationCanceledException) { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } throw; }
    var output = await stdout;
    var errors = await stderr;
    if (process.ExitCode != 0) { throw new AzureFailureException(process.ExitCode, output, errors); }
    return output.Trim();
  }
}

/// <summary>Infrastructure command orchestration.</summary>
public static partial class Infra
{
  private const string PasswordName = "postgres-admin-password";

  /// <summary>Executes a command using an injected Azure CLI.</summary>
  public static Task<int> RunAsync(string[] args, IAzureProcess az, TextWriter output, TextWriter error) => RunAsync(args, az, output, error, CancellationToken.None);

  /// <summary>Executes a command with cancellation.</summary>
  public static async Task<int> RunAsync(string[] args, IAzureProcess az, TextWriter output, TextWriter error, CancellationToken cancellationToken)
  {
    var diagnostics = new Diagnostics(az, output);
    Diagnostics.Current.Value = diagnostics;
    az = diagnostics.Wrap();
    try
    {
      var flags = args.ToList();
      diagnostics.Verbose = flags.Remove("--verbose") || Environment.GetEnvironmentVariable("INFRA_VERBOSE") == "1";
      args = flags.ToArray();
      SweepStaleFiles();
      if (args.Length > 0 && (args[0] == "migrate" || (args[0] == "db" && args.Length > 1 && args[1] == "init-roles"))) { return await DatabaseCommand(args, az, output, cancellationToken); }
      if (args.Length < 2) { throw new ArgumentException("Usage: deploy|what-if ENV [--phase foundation|full], db start|stop staging, or secret init-postgres-password ENV"); }
      if (args[0] == "db")
      {
        if (args.Length != 3 || (args[1] != "start" && args[1] != "stop") || args[2] != "staging") { throw new ArgumentException("db start|stop requires staging."); }
        var server = await ResourceName(az, "staging", "Microsoft.DBforPostgreSQL/flexibleServers");
        await az.RunAsync("postgres", "flexible-server", args[1], "--resource-group", "rg-calendar-staging", "--name", server, "--output", "none");
        return 0;
      }
      if (args[0] == "secret")
      {
        if (args.Length != 3 || args[1] != "init-postgres-password") { throw new ArgumentException("Invalid secret command."); }
        ValidateEnvironment(args[2]);
        var vault = await VaultName(az, args[2], "opsKeyVaultName");
        var names = await SecretNames(az, vault, false);
        if (names.Contains(PasswordName, StringComparer.OrdinalIgnoreCase)) { throw new InvalidOperationException("Password already exists; coordinated manual rotation is required."); }
        var password = "Aa1!" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        await MaskSecret(output, password);
        await WithPrivateFile(password, async path => { await az.RunAsync("keyvault", "secret", "set", "--vault-name", vault, "--name", PasswordName, "--file", path, "--output", "none"); });
        await output.WriteLineAsync("PostgreSQL password stored in Key Vault.");
        return 0;
      }
      if (args[0] != "deploy" && args[0] != "what-if") { throw new ArgumentException("Unknown command."); }
      ValidateEnvironment(args[1]);
      var phase = "full";
      var allowedIps = new List<string>();
      var configuredIps = Environment.GetEnvironmentVariable("AZURE_ALLOWED_IPS");
      if (!string.IsNullOrWhiteSpace(configuredIps)) { allowedIps.AddRange(configuredIps.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)); }
      var options = new Queue<string>(args.Skip(2));
      while (options.TryDequeue(out var option))
      {
        if (option == "--phase" && options.TryDequeue(out var selectedPhase)) { phase = selectedPhase; }
        else if (option == "--allow-ip" && options.TryDequeue(out var ip)) { allowedIps.Add(ip); }
        else { throw new ArgumentException("Use --phase foundation|full and repeatable --allow-ip CIDR."); }
      }
      if (phase != "foundation" && phase != "full") { throw new ArgumentException("Invalid phase; use foundation or full."); }
      foreach (var ip in allowedIps) { ValidateIp(ip); }
      var clientId = Environment.GetEnvironmentVariable("AZURE_DEPLOYER_CLIENT_ID");
      if (!Guid.TryParse(clientId, out var clientGuid)) { throw new ArgumentException("Set AZURE_DEPLOYER_CLIENT_ID to the environment's deployment identity client ID (GUID)."); }
      var principalId = await az.RunAsync("rest", "--method", "get", "--url", $"https://graph.microsoft.com/v1.0/servicePrincipals(appId='{clientGuid:D}')", "--query", "id", "-o", "tsv");
      if (!Guid.TryParse(principalId, out _)) { throw new InvalidOperationException("Azure returned an invalid deployment principal object ID."); }
      var json = await az.RunAsync("bicep", "build-params", "--file", $"infra/parameters/{args[1]}.bicepparam", "--stdout");
      var compiled = JsonNode.Parse(json)?["parametersJson"]?.GetValue<string>() ?? throw new InvalidOperationException("Invalid Bicep compiler output.");
      var parameters = JsonNode.Parse(compiled)?["parameters"]?.AsObject() ?? throw new InvalidOperationException("Invalid compiled parameters.");
      parameters["deployDatabaseAndApp"] = new JsonObject { ["value"] = phase == "full" };
      parameters["allowedFirewallIps"] = new JsonObject { ["value"] = new JsonArray(allowedIps.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).Select(n => (JsonNode?)IpRange(n)).ToArray()) };
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
        var vault = await VaultName(az, args[1], "opsKeyVaultName");
        var names = await SecretNames(az, vault, false);
        if (!names.Contains(PasswordName, StringComparer.OrdinalIgnoreCase)) { throw new InvalidOperationException("Postgres password missing; owner must run secret init-postgres-password first."); }
        var password = await az.RunAsync("keyvault", "secret", "show", "--vault-name", vault, "--name", PasswordName, "--query", "value", "-o", "tsv");
        await MaskSecret(output, password);
        secretValue = password;
        parameters["postgresAdministratorPassword"] = new JsonObject { ["value"] = password };
        var appVault = await VaultName(az, args[1], "appKeyVaultName");
        var appNames = await SecretNames(az, appVault, true);
        parameters["keyVaultSecretNames"] = new JsonObject { ["value"] = new JsonArray(appNames.Select(n => (JsonNode?)JsonValue.Create(n)).ToArray()) };
      }
      var document = new JsonObject { ["parameters"] = parameters.DeepClone() };
      await WithPrivateFile(document.ToJsonString(), async path =>
      {
        var command = new List<string> { "deployment", "group", args[0] == "deploy" ? "create" : "what-if", "--resource-group", $"rg-calendar-{args[1]}", "--template-file", "infra/main.bicep", "--parameters", "@" + path, "--no-prompt" };
        if (phase == "foundation") { command.AddRange(["--name", "calendar-foundation"]); }
        if (args[0] == "what-if") { command.AddRange(["--no-pretty-print", "-o", "json"]); }
        try
        {
          var result = await az.RunAsync(command.ToArray());
          if (args[0] == "what-if") { await output.WriteLineAsync(SafePreview(result, secretValue)); }
        }
        catch (AzureFailureException failure)
        {
          await diagnostics.CollectOperations(failure, $"rg-calendar-{args[1]}", phase == "foundation" ? "calendar-foundation" : "main");
          throw;
        }
      });
      return 0;
    }
    catch (AzureFailureException ex)
    {
      await diagnostics.Report(ex, error);
      return 1;
    }
    catch (OperationCanceledException ex) when (cancellationToken.IsCancellationRequested)
    {
      await error.WriteLineAsync("Operation cancelled.");
      if (ex.Data["FirewallCleanup"] is string cleanup) { await error.WriteLineAsync(cleanup); }
      return 1;
    }
    catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
    {
      await error.WriteLineAsync("Unable to detect public IP; pass --client-ip IPv4.");
      if (ex.Data["FirewallCleanup"] is string cleanup) { await error.WriteLineAsync(cleanup); }
      return 1;
    }
    catch (Npgsql.NpgsqlException ex)
    {
      await error.WriteLineAsync("PostgreSQL operation failed; check connectivity, permissions and server state.");
      if (ex.Data["FirewallCleanup"] is string cleanup) { await error.WriteLineAsync(cleanup); }
      return 1;
    }
    catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or IOException or JsonException)
    {
      await error.WriteLineAsync(ex.Message);
      if (ex.Data["FirewallCleanup"] is string cleanup) { await error.WriteLineAsync(cleanup); }
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

  private static async Task<string> VaultName(IAzureProcess az, string env, string outputName)
  {
    var name = await az.RunAsync("deployment", "group", "show", "--resource-group", $"rg-calendar-{env}", "--name", "calendar-foundation", "--query", $"properties.outputs.{outputName}.value", "-o", "tsv");
    if (string.IsNullOrWhiteSpace(name) || name == "null") { throw new InvalidOperationException("Foundation vault output missing; deploy foundation first."); }
    return name;
  }

  private static async Task<string[]> SecretNames(IAzureProcess az, string vault, bool appOnly)
  {
    var json = await az.RunAsync("keyvault", "secret", "list", "--vault-name", vault, "--query", "[].{id:id,enabled:attributes.enabled}", "-o", "json");
    var entries = JsonNode.Parse(json)?.AsArray() ?? throw new InvalidOperationException("Invalid Key Vault secret list.");
    return entries.Where(n => !appOnly || n?["enabled"]?.GetValue<bool>() == true)
      .Select(n => (n?["id"]?.GetValue<string>() ?? "").Split('/')[^1])
      .Where(n => !appOnly || IsAppSecret(n)).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
  }

  private static bool IsAppSecret(string name) => name is "calendar-connection-string" or "google-client-id" or "google-client-secret" || Regex.IsMatch(name, "^allowed-email-[0-9]+$", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

  private static void ValidateIp(string value)
  {
    var parts = value.Split('/');
    if (parts.Length > 2 || !IPAddress.TryParse(parts[0], out var address) || address.AddressFamily != AddressFamily.InterNetwork || (parts.Length == 2 && (!int.TryParse(parts[1], out var prefix) || prefix is < 0 or > 32)))
    { throw new ArgumentException("Allowed firewall addresses must be IPv4 addresses or IPv4 CIDRs (0–32)."); }
  }

  private static JsonObject IpRange(string value)
  {
    var parts = value.Split('/');
    var address = IPAddress.Parse(parts[0]);
    var prefix = parts.Length == 2 ? int.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture) : 32;
    var number = BinaryPrimitives.ReadUInt32BigEndian(address.GetAddressBytes());
    var mask = prefix == 0 ? 0U : uint.MaxValue << (32 - prefix);
    static string ToAddress(uint n)
    {
      Span<byte> bytes = stackalloc byte[4];
      BinaryPrimitives.WriteUInt32BigEndian(bytes, n);
      return new IPAddress(bytes).ToString();
    }
    return new JsonObject { ["startIpAddress"] = ToAddress(number & mask), ["endIpAddress"] = ToAddress(number | ~mask) };
  }

  private static string SafePreview(string json, string? secret)
  {
    var node = JsonNode.Parse(json) ?? throw new InvalidOperationException("Invalid what-if result.");
    Redact(node);
    var result = node.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    return string.IsNullOrEmpty(secret) ? result : result.Replace(secret, "[redacted]", StringComparison.Ordinal);
  }

  private static void Redact(JsonNode node)
  {
    if (node is JsonObject obj)
    {
      if (obj.Any(p => (p.Key is "path" or "propertyName") && p.Value is JsonValue value && value.TryGetValue<string>(out var text) && IsSensitiveName(text)))
      {
        obj.Clear();
        obj["redacted"] = true;
        return;
      }
      foreach (var key in obj.Select(p => p.Key).ToArray())
      {
        if (IsSensitiveName(key)) { obj[key] = "[redacted]"; }
        else if (obj[key] is JsonNode child) { Redact(child); }
      }
    }
    else if (node is JsonArray array) { foreach (var child in array.OfType<JsonNode>()) { Redact(child); } }
  }

  private static bool IsSensitiveName(string name) => name.Contains("secret", StringComparison.OrdinalIgnoreCase) || name.Contains("password", StringComparison.OrdinalIgnoreCase) || name.Contains("credential", StringComparison.OrdinalIgnoreCase) || name.Contains("token", StringComparison.OrdinalIgnoreCase);

  private static string RuntimeDirectory()
  {
    if (OperatingSystem.IsWindows()) { throw new InvalidOperationException("Infrastructure tooling requires Linux or WSL."); }
    var runtime = Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR");
    var parent = !string.IsNullOrWhiteSpace(runtime) && Path.IsPathFullyQualified(runtime) && Directory.Exists(runtime)
      ? runtime : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".cache");
    var directory = Path.Combine(parent, "calendar-infra-private");
    Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0 || File.GetUnixFileMode(directory) != (UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)) { throw new InvalidOperationException("Infrastructure runtime directory must be private (0700) and not a symlink."); }
    return directory;
  }

  private static void SweepStaleFiles()
  {
    foreach (var path in Directory.EnumerateFiles(RuntimeDirectory(), "calendar-infra-*").Where(path => File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddHours(-24)))
    {
      File.Delete(path);
    }
  }

  internal static async Task<string> WriteTranscript(string data)
  {
    if (OperatingSystem.IsWindows()) { throw new InvalidOperationException("Infrastructure tooling requires Linux or WSL."); }
    var path = Path.Combine(RuntimeDirectory(), "calendar-infra-transcript-" + Guid.NewGuid().ToString("N"));
    using var file = new FileStream(path, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite });
    using var writer = new StreamWriter(file);
    await writer.WriteAsync(data);
    return path;
  }

  private static async Task WithPrivateFile(string data, Func<string, Task> action)
  {
    if (OperatingSystem.IsWindows()) { throw new InvalidOperationException("Infrastructure tooling requires Linux or WSL."); }
    var path = Path.Combine(RuntimeDirectory(), "calendar-infra-" + Guid.NewGuid().ToString("N"));
    try
    {
      using (var file = new FileStream(path, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite }))
      using (var writer = new StreamWriter(file)) { await writer.WriteAsync(data); }
      await action(path);
    }
    finally { File.Delete(path); }
  }
}
