using System.Text.RegularExpressions;

namespace InfraTool;

/// <summary>A failed Azure CLI process, retained privately until sanitized.</summary>
public sealed class AzureFailureException(int exitCode, string stdout, string stderr) : InvalidOperationException("Azure CLI failed.")
{
  internal int ExitCode { get; } = exitCode;
  internal string Stdout { get; } = stdout;
  internal string Stderr { get; } = stderr;
  internal string Command { get; set; } = "az";
  internal string Step { get; set; } = "running Azure CLI";
}

internal sealed class Diagnostics(IAzureProcess inner, TextWriter output)
{
  internal static readonly AsyncLocal<Diagnostics?> Current = new();
  private readonly List<string> secrets = [];
  private int step;
  internal bool Verbose { get; set; }
  internal void Mask(string value) { if (!string.IsNullOrEmpty(value)) { secrets.Add(value); } }

  internal string Sanitize(string text)
  {
    foreach (var secret in secrets.OrderByDescending(s => s.Length)) { text = text.Replace(secret, "[redacted]", StringComparison.Ordinal); }
    var timeout = TimeSpan.FromSeconds(1);
    text = Regex.Replace(text, """(?i)(["']?(?:[\w.-]*(?:password|secret|token|credential|connection[-_ ]?string|key)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}\r\n]+)""", "$1[redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, @"(?i)\bBearer\s+[^\s,;]+", "Bearer [redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, @"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b", "[redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, @"\b[A-Za-z0-9+/=_-]{40,}\b", "[redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, """\?[^\s"']*(?:sig|se|sp|sv)=[^\s"']*""", "?[redacted]", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, timeout);
    return text;
  }

  internal async Task Report(AzureFailureException failure, TextWriter error)
  {
    var body = Sanitize($"stdout:\n{failure.Stdout}\nstderr:\n{failure.Stderr}");
    var transcript = Sanitize($"Step: {failure.Step}\nCommand: {failure.Command}\nExit code: {failure.ExitCode}\n{body}\n");
    var path = await Infra.WriteTranscript(transcript);
    await error.WriteLineAsync($"{failure.Step}: {failure.Command} failed (exit {failure.ExitCode}).");
    var lines = body.Split('\n');
    var truncated = lines.Length > 60 || body.Length > 8192;
    if (!Verbose && truncated)
    {
      body = string.Join('\n', lines.TakeLast(60));
      if (body.Length > 8192) { body = body[^8192..]; }
      await error.WriteLineAsync("Output truncated to the last 60 lines / 8 KB; use --verbose for full sanitized output.");
    }
    await error.WriteLineAsync(body);
    await error.WriteLineAsync($"Sanitized transcript: {path}");
  }

  internal IAzureProcess Wrap() => new ReportingAzure(this, inner, output);

  private sealed class ReportingAzure(Diagnostics diagnostics, IAzureProcess inner, TextWriter output) : IAzureProcess
  {
    public Task<string> RunAsync(params string[] args) => Run(args, false);
    public Task<string> RunCleanupAsync(params string[] args) => Run(args, true);
    private async Task<string> Run(string[] args, bool cleanup)
    {
      var path = CommandPath(args);
      var label = Label(args);
      await output.WriteLineAsync($"[{++diagnostics.step}] {label}");
      try { return cleanup ? await inner.RunCleanupAsync(args) : await inner.RunAsync(args); }
      catch (AzureFailureException ex) { ex.Command = path; ex.Step = label; throw; }
    }
    private static string CommandPath(string[] args)
    {
      var words = new HashSet<string>(StringComparer.Ordinal) { "rest", "bicep", "build-params", "deployment", "group", "operation", "create", "what-if", "show", "list", "resource", "keyvault", "secret", "set", "postgres", "flexible-server", "firewall-rule", "delete", "start", "stop", "wait" };
      return "az " + string.Join(' ', args.TakeWhile(words.Contains));
    }
    private static string Label(string[] args)
    {
      if (args.Contains("build-params")) { return "compiling parameters"; }
      if (args.Contains("deployment") && (args.Contains("create") || args.Contains("what-if"))) { return args.Contains("what-if") ? "previewing deployment" : "creating deployment"; }
      if (args.Contains("keyvault") && args.Contains("show")) { return "reading vault secret"; }
      if (args.Contains("keyvault") && args.Contains("list")) { return "listing vault secrets"; }
      if (args.Contains("keyvault") && args.Contains("set")) { return "storing vault secret"; }
      return "running " + CommandPath(args);
    }
  }
}
