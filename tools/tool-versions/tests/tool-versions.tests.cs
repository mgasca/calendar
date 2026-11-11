#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.3
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
    Write("tools/Directory.Build.props", """
            <Project>
              <ItemGroup>
                <PackageReference Include="SonarAnalyzer.CSharp" Version="2.0.0" PrivateAssets="all" />
              </ItemGroup>
            </Project>
            """);
    Write("tools/other/other.cs", "#:package shouldly@4.3.0\n");
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
  public void NewestVersions_TakesTheHighestPin_IgnoringIdCase()
  {
    IReadOnlyDictionary<string, string> newest = VersionChecker.NewestVersions(VersionChecker.FindPins(_root));

    newest["SonarAnalyzer.CSharp"].ShouldBe("2.0.0");
    newest["SHOULDLY"].ShouldBe("4.3.0", "lookups are case-insensitive, like NuGet ids");
    newest["Untracked.Package"].ShouldBe("9.9.9");
  }

  [Theory]
  [InlineData("4.10.0", "4.9.0")]
  [InlineData("10.35.0.4138", "10.35.0")]
  [InlineData("4.0.3", "4.0.3-pre.1")]
  [InlineData("4.0.3-pre.2", "4.0.3-pre.1")]
  [InlineData("2.0.0", "1.99.99")]
  public void VersionOrder_ComparesPartsAsNumbers_AndAReleaseAfterItsPrereleases(string newer, string older)
  {
    VersionOrder.Instance.Compare(newer, older).ShouldBeGreaterThan(0);
    VersionOrder.Instance.Compare(older, newer).ShouldBeLessThan(0);
    VersionOrder.Instance.Compare(newer, newer).ShouldBe(0);
  }

  [Fact]
  public void FindPins_ReadsDirectivesAndProps_AndSkipsFixtures()
  {
    IReadOnlyList<PinnedPackage> pins = VersionChecker.FindPins(_root);

    pins.ShouldBe(
      [
          new PinnedPackage("SonarAnalyzer.CSharp", "2.0.0", "tools/Directory.Build.props"),
              new PinnedPackage("shouldly", "4.3.0", "tools/other/other.cs"),
              new PinnedPackage("SonarAnalyzer.CSharp", "1.0.0", ".claude/skills/demo/Directory.Build.props"),
              new PinnedPackage("Shouldly", "4.3.0", ".claude/skills/demo/tests/demo.tests.cs"),
              new PinnedPackage("Untracked.Package", "9.9.9", ".claude/skills/demo/tests/demo.tests.cs"),
          ],
      ignoreOrder: true);
  }

  [Fact]
  public void FindDrift_ReportsOnlyPinsBehindTheNewestPinOfTheirPackage()
  {
    IReadOnlyList<VersionDrift> drifts = Drifts();

    VersionDrift drift = drifts.ShouldHaveSingleItem();
    drift.Pin.Package.ShouldBe("SonarAnalyzer.CSharp");
    drift.ExpectedVersion.ShouldBe("2.0.0");
    drift.Pin.File.ShouldBe(".claude/skills/demo/Directory.Build.props");
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

    Read(".claude/skills/demo/Directory.Build.props")
      .ShouldBe(before.Replace("Version=\"1.0.0\"", "Version=\"2.0.0\"", StringComparison.Ordinal));
  }

  private IReadOnlyList<VersionDrift> Drifts() => VersionChecker.FindDrift(VersionChecker.FindPins(_root));

  private void Write(string relative, string content)
  {
    var path = Path.Combine(_root, relative);
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    File.WriteAllText(path, content);
  }

  private string Read(string relative) => File.ReadAllText(Path.Combine(_root, relative));
}
