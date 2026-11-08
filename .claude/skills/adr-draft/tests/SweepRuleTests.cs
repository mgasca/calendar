using System.Runtime.CompilerServices;
using System.Text.Json;
using Shouldly;
using Xunit;

namespace AdrDraft.Tests;

/// <summary>
/// The adr-sweep checks in check-adr (story 0051, issue #562): M2, M3, M6, M7 and J6, and the inventory. Each test builds
/// a docs tree (decisions from fixtures/valid, a small architecture model, a stories directory) and breaks one rule.
/// </summary>
public sealed class SweepRuleTests : IDisposable
{
  private const string First = "0000-first-decision.md";
  private const string Second = "0001-second-decision.md";
  private const string SupersededStatus = "status: superseded by [ADR-0000](0000-first-decision.md)";

  private const string ValidModel = """
    {
      "nodes": [
        { "unique-id": "api", "metadata": { "adrs": ["ADR-0000"] }, "description": "See https://site/adr/0001/." }
      ],
      "flows": [],
      "metadata": {
        "adr-url-pattern": "https://site/adr/NNNN/ (ADR-0099 is an example, not a citation)",
        "adrs": [
          { "id": "ADR-0000", "title": "First decision", "status": "accepted", "file": "docs/decisions/0000-first-decision.md" },
          { "id": "ADR-0001", "title": "Second decision", "status": "proposed", "file": "docs/decisions/0001-second-decision.md" }
        ]
      }
    }
    """;

  private readonly string _root;
  private readonly string _decisions;
  private readonly string _stories;
  private readonly string _model;

  public SweepRuleTests()
  {
    _root = Directory.CreateTempSubdirectory("adr-sweep-tests-").FullName;
    _decisions = Directory.CreateDirectory(Path.Combine(_root, "docs", "decisions")).FullName;
    _stories = Directory.CreateDirectory(Path.Combine(_root, "docs", "stories")).FullName;
    _model = Path.Combine(Directory.CreateDirectory(Path.Combine(_root, "docs", "architecture")).FullName, "model.json");
    foreach (var file in Directory.EnumerateFiles(FixturesDir()))
    {
      File.Copy(file, Path.Combine(_decisions, Path.GetFileName(file)));
    }
    File.WriteAllText(_model, ValidModel);
  }

  public void Dispose() => Directory.Delete(_root, recursive: true);

  [Fact]
  public void ValidTree_PassesEverySweepRule()
  {
    AdrValidator.CheckRepository(_decisions).ShouldBeEmpty();
    AdrValidator.CheckModel(_model, Records()).ShouldBeEmpty();
    AdrValidator.CheckStories(_stories, Records()).ShouldBeEmpty();
    Check(First).Errors.ShouldBeEmpty();
    Check(Second).Errors.ShouldBeEmpty();
  }

  // M2: the model's copy of each record.

  [Theory]
  [InlineData("\"status\": \"proposed\"", "\"status\": \"accepted\"", "M2 ADR-0001: model status 'accepted', file says 'proposed'")]
  [InlineData("\"title\": \"Second decision\"", "\"title\": \"Other\"", "M2 ADR-0001: model title 'Other', file title 'Second decision'")]
  [InlineData("docs/decisions/0001-second-decision.md", "docs/decisions/0001-gone.md", "M2 ADR-0001: model file")]
  [InlineData("\"ADR-0000\"] }", "\"ADR-0007\"] }", "M2 ADR-0007: cited by the model at nodes[0].metadata.adrs[0], but there is no")]
  [InlineData("\"flows\": []", "\"flows\": [{ \"description\": \"/adr/0042/\" }]", "M2 ADR-0042: cited by the model at flows[0]")]
  public void ModelDrift_IsReported(string find, string replace, string expected)
  {
    MutateModel(find, replace);

    AdrValidator.CheckModel(_model, Records()).ShouldContain(e => e.Contains(expected, StringComparison.Ordinal));
  }

