using System.Runtime.CompilerServices;

namespace Calendar.Api.Tests;

internal static class TestHostDefaults
{
  // Every host would otherwise open an inotify watcher for appsettings*.json (reloadOnChange), and a test run creates
  // hundreds of hosts, exhausting fs.inotify.max_user_instances (128 by default on WSL2). Tests never edit config files.
  // It must be an environment variable: WebApplication.CreateBuilder reads it before any factory hook runs.
  [ModuleInitializer]
  internal static void DisableConfigReloadOnChange() =>
    // so we don't deplete notifiers based on unit tests watching for changes
    Environment.SetEnvironmentVariable("DOTNET_hostBuilder:reloadConfigOnChange", "false");

  // `just` loads .env into every recipe, so a developer's Auth__* values (DevSeedKey, AllowedEmails, Google credentials)
  // reach the test process. A DevSeedKey in Development restricts the fallback policy to the cookie and seed schemes,
  // which rejects the fake test scheme with 401. Tests that need these settings pass them with UseSetting.
  [ModuleInitializer]
  internal static void IsolateFromDeveloperAuthSettings()
  {
    var names = Environment.GetEnvironmentVariables().Keys.Cast<string>()
      .Where(key => key.StartsWith("Auth__", StringComparison.Ordinal))
      .ToList();
    foreach (var name in names)
    {
      Environment.SetEnvironmentVariable(name, null);
    }
  }
}
