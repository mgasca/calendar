using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace DeliveryGuards;

/// <summary>The files the guards read, as text, keyed by their path relative to the repo root.</summary>
public sealed record RepoFiles(
  string Workflow,
  string BackendJustfile,
  string ToolsJustfile,
  IReadOnlyDictionary<string, string> BackendMsBuild)
{
  /// <summary>The workflow the guards check.</summary>
  public const string WorkflowPath = ".github/workflows/ci.yml";

  /// <summary>The MSBuild file that sets the backend's analysis switches.</summary>
  public const string BackendPropsPath = "backend/Directory.Build.props";

  /// <summary>Reads the files from a checkout rooted at <paramref name="root"/>.</summary>
  public static RepoFiles Load(string root)
  {
    string Read(string path) => File.ReadAllText(Path.Combine(root, path));

    var backend = Path.Combine(root, "backend");
    var msbuild = Directory.EnumerateFiles(backend, "*.*", SearchOption.AllDirectories)
      .Where(p => p.EndsWith(".props", StringComparison.Ordinal) || p.EndsWith(".targets", StringComparison.Ordinal)
        || p.EndsWith(".csproj", StringComparison.Ordinal))
      .Where(p => !p.Split(Path.DirectorySeparatorChar).Any(part => part is "bin" or "obj"))
      .ToDictionary(p => Path.GetRelativePath(root, p).Replace(Path.DirectorySeparatorChar, '/'), File.ReadAllText);
    return new RepoFiles(Read(WorkflowPath), Read("backend/mod.just"), Read("tools/mod.just"), msbuild);
  }
}

/// <summary>
/// One mechanism guard: a deterministic check that fails when the mechanism a delivery performance fix introduced
/// is reverted (epic #380, issue #387). It never measures time.
/// </summary>
/// <param name="Id">Stable name, used in test names and in the report.</param>
/// <param name="Fix">The issue whose fix it protects.</param>
/// <param name="Record">The benchmark record in docs/benchmarks that measured the fix, or "none".</param>
/// <param name="Mechanism">What must stay true, in one sentence.</param>
/// <param name="Check">Returns one message per violation; none means the guard passes.</param>
public sealed record Guard(string Id, string Fix, string Record, string Mechanism, Func<RepoFiles, IEnumerable<string>> Check);

/// <summary>The guards, and what they read from ci.yml, the just modules and the backend MSBuild files.</summary>
public static partial class Guards
{
  private const string SupersedeJobName = "Cancel superseded runs";
  private const string ResultJobName = "CI result";

  /// <summary>Every guard, in the order of the fixes.</summary>
  public static IReadOnlyList<Guard> All { get; } =
  [
    new(
      "superseded-runs",
      "#348",
      "0008",
      "A same-repository pull request run has a concurrency group of its own, and the Cancel superseded runs job cancels the older runs.",
      SupersededRuns),
    new(
      "format-whitespace-only",
      "#350",
      "0010",
      "Backend formatting is checked with dotnet format whitespace only, and the build enforces code style with warnings as errors.",
      FormatWhitespaceOnly),
    new(
      "parallel-tool-tests",
      "#351",
      "0011",
      "just tools test runs the test apps TOOLS_TEST_JOBS at a time (default above 1), with a NuGet cache in the Tooling job.",
      ParallelToolTests),
    new(
      "ci-result-needs-all",
      "#368",
      "none",
      "CI result always runs, needs every other job (except Cancel superseded runs) and passes only when all of them succeeded.",
      CiResultNeedsAll),
    new(
      "single-web-typecheck",
      "#276",
      "0006",
      "The Frontend job type-checks the web app once, in its typecheck step, and its build step is the bundler alone.",
      SingleWebTypecheck),
    new(
      "docs-site-job",
      "#274",
      "0004",
      "The docs site is checked in its own Docs site job: Frontend excludes it, and the docs typecheck reuses the build's sync.",
      DocsSiteJob),
  ];

  /// <summary>Runs every guard; a workflow that cannot be read fails every guard that reads it.</summary>
  public static IReadOnlyList<(Guard Guard, IReadOnlyList<string> Failures)> RunAll(RepoFiles files) =>
    [.. All.Select(g => (g, Run(g, files)))];

