using System.ComponentModel;
using System.Diagnostics;

namespace AgentHooks;

/// <summary>
/// The .NET versions the session-start line names: the SDK that <c>dotnet</c> selects in the current directory (the one
/// the hook's own <c>dotnet run</c> used, global.json included) and the runtime the tool runs on.
/// </summary>
public static class DotnetSdk
{
  /// <summary>How long <c>dotnet --version</c> may take before the SDK is reported as unknown (it takes about 0.2 s).</summary>
  public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

  /// <summary>The SDK version that <c>dotnet --version</c> prints, or null when it fails or takes longer than the timeout.</summary>
  public static Task<string?> VersionAsync(TimeSpan timeout) => RunAsync("dotnet", ["--version"], timeout);

  /// <summary>The text after ".NET " on the session-start line.</summary>
  public static string Describe(string? sdkVersion, string runtimeVersion) =>
    $"SDK {sdkVersion ?? "unknown"}, runtime {runtimeVersion}";

  /// <summary>The SDK version on the last non-empty line of the output, or null when that line is not one.</summary>
  public static string? Parse(string output)
  {
    var last = output.Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.Length > 0);
    if (last is null)
    {
      return null;
    }
    // An SDK version has three parts and an optional prerelease label: 10.0.403, 10.0.100-rc.2.25502.107.
    return Version.TryParse(last.Split('-', 2)[0], out Version? version) && version.Build >= 0 && version.Revision < 0
      ? last
      : null;
  }

  /// <summary>Runs the executable and parses its standard output; null when it is missing, fails or times out.</summary>
  internal static async Task<string?> RunAsync(string executable, IReadOnlyList<string> args, TimeSpan timeout)
  {
    var info = new ProcessStartInfo(OnPath(executable))
    {
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false,
    };
    foreach (var arg in args)
    {
      info.ArgumentList.Add(arg);
    }
    try
    {
      using var process = Process.Start(info);
      if (process is null)
      {
        return null;
      }
      using var expiry = new CancellationTokenSource(timeout);
      Task<string> output = process.StandardOutput.ReadToEndAsync(expiry.Token);
      Task<string> errors = process.StandardError.ReadToEndAsync(expiry.Token);
      try
      {
        await process.WaitForExitAsync(expiry.Token);
        await Task.WhenAll(output, errors);
      }
      catch (OperationCanceledException)
      {
        process.Kill(entireProcessTree: true);
        return null;
      }
      return process.ExitCode == 0 ? Parse(await output) : null;
    }
    catch (Win32Exception)
    {
      return null;
    }
  }

  /// <summary>The executable's absolute path on PATH, so the process start uses one; the bare name when it is not found.</summary>
  private static string OnPath(string executable) =>
    (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
      .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
      .Select(dir => Path.Combine(dir, OperatingSystem.IsWindows() ? executable + ".exe" : executable))
      .FirstOrDefault(File.Exists) ?? executable;
}
