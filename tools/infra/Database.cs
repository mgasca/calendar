using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using Npgsql;

namespace InfraTool;

public static partial class Infra
{
  private const string Recovery = "Vault and server disagree. Coordinate manual recovery: set the role password as owner, store the same password in the ops vault, and update the app connection string when applicable; or drop the role only if it owns nothing. See docs/runbooks/azure-database.md.";

  private static async Task<int> DatabaseCommand(string[] args, IAzureProcess az, TextWriter output)
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
      ip = (await http.GetStringAsync("https://api.ipify.org")).Trim();
#pragma warning restore S1075
    }
    else { throw new ArgumentException("Use --client-ip IPv4."); }
    if (!IPAddress.TryParse(ip, out var address) || address.AddressFamily != AddressFamily.InterNetwork || address.Equals(IPAddress.Any)) { throw new ArgumentException("Client IP must be an IPv4 address."); }
    var server = await ResourceName(az, env, "Microsoft.DBforPostgreSQL/flexibleServers");
    var group = $"rg-calendar-{env}";
    var ops = await VaultName(az, env, "opsKeyVaultName");
    if (!init)
    {
      await RunLocal("dotnet", ["tool", "restore"], "backend", null);
      await RunLocal("dotnet", ["restore", "src/Calendar.Infrastructure"], "backend", null);
      await RunLocal("dotnet", ["ef", "migrations", "bundle", "--self-contained", "--target-runtime", "linux-x64", "--project", "src/Calendar.Infrastructure", "--output", Path.Combine(Path.GetTempPath(), "calendar-bundle-" + Guid.NewGuid().ToString("N"))], "backend", null, async bundle =>
      {
        await PrepareServer(az, env, group, server);
        await WithFirewall(az, group, server, ip, async () =>
        {
          var password = await ReadSecret(az, ops, "calendar-migrator-password");
          var host = await ServerHost(az, group, server);
          var connection = Connection(host, "calendar_migrator", password);
          if (env == "production") { await output.WriteLineAsync($"Production restore point (UTC): {DateTimeOffset.UtcNow:O}"); }
          try { await RunLocal(bundle, [], ".", connection); }
          catch (InvalidOperationException) { throw new InvalidOperationException("Migration bundle failed; the existing revision keeps serving. Inspect database migration state before retrying."); }
        });
      });
      return 0;
    }
    await PrepareServer(az, env, group, server);
    await WithFirewall(az, group, server, ip, async () =>
    {
      var host = await ServerHost(az, group, server);
      var admin = await ReadSecret(az, ops, PasswordName);
      var appVault = await VaultName(az, env, "appKeyVaultName");
      await using var connection = new NpgsqlConnection(Connection(host, "calendaradmin", admin));
      await connection.OpenAsync();
      var names = await SecretNames(az, ops, false);
      var migrator = await EnsureRole(az, connection, host, ops, names, "calendar_migrator", "calendar-migrator-password", output);
      _ = migrator;
      var app = await EnsureRole(az, connection, host, ops, names, "calendar_app", "calendar-app-password", output);
      var expected = Connection(host, "calendar_app", app);
      var appNames = await SecretNames(az, appVault, false);
      if (appNames.Contains("calendar-connection-string", StringComparer.OrdinalIgnoreCase))
      {
        CheckConnectionSecret(await ReadSecret(az, appVault, "calendar-connection-string"), expected);
      }
      else { await StoreSecret(az, appVault, "calendar-connection-string", expected); }
      await ApplyGrants(connection);
      await output.WriteLineAsync("Role grants applied.");
    });
    return 0;
  }

  private static async Task<string> EnsureRole(IAzureProcess az, NpgsqlConnection connection, string host, string vault, string[] names, string role, string secret, TextWriter output)
  {
    await using var existsCommand = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = @role)", connection);
    existsCommand.Parameters.AddWithValue("role", role);
    var exists = (bool)(await existsCommand.ExecuteScalarAsync() ?? false);
    var hasSecret = names.Contains(secret, StringComparer.OrdinalIgnoreCase);
    return await ReconcileRole(exists, hasSecret,
      () => StoreSecret(az, vault, secret, "Aa1!" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))),
      () => ReadSecret(az, vault, secret),
      async password =>
      {
        try { await using var verify = new NpgsqlConnection(Connection(host, role, password)); await verify.OpenAsync(); return true; }
        catch (Exception ex) when (ex is NpgsqlException or IOException) { return false; }
      },
      password => CreateRole(connection, role, password),
      message => output.WriteLineAsync($"{role}: {message}"));
  }

  internal static async Task CreateRole(NpgsqlConnection connection, string role, string password)
  {
    await using var format = new NpgsqlCommand("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', @role, @password)", connection);
    format.Parameters.AddWithValue("role", role);
    format.Parameters.AddWithValue("password", password);
    var sql = (string)(await format.ExecuteScalarAsync() ?? throw new InvalidOperationException("Unable to create role."));
    await using var create = new NpgsqlCommand(sql, connection);
    await create.ExecuteNonQueryAsync();
  }

  internal const string GrantsSql = "ALTER DATABASE calendar OWNER TO calendar_migrator; REVOKE ALL ON DATABASE calendar FROM PUBLIC; GRANT CONNECT ON DATABASE calendar TO CURRENT_USER; GRANT CONNECT ON DATABASE calendar TO calendar_app; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO calendar_migrator; GRANT USAGE ON SCHEMA public TO calendar_app; ALTER DEFAULT PRIVILEGES FOR ROLE calendar_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO calendar_app; ALTER DEFAULT PRIVILEGES FOR ROLE calendar_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO calendar_app;";

  internal static async Task ApplyGrants(NpgsqlConnection connection)
  {
    await using var grants = new NpgsqlCommand(GrantsSql, connection);
    await grants.ExecuteNonQueryAsync();
  }

  internal static async Task<string> ReconcileRole(bool exists, bool hasSecret, Func<Task> store, Func<Task<string>> read, Func<string, Task<bool>> verify, Func<string, Task> create, Func<string, Task> report)
  {
    if (exists && !hasSecret) { throw new InvalidOperationException(Recovery); }
    if (!hasSecret) { await store(); }
    var password = await read();
    if (exists)
    {
      if (!await verify(password)) { throw new InvalidOperationException(Recovery); }
      await report("existing credential verified.");
    }
    else { await create(password); await report("created."); }
    return password;
  }

  internal static void CheckConnectionSecret(string actual, string expected)
  {
    if (actual != expected) { throw new InvalidOperationException("Existing app connection string differs from the expected value. " + Recovery); }
  }

  private static string Connection(string host, string role, string password) => new NpgsqlConnectionStringBuilder { Host = host, Database = "calendar", Username = role, Password = password, SslMode = SslMode.VerifyFull }.ConnectionString;
  private static Task<string> ReadSecret(IAzureProcess az, string vault, string name) => az.RunAsync("keyvault", "secret", "show", "--vault-name", vault, "--name", name, "--query", "value", "-o", "tsv");
  internal static Task StoreSecret(IAzureProcess az, string vault, string name, string value) => WithPrivateFile(value, async path => { await az.RunAsync("keyvault", "secret", "set", "--vault-name", vault, "--name", name, "--file", path, "--output", "none"); });
  private static Task<string> ServerHost(IAzureProcess az, string group, string server) => az.RunAsync("postgres", "flexible-server", "show", "--resource-group", group, "--name", server, "--query", "fullyQualifiedDomainName", "-o", "tsv");

  private static async Task PrepareServer(IAzureProcess az, string env, string group, string server)
  {
    var state = await az.RunAsync("postgres", "flexible-server", "show", "--resource-group", group, "--name", server, "--query", "state", "-o", "tsv");
    if (state == "Stopped" && env == "staging") { await az.RunAsync("postgres", "flexible-server", "start", "--resource-group", group, "--name", server, "--output", "none"); }
    else if (state != "Ready") { throw new InvalidOperationException("PostgreSQL server is not ready."); }
    await az.RunAsync("postgres", "flexible-server", "wait", "--resource-group", group, "--name", server, "--custom", "state=='Ready'");
  }

  internal static async Task WithFirewall(IAzureProcess az, string group, string server, string ip, Func<Task> action)
  {
    var rule = "calendar-migration-" + Guid.NewGuid().ToString("N");
    try
    {
      await az.RunAsync("postgres", "flexible-server", "firewall-rule", "create", "--resource-group", group, "--server-name", server, "--name", rule, "--start-ip-address", ip, "--end-ip-address", ip, "--output", "none");
      await action();
    }
    finally { await DeleteFirewall(az, group, server, rule); }
  }

  private static async Task DeleteFirewall(IAzureProcess az, string group, string server, string rule)
  {
    try { await az.RunAsync("postgres", "flexible-server", "firewall-rule", "delete", "--resource-group", group, "--server-name", server, "--name", rule, "--yes", "--output", "none"); }
    catch (InvalidOperationException) { throw new InvalidOperationException($"Could not remove temporary firewall rule {rule} from {server}; remove it manually."); }
  }

  private static async Task RunLocal(string command, string[] args, string directory, string? connection, Func<string, Task>? after = null)
  {
    var info = new ProcessStartInfo(command) { WorkingDirectory = directory, RedirectStandardOutput = true, RedirectStandardError = true };
    foreach (var arg in args) { info.ArgumentList.Add(arg); }
    if (connection is not null) { info.Environment["CALENDAR_MIGRATOR_CONNECTION"] = connection; }
    using var process = Process.Start(info) ?? throw new InvalidOperationException("Unable to start migration command.");
    var stdout = process.StandardOutput.ReadToEndAsync();
    var stderr = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync();
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
