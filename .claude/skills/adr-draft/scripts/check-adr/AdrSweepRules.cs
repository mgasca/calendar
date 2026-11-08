using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AdrDraft;

/// <summary>One amendment heading of a record: its text after "### ", and its date when it has one.</summary>
public sealed record AdrAmendment(string Heading, string? Date);

/// <summary>The inline code spans in a record's Decision Outcome that look like paths, commands or versions.</summary>
public sealed record CitedTokens(IReadOnlyList<string> Paths, IReadOnlyList<string> Commands, IReadOnlyList<string> Versions);

/// <summary>
/// What the ADR sweep's inventory holds for one record, read from its file. <see cref="Status"/> is the front matter
/// status with a <c>superseded by [ADR-NNNN](...)</c> link reduced to <c>superseded</c>, as the architecture model writes
/// it; <see cref="SupersededBy"/> is then <c>ADR-NNNN</c>.
/// </summary>
public sealed record AdrRecord(
    string Number,
    string FileName,
    string Title,
    string Date,
    string Status,
    string? SupersededBy,
    IReadOnlyList<AdrAmendment> Amendments,
    CitedTokens Cited);

/// <summary>
/// The mechanical checks of the <c>adr-sweep</c> skill that read only the branch (story 0051, issue #562): M2 (the
/// architecture model agrees with the records), M3 (supersession integrity), M6 (no number used twice), M7 (amendment
/// form) and J6 (no planned story card cites a superseded record), and the sweep's inventory.
/// </summary>
public static partial class AdrValidator
{
  private static readonly string[] CommandWords =
  [
    "just", "dotnet", "pnpm", "corepack", "npm", "npx", "node", "git", "gh", "jq", "docker", "az", "bash", "curl", "psql",
    "shellcheck",
  ];

  /// <summary>Reads the inventory fields of one record. A malformed record yields empty fields, never an exception.</summary>
  public static AdrRecord ReadRecord(string path)
  {
    var name = Path.GetFileName(path);
    var text = File.ReadAllText(path);
    Dictionary<string, string> meta = CheckFrontMatter(text, [], out var body);
    Match title = H1Regex().Match(body);
    var rawStatus = meta.GetValueOrDefault("status", "");
    Match superseded = SupersededRegex().Match(rawStatus);

    var amendments = AmendmentHeadingRegex().Matches(body)
        .Select(m => new AdrAmendment(m.Groups[1].Value.Trim(), AmendmentDate(m.Groups[1].Value)))
        .ToList();
    var outcome = SectionMap(Sections(body, 2)).GetValueOrDefault("Decision Outcome", "");

    return new AdrRecord(
        name.Length >= 4 ? name[..4] : name,
        name,
        title.Success ? PlainText(title.Groups[1].Value.Trim()) : "",
        meta.GetValueOrDefault("date", ""),
        superseded.Success ? "superseded" : rawStatus,
        superseded.Success ? $"ADR-{superseded.Groups[1].Value}" : null,
        amendments,
        CiteTokens(outcome));
  }

  /// <summary>Reads every record of <paramref name="decisionsDir"/>, in number order.</summary>
  public static IReadOnlyList<AdrRecord> ReadRecords(string decisionsDir) =>
      [.. AdrFiles(decisionsDir).Values.Select(f => ReadRecord(Path.Combine(decisionsDir, f)))];

