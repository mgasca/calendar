using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using Shouldly;
using Xunit;

namespace CiTimings.Tests;

/// <summary>
/// Runs the committed gate program, <c>.github/ci-gate.jq</c>, with jq on canned jobs API responses and a baseline file
/// written by <see cref="BaselineIo.Write"/>, so the program, the file format and the workflow step cannot drift apart
/// (ADR 0045). jq must be on PATH: a missing jq fails these tests, it never skips them.
/// </summary>
public sealed class GateTests
{
  private sealed record GateRun(int ExitCode, string Output, string Error);

  private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-06T20:04:12Z", CultureInfo.InvariantCulture);

  private static readonly string Root = FindRoot();

  private static string GatePath => Path.Combine(Root, ".github", "ci-gate.jq");

  private static string FindRoot([CallerFilePath] string path = "")
  {
    DirectoryInfo? directory = new FileInfo(path).Directory;
    while (directory is not null && !File.Exists(Path.Combine(directory.FullName, ".github", "ci-gate.jq")))
    {
      directory = directory.Parent;
    }
    return directory?.FullName ?? throw new InvalidOperationException($"no .github/ci-gate.jq above {path}");
  }

  /// <summary>A pinned baseline: Backend median 80 s (threshold 95), Docs site 80 s on check and 100 s on publication.</summary>
  private static string Baseline(string status = "pinned", bool withFrontend = true)
  {
    List<SampledRun> sampled = [];
    for (var index = 0; index < 4; index++)
    {
      List<PathSample> check = [new(index, "Backend", "check", 80), new(index, "Docs site", "check", 80)];
      if (withFrontend)
      {
        check.Add(new(index, "Frontend", "check", 40));
      }
      sampled.Add(new SampledRun(Run(index, "workflow_dispatch"), check));
      sampled.Add(new SampledRun(
        Run(10 + index, "push"),
        [new(10 + index, "Backend", "publication", 80), new(10 + index, "Docs site", "publication", 100)]));
    }
    BaselineFile file = BaselineRuns.Build("ci.yml", "docs/benchmarks/0014-ci-job-baseline.md", 4, GateConstants.Default, sampled);
    var json = BaselineIo.Write(file);
    return status == "pinned" ? json : json.Replace("\"status\": \"pinned\"", $"\"status\": \"{status}\"", StringComparison.Ordinal);
  }

  private static WorkflowRun Run(long id, string runEvent) => new(id, "completed", "success", T0.AddMinutes(id), runEvent, "main", "c");

  private static string Job(string name, int seconds, string conclusion = "success", bool published = false)
  {
    var end = T0.AddSeconds(seconds).ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
    var publication = published ? "success" : "skipped";
    var steps = name == "Docs site"
      ? $$"""[{ "number": 14, "name": "Build and verify publication artifact", "conclusion": "{{publication}}" }]"""
      : "[]";
    var status = conclusion.Length == 0 ? "in_progress" : "completed";
    var completed = conclusion.Length == 0 ? "null" : $"\"{end}\"";
    var outcome = conclusion.Length == 0 ? "null" : $"\"{conclusion}\"";
    return $$"""
      { "name": "{{name}}", "status": "{{status}}", "conclusion": {{outcome}},
        "started_at": "2026-11-06T20:04:12Z", "completed_at": {{completed}}, "steps": {{steps}} }
      """;
  }

  private static string Jobs(params string[] jobs) => $"{{ \"total_count\": {jobs.Length}, \"jobs\": [{string.Join(",", jobs)}] }}";

  private static GateRun Gate(string jobs, string baseline, string runEvent, string? format = null)
  {
    DirectoryInfo directory = Directory.CreateTempSubdirectory("ci-gate-tests-");
    try
    {
      var jobsPath = Path.Combine(directory.FullName, "jobs.json");
      var baselinePath = Path.Combine(directory.FullName, "ci-baseline.json");
      File.WriteAllText(jobsPath, jobs);
      File.WriteAllText(baselinePath, baseline);
      List<string> arguments = ["-r", "-f", GatePath, "--slurpfile", "baseline", baselinePath, "--arg", "event", runEvent];
      if (format is not null)
      {
        arguments.AddRange(["--arg", "format", format]);
      }
      arguments.Add(jobsPath);
      return RunJq(arguments);
    }
    finally
    {
      directory.Delete(recursive: true);
    }
  }

