#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.3
#:package Shouldly@4.3.0
#:package YamlDotNet@18.1.0
#:include ../WorkflowYaml.cs
#:include ../DeliveryGuards.cs

// Tests for the delivery mechanism guards. Run: dotnet run tools/delivery-guards/tests/delivery-guards.tests.cs
// CheckoutTests run every guard against this checkout, so `just tools test` fails when a fix's mechanism is reverted.
// The other tests feed each guard a small fixture of its own, passing and then broken in each way the guard catches.

using System.Runtime.CompilerServices;
using Shouldly;
using Xunit;

namespace DeliveryGuards.Tests;

public sealed class CheckoutTests
{
  private static readonly RepoFiles Files = RepoFiles.Load(RepoRoot());

  public static TheoryData<string> GuardIds() => [.. Guards.All.Select(g => g.Id)];

  [Theory]
  [MemberData(nameof(GuardIds))]
  public void Guard_PassesOnThisCheckout(string id)
  {
    Guard guard = Guards.All.Single(g => g.Id == id);
    Guards.Run(guard, Files).ShouldBeEmpty($"{guard.Id} ({guard.Fix}): {guard.Mechanism}");
  }

  [Fact]
  public void Guards_HaveDistinctIdsAndCiteAFix()
  {
    Guards.All.Select(g => g.Id).ShouldBeUnique();
    Guards.All.ShouldAllBe(g => g.Fix.StartsWith('#') && (g.Record == "none" || g.Record.Length == 4));
  }

  [Fact]
  public void Workflow_IsReadAsTheJobsItHolds()
  {
    var workflow = Workflow.Parse(Files.Workflow);
    workflow.JobNamed("CI result").ShouldNotBeNull();
    workflow.Jobs.Count.ShouldBeGreaterThan(5);
    workflow.Jobs.ShouldAllBe(j => j.Steps.Count > 0);
  }

  private static string RepoRoot([CallerFilePath] string path = "")
  {
    for (var dir = new DirectoryInfo(Path.GetDirectoryName(path)!); dir is not null; dir = dir.Parent)
    {
      if (File.Exists(Path.Combine(dir.FullName, ".just-version")))
      {
        return dir.FullName;
      }
    }

    throw new InvalidOperationException($"No repo root above {path}.");
  }
}

/// <summary>A small repo that every guard passes; each test breaks one thing with a text replacement.</summary>
internal static class Fixture
{
  public const string Workflow = """
    name: CI
    on:
      pull_request:
    concurrency:
      group: >-
        ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
        && github.run_id || github.ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    jobs:
      changes:
        name: Changes
        outputs:
          backend: ${{ steps.decide.outputs.backend }}
          frontend: ${{ steps.decide.outputs.frontend }}
          docs: ${{ steps.decide.outputs.docs }}
          tooling: ${{ steps.decide.outputs.tooling }}
          skipped: ${{ steps.decide.outputs.skipped }}
        steps:
          - id: decide
            run: result=$(jq -c -f .github/ci-changes.jq <<< "$input")
      backend:
        name: Backend
        needs: changes
        if: needs.changes.outputs.backend == 'true'
        steps:
          - uses: actions/checkout@v7
          - run: dotnet build --no-restore -c Release
          - run: dotnet format whitespace --verify-no-changes --no-restore
      frontend:
        name: Frontend
        needs: changes
        if: needs.changes.outputs.frontend == 'true'
        steps:
          - run: pnpm install --frozen-lockfile
          - run: pnpm -r --filter '!@calendar/docs' typecheck
          - run: pnpm -r --filter '!@calendar/docs' test:coverage
          - name: Build the web app
            run: pnpm --filter @calendar/web exec vite build
      docs:
        name: Docs site
        needs: changes
        if: needs.changes.outputs.docs == 'true'
        steps:
          - run: pnpm --filter @calendar/docs build
          - run: pnpm --filter @calendar/docs typecheck --noSync
      tooling:
        name: Tooling
        needs: changes
        if: needs.changes.outputs.tooling == 'true'
        steps:
          - uses: actions/setup-dotnet@v6
            with:
              dotnet-version: 10.0.x
              cache: true
              cache-dependency-path: |
                tools/**/packages.lock.json
          - name: Test and lint tooling
            run: just tools test
      supersede:
        name: Cancel superseded runs
        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
        permissions:
          actions: write
        steps:
          - run: |
              for id in $ids; do
                gh run cancel "$id"
              done
      result:
        name: CI result
        if: ${{ always() }}
        needs: [changes, backend, frontend, docs, tooling]
        steps:
          - run: |
              jq -e '. as $needs | all(to_entries[]; .value.result == "success"
                or (.value.result == "skipped" and $needs.changes.outputs[.key] == "false"))' <<< "$NEEDS"
              gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs" --jq '.jobs[] | select(.conclusion != "success")
                | select(.conclusion != "skipped" or (.name | IN($skipped[]) | not))'
    """;

