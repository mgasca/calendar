using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace AgentHooks;

/// <summary>Runs an external command with a time limit. Every failure is an answer of null, never an exception.</summary>
public static class ExternalCommand
{
  /// <summary>What a command that finished printed on standard output, and its exit code.</summary>
  public sealed record Output(int ExitCode, string Stdout);

  /// <summary>
  /// Runs the executable in <paramref name="cwd"/> with its stdin closed. Null when the directory or executable is missing,
  /// or when it runs longer than <paramref name="timeout"/>, in which case its process tree is killed.
  /// </summary>
  public static Output? Run(
    string executable,
    IReadOnlyList<string> args,
    string cwd,
    TimeSpan timeout,
    IReadOnlyDictionary<string, string>? environment = null)
  {
    if (!Directory.Exists(cwd))
    {
      return null;
    }
    var info = new ProcessStartInfo(OnPath(executable))
    {
      WorkingDirectory = cwd,
      RedirectStandardInput = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false,
    };
    foreach (var arg in args)
    {
      info.ArgumentList.Add(arg);
    }
    foreach ((var name, var value) in environment ?? new Dictionary<string, string>())
    {
      info.Environment[name] = value;
    }
    try
    {
      using var process = new Process { StartInfo = info };
      var stdout = new StringBuilder();
      process.OutputDataReceived += (_, e) =>
      {
        if (e.Data is not null)
        {
          stdout.AppendLine(e.Data);
        }
      };
      Start(process, StartDeadline);
      process.StandardInput.Close();
      process.BeginOutputReadLine();
      process.BeginErrorReadLine();
      if (!process.WaitForExit(timeout))
      {
        process.Kill(entireProcessTree: true);
        return null;
      }
      // The timed wait can return before the output events finish; the untimed one waits for them.
      process.WaitForExit();
      return new Output(process.ExitCode, stdout.ToString());
    }
    catch (Exception e) when (e is Win32Exception or InvalidOperationException)
    {
      return null;
    }
  }

  /// <summary>Linux errno ETXTBSY: the executable is open for writing in some process.</summary>
  private const int TextFileBusy = 26;

  private static readonly TimeSpan StartDeadline = TimeSpan.FromSeconds(2);

  /// <summary>
  /// Starts the process, retrying while Linux reports the executable busy. A script written a moment ago can still be
  /// open for writing in a child that another thread's process start forked and has not yet exec'd, which fails the
  /// start with ETXTBSY until that child execs (#528).
  /// </summary>
  private static void Start(Process process, TimeSpan deadline)
  {
    var clock = Stopwatch.StartNew();
    while (true)
    {
      try
      {
        process.Start();
        return;
      }
      catch (Win32Exception e) when (e.NativeErrorCode == TextFileBusy && clock.Elapsed < deadline)
      {
        using var gate = new ManualResetEventSlim();
        gate.Wait(20);
      }
    }
  }

  /// <summary>
  /// The executable's absolute path on PATH, so the process start uses one (S4036); an absolute path is kept, and the bare
  /// name is returned when nothing on PATH matches.
  /// </summary>
  public static string OnPath(string executable) =>
    Path.IsPathRooted(executable)
      ? executable
      : (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
        .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
        .Select(dir => Path.Combine(dir, OperatingSystem.IsWindows() ? executable + ".exe" : executable))
        .FirstOrDefault(File.Exists) ?? executable;
}