  /// <summary>Runs one guard and collects its failures.</summary>
  public static IReadOnlyList<string> Run(Guard guard, RepoFiles files)
  {
    try
    {
      return [.. guard.Check(files)];
    }
    catch (FormatException e)
    {
      return [$"{RepoFiles.WorkflowPath} could not be read: {e.Message}"];
    }
  }

  private static IEnumerable<string> SupersededRuns(RepoFiles files)
  {
    var workflow = Workflow.Parse(files.Workflow);
    var group = workflow.Root.Map("concurrency")?.Text("group") ?? "";
    foreach (var part in SameRepositoryPullRequest.Append("github.run_id").Where(p => !group.Contains(p, StringComparison.Ordinal)))
    {
      yield return $"concurrency.group does not contain `{part}`, so a same-repository pull request run shares a group "
        + "with the run it supersedes and queues until GitHub stops it.";
    }

    if (workflow.JobNamed(SupersedeJobName) is not { } job)
    {
      yield return $"no job is named `{SupersedeJobName}`.";
      yield break;
    }

    // The job holds actions: write, so the guard also keeps what makes that safe: same-repository pull requests only,
    // no other permission, and no step that fetches the pull request's code.
    var condition = job.Body.Text("if") ?? "";
    if (!Array.TrueForAll(SameRepositoryPullRequest, p => condition.Contains(p, StringComparison.Ordinal))
      || condition.Contains("!=", StringComparison.Ordinal) || condition.Contains("pull_request_target", StringComparison.Ordinal))
    {
      yield return $"`{SupersedeJobName}` does not run only for same-repository pull requests (its `if` must require "
        + $"`{SameRepositoryPullRequest[0]}` and `{SameRepositoryPullRequest[1]}`).";
    }

    YamlMapping? permissions = job.Body.Map("permissions");
    if (permissions is null || permissions.Entries.Count != 1 || permissions.Text("actions") != "write")
    {
      yield return $"`{SupersedeJobName}` must have exactly `permissions: actions: write`: it cannot cancel runs without it, "
        + "and any other scope is more than it needs.";
    }

    if (job.Steps.Any(FetchesCode))
    {
      yield return $"`{SupersedeJobName}` fetches code; with actions: write it must run no code from the pull request.";
    }

    if (!job.Steps.Any(s => Workflow.Run(s).Contains("gh run cancel", StringComparison.Ordinal)))
    {
      yield return $"`{SupersedeJobName}` has no step that runs `gh run cancel`.";
    }
  }

  private static readonly string[] SameRepositoryPullRequest =
    ["github.event_name == 'pull_request'", "github.event.pull_request.head.repo.full_name == github.repository"];

  private static bool FetchesCode(YamlMapping step) =>
    (step.Text("uses") ?? "").StartsWith("actions/checkout", StringComparison.OrdinalIgnoreCase)
    || FetchCommand().IsMatch(Workflow.Run(step));

  private static IEnumerable<string> FormatWhitespaceOnly(RepoFiles files)
  {
    var workflow = Workflow.Parse(files.Workflow);
    if (workflow.JobNamed("Backend") is not { } backend)
    {
      yield return "no job is named `Backend`.";
    }
    else
    {
      var commands = backend.Steps.SelectMany(s => Workflow.Run(s).Split('\n')).ToList();
      foreach (var failure in FormatCommands(commands, "the Backend job"))
      {
        yield return failure;
      }
    }

    if (JustRecipe(files.BackendJustfile, "lint") is not { } lint)
    {
      yield return "backend/mod.just has no `lint` recipe.";
    }
    else
    {
      foreach (var failure in FormatCommands(lint, "backend/mod.just `lint`"))
      {
        yield return failure;
      }
    }

    foreach (var failure in AnalysisSwitches(files.BackendMsBuild))
    {
      yield return failure;
    }
  }

  /// <summary>Every <c>dotnet format</c> command must be the whitespace check, and there must be one.</summary>
  private static IEnumerable<string> FormatCommands(IReadOnlyList<string> lines, string where)
  {
    var formats = lines.Select(l => l.Trim()).Where(l => DotnetFormat().IsMatch(l)).ToList();
    if (!formats.Exists(l => WhitespaceCheck().IsMatch(l)))
    {
      yield return $"{where} has no `dotnet format whitespace --verify-no-changes` step.";
    }

    foreach (var line in formats.Where(l => !WhitespaceCheck().IsMatch(l)))
    {
      yield return $"{where} runs `{line}`: the build already enforces code style and the analyzers, so only "
        + "`dotnet format whitespace` is needed.";
    }
  }