  public const string BackendJustfile = """
    # Analyzers and code style
    lint:
        dotnet build --no-restore
        dotnet format whitespace --verify-no-changes --no-restore

    # Auto-format the backend
    format:
        dotnet format
    """;

  public const string ToolsJustfile = """
    tool_dirs := "tools"

    # Test and lint repo tooling
    test:
        #!/usr/bin/env bash
        printf '%s\n' $tests | xargs -P "${TOOLS_TEST_JOBS:-4}" -I{} bash -c 'dotnet run "$1"' _ {}
    """;

  public const string Props = """
    <Project>
      <PropertyGroup>
        <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
        <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
      </PropertyGroup>
    </Project>
    """;

  public static RepoFiles Files(
    Func<string, string>? workflow = null,
    Func<string, string>? backendJust = null,
    Func<string, string>? toolsJust = null,
    Func<string, string>? props = null,
    string? project = null)
  {
    var msbuild = new Dictionary<string, string> { [RepoFiles.BackendPropsPath] = (props ?? Same)(Props) };
    if (project is not null)
    {
      msbuild["backend/src/Calendar.Api/Calendar.Api.csproj"] = project;
    }

    return new RepoFiles((workflow ?? Same)(Workflow), (backendJust ?? Same)(BackendJustfile), (toolsJust ?? Same)(ToolsJustfile), msbuild);
  }

  public static IReadOnlyList<string> Failures(string id, RepoFiles files) => Guards.Run(Guards.All.Single(g => g.Id == id), files);

  private static string Same(string text) => text;
}

public sealed class FixtureTests
{
  public static TheoryData<string> GuardIds() => [.. Guards.All.Select(g => g.Id)];

  [Theory]
  [MemberData(nameof(GuardIds))]
  public void Guard_PassesOnTheFixture(string id) => Fixture.Failures(id, Fixture.Files()).ShouldBeEmpty();

  [Fact]
  public void AnUnreadableWorkflow_FailsTheGuard() =>
    Fixture.Failures("superseded-runs", Fixture.Files(workflow: w => w + "\n  bad: [unclosed\n")).ShouldHaveSingleItem()
      .ShouldContain("could not be read");
}

public sealed class SupersededRunsTests
{
  private static IReadOnlyList<string> Failures(Func<string, string> workflow) =>
    Fixture.Failures("superseded-runs", Fixture.Files(workflow: workflow));

  [Fact]
  public void AGroupPerRef_Fails() =>
    Failures(w => w.Replace(
      ">-\n    ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name"
        + " == github.repository\n    && github.run_id || github.ref }}",
      "${{ github.workflow }}-${{ github.ref }}",
      StringComparison.Ordinal))
      .ShouldContain(f => f.Contains("github.run_id", StringComparison.Ordinal));