  [Fact]
  public void RecordMissingFromModel_IsReported()
  {
    MutateModel(
      ",\n      { \"id\": \"ADR-0001\", \"title\": \"Second decision\", \"status\": \"proposed\", "
      + "\"file\": \"docs/decisions/0001-second-decision.md\" }",
      "");

    AdrValidator.CheckModel(_model, Records()).ShouldContain("M2 ADR-0001: missing from metadata.adrs in model.json");
  }

  [Fact]
  public void ModelEntryWithoutRecord_IsReported()
  {
    File.Delete(Path.Combine(_decisions, Second));

    AdrValidator.CheckModel(_model, Records()).ShouldContain("M2 ADR-0001: metadata.adrs entry has no record in docs/decisions");
  }

  [Fact]
  public void DuplicateModelEntry_IsReported()
  {
    MutateModel("\"adrs\": [\n", "\"adrs\": [\n      { \"id\": \"ADR-0000\" },\n");

    AdrValidator.CheckModel(_model, Records()).ShouldContain("M2 ADR-0000: more than one metadata.adrs entry");
  }

  [Fact]
  public void SupersededByDiffersFromFile_IsReported()
  {
    SupersedeSecond(modelNote: null);
    MutateModel("\"superseded-by\": \"ADR-0000\"", "\"superseded-by\": \"ADR-0002\"");

    AdrValidator.CheckModel(_model, Records())
      .ShouldContain("M2 ADR-0001: model superseded-by 'ADR-0002', file says 'ADR-0000'");
  }

  [Fact]
  public void CitingASupersededRecord_IsReported()
  {
    SupersedeSecond(modelNote: null);

    IReadOnlyList<string> errors = AdrValidator.CheckModel(_model, Records());

    errors.ShouldHaveSingleItem().ShouldStartWith("M2 ADR-0001: cited by the model at nodes[0].description, but superseded by ADR-0000");
  }

  [Fact]
  public void CitingASupersededRecordWithANote_IsAllowed()
  {
    SupersedeSecond(modelNote: "Only part of it is withdrawn.");

    AdrValidator.CheckModel(_model, Records()).ShouldBeEmpty();
  }

  [Fact]
  public void ModelTitle_IsComparedAsPlainText()
  {
    Mutate(Second, "# Second decision", "# Second `decision` with [a link](https://example.org) and **bold**");
    MutateModel("\"title\": \"Second decision\"", "\"title\": \"Second decision with a link and bold\"");

    AdrValidator.CheckModel(_model, Records()).ShouldBeEmpty();
  }

  // M3: supersession integrity.

  [Fact]
  public void SupersedingRecordThatNamesItsPredecessor_Passes()
  {
    SupersedeSecond(modelNote: null);

    Check(Second).Errors.ShouldBeEmpty();
  }

  [Fact]
  public void SupersedingRecordThatNeverNamesItsPredecessor_IsReported()
  {
    SupersedeSecond(modelNote: null);
    Mutate(First, "See [ADR-0001](0001-second-decision.md).", "See the other record.");

    Check(Second).Errors.ShouldContain("M3: ADR-0000 supersedes this record but never names ADR-0001");
  }

  [Theory]
  [InlineData("status: superseded by [ADR-0005](0000-first-decision.md)", "M3: superseded by ADR-0005, which does not exist")]
  [InlineData("status: superseded by [ADR-0000](0001-second-decision.md)", "M3: the superseded-by link names 0001-second-decision.md")]
  [InlineData("status: superseded by [ADR-0001](0001-second-decision.md)", "M3: a record cannot supersede itself")]
  public void BrokenSupersession_IsReported(string status, string expected)
  {
    Mutate(Second, "status: proposed", status);

    Check(Second).Errors.ShouldContain(e => e.StartsWith(expected, StringComparison.Ordinal));
  }

  // M6: a number used twice (on a pull request, CI checks out the merge with main).

  [Fact]
  public void NumberUsedByTwoFiles_IsReported()
  {
    File.Copy(Path.Combine(_decisions, Second), Path.Combine(_decisions, "0001-another-decision.md"));

    AdrValidator.CheckRepository(_decisions).ShouldContain(
      "M6 ADR-0001: number used by more than one file [0001-another-decision.md, 0001-second-decision.md]; "
      + "a new record takes --next-number");
  }