  private static IEnumerable<string> AnalysisSwitches(IReadOnlyDictionary<string, string> msbuild)
  {
    string[] switches = ["EnforceCodeStyleInBuild", "TreatWarningsAsErrors"];
    if (!msbuild.TryGetValue(RepoFiles.BackendPropsPath, out var props))
    {
      yield return $"{RepoFiles.BackendPropsPath} is missing.";
      yield break;
    }

    var shared = XDocument.Parse(props);
    foreach (var name in switches)
    {
      IEnumerable<XElement> unconditional = shared.Descendants(name)
        .Where(e => e.Attribute("Condition") is null && e.Parent?.Attribute("Condition") is null);
      if (!unconditional.Any(e => string.Equals(e.Value.Trim(), "true", StringComparison.OrdinalIgnoreCase)))
      {
        yield return $"{RepoFiles.BackendPropsPath} does not set `{name}` to true for every build.";
      }
    }

    foreach ((var path, var text) in msbuild.OrderBy(f => f.Key, StringComparer.Ordinal))
    {
      foreach (var name in switches)
      {
        foreach (XElement element in XDocument.Parse(text).Descendants(name)
          .Where(e => !string.Equals(e.Value.Trim(), "true", StringComparison.OrdinalIgnoreCase)))
        {
          yield return $"{path} sets `{name}` to `{element.Value.Trim()}`; the build must enforce code style with warnings as errors.";
        }
      }
    }
  }

  private static IEnumerable<string> ParallelToolTests(RepoFiles files)
  {
    IReadOnlyList<string>? test = JustRecipe(files.ToolsJustfile, "test");
    Match? jobs = test?.Select(l => ParallelJobs().Match(l)).FirstOrDefault(m => m.Success);
    if (jobs is null)
    {
      yield return "tools/mod.just `test` does not run the test apps with `xargs -P \"${TOOLS_TEST_JOBS:-N}\"`.";
    }
    else if (int.Parse(jobs.Groups["n"].Value, CultureInfo.InvariantCulture) <= 1)
    {
      yield return $"tools/mod.just `test` defaults TOOLS_TEST_JOBS to {jobs.Groups["n"].Value}: the test apps would run one at a time.";
    }

    var workflow = Workflow.Parse(files.Workflow);
    foreach ((var where, var value) in workflow.EnvValues("TOOLS_TEST_JOBS"))
    {
      if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n <= 1)
      {
        yield return $"{where} sets TOOLS_TEST_JOBS to `{value}`; it must be a number above 1.";
      }
    }

    foreach (Match match in workflow.Jobs.SelectMany(j => j.Steps).SelectMany(s => InlineJobs().Matches(Workflow.Run(s)))
      .Where(m => int.Parse(m.Groups["n"].Value, CultureInfo.InvariantCulture) <= 1))
    {
      yield return $"a step runs with `{match.Value}`: the test apps would run one at a time.";
    }

    WorkflowJob? tooling = workflow.Jobs
      .FirstOrDefault(j => j.Steps.Any(s => Workflow.Run(s).Contains("just tools test", StringComparison.Ordinal)));
    if (tooling is null)
    {
      yield return "no job runs `just tools test`.";
      yield break;
    }