  [Fact]
  public void NoCancelJob_Fails() =>
    Failures(w => w.Replace("name: Cancel superseded runs", "name: Something else", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("no job is named");

  [Fact]
  public void ACancelJobWithoutActionsWrite_Fails() =>
    Failures(w => w.Replace("actions: write", "actions: read", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("actions: write");

  [Fact]
  public void ACancelJobThatChecksOut_Fails() =>
    Failures(w => w.Replace(
      "      - run: |\n          for id", "      - uses: actions/checkout@v7\n      - run: |\n          for id", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("fetches code");

  [Fact]
  public void ACancelJobThatCancelsNothing_Fails() =>
    Failures(w => w.Replace("gh run cancel", "echo", StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain("gh run cancel");

  [Fact]
  public void ACancelJobOnEveryEvent_Fails() =>
    Failures(w => w.Replace(
      "    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository\n",
      "",
      StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain("only for same-repository pull requests");

  [Theory]
  [InlineData(" && github.event.pull_request.head.repo.full_name == github.repository\n    permissions", "\n    permissions")]
  [InlineData("if: github.event_name == 'pull_request' &&", "if: github.event_name != 'pull_request' &&")]
  [InlineData(
    "if: github.event_name == 'pull_request' &&",
    "if: github.event_name == 'pull_request_target' || github.event_name == 'pull_request' &&")]
  public void ACancelJobForOtherRuns_Fails(string from, string to) =>
    Failures(w => w.Replace(from, to, StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("only for same-repository pull requests");

  [Theory]
  [InlineData("      actions: write\n", "      actions: write\n      contents: write\n")]
  [InlineData("      actions: write\n", "      actions: write\n      id-token: write\n")]
  public void ACancelJobWithMorePermissions_Fails(string from, string to) =>
    Failures(w => w.Replace(from, to, StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("exactly `permissions: actions: write`");

  [Theory]
  [InlineData("      - uses: Actions/Checkout@v7\n")]
  [InlineData("      - run: git clone \"https://github.com/$GITHUB_REPOSITORY\"\n")]
  [InlineData("      - run: gh pr checkout \"$PR\"\n")]
  public void ACancelJobThatFetchesCode_Fails(string step) =>
    Failures(w => w.Replace("      - run: |\n          for id", step + "      - run: |\n          for id", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("fetches code");

}

public sealed class FormatWhitespaceOnlyTests
{
  [Fact]
  public void TheFullFormatCommandInCi_Fails() =>
    Fixture.Failures("format-whitespace-only", Fixture.Files(workflow: w => w.Replace(
      "dotnet format whitespace --verify-no-changes", "dotnet format --verify-no-changes", StringComparison.Ordinal)))
      .ShouldBe([
        "the Backend job has no `dotnet format whitespace --verify-no-changes` step.",
        "the Backend job runs `dotnet format --verify-no-changes --no-restore`: the build already enforces code style and the "
          + "analyzers, so only `dotnet format whitespace` is needed.",
      ]);

  [Fact]
  public void AnExtraStyleCheckInCi_Fails() =>
    Fixture.Failures("format-whitespace-only", Fixture.Files(workflow: w => w.Replace(
      "      - run: dotnet format whitespace --verify-no-changes --no-restore\n",
      "      - run: dotnet format whitespace --verify-no-changes --no-restore\n      - run: dotnet format style --verify-no-changes\n",
      StringComparison.Ordinal)))
      .ShouldHaveSingleItem().ShouldContain("dotnet format style");

  [Fact]
  public void TheFullFormatCommandInTheLintRecipe_Fails() =>
    Fixture.Failures("format-whitespace-only", Fixture.Files(backendJust: j => j.Replace(
      "dotnet format whitespace --verify-no-changes", "dotnet format --verify-no-changes", StringComparison.Ordinal)))
      .ShouldAllBe(f => f.StartsWith("backend/mod.just `lint`", StringComparison.Ordinal));

  [Fact]
  public void TheFormatRecipe_IsNotTheLintRecipe() =>
    Guards.JustRecipe(Fixture.BackendJustfile, "lint").ShouldNotBeNull().ShouldNotContain(l => l.Trim() == "dotnet format");

  [Theory]
  [InlineData("<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>", "", "EnforceCodeStyleInBuild")]
  [InlineData(
    "<TreatWarningsAsErrors>true</TreatWarningsAsErrors>",
    "<TreatWarningsAsErrors>false</TreatWarningsAsErrors>",
    "TreatWarningsAsErrors")]
  [InlineData(
    "<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>",
    "<EnforceCodeStyleInBuild Condition=\"'$(CI)' == 'true'\">true</EnforceCodeStyleInBuild>",
    "EnforceCodeStyleInBuild")]
  public void ASharedSwitchOff_Fails(string from, string to, string name) =>
    Fixture.Failures("format-whitespace-only", Fixture.Files(props: p => p.Replace(from, to, StringComparison.Ordinal)))
      .ShouldContain(f => f.Contains(name, StringComparison.Ordinal));

  [Fact]
  public void AProjectThatTurnsASwitchOff_Fails() =>
    Fixture.Failures("format-whitespace-only", Fixture.Files(project: """
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup><TreatWarningsAsErrors>false</TreatWarningsAsErrors></PropertyGroup>
      </Project>
      """)).ShouldHaveSingleItem().ShouldStartWith("backend/src/Calendar.Api/Calendar.Api.csproj sets `TreatWarningsAsErrors`");
}

public sealed class ParallelToolTestsTests
{
  [Fact]
  public void ASerialLoop_Fails() =>
    Fixture.Failures("parallel-tool-tests", Fixture.Files(toolsJust: j => j.Replace(
      """printf '%s\n' $tests | xargs -P "${TOOLS_TEST_JOBS:-4}" -I{} bash -c 'dotnet run "$1"' _ {}""",
      """for t in $tests; do dotnet run "$t"; done""",
      StringComparison.Ordinal)))
      .ShouldHaveSingleItem().ShouldContain("xargs -P");

  [Fact]
  public void ADefaultOfOne_Fails() =>
    Fixture.Failures("parallel-tool-tests", Fixture.Files(toolsJust: j => j.Replace(":-4}", ":-1}", StringComparison.Ordinal)))
      .ShouldHaveSingleItem().ShouldContain("defaults TOOLS_TEST_JOBS to 1");

  [Theory]
  [InlineData("        run: just tools test", "        run: just tools test\n        env:\n          TOOLS_TEST_JOBS: 1")]
  [InlineData("        run: just tools test", "        run: just tools test\n        env:\n          TOOLS_TEST_JOBS: ${{ vars.JOBS }}")]
  [InlineData("        run: just tools test", "        run: TOOLS_TEST_JOBS=1 just tools test")]
  public void AWorkflowThatSerialises_Fails(string from, string to) =>
    Fixture.Failures("parallel-tool-tests", Fixture.Files(workflow: w => w.Replace(from, to, StringComparison.Ordinal)))
      .ShouldHaveSingleItem().ShouldContain("TOOLS_TEST_JOBS");

  [Fact]
  public void NoNuGetCache_Fails() =>
    Fixture.Failures(
      "parallel-tool-tests", Fixture.Files(workflow: w => w.Replace("cache: true", "cache: false", StringComparison.Ordinal)))
      .ShouldHaveSingleItem().ShouldContain("NuGet cache");
}

public sealed class CiResultNeedsAllTests
{
  private static IReadOnlyList<string> Failures(Func<string, string> workflow) =>
    Fixture.Failures("ci-result-needs-all", Fixture.Files(workflow: workflow));

  [Fact]
  public void AJobLeftOutOfNeeds_Fails() =>
    Failures(w => w.Replace("[changes, backend, frontend, docs, tooling]", "[changes, backend, frontend, docs]", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("does not need `tooling` (Tooling)");

  [Fact]
  public void ANewJobNotNeeded_Fails() =>
    Failures(w => w.Replace(
      "  supersede:\n",
      "  gate:\n    name: Run-time gate\n    steps:\n      - run: echo\n  supersede:\n",
      StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain("does not need `gate` (Run-time gate)");

  [Fact]
  public void ANewJobNeeded_Passes() =>
    Failures(w => w.Replace(
      "  supersede:\n",
      "  gate:\n    name: Run-time gate\n    steps:\n      - run: echo\n  supersede:\n",
      StringComparison.Ordinal).Replace("tooling]", "tooling, gate]", StringComparison.Ordinal)).ShouldBeEmpty();

  [Fact]
  public void NeedsAsABlockList_IsRead() =>
    Failures(w => w.Replace(
      "needs: [changes, backend, frontend, docs, tooling]",
      "needs:\n      - changes\n      - backend\n      - frontend\n      - docs\n      - tooling",
      StringComparison.Ordinal)).ShouldBeEmpty();

  [Fact]
  public void NeedingTheOptionalCancelJob_Fails() =>
    Failures(w => w.Replace("tooling]", "tooling, supersede]", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("needs `supersede`");

  [Fact]
  public void NotAlways_Fails() =>
    Failures(w => w.Replace("    if: ${{ always() }}\n", "", StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain("always()");

  [Fact]
  public void AResultCheckThatAcceptsAnyNonFailure_Fails() =>
    Failures(w => w.Replace(".value.result == \"success\"", ".value.result != \"failure\"", StringComparison.Ordinal))
      .ShouldBe(["`CI result` no longer requires every needed job's result to be success (`.result == \"success\"`).",
        $"`CI result` accepts a job that did not succeed beyond a skip the Changes job intended (`{Guards.NeedsSkipException}`)."]);

  [Fact]
  public void ASkipThatChangesDidNotIntend_Fails() =>
    Failures(w => w.Replace(
      " and $needs.changes.outputs[.key] == \"false\"", "", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("beyond a skip the Changes job intended");

  [Fact]
  public void AJobsApiCheckThatAcceptsEverySkip_Fails() =>
    Failures(w => w.Replace(Guards.JobsApiSkipException, "select(.conclusion != \"skipped\")", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("beyond a skip the Changes job intended");

  [Fact]
  public void TheStrictCheckWithoutSkips_Passes() =>
    Failures(w => w.Replace(" or (" + Guards.NeedsSkipException + ")", "", StringComparison.Ordinal)
      .Replace("| " + Guards.JobsApiSkipException, "", StringComparison.Ordinal)).ShouldBeEmpty();

  [Fact]
  public void NoJobsApiCheck_Fails() =>
    Failures(w => w.Replace(
      """          gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs" --jq '.jobs[] | select(.conclusion != "success")""",
      "          true '",
      StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain("jobs API");
}

public sealed class ChangesJobTests
{
  private static IReadOnlyList<string> Failures(Func<string, string> workflow) =>
    Fixture.Failures("changes-job", Fixture.Files(workflow: workflow));

  [Fact]
  public void NoChangesJob_Fails() =>
    Failures(w => w.Replace("name: Changes", "name: Paths", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("no job is named `Changes`");

  [Fact]
  public void AConditionalChangesJob_Fails() =>
    Failures(w => w.Replace("name: Changes\n", "name: Changes\n    if: github.event_name == 'pull_request'\n", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("must run on every event");

  [Fact]
  public void RulesInlineInsteadOfTheTestedFile_Fails() =>
    Failures(w => w.Replace("jq -c -f .github/ci-changes.jq", "jq -c -f rules.jq", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain(Guards.ChangesRulesPath);

  [Fact]
  public void AJobThatDoesNotNeedChanges_Fails() =>
    Failures(w => w.Replace("name: Tooling\n    needs: changes\n", "name: Tooling\n", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("`Tooling` does not need `changes`");

  [Theory]
  [InlineData("needs.changes.outputs.frontend == 'true'")]
  [InlineData("needs.changes.outputs.docs == 'true' || needs.changes.outputs.frontend == 'true'")]
  [InlineData("always()")]
  public void AJobThatReadsAnotherCondition_Fails(string condition) =>
    Failures(w => w.Replace("if: needs.changes.outputs.docs == 'true'", $"if: {condition}", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("`Docs site` must run `if: needs.changes.outputs.docs == 'true'`");

  [Fact]
  public void AJobWithNoOutput_Fails() =>
    Failures(w => w.Replace("      tooling: ${{ steps.decide.outputs.tooling }}\n", "", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("no `tooling` output");

  [Fact]
  public void NoSkippedOutput_Fails() =>
    Failures(w => w.Replace("      skipped: ${{ steps.decide.outputs.skipped }}\n", "", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("no `skipped` output");
}

/// <summary>Runs the committed rules file with jq on canned inputs (ADR-0046); jq missing fails, it does not skip.</summary>
public sealed class ChangesRulesTests
{
  private static readonly string Root = RepoRoot();

  private static readonly string[] AllJobs = ["backend", "frontend", "docs", "tooling", "adr", "image"];

  // A pull request or merge group that runs everything runs every job but ADR conventions, because Tooling runs the same
  // check; a push or dispatch runs ADR conventions too, so ADR-0045 can baseline it from main (issue #572).
  private const string EveryPullRequestJob = "backend frontend docs tooling image";

  private static readonly string[] JqPaths = ["/usr/bin/jq", "/usr/local/bin/jq"];

  [Theory]
  // `just tools adr` reads the story cards and the architecture model as well as the ADRs (story 0051, issue #562). A card
  // or the model runs only the ADR check, not the whole Tooling job; an ADR still runs Tooling, which runs the check too.
  [InlineData("docs/stories/0038-x.md", "docs adr")]
  [InlineData("docs/architecture/calendar.architecture.json", "docs adr")]
  [InlineData("docs/decisions/0001-x.md", "docs tooling")]
  [InlineData("docs/decisions/0046-x.md", "docs tooling")]
  [InlineData("docs/storiesx/0038-x.md", "docs")]
  [InlineData("docs/architecture/README.md", "docs")]
  [InlineData("frontend/apps/docs/src/lib/adr.ts", "docs")]
  [InlineData("backend/src/Calendar.Api/Program.cs", "backend image")]
  [InlineData("backend/Directory.Packages.props", "backend tooling image")]
  [InlineData("backend/mod.just", "backend tooling image")]
  [InlineData("contracts/openapi.json", "backend frontend image")]
  [InlineData("frontend/apps/web/src/main.tsx", "frontend image")]
  [InlineData("frontend/packages/api-client/src/index.ts", "frontend image")]
  // The shared theme package (story 0046, issue #518): the docs site builds from it, and so do the web app and the image.
  [InlineData("frontend/packages/theme/src/tokens.css", "docs frontend image")]
  [InlineData("frontend/packages/theme/package.json", "docs frontend image")]
  [InlineData("frontend/packages/theme-extra/src/tokens.css", "frontend image")]
  [InlineData("frontend/packages/theme.css", "frontend image")]
  [InlineData("frontend/apps/web/src/styles/tokens.css", "frontend image")]
  [InlineData("frontend/pnpm-lock.yaml", "docs frontend image")]
  [InlineData("frontend/mod.just", "docs frontend tooling image")]
  [InlineData("frontend/AGENTS.md", "")]
  [InlineData("tools/ci-timings/CiTimings.cs", "tooling")]
  [InlineData(".claude/skills/adr-draft/SKILL.md", "tooling")]
  [InlineData("infra/main.bicep", "tooling")]
  [InlineData("docker/postgres/init/01-roles.sh", "tooling image")]
  [InlineData("justfile", "tooling")]
  [InlineData("db.just", "tooling")]
  [InlineData(".just-version", "tooling")]
  [InlineData("Dockerfile", "image")]
  [InlineData("image.just", "tooling image")]
  [InlineData("README.md", "")]
  [InlineData(".github/dependabot.yml", "")]
  [InlineData(".github/workflows/pages.yml", "docs")]
  [InlineData(".github/ci-gate.jq", "tooling")]
  [InlineData(".github/ci-baseline.json", "tooling")]
  [InlineData(".github/workflows/ci-trend.yml", "tooling")]
  [InlineData(".github/pull_request_template.md", "tooling")]
  public void AFile_RunsTheJobsItIsAnInputOf(string file, string expected) =>
    Run("pull_request", true, file).ShouldBe(Expected(expected));

  [Theory]
  [InlineData(".github/workflows/ci.yml")]
  [InlineData(".github/ci-changes.jq")]
  public void AChangeToTheRules_RunsEverything(string file) =>
    Run("pull_request", true, "README.md", file).ShouldBe(Expected(EveryPullRequestJob));

  [Fact]
  public void FilesInSeveralSets_RunTheUnion() =>
    Run("merge_group", true, "docs/runbooks/x.md", "backend/src/A.cs").ShouldBe(Expected("backend docs image"));

  [Fact]
  public void AThemeOnlyChange_RunsTheDocsSite() =>
    Run("pull_request", true, "frontend/packages/theme/src/tokens.css").ShouldBe(Expected("docs frontend image"));

  [Fact]
  public void ARenameOutOfTheThemePackage_RunsTheDocsSite() =>
    Run("pull_request", true, "frontend/packages/theme/tokens.css", "frontend/apps/web/src/tokens.css")
      .ShouldBe(Expected("docs frontend image"));

  [Fact]
  public void ThemeAndAppFilesTogether_RunTheDocsSiteThroughTheNamedFile() =>
    Run("pull_request", true, "frontend/apps/web/src/main.tsx", "frontend/packages/theme/src/fonts.css")
      .ShouldBe(Expected("docs frontend image"));

  [Fact]
  public void UnrelatedFrontendFilesTogether_DoNotRunTheDocsSite() =>
    Run("pull_request", true, "frontend/apps/web/src/main.tsx", "frontend/packages/api-client/src/index.ts", "contracts/openapi.json")
      .ShouldBe(Expected("backend frontend image"));

  // ADR conventions runs for a card or the model only while nothing in the run starts Tooling, which runs the same check.
  [Fact]
  public void ACardWithAToolChange_RunsToolingInsteadOfTheAdrCheck() =>
    Run("pull_request", true, "docs/stories/0038-x.md", "tools/ci-timings/CiTimings.cs").ShouldBe(Expected("docs tooling"));

  [Fact]
  public void TheModelWithAnAdr_RunsToolingInsteadOfTheAdrCheck() =>
    Run("pull_request", true, "docs/architecture/calendar.architecture.json", "docs/decisions/0046-x.md")
      .ShouldBe(Expected("docs tooling"));

  [Fact]
  public void ACardWithABackendChange_RunsTheAdrCheckBesideTheOthers() =>
    Run("merge_group", true, "docs/stories/0038-x.md", "backend/src/A.cs").ShouldBe(Expected("backend docs adr image"));

  [Fact]
  public void AnIncompleteListing_RunsEverything() =>
    Run("pull_request", false, "README.md").ShouldBe(Expected(EveryPullRequestJob));

  [Fact]
  public void AnIncompleteMergeGroupListing_RunsEverythingButTheAdrCheck() =>
    Run("merge_group", false, "docs/stories/0038-x.md").ShouldBe(Expected(EveryPullRequestJob));

  [Theory]
  [InlineData("push")]
  [InlineData("workflow_dispatch")]
  public void APushOrDispatch_RunsEverything(string @event) =>
    Run(@event, true).ShouldBe(Expected(string.Join(' ', AllJobs)));

  // Forks (ADR-0025): the rules above only decide whether the Docs site job runs. The publication artifact is built and
  // uploaded only after the Pages configuration step, which runs for main and same-repository pull requests only, so a
  // fork that touches the theme package still gets the checks and no preview.
  [Fact]
  public void ThePublicationArtifact_IsBuiltOnlyForMainAndSameRepositoryPullRequests()
  {
    var workflow = Workflow.Parse(File.ReadAllText(Path.Combine(Root, RepoFiles.WorkflowPath)));
    List<YamlMapping> steps = [.. workflow.JobNamed("Docs site")!.Steps.OfType<YamlMapping>()];
    YamlMapping configure = steps.Single(s => s.Text("name") == "Read GitHub Pages configuration");
    var condition = configure.Text("if") ?? "";
    condition.ShouldContain("github.event.pull_request.head.repo.full_name == github.repository");
    condition.ShouldContain("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    configure.Text("id").ShouldBe("pages");
    foreach (var name in new[] { "Build and verify publication artifact", "Upload verified publication artifact" })
    {
      steps.Single(s => s.Text("name") == name).Text("if").ShouldBe("steps.pages.outcome == 'success'", name);
    }
  }

  [Fact]
  public void SkippedNames_AreTheJobNamesInCi()
  {
    var output = RunJq("""{"event":"pull_request","complete":true,"files":["README.md"]}""");
    output.ShouldContain("""
      "skipped":["Backend","Frontend","Docs site","Tooling","ADR conventions","Container image"]
      """.Trim());
    var workflow = Workflow.Parse(File.ReadAllText(Path.Combine(Root, RepoFiles.WorkflowPath)));
    foreach (var id in AllJobs)
    {
      workflow.Jobs.ShouldContain(j => j.Id == id && output.Contains($"\"{j.Name}\"", StringComparison.Ordinal), id);
    }

    workflow.Jobs.Where(j => j.Body.List("needs").OfType<YamlScalar>().Any(s => s.Value == "changes") && j.Name != "CI result")
      .Select(j => j.Id).Order(StringComparer.Ordinal).ShouldBe(AllJobs.Order(StringComparer.Ordinal));
  }

  private static string Expected(string jobs)
  {
    HashSet<string> run = jobs.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
    return string.Join(' ', AllJobs.Select(j => $"{j}={run.Contains(j)}".ToLowerInvariant()));
  }

  private static string Run(string @event, bool complete, params string[] files)
  {
    var list = string.Join(',', files.Select(f => $"\"{f}\""));
    var output = RunJq($$"""{"event":"{{@event}}","complete":{{(complete ? "true" : "false")}},"files":[{{list}}]}""");
    using var json = System.Text.Json.JsonDocument.Parse(output);
    return string.Join(' ', AllJobs.Select(j => $"{j}={json.RootElement.GetProperty(j).GetBoolean()}".ToLowerInvariant()));
  }

  private static string RunJq(string input)
  {
    var jq = JqPaths.FirstOrDefault(File.Exists)
      ?? throw new InvalidOperationException("jq is not installed (/usr/bin/jq); the rules tests need it and do not skip.");
    var start = new System.Diagnostics.ProcessStartInfo(jq, ["-c", "-f", Path.Combine(Root, Guards.ChangesRulesPath)])
    {
      RedirectStandardInput = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
    };
    using System.Diagnostics.Process process = System.Diagnostics.Process.Start(start)!;
    process.StandardInput.Write(input);
    process.StandardInput.Close();
    var output = process.StandardOutput.ReadToEnd();
    var error = process.StandardError.ReadToEnd();
    process.WaitForExit();
    process.ExitCode.ShouldBe(0, error);
    return output.Trim();
  }

  private static string RepoRoot([CallerFilePath] string path = "")
  {
    for (var dir = new DirectoryInfo(Path.GetDirectoryName(path)!); dir is not null; dir = dir.Parent)
    {
      if (File.Exists(Path.Combine(dir.FullName, ".just-version")))
      {
        return dir.FullName;
      }
    }

    throw new InvalidOperationException($"No repo root above {path}.");
  }
}

public sealed class SingleWebTypecheckTests
{
  private static IReadOnlyList<string> Failures(Func<string, string> workflow) =>
    Fixture.Failures("single-web-typecheck", Fixture.Files(workflow: workflow));

  [Theory]
  [InlineData("pnpm --filter @calendar/web exec vite build", "pnpm --filter @calendar/web build")]
  [InlineData("pnpm --filter @calendar/web exec vite build", "pnpm -r --filter '!@calendar/docs' build")]
  [InlineData(
    "pnpm --filter @calendar/web exec vite build",
    "pnpm --filter @calendar/web exec tsc -b && pnpm --filter @calendar/web exec vite build")]
  public void ASecondTypecheck_Fails(string from, string to) =>
    Failures(w => w.Replace(from, to, StringComparison.Ordinal))
      .ShouldContain(f => f.Contains("type-checks in 2 steps", StringComparison.Ordinal));

  [Fact]
  public void NoTypecheckStep_Fails() =>
    Failures(w => w.Replace("      - run: pnpm -r --filter '!@calendar/docs' typecheck\n", "", StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("type-checks in 0 steps");

  [Fact]
  public void TheBuildBeforeTheTypecheck_Fails() =>
    Failures(w => w.Replace("      - run: pnpm -r --filter '!@calendar/docs' typecheck\n", "", StringComparison.Ordinal)
      .Replace(
        "run: pnpm --filter @calendar/web exec vite build",
        "run: pnpm --filter @calendar/web exec vite build\n      - run: pnpm -r --filter '!@calendar/docs' typecheck",
        StringComparison.Ordinal))
      .ShouldHaveSingleItem().ShouldContain("before its typecheck step");
}

public sealed class DocsSiteJobTests
{
  private static IReadOnlyList<string> Failures(Func<string, string> workflow) =>
    Fixture.Failures("docs-site-job", Fixture.Files(workflow: workflow));

  [Theory]
  [InlineData("pnpm -r --filter '!@calendar/docs' typecheck", "pnpm -r typecheck", "`typecheck`")]
  [InlineData("pnpm -r --filter '!@calendar/docs' test:coverage", "pnpm -r test:coverage", "`test:coverage`")]
  public void FrontendRunningTheDocsSite_Fails(string from, string to, string step) =>
    Failures(w => w.Replace(from, to, StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain(step);

  [Fact]
  public void ADocsTypecheckThatSyncsAgain_Fails() =>
    Failures(w => w.Replace(" --noSync", "", StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain("--noSync");

  [Fact]
  public void NoDocsJob_Fails() =>
    Failures(w => w.Replace("name: Docs site", "name: Docs", StringComparison.Ordinal)).ShouldHaveSingleItem().ShouldContain("Docs site");
}

public sealed class WorkflowYamlTests
{
  [Fact]
  public void Parse_ReadsMappingsSequencesAndScalars()
  {
    YamlMapping root = WorkflowYaml.Parse("""
      # comment
      on:
        push:
          branches: [main, 'release']
      env:
        A: "quoted # not a comment"
        B: plain # a comment
      jobs:
        x:
          needs:
          - a
          - b
          steps:
            - uses: actions/checkout@v7 # v7.0.0
            - name: Two lines
              run: |
                echo one # kept
                # also kept

                echo two
            - run: >-
                folded
                text
      """).ShouldBeOfType<YamlMapping>();

    root.Map("on")!.Map("push")!.List("branches").Cast<YamlScalar>().Select(s => s.Value).ShouldBe(["main", "release"]);
    root.Map("env")!.Text("A").ShouldBe("quoted # not a comment");
    root.Map("env")!.Text("B").ShouldBe("plain");
    YamlMapping job = root.Map("jobs")!.Map("x")!;
    job.List("needs").Cast<YamlScalar>().Select(s => s.Value).ShouldBe(["a", "b"]);
    var steps = job.List("steps").Cast<YamlMapping>().ToList();
    steps[0].Text("uses").ShouldBe("actions/checkout@v7");
    steps[1].Text("name").ShouldBe("Two lines");
    steps[1].Text("run").ShouldBe("echo one # kept\n# also kept\n\necho two\n");
    steps[2].Text("run").ShouldBe("folded text");
  }

  [Theory]
  [InlineData("a: [1")]
  [InlineData("a:\n  b: 1\n c: 2")]
  [InlineData("a: 1\n---\nb: 2")]
  [InlineData("")]
  public void Parse_RejectsInvalidYamlAndMultipleDocuments(string yaml) => Should.Throw<FormatException>(() => WorkflowYaml.Parse(yaml));
}