  // M7: amendment form.

  [Fact]
  public void AmendmentHeadingWithoutDate_IsReported()
  {
    AddAmendment("### Amendment: undated", bullet: null);

    Check(First).Errors.ShouldContain(
      e => e.StartsWith("M7: amendment heading '### Amendment: undated' has no date", StringComparison.Ordinal));
  }

  [Fact]
  public void DatedAmendmentWithoutItsBullet_IsReported()
  {
    AddAmendment("### Amendment, 2026-02-01: a change", bullet: "* **Amendment, 2026-01-31:** a different day.");

    Check(First).Errors.ShouldContain(
      "M7: 1 amendment heading(s) dated 2026-02-01 but 0 More Information bullet(s) '* **Amendment, 2026-02-01:**'");
  }

  [Fact]
  public void DatedAmendmentWithItsBullet_AndABulletAlone_Pass()
  {
    AddAmendment(
      "### Amendment, 2026-02-01: a change",
      bullet: "* **Amendment, 2026-02-01 (scope):** the change.\n* **Amendment, 2026-01-15:** made in place, no heading.");

    Check(First).Errors.ShouldBeEmpty();
  }

  // J6: planned story cards.

  [Theory]
  [InlineData("planned", true)]
  [InlineData("implemented", false)]
  public void StoryCitingASupersededRecord_IsReportedOnlyWhenPlanned(string status, bool reported)
  {
    SupersedeSecond(modelNote: null);
    WriteStory("0007-a-story.md", status, "[\"0000\", \"0001\"]");

    IReadOnlyList<string> errors = AdrValidator.CheckStories(_stories, Records());

    if (reported)
    {
      errors.ShouldHaveSingleItem().ShouldBe("J6 story 0007: planned card cites ADR-0001, superseded by ADR-0000");
    }
    else
    {
      errors.ShouldBeEmpty();
    }
  }

  [Fact]
  public void PlannedStoryCitingCurrentRecords_Passes()
  {
    WriteStory("0007-a-story.md", "planned", "[\"0000\", \"0001\"]");

    AdrValidator.CheckStories(_stories, Records()).ShouldBeEmpty();
  }

  // Inventory.

  [Fact]
  public void Inventory_HasOneEntryPerRecordWithEveryField()
  {
    SupersedeSecond(modelNote: "kept");
    AddAmendment("### Amendment, 2026-02-01: a change", bullet: "* **Amendment, 2026-02-01:** the change.");
    Mutate(
      First,
      "A test checks it.",
      "Run `just tools adr` and `dotnet run x.cs`, read `docs/decisions/README.md` and `.node-version`, pin `10.0.300` and "
      + "`postgres:18.6-alpine`; `HttpOnly` is not a token.");
    var firstOnMain = new Dictionary<string, string>(StringComparer.Ordinal) { [First] = "2026-01-02" };

    using var json = JsonDocument.Parse(AdrValidator.Inventory(Records(), _model, firstOnMain));

    JsonElement[] entries = [.. json.RootElement.EnumerateArray()];
    entries.Length.ShouldBe(2);
    JsonElement first = entries[0];
    first.GetProperty("number").GetString().ShouldBe("0000");
    first.GetProperty("file").GetString().ShouldBe(First);
    first.GetProperty("title").GetString().ShouldBe("First decision");
    first.GetProperty("date").GetString().ShouldBe("2026-01-01");
    first.GetProperty("status").GetString().ShouldBe("accepted");
    first.GetProperty("supersededBy").ValueKind.ShouldBe(JsonValueKind.Null);
    first.GetProperty("firstOnMain").GetString().ShouldBe("2026-01-02");
    first.GetProperty("model").GetProperty("id").GetString().ShouldBe("ADR-0000");
    JsonElement amendment = first.GetProperty("amendments").EnumerateArray().ShouldHaveSingleItem();
    amendment.GetProperty("heading").GetString().ShouldBe("Amendment, 2026-02-01: a change");
    amendment.GetProperty("date").GetString().ShouldBe("2026-02-01");
    JsonElement cited = first.GetProperty("citedTokens");
    Strings(cited, "commands").ShouldBe(["just tools adr", "dotnet run x.cs"]);
    Strings(cited, "paths").ShouldBe(["docs/decisions/README.md", ".node-version"]);
    Strings(cited, "versions").ShouldBe(["10.0.300", "postgres:18.6-alpine"]);

    JsonElement second = entries[1];
    second.GetProperty("status").GetString().ShouldBe("superseded");
    second.GetProperty("supersededBy").GetString().ShouldBe("ADR-0000");
    second.GetProperty("firstOnMain").ValueKind.ShouldBe(JsonValueKind.Null);
    second.GetProperty("model").GetProperty("note").GetString().ShouldBe("kept");
  }