    YamlMapping? setup = tooling.Steps
      .FirstOrDefault(s => (s.Text("uses") ?? "").StartsWith("actions/setup-dotnet", StringComparison.Ordinal));
    YamlMapping? with = setup?.Map("with");
    if (with?.Text("cache") != "true" || !(with.Text("cache-dependency-path") ?? "").Contains("tools/", StringComparison.Ordinal))
    {
      yield return $"the `{tooling.Name}` job's setup-dotnet step has no NuGet cache keyed on the tools' packages.lock.json files.";
    }
  }

  private static IEnumerable<string> CiResultNeedsAll(RepoFiles files)
  {
    var workflow = Workflow.Parse(files.Workflow);
    if (workflow.JobNamed(ResultJobName) is not { } result)
    {
      yield return $"no job is named `{ResultJobName}`.";
      yield break;
    }

    if (!(result.Body.Text("if") ?? "").Contains("always()", StringComparison.Ordinal))
    {
      yield return $"`{ResultJobName}` does not run `if: always()`, so it is skipped, not failed, when a needed job fails.";
    }

    var needs = result.Body.List("needs").OfType<YamlScalar>().Select(s => s.Value).ToHashSet(StringComparer.Ordinal);
    var optional = workflow.JobNamed(SupersedeJobName)?.Id;
    foreach (WorkflowJob? job in workflow.Jobs.Where(j => j.Id != result.Id && j.Id != optional && !needs.Contains(j.Id)))
    {
      yield return $"`{ResultJobName}` does not need `{job.Id}` ({job.Name}), so the required check can pass without it.";
    }

    if (optional is not null && needs.Contains(optional))
    {
      yield return $"`{ResultJobName}` needs `{optional}`, which is skipped on every run but a same-repository pull request.";
    }

    var script = string.Join('\n', result.Steps.Select(Workflow.Run));
    if (!script.Contains("all(.[]; .result == \"success\")", StringComparison.Ordinal))
    {
      yield return $"`{ResultJobName}` no longer requires every needed job's result to be success "
        + "(`all(.[]; .result == \"success\")`).";
    }

    if (!script.Contains("/jobs", StringComparison.Ordinal) || !script.Contains(".conclusion != \"success\"", StringComparison.Ordinal))
    {
      yield return $"`{ResultJobName}` no longer checks the jobs API for jobs that did not succeed (run 42270142424).";
    }
  }

  private static IEnumerable<string> SingleWebTypecheck(RepoFiles files)
  {
    var workflow = Workflow.Parse(files.Workflow);
    if (workflow.JobNamed("Frontend") is not { } frontend)
    {
      yield return "no job is named `Frontend`.";
      yield break;
    }

    var runs = frontend.Steps.Select(Workflow.Run).ToList();
    var typechecks = runs.Select((run, i) => (run, i)).Where(s => TypeChecks(s.run)).Select(s => s.i).ToList();
    var bundles = runs.Select((run, i) => (run, i)).Where(s => Bundles(s.run)).Select(s => s.i).ToList();
    if (typechecks.Count != 1)
    {
      yield return $"the Frontend job type-checks in {typechecks.Count} steps; it must be once, in its typecheck step "
        + "(a `pnpm build` runs `tsc -b` again).";
    }

    if (bundles.Count == 0)
    {
      yield return "the Frontend job has no web build step that runs `vite build` alone.";
    }
    else if (typechecks.Count > 0 && bundles[0] < typechecks[0])
    {
      yield return "the Frontend job's `vite build` step runs before its typecheck step.";
    }
  }

  private static bool TypeChecks(string run) =>
    run.Split('\n').Any(l => l.Contains("typecheck", StringComparison.Ordinal) || TscCommand().IsMatch(l) || PnpmBuild().IsMatch(l));

  private static bool Bundles(string run) => run.Split('\n').Any(l => VitePnpmExec().IsMatch(l));

  private static IEnumerable<string> DocsSiteJob(RepoFiles files)
  {
    var workflow = Workflow.Parse(files.Workflow);
    if (workflow.JobNamed("Frontend") is not { } frontend)
    {
      yield return "no job is named `Frontend`.";
    }
    else
    {
      foreach (var script in new[] { "typecheck", "test:coverage" })
      {
        var steps = frontend.Steps.Select(Workflow.Run).Where(r => r.Contains(script, StringComparison.Ordinal)).ToList();
        if (steps.Count == 0)
        {
          yield return $"the Frontend job has no `{script}` step.";
        }
        else if (!steps.TrueForAll(r => r.Contains("--filter '!@calendar/docs'", StringComparison.Ordinal)))
        {
          yield return $"the Frontend job's `{script}` step no longer excludes `@calendar/docs`, which the Docs site job runs.";
        }
      }
    }

    if (workflow.JobNamed("Docs site") is not { } docs)
    {
      yield return "no job is named `Docs site`.";
      yield break;
    }

    var typecheck = docs.Steps.Select(Workflow.Run).Where(r => r.Contains("typecheck", StringComparison.Ordinal)).ToList();
    if (typecheck.Count == 0 || !typecheck.TrueForAll(r => r.Contains("--noSync", StringComparison.Ordinal)))
    {
      yield return "the Docs site job's typecheck does not pass `--noSync`, so `astro check` repeats the content sync the build ran.";
    }
  }

  /// <summary>The body lines of a just recipe, or null when the file has no recipe of that name.</summary>
  public static IReadOnlyList<string>? JustRecipe(string justfile, string recipe)
  {
    var lines = justfile.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
    var header = new Regex($@"^@?{Regex.Escape(recipe)}(\s[^:=]*)?:(?!=)", RegexOptions.None, TimeSpan.FromSeconds(1));
    var start = Array.FindIndex(lines, l => header.IsMatch(l));
    if (start < 0)
    {
      return null;
    }

    return [.. lines.Skip(start + 1).TakeWhile(l => l.Length == 0 || l[0] is ' ' or '\t')];
  }

  [GeneratedRegex(@"\b(git\s+(clone|fetch|checkout|pull|worktree)|gh\s+(repo\s+clone|pr\s+checkout))\b", RegexOptions.None, 1000)]
  private static partial Regex FetchCommand();

  [GeneratedRegex(@"\bdotnet\s+format\b", RegexOptions.None, 1000)]
  private static partial Regex DotnetFormat();

  [GeneratedRegex(@"\bdotnet\s+format\s+whitespace\b.*--verify-no-changes\b", RegexOptions.None, 1000)]
  private static partial Regex WhitespaceCheck();

  [GeneratedRegex(@"xargs\s+(?:\S+\s+)*?-P\s*""?\$\{TOOLS_TEST_JOBS:-(?<n>\d+)\}""?", RegexOptions.None, 1000)]
  private static partial Regex ParallelJobs();

  [GeneratedRegex(@"\bTOOLS_TEST_JOBS=(?<n>\d+)", RegexOptions.None, 1000)]
  private static partial Regex InlineJobs();

  [GeneratedRegex(@"(^|[\s;&|(])(npx\s+|pnpm\s+(exec\s+)?)?tsc\b", RegexOptions.None, 1000)]
  private static partial Regex TscCommand();

  [GeneratedRegex(@"\bpnpm\b(?!.*\bexec\b).*\s(run\s+)?build\b", RegexOptions.None, 1000)]
  private static partial Regex PnpmBuild();

  [GeneratedRegex(@"\bpnpm\b.*\bexec\s+vite\s+build\b", RegexOptions.None, 1000)]
  private static partial Regex VitePnpmExec();
}