  private static GateRun RunJq(IEnumerable<string> arguments)
  {
    var jq = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
      .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
      .Select(dir => Path.Combine(dir, "jq"))
      .FirstOrDefault(File.Exists)
      ?? throw new InvalidOperationException("jq is not on PATH: the gate tests need it (ADR 0045); install jq, they never skip");
    var start = new ProcessStartInfo(jq) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
    foreach (var argument in arguments)
    {
      start.ArgumentList.Add(argument);
    }
    using Process process = Process.Start(start) ?? throw new InvalidOperationException("jq did not start");
    Task<string> output = process.StandardOutput.ReadToEndAsync();
    Task<string> error = process.StandardError.ReadToEndAsync();
    process.WaitForExit();
    return new GateRun(process.ExitCode, output.Result, error.Result);
  }

  [Fact]
  public void AnOrdinaryPullRequestRun_Passes()
  {
    GateRun run =
      Gate(Jobs(Job("Backend", 82), Job("Docs site", 79), Job("Frontend", 41)), Baseline(), "pull_request");

    run.Error.ShouldBeEmpty();
    run.ExitCode.ShouldBe(0);
    run.Output.ShouldContain("Backend: 1:22, within its threshold of 1:35 (median 1:20).");
    run.Output.ShouldNotContain("::error::");
    run.Output.ShouldNotContain("::warning::");
  }

  [Theory]
  [InlineData("pull_request")]
  [InlineData("merge_group")]
  public void ASlowJobOnAGatingEvent_FailsAndNamesTheJobTimeThresholdAndMedian(string runEvent)
  {
    GateRun run = Gate(Jobs(Job("Backend", 140), Job("Docs site", 79)), Baseline(), runEvent);

    run.ExitCode.ShouldBe(1);
    run.Output.ShouldContain(
      "::error::Backend took 2:20 on the check path, above its threshold of 1:35 (baseline median 1:20, n = 4, "
      + "docs/benchmarks/0014-ci-job-baseline.md).");
    run.Output.ShouldContain("Re-run all jobs");
    run.Output.ShouldContain("Docs site: 1:19, within");
    run.Error.ShouldContain("A job took longer than its pinned baseline allows");
  }

  [Fact]
  public void ExactlyAtTheThreshold_Passes() =>
    Gate(Jobs(Job("Backend", 95), Job("Docs site", 79)), Baseline(), "pull_request").ExitCode.ShouldBe(0);

  [Fact]
  public void OneSecondAboveTheThreshold_Fails() =>
    Gate(Jobs(Job("Backend", 96), Job("Docs site", 79)), Baseline(), "pull_request").ExitCode.ShouldBe(1);

  [Fact]
  public void APublishedRun_IsComparedWithThePublicationPath()
  {
    // 110 s is within the publication threshold (100 + 15 = 115) but above the check one (80 + 15 = 95).
    GateRun run =
      Gate(Jobs(Job("Docs site", 110, published: true), Job("Backend", 80)), Baseline(), "pull_request");

    run.ExitCode.ShouldBe(0);
    run.Output.ShouldContain("Docs site: 1:50, within its threshold of 1:55 (median 1:40).");
  }

  [Fact]
  public void AnUnpublishedRun_IsComparedWithTheCheckPath() =>
    Gate(Jobs(Job("Docs site", 110), Job("Backend", 80)), Baseline(), "pull_request").Output
      .ShouldContain("::error::Docs site took 1:50 on the check path, above its threshold of 1:35");

  [Fact]
  public void AJobWithNoBaselineEntry_WarnsAndPasses()
  {
    GateRun run =
      Gate(Jobs(Job("Backend", 80), Job("Docs site", 80), Job("Tooling", 900)), Baseline(), "pull_request");

    run.ExitCode.ShouldBe(0);
    run.Output.ShouldContain("::warning::Tooling has no baseline on the check path; it is not gated until the next baseline update.");
  }

