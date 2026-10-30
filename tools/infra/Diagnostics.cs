using System.Text.RegularExpressions;
using System.Text.Json.Nodes;

namespace InfraTool;

/// <summary>A failed Azure CLI process, retained privately until sanitized.</summary>
public sealed class AzureFailureException(int exitCode, string stdout, string stderr) : InvalidOperationException("Azure CLI failed.")
{
  internal int ExitCode { get; } = exitCode;
  internal string Stdout { get; } = stdout;
  internal string Stderr { get; } = stderr;
  internal string Command { get; set; } = "az";
  internal string Step { get; set; } = "running Azure CLI";
  internal List<string> Operations { get; } = [];
}

internal sealed class Diagnostics(IAzureProcess inner, TextWriter output, Func<TimeSpan, CancellationToken, Task>? delay = null, CancellationToken cancellationToken = default)
{
  internal static readonly AsyncLocal<Diagnostics?> Current = new();
  private readonly CancellationToken token = cancellationToken;
  private readonly Func<TimeSpan, CancellationToken, Task> wait = delay ?? Task.Delay;
  private readonly List<string> secrets = [];
  private int step;
  private bool appVault;
  private readonly List<string> failures = [];
  internal bool DeploymentMode { get; set; }
  internal bool Verbose { get; set; }
  internal int Retries { get; set; } = 2;
  internal void Mask(string value) { if (!string.IsNullOrEmpty(value)) { secrets.Add(value); } }

