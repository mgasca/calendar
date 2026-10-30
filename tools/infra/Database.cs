using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Npgsql;

namespace InfraTool;

public static partial class Infra
{
  private const string Recovery = "Vault and server disagree. Coordinate manual recovery: set the role password as owner, store the same password in the ops vault, and update the app connection string when applicable; or drop the role only if it owns nothing. See docs/runbooks/azure-database.md.";

  private static async Task<int> DatabaseCommand(string[] args, IAzureProcess az, TextWriter output, CancellationToken token)
  {
    var init = args[0] == "db";
    var index = init ? 2 : 1;
    if (args.Length <= index) { throw new ArgumentException("Specify staging or production."); }
    var env = args[index];
    ValidateEnvironment(env);
    string ip;
    if (args.Length == index + 3 && args[index + 1] == "--client-ip") { ip = args[index + 2]; }
    else if (args.Length == index + 1)
    {
      using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
#pragma warning disable S1075 // Public IP discovery service; --client-ip overrides it.
      ip = (await http.GetStringAsync("https://api.ipify.org", token)).Trim();
#pragma warning restore S1075
    }
    else { throw new ArgumentException("Use --client-ip IPv4."); }
    if (!IPAddress.TryParse(ip, out var address) || address.AddressFamily != AddressFamily.InterNetwork || address.Equals(IPAddress.Any)) { throw new ArgumentException("Client IP must be an IPv4 address."); }
    var server = await ResourceName(az, env, "Microsoft.DBforPostgreSQL/flexibleServers");
    var group = $"rg-calendar-{env}";
    var ops = await VaultName(az, env, "opsKeyVaultName");
    if (!init)
    {
      await PrepareServer(az, env, group, server);
      await SweepFirewall(az, group, server);
      await RunLocal("dotnet", ["tool", "restore"], "backend", null, token: token);
      await RunLocal("dotnet", ["restore", "src/Calendar.Infrastructure"], "backend", null, token: token);
      await RunLocal("dotnet", ["ef", "migrations", "bundle", "--self-contained", "--target-runtime", "linux-x64", "--project", "src/Calendar.Infrastructure", "--output", Path.Combine(Path.GetTempPath(), "calendar-bundle-" + Guid.NewGuid().ToString("N"))], "backend", null, async bundle =>
      {
        await WithFirewall(az, group, server, ip, async () =>
        {
          var password = await ReadSecret(az, ops, "calendar-migrator-password", output);
          var host = await ServerHost(az, group, server);
          var connection = Connection(host, "calendar_migrator", password);
          await MaskSecret(output, connection);
          if (env == "production") { await output.WriteLineAsync($"Production restore point (UTC): {DateTimeOffset.UtcNow:O}"); }
          try { await RunLocal(bundle, [], ".", connection, token: token); }
          catch (InvalidOperationException) { throw new InvalidOperationException("Migration bundle failed; the existing revision keeps serving. Inspect database migration state before retrying."); }
        });
      }, token);
      return 0;
    }
    await PrepareServer(az, env, group, server);
    await SweepFirewall(az, group, server);
    await WithFirewall(az, group, server, ip, async () =>
    {
      var host = await ServerHost(az, group, server);
      var admin = await ReadSecret(az, ops, PasswordName, output);
      var appVault = await VaultName(az, env, "appKeyVaultName");
      var adminConnection = Connection(host, "calendaradmin", admin);
      await MaskSecret(output, adminConnection);
      await using var connection = new NpgsqlConnection(adminConnection);
      await connection.OpenAsync(token);
      var names = await SecretNames(az, ops, false);
      var migrator = await EnsureRole(az, connection, host, ops, names, "calendar_migrator", "calendar-migrator-password", output, token);
      _ = migrator;
      var app = await EnsureRole(az, connection, host, ops, names, "calendar_app", "calendar-app-password", output, token);
      var expected = Connection(host, "calendar_app", app);
      await MaskSecret(output, expected);
      var appNames = await SecretNames(az, appVault, false);
      if (appNames.Contains("calendar-connection-string", StringComparer.OrdinalIgnoreCase))
      {
        CheckConnectionSecret(await ReadSecret(az, appVault, "calendar-connection-string", output), expected);
      }
      else { await StoreNewSecret(az, appVault, "calendar-connection-string", expected, output); }
      token.ThrowIfCancellationRequested();
      await ApplyGrants(connection, token);
      await output.WriteLineAsync("Role grants applied.");
    });
    return 0;
  }

