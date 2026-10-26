#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../ToolVersions.cs

// Tests for the tool-version drift check. Run: dotnet run tools/tool-versions/tests/tool-versions.tests.cs
// Each test builds a small fake repo in a temp directory.

using Shouldly;
using Xunit;

namespace ToolVersions.Tests;

public sealed class VersionCheckerTests : IDisposable
{
  private readonly string _root = Directory.CreateTempSubdirectory("tool-versions-").FullName;

  public VersionCheckerTests()
  {
    Write("backend/Directory.Packages.props", """
            <Project>
              <ItemGroup>
                <PackageVersion Include="SonarAnalyzer.CSharp" Version="2.0.0" />
                <PackageVersion Include="Shouldly" Version="4.3.0" />
              </ItemGroup>
            </Project>
            """);
    Write(".claude/skills/demo/Directory.Build.props", """
            <Project>
              <ItemGroup>
                <PackageReference Include="SonarAnalyzer.CSharp" Version="1.0.0" PrivateAssets="all" />
              </ItemGroup>
            </Project>
            """);
    Write(".claude/skills/demo/tests/demo.tests.cs", """
            #!/usr/bin/env -S dotnet run
            #:package Shouldly@4.3.0
            #:package Untracked.Package@9.9.9
            """);
    Write("tools/demo/tests/fixtures/fake.cs", "#:package Shouldly@0.0.1\n");
  }

  public void Dispose() => Directory.Delete(_root, recursive: true);

  [Fact]
  public void ReadCentralVersions_ReadsPackageVersions()
  {
    var central = VersionChecker.ReadCentralVersions(Path.Combine(_root, "backend/Directory.Packages.props"));

    central["SonarAnalyzer.CSharp"].ShouldBe("2.0.0");
    central["shouldly"].ShouldBe("4.3.0", "lookups are case-insensitive, like NuGet ids");
  }

  [Fact]
  public void FindPins_ReadsDirectivesAndProps_AndSkipsFixtures()
  {
    var pins = VersionChecker.FindPins(_root);

    pins.ShouldBe(
    [
        new PinnedPackage("SonarAnalyzer.CSharp", "1.0.0", ".claude/skills/demo/Directory.Build.props"),
            new PinnedPackage("Shouldly", "4.3.0", ".claude/skills/demo/tests/demo.tests.cs"),
            new PinnedPackage("Untracked.Package", "9.9.9", ".claude/skills/demo/tests/demo.tests.cs"),
        ], ignoreOrder: true);
  }

  [Fact]
  public void FindDrift_ReportsOnlyTrackedPackagesWithDifferentVersions()
  {
    var drifts = Drifts();

    var drift = drifts.ShouldHaveSingleItem();
    drift.Pin.Package.ShouldBe("SonarAnalyzer.CSharp");
    drift.BackendVersion.ShouldBe("2.0.0");
  }

  [Fact]
  public void Fix_UpdatesPropsAndDirectives_ThenNoDriftRemains()
  {
    Write(".claude/skills/demo/tests/demo.tests.cs", "#:package Shouldly@4.0.0\n");

    var changed = VersionChecker.Fix(_root, Drifts());

    changed.ShouldBe(2);
    Read(".claude/skills/demo/Directory.Build.props").ShouldContain("""Include="SonarAnalyzer.CSharp" Version="2.0.0" """.TrimEnd());
    Read(".claude/skills/demo/tests/demo.tests.cs").ShouldBe("#:package Shouldly@4.3.0\n");
    Drifts().ShouldBeEmpty();
  }

  [Fact]
  public void Fix_LeavesOtherContentUntouched()
  {
    var before = Read(".claude/skills/demo/Directory.Build.props");

    VersionChecker.Fix(_root, Drifts());

    Read(".claude/skills/demo/Directory.Build.props").ShouldBe(before.Replace("Version=\"1.0.0\"", "Version=\"2.0.0\"", StringComparison.Ordinal));
  }

  private IReadOnlyList<VersionDrift> Drifts() =>
      VersionChecker.FindDrift(
          VersionChecker.FindPins(_root),
          VersionChecker.ReadCentralVersions(Path.Combine(_root, "backend/Directory.Packages.props")));

  private void Write(string relative, string content)
  {
    var path = Path.Combine(_root, relative);
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    File.WriteAllText(path, content);
  }

  private string Read(string relative) => File.ReadAllText(Path.Combine(_root, relative));
}