  [Fact]
  public void Inventory_WithoutGitOrModel_OmitsFirstOnMainAndHasNullModel()
  {
    using var json = JsonDocument.Parse(AdrValidator.Inventory(Records(), modelPath: null, firstOnMain: null));

    JsonElement first = json.RootElement[0];
    first.TryGetProperty("firstOnMain", out _).ShouldBeFalse();
    first.GetProperty("model").ValueKind.ShouldBe(JsonValueKind.Null);
  }

  [Fact]
  public void ParseFirstAdded_KeepsTheOldestDate()
  {
    const string Log =
      "2026-03-01\n\ndocs/decisions/0001-b.md\n2026-02-01\n\ndocs/decisions/0000-a.md\n2026-01-01\n\ndocs/decisions/0001-b.md\n";

    IReadOnlyDictionary<string, string> added = AdrValidator.ParseFirstAdded(Log);

    added["0000-a.md"].ShouldBe("2026-02-01");
    added["0001-b.md"].ShouldBe("2026-01-01");
  }

  private static string[] Strings(JsonElement element, string name) =>
      [.. element.GetProperty(name).EnumerateArray().Select(e => e.GetString() ?? "")];

  /// <summary>Supersedes 0001 by 0000 in the file and the model; 0000 already names ADR-0001.</summary>
  private void SupersedeSecond(string? modelNote)
  {
    Mutate(Second, "status: proposed", SupersededStatus);
    var note = modelNote is null ? "" : $", \"note\": \"{modelNote}\"";
    MutateModel("\"status\": \"proposed\"", $"\"status\": \"superseded\", \"superseded-by\": \"ADR-0000\"{note}");
  }

  private void AddAmendment(string heading, string? bullet)
  {
    Mutate(First, "### Consequences", $"{heading}\n\nWhat changed.\n\n### Consequences");
    var text = File.ReadAllText(Path.Combine(_decisions, First));
    var more = bullet is null ? "" : $"\n## More Information\n\n{bullet}\n";
    File.WriteAllText(Path.Combine(_decisions, First), text + more);
  }

  private void WriteStory(string name, string status, string adrs) =>
      File.WriteAllText(
        Path.Combine(_stories, name),
        $"---\nstatus: {status}\ndate: 2026-01-01\nadrs: {adrs}\n---\n\n# {name[..4]} A story\n");

  private IReadOnlyList<AdrRecord> Records() => AdrValidator.ReadRecords(_decisions);

  private AdrFileResult Check(string file) =>
      AdrValidator.CheckFile(Path.Combine(_decisions, file), AdrValidator.AdrFiles(_decisions));

  private void Mutate(string file, string find, string replace)
  {
    var path = Path.Combine(_decisions, file);
    var text = File.ReadAllText(path);
    text.ShouldContain(find, customMessage: "test setup: text to replace not found in fixture");
    File.WriteAllText(path, text.Replace(find, replace, StringComparison.Ordinal));
  }

  private void MutateModel(string find, string replace)
  {
    var text = File.ReadAllText(_model);
    text.ShouldContain(find, customMessage: "test setup: text to replace not found in the model");
    File.WriteAllText(_model, text.Replace(find, replace, StringComparison.Ordinal));
  }

  private static string FixturesDir([CallerFilePath] string sourceFile = "") =>
      Path.Combine(Path.GetDirectoryName(sourceFile)!, "fixtures", "valid");
}