  private static async Task<string> EnsureRole(IAzureProcess az, NpgsqlConnection connection, string host, string vault, string[] names, string role, string secret, TextWriter output, CancellationToken token)
  {
    await using var existsCommand = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = @role)", connection);
    existsCommand.Parameters.AddWithValue("role", role);
    var exists = (bool)(await existsCommand.ExecuteScalarAsync(token) ?? false);
    var hasSecret = names.Contains(secret, StringComparer.OrdinalIgnoreCase);
    return await ReconcileRole(exists, hasSecret,
      async () =>
      {
        var generated = "Aa1!" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        await StoreNewSecret(az, vault, secret, generated, output);
        return generated;
      },
      () => ReadSecret(az, vault, secret, output),
      async password =>
      {
        try { var value = Connection(host, role, password); await MaskSecret(output, value); await using var verify = new NpgsqlConnection(value); await verify.OpenAsync(token); return true; }
        catch (Exception ex) when (ex is NpgsqlException or IOException) { return false; }
      },
      async password =>
      {
        await using var check = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = @role)", connection);
        check.Parameters.AddWithValue("role", role);
        await ConfirmCreationState(async () => (bool)(await check.ExecuteScalarAsync(token) ?? false), () => ReadSecret(az, vault, secret, output), password);
        await CreateRole(connection, role, password, token);
      },
      message => output.WriteLineAsync($"{role}: {message}"));
  }

  internal static async Task CreateRole(NpgsqlConnection connection, string role, string password, CancellationToken token = default)
  {
    await using var format = new NpgsqlCommand("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', @role, @password)", connection);
    format.Parameters.AddWithValue("role", role);
    format.Parameters.AddWithValue("password", password);
    var sql = (string)(await format.ExecuteScalarAsync(token) ?? throw new InvalidOperationException("Unable to create role."));
    await using var create = new NpgsqlCommand(sql, connection);
    await create.ExecuteNonQueryAsync(token);
  }

  internal const string GrantsSql = "ALTER DATABASE calendar OWNER TO calendar_migrator; REVOKE ALL ON DATABASE calendar FROM PUBLIC; GRANT CONNECT ON DATABASE calendar TO CURRENT_USER; GRANT CONNECT ON DATABASE calendar TO calendar_app; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO calendar_migrator; GRANT USAGE ON SCHEMA public TO calendar_app; ALTER DEFAULT PRIVILEGES FOR ROLE calendar_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO calendar_app; ALTER DEFAULT PRIVILEGES FOR ROLE calendar_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO calendar_app;";

  internal static async Task ApplyGrants(NpgsqlConnection connection, CancellationToken token = default)
  {
    await using var grants = new NpgsqlCommand(GrantsSql, connection);
    await grants.ExecuteNonQueryAsync(token);
  }

  internal static async Task<string> ReconcileRole(bool exists, bool hasSecret, Func<Task<string>> store, Func<Task<string>> read, Func<string, Task<bool>> verify, Func<string, Task> create, Func<string, Task> report)
  {
    if (exists && !hasSecret) { throw new InvalidOperationException(Recovery); }
    var written = hasSecret ? null : await store();
    var password = await read();
    if (written is not null && written != password) { throw new InvalidOperationException("Concurrent initialization detected; stop other operators and retry."); }
    if (exists)
    {
      if (!await verify(password)) { throw new InvalidOperationException(Recovery); }
      await report("existing credential verified.");
    }
    else { await create(password); await report("created."); }
    return password;
  }

  internal static async Task ConfirmCreationState(Func<Task<bool>> roleExists, Func<Task<string>> readSecret, string expected)
  {
    if (await roleExists() || await readSecret() != expected) { throw new InvalidOperationException("Concurrent initialization detected; stop other operators and retry."); }
  }

  internal static void CheckConnectionSecret(string actual, string expected)
  {
    if (actual != expected) { throw new InvalidOperationException("Existing app connection string differs from the expected value. " + Recovery); }
  }

  private static string Connection(string host, string role, string password) => new NpgsqlConnectionStringBuilder { Host = host, Database = "calendar", Username = role, Password = password, SslMode = SslMode.VerifyFull }.ConnectionString;
  internal static async Task MaskSecret(TextWriter output, string value)
  {
    Diagnostics.Current.Value?.Mask(value);
    if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true")
    {
      await output.WriteLineAsync("::add-mask::" + value.Replace("%", "%25", StringComparison.Ordinal).Replace("\r", "%0D", StringComparison.Ordinal).Replace("\n", "%0A", StringComparison.Ordinal));
    }
  }
  private static async Task<string> ReadSecret(IAzureProcess az, string vault, string name, TextWriter output)
  {
    var value = await az.RunAsync("keyvault", "secret", "show", "--vault-name", vault, "--name", name, "--query", "value", "-o", "tsv");
    await MaskSecret(output, value);
    return value;
  }
  internal static async Task StoreNewSecret(IAzureProcess az, string vault, string name, string value, TextWriter output)
  {
    await MaskSecret(output, value);
    var names = await SecretNames(az, vault, false);
    if (names.Contains(name, StringComparer.OrdinalIgnoreCase)) { throw new InvalidOperationException("Concurrent initialization detected; stop other operators and retry."); }
    await StoreSecret(az, vault, name, value, output);
  }
  internal static async Task StoreSecret(IAzureProcess az, string vault, string name, string value, TextWriter? output = null)
  {
    await MaskSecret(output ?? TextWriter.Null, value);
    await WithPrivateFile(value, async path => { await az.RunAsync("keyvault", "secret", "set", "--vault-name", vault, "--name", name, "--file", path, "--output", "none"); });
    var latest = await ReadSecret(az, vault, name, output ?? TextWriter.Null);
    if (latest != value) { throw new InvalidOperationException("Concurrent initialization detected; stop other operators and retry."); }
  }
  private static Task<string> ServerHost(IAzureProcess az, string group, string server) => az.RunAsync("postgres", "flexible-server", "show", "--resource-group", group, "--name", server, "--query", "fullyQualifiedDomainName", "-o", "tsv");

  private static async Task PrepareServer(IAzureProcess az, string env, string group, string server)
  {
    var state = await az.RunAsync("postgres", "flexible-server", "show", "--resource-group", group, "--name", server, "--query", "state", "-o", "tsv");
    if (state == "Stopped" && env == "staging") { await az.RunAsync("postgres", "flexible-server", "start", "--resource-group", group, "--name", server, "--output", "none"); }
    else if (state != "Ready") { throw new InvalidOperationException("PostgreSQL server is not ready."); }
    await az.RunAsync("postgres", "flexible-server", "wait", "--resource-group", group, "--name", server, "--custom", "state=='Ready'");
  }

  internal static async Task SweepFirewall(IAzureProcess az, string group, string server)
  {
    var json = await az.RunAsync("postgres", "flexible-server", "firewall-rule", "list", "--resource-group", group, "--server-name", server, "--query", "[].name", "-o", "json");
    var names = JsonNode.Parse(json)?.AsArray() ?? throw new InvalidOperationException("Invalid firewall rule list.");
    foreach (var name in names.Select(n => n?.GetValue<string>() ?? "").Where(n => n.StartsWith("calendar-migration-", StringComparison.Ordinal))) { await DeleteFirewall(az, group, server, name); }
  }

  internal static async Task WithFirewall(IAzureProcess az, string group, string server, string ip, Func<Task> action)
  {
    var rule = "calendar-migration-" + Guid.NewGuid().ToString("N");
    Exception? failure = null;
    try
    {
      await az.RunAsync("postgres", "flexible-server", "firewall-rule", "create", "--resource-group", group, "--server-name", server, "--name", rule, "--start-ip-address", ip, "--end-ip-address", ip, "--output", "none");
      await action();
    }
    catch (Exception ex) { failure = ex; throw; }
    finally
    {
      try { await DeleteFirewall(az, group, server, rule); }
      catch (InvalidOperationException cleanup) when (failure is not null) { failure.Data["FirewallCleanup"] = cleanup.Message; }
    }
  }

  private static async Task DeleteFirewall(IAzureProcess az, string group, string server, string rule)
  {
    try { await az.RunCleanupAsync("postgres", "flexible-server", "firewall-rule", "delete", "--resource-group", group, "--server-name", server, "--name", rule, "--yes", "--output", "none"); }
    catch (InvalidOperationException) { throw new InvalidOperationException($"Could not remove temporary firewall rule {rule} from {server}; remove it manually."); }
  }

  private static async Task RunLocal(string command, string[] args, string directory, string? connection, Func<string, Task>? after = null, CancellationToken token = default)
  {
    var info = new ProcessStartInfo(command) { WorkingDirectory = directory, RedirectStandardOutput = true, RedirectStandardError = true };
    foreach (var arg in args) { info.ArgumentList.Add(arg); }
    if (connection is not null) { info.Environment["CALENDAR_MIGRATOR_CONNECTION"] = connection; }
    using var process = Process.Start(info) ?? throw new InvalidOperationException("Unable to start migration command.");
    var stdout = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
    var stderr = process.StandardError.ReadToEndAsync(CancellationToken.None);
    try { await process.WaitForExitAsync(token); }
    catch (OperationCanceledException) { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } throw; }
    _ = await stdout; _ = await stderr;
    if (process.ExitCode != 0) { throw new InvalidOperationException($"Migration command failed (exit {process.ExitCode})."); }
    if (after is not null)
    {
      var path = args[^1];
      try { await after(path); }
      finally { File.Delete(path); }
    }
  }
}