  internal string Sanitize(string text)
  {
    foreach (var secret in secrets.OrderByDescending(s => s.Length)) { text = text.Replace(secret, "[redacted]", StringComparison.Ordinal); }
    var timeout = TimeSpan.FromSeconds(1);
    text = Regex.Replace(text, """(?i)(["']?(?:[\w.-]*(?:password|secret|token|credential|connection[-_ ]?string|key)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}\r\n]+)""", "$1[redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, @"(?i)\bBearer\s+[^\s,;]+", "Bearer [redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, @"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b", "[redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, @"\b[A-Za-z0-9+=_-]{40,}\b", "[redacted]", RegexOptions.CultureInvariant, timeout);
    text = Regex.Replace(text, """\?[^\s"']*(?:sig|se|sp|sv)=[^\s"']*""", "?[redacted]", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, timeout);
    return text;
  }

  internal sealed record Hint(string Pattern, string Advice, string? RetryReason = null);
  private static readonly Hint[] Hints =
  [
    new(@"(?is)(unable to get value using.{0,100}managed identity|key.?vault.{0,100}managed identity)", "The app identity may lack Key Vault Secrets User, or the grant may still be propagating; check the vault scope and wait up to 10 minutes before retrying.", "Key Vault identity access may be propagating"),
    new(@"(?is)(authorizationfailed.{0,300}(role.?assignment|propagat)|role.?assignment.{0,300}authorizationfailed)", "A recent role grant may still be propagating; check its scope and wait up to 10 minutes before retrying.", "role assignment may be propagating"),
    new(@"(?i)authorizationfailed", "Check the deployment identity's permissions and role assignment scope; a recent grant may take up to 10 minutes to propagate."),
    new(@"(?i)(serverisbusy|too many requests|throttl|\b429\b|\b5\d\d\b|server.{0,40}not.{0,15}ready)", "Azure may be temporarily busy; check server state and retry after a delay.", "Azure may be temporarily busy"),
    new(@"(?i)(invalidtemplate|validationfailed|validation error)", "Check the template and parameters reported by Azure, then correct the validation error."),
    new(@"(?i)(quotaexceeded|regionisofferrestricted|skunotavailable)", "Check subscription quota, region access and SKU availability before retrying."),
    new(@"(?i)(already exists|already taken|name.{0,20}unavailable|vaultalreadyexists|registrynameinvalid)", "The resource name may already be taken; check the name and choose an available one."),
    new(@"(?i)(firewall|client ip address)", "Check the server firewall rules and the client or application IP address."),
    new(@"(?i)(not logged in|az login|expired.{0,20}token|authenticationfailed|aadsts)", "The Azure login may be missing or expired; run az login and select the correct subscription."),
    new(@"(?i)(conflict|stopped server|server.{0,20}stopped)", "Check the resource state and resolve any conflicting operation or start the stopped server before retrying.")
  ];

  internal static Hint? Classify(string text) => Hints.FirstOrDefault(h => Regex.IsMatch(text, h.Pattern, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1)));

  internal async Task Report(AzureFailureException failure, TextWriter error)
  {
    var body = Sanitize($"stdout:\n{failure.Stdout}\nstderr:\n{failure.Stderr}");
    var operations = Sanitize(string.Join("\n", failure.Operations));
    var transcript = Sanitize(string.Join("\n", failures) + $"\nStep: {failure.Step}\nCommand: {failure.Command}\nExit code: {failure.ExitCode}\n{body}\n{operations}\n");
    var hint = Classify(failure.Stdout + "\n" + failure.Stderr + "\n" + string.Join("\n", failure.Operations));
    if (hint is not null) { transcript += "Hint: " + hint.Advice + "\n"; }
    var path = await Infra.WriteTranscript(transcript);
    await error.WriteLineAsync($"{failure.Step}: {failure.Command} failed (exit {failure.ExitCode}).");
    var display = body + (operations.Length > 0 ? "\n" + operations : "");
    var lines = display.Split('\n');
    var truncated = lines.Length > 60 || display.Length > 8192;
    if (!Verbose && truncated)
    {
      display = string.Join('\n', lines.TakeLast(60));
      if (display.Length > 8192) { display = display[^8192..]; }
      await error.WriteLineAsync("Output truncated to the last 60 lines / 8 KB; use --verbose for full sanitized output.");
    }
    await error.WriteLineAsync(display);
    if (hint is not null) { await error.WriteLineAsync("Hint: " + hint.Advice); }
    await error.WriteLineAsync($"Sanitized transcript: {path}");
  }

  internal async Task CollectOperations(AzureFailureException failure, string group, string deployment)
  {
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    await Visit(deployment, 0);
    async Task Visit(string name, int depth)
    {
      if (depth > 2 || !seen.Add(name)) { return; }
      try
      {
        var json = await inner.RunAsync("deployment", "operation", "group", "list", "--resource-group", group, "--name", name, "--query", "[?properties.provisioningState=='Failed']", "-o", "json");
        var operations = JsonNode.Parse(json)?.AsArray() ?? [];
        foreach (var operation in operations)
        {
          var properties = operation?["properties"];
          var resource = properties?["targetResource"];
          var type = resource?["resourceType"]?.ToString() ?? "unknown resource";
          var resourceName = resource?["resourceName"]?.ToString() ?? "unknown";
          var error = properties?["statusMessage"]?["error"];
          failure.Operations.Add($"Failed operation: {type}/{resourceName}: {error?["code"]} {error?["message"]}");
          if (type.Equals("Microsoft.Resources/deployments", StringComparison.OrdinalIgnoreCase)) { await Visit(resourceName, depth + 1); }
        }
      }
      catch (Exception ex) when (ex is AzureFailureException or System.Text.Json.JsonException or InvalidOperationException)
      {
        failure.Operations.Add("Could not retrieve deployment operations; the deployment may not have reached Azure.");
      }
    }
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
      if (diagnostics.DeploymentMode && args.Contains("keyvault") && args.Contains("list")) { label = diagnostics.appVault ? "listing app-vault secrets" : "listing ops-vault secrets"; }
      var progress = diagnostics.DeploymentMode ? Stage(args, diagnostics) + "/6" : (++diagnostics.step).ToString(System.Globalization.CultureInfo.InvariantCulture);
      await output.WriteLineAsync($"[{progress}] {label}");
      var attempt = 0;
      while (true)
      {
        try { return cleanup ? await inner.RunCleanupAsync(args) : await inner.RunAsync(args); }
        catch (AzureFailureException ex)
        {
          ex.Command = path;
          ex.Step = label;
          var deployment = args.Length >= 3 && args[0] == "deployment" && args[1] == "group" && args[2] is "create" or "what-if";
          if (deployment)
          {
            var groupIndex = Array.IndexOf(args, "--resource-group");
            var nameIndex = Array.IndexOf(args, "--name");
            if (groupIndex >= 0 && groupIndex + 1 < args.Length)
            {
              await diagnostics.CollectOperations(ex, args[groupIndex + 1], nameIndex >= 0 && nameIndex + 1 < args.Length ? args[nameIndex + 1] : "main");
            }
          }
          var hint = Classify(ex.Stdout + "\n" + ex.Stderr + "\n" + string.Join("\n", ex.Operations));
          var readOnly = args.Length >= 2 && ((args[0] == "rest" && args.Contains("get")) || (args[0] == "bicep" && args[1] == "build-params") || ((args[0] == "resource" || args[0] == "keyvault" || args[0] == "deployment" || args[0] == "postgres") && (args.Contains("show") || args.Contains("list"))));
          if (cleanup || (!deployment && !readOnly) || attempt >= diagnostics.Retries || hint?.RetryReason is null) { throw; }
          diagnostics.failures.Add($"Attempt {attempt + 1}: {path} exit {ex.ExitCode}\nstdout:\n{ex.Stdout}\nstderr:\n{ex.Stderr}\n{string.Join("\n", ex.Operations)}");
          var seconds = 60 * Math.Pow(2, Math.Min(attempt, 5));
          await output.WriteLineAsync($"Attempt {attempt + 2}/{diagnostics.Retries + 1} after {hint.RetryReason}; retrying in {seconds} s");
          await diagnostics.wait(TimeSpan.FromSeconds(seconds), diagnostics.token);
          attempt++;
        }
      }
    }
    private static string Stage(string[] args, Diagnostics diagnostics)
    {
      if (args.Contains("rest")) { return "1"; }
      if (args.Contains("build-params")) { return "2"; }
      if (args.Contains("deployment") && args.Contains("show")) { diagnostics.appVault = args.Any(a => a.Contains("appKeyVaultName", StringComparison.Ordinal)); return diagnostics.appVault ? "5" : "3"; }
      if (args.Contains("keyvault") && args.Contains("show")) { return "4"; }
      if (args.Contains("keyvault") && args.Contains("list")) { return diagnostics.appVault ? "5" : "4"; }
      return "6";
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
      if (args.Contains("keyvault") && args.Contains("show")) { return args.Contains("postgres-admin-password") ? "reading the ops vault password" : "reading vault secret"; }
      if (args.Contains("keyvault") && args.Contains("list")) { return "listing vault secrets"; }
      if (args.Contains("keyvault") && args.Contains("set")) { return "storing vault secret"; }
      return "running " + CommandPath(args);
    }
  }
}