  /// <summary>
  /// M2: every record has one entry in the model's <c>metadata.adrs</c> and every entry a record, with the same title,
  /// status, superseded-by and file; every ADR the rest of the model cites (<c>ADR-NNNN</c> or <c>/adr/NNNN/</c>) exists
  /// and is not superseded, unless its entry carries a <c>note</c> saying what still stands.
  /// </summary>
  public static IReadOnlyList<string> CheckModel(string modelPath, IReadOnlyList<AdrRecord> records)
  {
    var errors = new List<string>();
    var model = Path.GetFileName(modelPath);
    using var document = JsonDocument.Parse(File.ReadAllText(modelPath));
    JsonElement root = document.RootElement;
    if (!TryGetAdrEntries(root, out JsonElement adrs))
    {
      errors.Add($"M2 model: {model} has no metadata.adrs array");
      return errors;
    }

    var byNumber = records.ToDictionary(r => r.Number, StringComparer.Ordinal);
    var entries = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
    foreach (JsonElement entry in adrs.EnumerateArray())
    {
      var id = Text(entry, "id") ?? "";
      Match m = AdrIdRegex().Match(id);
      if (!m.Success)
      {
        errors.Add($"M2 model: metadata.adrs entry id must be ADR-NNNN, got '{id}'");
      }
      else if (!entries.TryAdd(m.Groups[1].Value, entry))
      {
        errors.Add($"M2 {id}: more than one metadata.adrs entry");
      }
    }

    foreach (AdrRecord record in records.Where(r => !entries.ContainsKey(r.Number)))
    {
      errors.Add($"M2 ADR-{record.Number}: missing from metadata.adrs in {model}");
    }
    foreach ((var number, JsonElement entry) in entries.OrderBy(e => e.Key, StringComparer.Ordinal))
    {
      if (byNumber.TryGetValue(number, out AdrRecord? record))
      {
        CompareEntry(record, entry, errors);
      }
      else
      {
        errors.Add($"M2 ADR-{number}: metadata.adrs entry has no record in docs/decisions");
      }
    }

    CheckModelCitations(root, byNumber, entries, errors);
    return errors;
  }

  /// <summary>J6: a story card with <c>status: planned</c> must not list a superseded record in <c>adrs:</c>.</summary>
  public static IReadOnlyList<string> CheckStories(string storiesDir, IReadOnlyList<AdrRecord> records)
  {
    var errors = new List<string>();
    var byNumber = records.ToDictionary(r => r.Number, StringComparer.Ordinal);
    IEnumerable<string> cards = Directory.EnumerateFiles(storiesDir, "*.md")
        .Where(p => FileNameRegex().IsMatch(Path.GetFileName(p)))
        .Order(StringComparer.Ordinal);
    foreach (var card in cards)
    {
      Dictionary<string, string> meta = CheckFrontMatter(File.ReadAllText(card), [], out _);
      if (meta.GetValueOrDefault("status") != "planned")
      {
        continue;
      }
      foreach (var cited in NumberRegex().Matches(meta.GetValueOrDefault("adrs", "")).Select(m => m.Value))
      {
        if (byNumber.TryGetValue(cited, out AdrRecord? record) && record.SupersededBy is not null)
        {
          errors.Add($"J6 story {Path.GetFileName(card)[..4]}: planned card cites ADR-{cited}, superseded by {record.SupersededBy}");
        }
      }
    }
    return errors;
  }