/// <summary>A workflow job: its key under <c>jobs</c>, its display name and its mapping.</summary>
public sealed record WorkflowJob(string Id, string Name, YamlMapping Body)
{
  /// <summary>The job's steps, as mappings.</summary>
  public IReadOnlyList<YamlMapping> Steps => [.. Body.List("steps").OfType<YamlMapping>()];
}

/// <summary>A GitHub Actions workflow, read with <see cref="WorkflowYaml"/>.</summary>
public sealed record Workflow(YamlMapping Root, IReadOnlyList<WorkflowJob> Jobs)
{
  /// <summary>Parses a workflow file.</summary>
  public static Workflow Parse(string yaml)
  {
    if (WorkflowYaml.Parse(yaml) is not YamlMapping root || root.Map("jobs") is not { } jobs)
    {
      throw new FormatException("the workflow has no `jobs` mapping.");
    }

    return new Workflow(root, [.. jobs.Entries
      .Where(e => e.Value is YamlMapping)
      .Select(e => new WorkflowJob(e.Key, ((YamlMapping)e.Value).Text("name") ?? e.Key, (YamlMapping)e.Value))]);
  }

  /// <summary>The job whose display name is <paramref name="name"/>, or null.</summary>
  public WorkflowJob? JobNamed(string name) => Jobs.FirstOrDefault(j => j.Name == name);

  /// <summary>A step's <c>run</c> script, or empty for a <c>uses</c> step.</summary>
  public static string Run(YamlMapping step) => step.Text("run") ?? "";

  /// <summary>Every value given to <paramref name="variable"/> in an <c>env</c> map: the workflow's, a job's or a step's.</summary>
  public IEnumerable<(string Where, string Value)> EnvValues(string variable)
  {
    if (Root.Map("env")?.Text(variable) is { } top)
    {
      yield return ("the workflow env", top);
    }

    foreach (WorkflowJob job in Jobs)
    {
      if (job.Body.Map("env")?.Text(variable) is { } atJob)
      {
        yield return ($"the `{job.Name}` job's env", atJob);
      }

      foreach (YamlMapping step in job.Steps)
      {
        if (step.Map("env")?.Text(variable) is { } atStep)
        {
          yield return ($"a step of `{job.Name}`", atStep);
        }
      }
    }
  }
}