  [Fact]
  public void APathWithNoBaseline_WarnsOnceAndPasses()
  {
    var baseline = BaselineIo.Write(BaselineRuns.Build(
      "ci.yml",
      "docs/benchmarks/0014-ci-job-baseline.md",
      1,
      GateConstants.Default,
      [new SampledRun(Run(1, "push"), [new PathSample(1, "Backend", "publication", 80)])]));

    GateRun run = Gate(Jobs(Job("Backend", 900)), baseline, "pull_request");

    run.ExitCode.ShouldBe(0);
    run.Output.ShouldBe("::warning::No baseline for the check path in .github/ci-baseline.json; no job is gated.\n");
  }

  [Theory]
  [InlineData("push")]
  [InlineData("workflow_dispatch")]
  public void ASlowJobOnAMainRun_OnlyWarns(string runEvent)
  {
    GateRun run = Gate(Jobs(Job("Backend", 140), Job("Docs site", 79)), Baseline(), runEvent);

    run.ExitCode.ShouldBe(0);
    run.Error.ShouldBeEmpty();
    run.Output.ShouldContain($"::warning::Backend took 2:20 on the check path, above its threshold of 1:35");
    run.Output.ShouldContain($"Not failing: the gate only reports on a {runEvent} run.");
  }

  [Fact]
  public void ASlowJobOnAProvisionalPath_OnlyWarns()
  {
    GateRun run =
      Gate(Jobs(Job("Backend", 140), Job("Docs site", 79)), Baseline("provisional"), "pull_request");

    run.ExitCode.ShouldBe(0);
    run.Output.ShouldContain("Not failing: the check baseline is provisional (fewer than 4 runs per job).");
  }

  [Fact]
  public void FailedSkippedRunningAndUngatedJobs_AreIgnored()
  {
    GateRun run = Gate(
      Jobs(
        Job("Backend", 900, "failure"),
        Job("Frontend", 900, "skipped"),
        Job("CI result", 900, ""),
        Job("Cancel superseded runs", 900),
        Job("Docs site", 79)),
      Baseline(),
      "pull_request");

    run.ExitCode.ShouldBe(0);
    run.Output.ShouldBe("Docs site: 1:19, within its threshold of 1:35 (median 1:20).\n");
  }

  [Fact]
  public void TheSummary_IsAMarkdownTableAndNeverFails()
  {
    GateRun run = Gate(
      Jobs(Job("Backend", 140), Job("Docs site", 79), Job("Tooling", 60)),
      Baseline(withFrontend: false),
      "pull_request",
      "summary");

    run.ExitCode.ShouldBe(0);
    run.Output.ShouldStartWith("### Job run times on the check path (ADR 0045)\n");
    run.Output.ShouldContain("| Backend | 2:20 | 1:35 | 1:20 | 4 | **above the threshold** |");
    run.Output.ShouldContain("| Docs site | 1:19 | 1:35 | 1:20 | 4 | within |");
    run.Output.ShouldContain("| Tooling | 1:00 | – | – | – | no baseline |");
  }

  [Fact]
  public void TheWorkflow_RunsThisGateFileInCiResult_OnTheSavedJobsResponse()
  {
    var workflow = File.ReadAllText(Path.Combine(Root, ".github", "workflows", "ci.yml"));
    var result = workflow[workflow.IndexOf("\n  result:\n", StringComparison.Ordinal)..];

    result.ShouldContain("sparse-checkout: .github");
    result.ShouldContain("> \"$RUNNER_TEMP/jobs.json\"");
    result.ShouldContain(
      "gate=(jq -r -f .github/ci-gate.jq --slurpfile baseline .github/ci-baseline.json --arg event \"$GITHUB_EVENT_NAME\")");
    result.ShouldContain("\"${gate[@]}\" \"$RUNNER_TEMP/jobs.json\"");
    result.IndexOf("ci-gate.jq", StringComparison.Ordinal)
      .ShouldBeGreaterThan(result.IndexOf("All CI jobs passed.", StringComparison.Ordinal));
  }

  [Fact]
  public void TheCommittedBaseline_IsReadableByTheTool_WhenPresent()
  {
    var path = Path.Combine(Root, ".github", "ci-baseline.json");
    if (File.Exists(path))
    {
      BaselineFile file = BaselineIo.Read(File.ReadAllText(path, Encoding.UTF8));
      file.Paths.ShouldNotBeEmpty();
      file.Paths.Values.SelectMany(baseline => baseline.Jobs.Values).ShouldAllBe(job => job.Threshold > job.Median);
    }
  }
}