  /// <summary>
  /// Maps each file name to the date (YYYY-MM-DD) it was first added, from the output of
  /// <c>git log --diff-filter=A --format=%cs --name-only</c>, which lists the newest commit first.
  /// </summary>
  public static IReadOnlyDictionary<string, string> ParseFirstAdded(string gitLog)
  {
    var added = new Dictionary<string, string>(StringComparer.Ordinal);
    var date = "";
    foreach (var line in gitLog.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0))
    {
      if (DateRegex().IsMatch(line))
      {
        date = line;
      }
      else if (date.Length > 0)
      {
        added[Path.GetFileName(line)] = date;
      }
    }
    return added;
  }

  /// <summary>
  /// The ADR sweep's step 2 inventory as indented JSON: one object per record, with its model entry as written (or
  /// null) and, when <paramref name="firstOnMain"/> is given, the date the file first reached <c>main</c>.
  /// </summary>
  public static string Inventory(
      IReadOnlyList<AdrRecord> records,
      string? modelPath,
      IReadOnlyDictionary<string, string>? firstOnMain)
  {
    using JsonDocument? document = modelPath is null ? null : JsonDocument.Parse(File.ReadAllText(modelPath));
    var entries = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
    if (document is not null && TryGetAdrEntries(document.RootElement, out JsonElement adrs))
    {
      foreach (JsonElement entry in adrs.EnumerateArray())
      {
        Match m = AdrIdRegex().Match(Text(entry, "id") ?? "");
        if (m.Success)
        {
          entries.TryAdd(m.Groups[1].Value, entry);
        }
      }
    }

    using var stream = new MemoryStream();
    using (var json = new Utf8JsonWriter(
        stream,
        new JsonWriterOptions { Indented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
    {
      json.WriteStartArray();
      foreach (AdrRecord record in records)
      {
        WriteRecord(json, record, entries, firstOnMain);
      }
      json.WriteEndArray();
    }
    return System.Text.Encoding.UTF8.GetString(stream.ToArray());
  }

  /// <summary>M3: the superseding record exists, is the file the status links to, and names this record.</summary>
  private static void CheckSupersession(
      string path,
      string status,
      string number,
      IReadOnlyDictionary<string, string> files,
      List<string> errors)
  {
    Match m = SupersededRegex().Match(status);
    if (!m.Success)
    {
      return;
    }
    var target = m.Groups[1].Value;
    if (target == number)
    {
      errors.Add("M3: a record cannot supersede itself");
      return;
    }
    if (!files.TryGetValue(target, out var targetFile))
    {
      errors.Add($"M3: superseded by ADR-{target}, which does not exist");
      return;
    }
    if (m.Groups[2].Value != targetFile)
    {
      errors.Add($"M3: the superseded-by link names {m.Groups[2].Value}, but ADR-{target} is {targetFile}");
    }
    var directory = Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".";
    if (!File.ReadAllText(Path.Combine(directory, targetFile)).Contains($"ADR-{number}", StringComparison.Ordinal))
    {
      errors.Add($"M3: ADR-{target} supersedes this record but never names ADR-{number}");
    }
  }

  /// <summary>
  /// M7 (form): every <c>### Amendment</c> heading is dated, and each date has at least as many
  /// <c>* **Amendment, YYYY-MM-DD:**</c> bullets under More Information as headings. A bullet without a heading is
  /// allowed: an amendment made in place has only its bullet.
  /// </summary>
  private static void CheckAmendments(string body, string moreInformation, List<string> errors)
  {
    var headingDates = new List<string>();
    foreach (var heading in AmendmentHeadingRegex().Matches(body).Select(m => m.Groups[1].Value.Trim()))
    {
      var date = AmendmentDate(heading);
      if (date is null)
      {
        errors.Add($"M7: amendment heading '### {heading}' has no date (### Amendment, YYYY-MM-DD: summary)");
      }
      else
      {
        headingDates.Add(date);
      }
    }

    var bulletDates = AmendmentBulletRegex().Matches(moreInformation).Select(m => m.Groups[1].Value).ToList();
    IOrderedEnumerable<IGrouping<string, string>> byDate = headingDates
        .GroupBy(d => d, StringComparer.Ordinal)
        .OrderBy(g => g.Key, StringComparer.Ordinal);
    foreach (IGrouping<string, string> dated in byDate)
    {
      var bullets = bulletDates.Count(d => d == dated.Key);
      if (bullets < dated.Count())
      {
        errors.Add(
          $"M7: {dated.Count()} amendment heading(s) dated {dated.Key} but {bullets} More Information bullet(s) "
          + $"'* **Amendment, {dated.Key}:**'");
      }
    }
  }

  /// <summary>M6 (branch half): no number is used by two files. On a pull request, CI checks out the merge with main.</summary>
  private static void CheckDuplicateNumbers(string decisionsDir, List<string> errors)
  {
    IEnumerable<IGrouping<string, string>> duplicates = Directory.EnumerateFiles(decisionsDir, "*.md")
        .Select(Path.GetFileName)
        .OfType<string>()
        .Where(n => FileNameRegex().IsMatch(n))
        .GroupBy(n => n[..4], StringComparer.Ordinal)
        .Where(g => g.Count() > 1)
        .OrderBy(g => g.Key, StringComparer.Ordinal);
    foreach (IGrouping<string, string> duplicate in duplicates)
    {
      var names = string.Join(", ", duplicate.Order(StringComparer.Ordinal));
      errors.Add($"M6 ADR-{duplicate.Key}: number used by more than one file [{names}]; a new record takes --next-number");
    }
  }

  private static void CompareEntry(AdrRecord record, JsonElement entry, List<string> errors)
  {
    var id = $"ADR-{record.Number}";
    var title = Text(entry, "title");
    if (title != record.Title)
    {
      errors.Add($"M2 {id}: model title '{title}', file title '{record.Title}'");
    }
    var status = Text(entry, "status");
    if (status != record.Status)
    {
      errors.Add($"M2 {id}: model status '{status}', file says '{record.Status}'");
    }
    var supersededBy = Text(entry, "superseded-by");
    if (supersededBy != record.SupersededBy)
    {
      errors.Add($"M2 {id}: model superseded-by '{supersededBy}', file says '{record.SupersededBy}'");
    }
    var file = Text(entry, "file");
    if (Path.GetFileName(file ?? "") != record.FileName)
    {
      errors.Add($"M2 {id}: model file '{file}', record is {record.FileName}");
    }
  }

  private static void CheckModelCitations(
      JsonElement root,
      Dictionary<string, AdrRecord> records,
      Dictionary<string, JsonElement> entries,
      List<string> errors)
  {
    var citations = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
    if (root.ValueKind == JsonValueKind.Object)
    {
      foreach (JsonProperty property in root.EnumerateObject().Where(p => p.Name != "metadata"))
      {
        CollectCitations(property.Value, property.Name, citations);
      }
    }

    foreach ((var number, List<string> places) in citations)
    {
      var where = places.Count == 1 ? places[0] : $"{places[0]} and {places.Count - 1} other place(s)";
      if (!records.TryGetValue(number, out AdrRecord? record))
      {
        errors.Add($"M2 ADR-{number}: cited by the model at {where}, but there is no such record");
      }
      else if (record.SupersededBy is not null && !(entries.TryGetValue(number, out JsonElement entry) && Text(entry, "note") is not null))
      {
        errors.Add(
          $"M2 ADR-{number}: cited by the model at {where}, but superseded by {record.SupersededBy}; cite the newer record, "
          + "or give its metadata.adrs entry a \"note\" saying what still stands");
      }
    }
  }

  private static void CollectCitations(JsonElement element, string path, SortedDictionary<string, List<string>> citations)
  {
    switch (element.ValueKind)
    {
      case JsonValueKind.Object:
        foreach (JsonProperty property in element.EnumerateObject())
        {
          CollectCitations(property.Value, $"{path}.{property.Name}", citations);
        }
        break;
      case JsonValueKind.Array:
        var index = 0;
        foreach (JsonElement item in element.EnumerateArray())
        {
          CollectCitations(item, $"{path}[{index++}]", citations);
        }
        break;
      case JsonValueKind.String:
        IEnumerable<string> numbers = CitationRegex().Matches(element.GetString() ?? "")
            .Select(m => m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value);
        foreach (var number in numbers)
        {
          if (!citations.TryGetValue(number, out List<string>? places))
          {
            places = [];
            citations[number] = places;
          }
          places.Add(path);
        }
        break;
      default:
        break;
    }
  }

  private static void WriteRecord(
      Utf8JsonWriter json,
      AdrRecord record,
      Dictionary<string, JsonElement> entries,
      IReadOnlyDictionary<string, string>? firstOnMain)
  {
    json.WriteStartObject();
    json.WriteString("number", record.Number);
    json.WriteString("file", record.FileName);
    json.WriteString("title", record.Title);
    json.WriteString("date", record.Date);
    json.WriteString("status", record.Status);
    if (record.SupersededBy is null)
    {
      json.WriteNull("supersededBy");
    }
    else
    {
      json.WriteString("supersededBy", record.SupersededBy);
    }

    json.WriteStartArray("amendments");
    foreach (AdrAmendment amendment in record.Amendments)
    {
      json.WriteStartObject();
      json.WriteString("heading", amendment.Heading);
      if (amendment.Date is null)
      {
        json.WriteNull("date");
      }
      else
      {
        json.WriteString("date", amendment.Date);
      }
      json.WriteEndObject();
    }
    json.WriteEndArray();

    if (firstOnMain is not null)
    {
      if (firstOnMain.TryGetValue(record.FileName, out var first))
      {
        json.WriteString("firstOnMain", first);
      }
      else
      {
        json.WriteNull("firstOnMain");
      }
    }

    json.WritePropertyName("model");
    if (entries.TryGetValue(record.Number, out JsonElement entry))
    {
      entry.WriteTo(json);
    }
    else
    {
      json.WriteNullValue();
    }

    json.WriteStartObject("citedTokens");
    WriteStrings(json, "paths", record.Cited.Paths);
    WriteStrings(json, "commands", record.Cited.Commands);
    WriteStrings(json, "versions", record.Cited.Versions);
    json.WriteEndObject();
    json.WriteEndObject();
  }

  private static void WriteStrings(Utf8JsonWriter json, string name, IReadOnlyList<string> values)
  {
    json.WriteStartArray(name);
    foreach (var value in values)
    {
      json.WriteStringValue(value);
    }
    json.WriteEndArray();
  }

  /// <summary>
  /// Distinct inline code spans of <paramref name="outcome"/> (fenced blocks left out), kept when they read as a command
  /// (first word a known tool), a version (N.N with a leading digit, or after <c>@</c> or <c>:</c>) or a path (holds
  /// <c>/</c> or ends in a file extension). Identifiers, flags and prose are dropped.
  /// </summary>
  private static CitedTokens CiteTokens(string outcome)
  {
    var paths = new List<string>();
    var commands = new List<string>();
    var versions = new List<string>();
    IEnumerable<string> spans = InlineCodeRegex().Matches(FenceRegex().Replace(outcome, ""))
        .Select(m => m.Value.Trim('`').Trim())
        .Where(s => s.Length > 0)
        .Distinct(StringComparer.Ordinal);
    foreach (var span in spans)
    {
      var first = span.Split(' ', 2)[0];
      if (CommandWords.Contains(first, StringComparer.Ordinal))
      {
        commands.Add(span);
      }
      else if (VersionRegex().IsMatch(span))
      {
        versions.Add(span);
      }
      else if (PathRegex().IsMatch(span))
      {
        paths.Add(span);
      }
    }
    return new CitedTokens(paths, commands, versions);
  }

  /// <summary>
  /// The heading as plain text, as the docs site reads it (mdast <c>toString</c>): link text without its target, and no
  /// code or emphasis markers. The model's titles are plain text.
  /// </summary>
  private static string PlainText(string heading) =>
      EmphasisRegex().Replace(LinkRegex().Replace(heading, "$1"), "").Replace("`", "", StringComparison.Ordinal);

  private static string? AmendmentDate(string heading)
  {
    Match m = AmendmentDateRegex().Match(heading);
    return m.Success ? m.Groups[1].Value : null;
  }

  private static bool TryGetAdrEntries(JsonElement root, out JsonElement adrs)
  {
    adrs = default;
    return root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty("metadata", out JsonElement metadata)
        && metadata.ValueKind == JsonValueKind.Object
        && metadata.TryGetProperty("adrs", out adrs)
        && adrs.ValueKind == JsonValueKind.Array;
  }

  private static string? Text(JsonElement element, string name) =>
      element.ValueKind == JsonValueKind.Object
      && element.TryGetProperty(name, out JsonElement value)
      && value.ValueKind == JsonValueKind.String
          ? value.GetString()
          : null;

  [GeneratedRegex(@"^superseded by \[ADR-([0-9]{4})\]\(([^)]+)\)$", RegexOptions.None, 1000)]
  private static partial Regex SupersededRegex();

  [GeneratedRegex(@"^### (Amendment\b.*)$", RegexOptions.Multiline, 1000)]
  private static partial Regex AmendmentHeadingRegex();

  [GeneratedRegex(@"^Amendment, ([0-9]{4}-[0-9]{2}-[0-9]{2})\b", RegexOptions.None, 1000)]
  private static partial Regex AmendmentDateRegex();

  [GeneratedRegex(@"^\* \*\*Amendment, ([0-9]{4}-[0-9]{2}-[0-9]{2})\b[^*]*:\*\*", RegexOptions.Multiline, 1000)]
  private static partial Regex AmendmentBulletRegex();

  [GeneratedRegex(@"\[([^\]]*)\]\([^)]*\)", RegexOptions.None, 1000)]
  private static partial Regex LinkRegex();

  [GeneratedRegex(@"\*\*|__", RegexOptions.None, 1000)]
  private static partial Regex EmphasisRegex();

  [GeneratedRegex(@"^ADR-([0-9]{4})$", RegexOptions.None, 1000)]
  private static partial Regex AdrIdRegex();

  [GeneratedRegex(@"ADR-([0-9]{4})|/adr/([0-9]{4})/", RegexOptions.None, 1000)]
  private static partial Regex CitationRegex();

  [GeneratedRegex(@"[0-9]{4}", RegexOptions.None, 1000)]
  private static partial Regex NumberRegex();

  [GeneratedRegex(@"^(?:v?[0-9]+\.[0-9]+\S*|\S+[@:]v?[0-9]+\.[0-9]+\S*)$", RegexOptions.None, 1000)]
  private static partial Regex VersionRegex();

  [GeneratedRegex(@"^(?![a-z]+://)(?=\S*/|\S*\.[a-z][a-z0-9-]{0,11}$)\S+$", RegexOptions.None, 1000)]
  private static partial Regex PathRegex();
}
