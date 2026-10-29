using System.Text;
using System.Text.RegularExpressions;

namespace AdrDraft;

/// <summary>Result of validating one ADR file.</summary>
public sealed record AdrFileResult(string FileName, IReadOnlyList<string> Errors)
{
  /// <summary>True when the file has no validation errors.</summary>
  public bool Ok => Errors.Count == 0;
}

/// <summary>
/// Validates Architecture Decision Records against this repo's conventions (ADR-0000).
/// Pure logic: no console output and no process exit, so it can be unit tested.
/// </summary>
public static partial class AdrValidator
{
  /// <summary>File name of the ADR index in the decisions directory.</summary>
  public const string IndexFileName = "README.md";
  /// <summary>File name of the ADR template in the decisions directory.</summary>
  public const string TemplateFileName = "adr-template.md";

  private static readonly string[] RequiredH2 =
  [
      "Context and Problem Statement",
        "Decision Drivers",
        "Considered Options",
        "Decision Outcome",
        "Pros and Cons of the Options",
    ];

  private static readonly string[] RequiredH3InOutcome = ["Consequences", "Confirmation"];

  private static readonly HashSet<string> Stars = new(StringComparer.Ordinal) { "★★★", "★★☆", "★☆☆", "☆☆☆" };

  /// <summary>Maps ADR number ("0014") to its file name, for files in <paramref name="decisionsDir"/>.</summary>
  public static IReadOnlyDictionary<string, string> AdrFiles(string decisionsDir)
  {
    var files = new SortedDictionary<string, string>(StringComparer.Ordinal);
    foreach (var path in Directory.EnumerateFiles(decisionsDir, "*.md"))
    {
      var name = Path.GetFileName(path);
      Match m = FileNameRegex().Match(name);
      if (m.Success)
      {
        files[m.Groups[1].Value] = name;
      }
    }
    return files;
  }

  /// <summary>Next free ADR number, zero-padded (e.g. "0017").</summary>
  public static string NextNumber(string decisionsDir)
  {
    var numbers = AdrFiles(decisionsDir).Keys.Select(int.Parse).ToList();
    var next = numbers.Count == 0 ? 0 : numbers.Max() + 1;
    return next.ToString("D4", System.Globalization.CultureInfo.InvariantCulture);
  }

  /// <summary>Repository-level checks: contiguous numbering and no stray Markdown files.</summary>
  public static IReadOnlyList<string> CheckRepository(string decisionsDir)
  {
    var errors = new List<string>();
    var numbers = AdrFiles(decisionsDir).Keys.Select(int.Parse).Order().ToList();
    if (!numbers.SequenceEqual(Enumerable.Range(0, numbers.Count)))
    {
      errors.Add($"ADR numbers must be contiguous from 0000, got [{string.Join(", ", numbers)}]");
    }

    var stray = Directory.EnumerateFiles(decisionsDir, "*.md")
        .Select(Path.GetFileName)
        .OfType<string>()
        .Where(n => n is not IndexFileName and not TemplateFileName && !FileNameRegex().IsMatch(n))
        .Order(StringComparer.Ordinal)
        .ToList();
    if (stray.Count > 0)
    {
      errors.Add($"unexpected files in {decisionsDir}: [{string.Join(", ", stray)}]");
    }
    return errors;
  }

  /// <summary>Validates a single ADR. <paramref name="files"/> comes from <see cref="AdrFiles"/>.</summary>
  public static AdrFileResult CheckFile(string path, IReadOnlyDictionary<string, string> files, string indexText)
  {
    var name = Path.GetFileName(path);
    var text = File.ReadAllText(path);
    var errors = new List<string>();
    var number = name.Length >= 4 ? name[..4] : name;

    if (!FileNameRegex().IsMatch(name))
    {
      errors.Add("filename must be NNNN-lowercase-kebab-title.md");
    }

    Dictionary<string, string> meta = CheckFrontMatter(text, errors, out var body);
    Match title = H1Regex().Match(body);
    if (!title.Success)
    {
      errors.Add("missing H1 title");
    }

    List<(string Heading, string Content)> h2Ordered = Sections(body, 2);
    Dictionary<string, string> h2 = SectionMap(h2Ordered);
    CheckSectionOrder(h2Ordered.ConvertAll(s => s.Heading), errors);

    List<string> drivers = CheckDrivers(h2.GetValueOrDefault("Decision Drivers", ""), errors);
    var outcome = h2.GetValueOrDefault("Decision Outcome", "");
    var prosCons = h2.GetValueOrDefault("Pros and Cons of the Options", "");

    CheckOptionsMatchProsCons(h2.GetValueOrDefault("Considered Options", ""), prosCons, errors);
    CheckOutcome(outcome, errors);
    CheckRatingTables(outcome, drivers, meta.GetValueOrDefault("status", ""), errors);
    CheckProsCons(prosCons, drivers, errors);
    CheckLinks(path, text, number, files, errors);
    CheckIndexRow(name, number, title, meta, indexText, errors);

    return new AdrFileResult(name, errors);
  }

  /// <summary>Rewrites bare "ADR-NNNN" mentions (outside code) as Markdown links. Returns how many were changed.</summary>
  public static int FixLinks(string path, IReadOnlyDictionary<string, string> files)
  {
    var text = File.ReadAllText(path);
    var self = Path.GetFileName(path)[..4];
    var count = 0;

    string Replace(Match m)
    {
      var reference = m.Groups[1].Value;
      if (reference == self || !files.TryGetValue(reference, out var target))
      {
        return m.Value;
      }
      count++;
      return $"[ADR-{reference}]({target})";
    }

    var output = new StringBuilder();
    var position = 0;
    foreach (Match code in CodeRegex().Matches(text))
    {
      output.Append(BareReferenceRegex().Replace(text[position..code.Index], Replace));
      output.Append(code.Value);
      position = code.Index + code.Length;
    }
    output.Append(BareReferenceRegex().Replace(text[position..], Replace));

    if (count > 0)
    {
      File.WriteAllText(path, output.ToString());
    }
    return count;
  }

  private static Dictionary<string, string> CheckFrontMatter(string text, List<string> errors, out string body)
  {
    var meta = new Dictionary<string, string>(StringComparer.Ordinal);
    Match fm = FrontMatterRegex().Match(text);
    if (!fm.Success)
    {
      errors.Add("missing YAML front matter (status, date, decision-makers)");
      body = text;
      return meta;
    }

    foreach (var line in fm.Groups[1].Value.Split('\n'))
    {
      var colon = line.IndexOf(':', StringComparison.Ordinal);
      if (colon > 0)
      {
        meta[line[..colon].Trim()] = line[(colon + 1)..].Trim();
      }
    }

    if (!StatusRegex().IsMatch(meta.GetValueOrDefault("status", "")))
    {
      errors.Add($"front matter status invalid: '{meta.GetValueOrDefault("status", "")}'");
    }
    if (!DateRegex().IsMatch(meta.GetValueOrDefault("date", "")))
    {
      errors.Add("front matter date must be YYYY-MM-DD");
    }
    if (string.IsNullOrEmpty(meta.GetValueOrDefault("decision-makers")))
    {
      errors.Add("front matter decision-makers is empty");
    }

    body = text[(fm.Index + fm.Length)..];
    return meta;
  }

  private static void CheckSectionOrder(List<string> headings, List<string> errors)
  {
    var missing = RequiredH2.Where(h => !headings.Contains(h)).ToList();
    if (missing.Count > 0)
    {
      errors.Add($"missing sections: [{string.Join(", ", missing)}]");
      return;
    }
    var present = headings.Where(RequiredH2.Contains).Distinct().ToList();
    if (!present.SequenceEqual(RequiredH2))
    {
      errors.Add($"sections out of order: [{string.Join(", ", present)}]");
    }
  }

  private static List<string> CheckDrivers(string section, List<string> errors)
  {
    var drivers = DriverRegex().Matches(section).Select(m => m.Groups[1].Value).ToList();
    if (drivers.Count == 0)
    {
      errors.Add("no drivers found (format: * **D1 Name**: why it matters)");
    }
    else if (!drivers.SequenceEqual(Enumerable.Range(1, drivers.Count).Select(i => $"D{i}")))
    {
      errors.Add($"drivers must be numbered D1..Dn in order, got [{string.Join(", ", drivers)}]");
    }
    if (BulletRegex().Count(section) != drivers.Count)
    {
      errors.Add("every Decision Drivers bullet must use: * **Dn Name**: description");
    }
    return drivers;
  }

  private static void CheckOptionsMatchProsCons(string options, string prosCons, List<string> errors)
  {
    var optionCount = BulletRegex().Count(options);
    var sectionCount = H3Regex().Count(prosCons);
    if (optionCount != sectionCount)
    {
      errors.Add($"{optionCount} considered options but {sectionCount} pros/cons sections");
    }
  }

  private static void CheckOutcome(string outcome, List<string> errors)
  {
    if (!outcome.Contains("Chosen option", StringComparison.Ordinal) && !LabelledChoiceRegex().IsMatch(outcome))
    {
      errors.Add("Decision Outcome must state the choice (\"Chosen option: ...\")");
    }
    var h3 = H3Regex().Matches(outcome).Select(m => m.Groups[1].Value.Trim()).ToList();
    foreach (var heading in RequiredH3InOutcome.Where(h => !h3.Contains(h)))
    {
      errors.Add($"Decision Outcome is missing '### {heading}'");
    }
  }

  private static void CheckRatingTables(string outcome, List<string> drivers, string status, List<string> errors)
  {
    var tables = ParseTables(outcome).Where(t => t.Count > 0 && t[0].Count > 0 && t[0][0] == "Driver").ToList();
    if (tables.Count == 0)
    {
      errors.Add("no rating table in Decision Outcome (header must start with '| Driver |')");
      return;
    }

    var rated = new HashSet<string>(StringComparer.Ordinal);
    for (var t = 0; t < tables.Count; t++)
    {
      CheckRatingTable(t + 1, tables[t], drivers, status, rated, errors);
    }

    var unrated = drivers.Where(d => !rated.Contains(d)).ToList();
    if (unrated.Count > 0)
    {
      errors.Add($"drivers not rated in any table: [{string.Join(", ", unrated)}]");
    }
  }

  private static void CheckRatingTable(
      int tableNumber,
      List<List<string>> table,
      List<string> drivers,
      string status,
      HashSet<string> rated,
      List<string> errors)
  {
    List<string> header = table[0];
    var chosen = header.Skip(1).Where(c => ChosenColumnRegex().IsMatch(c)).ToList();
    if (status is "proposed" or "accepted" && chosen.Count != 1)
    {
      errors.Add($"table {tableNumber}: exactly one option column must be '**Name (chosen)**' (found {chosen.Count})");
    }
    if (chosen.Count > 0 && header.Count > 1 && header[1] != chosen[0])
    {
      errors.Add($"table {tableNumber}: the chosen option must be the first option column");
    }
    if (header.Count < 3)
    {
      errors.Add($"table {tableNumber}: needs at least two option columns");
    }

    foreach (List<string>? row in table.Skip(2))
    {
      Match m = RowLabelRegex().Match(row[0] + " ");
      if (!m.Success)
      {
        errors.Add($"table {tableNumber}: row label '{row[0]}' must start with a driver id (e.g. 'D1 Name')");
        continue;
      }
      var driver = m.Groups[1].Value;
      if (!drivers.Contains(driver))
      {
        errors.Add($"table {tableNumber}: row {driver} is not a declared driver");
      }
      rated.Add(driver);
      if (row.Count != header.Count)
      {
        errors.Add($"table {tableNumber}: row {driver} has {row.Count} cells, header has {header.Count}");
      }
      var bad = row.Skip(1).Where(c => !Stars.Contains(c)).ToList();
      if (bad.Count > 0)
      {
        errors.Add($"table {tableNumber}: row {driver} has invalid ratings [{string.Join(", ", bad)}] (use ★★★ ★★☆ ★☆☆ ☆☆☆)");
      }
    }
  }

  private static void CheckProsCons(string prosCons, List<string> drivers, List<string> errors)
  {
    IEnumerable<string> untagged = BulletLineRegex().Matches(prosCons).Select(m => m.Value).Where(b => !ProConRegex().IsMatch(b));
    foreach (var bullet in untagged)
    {
      var preview = bullet.Length > 70 ? bullet[..70] : bullet;
      errors.Add($"pros/cons bullet must start '* Good|Bad|Neutral, because **Dn ...': {preview}");
    }

    var used = DriverMentionRegex().Matches(prosCons).Select(m => m.Groups[1].Value).ToHashSet(StringComparer.Ordinal);
    var unused = drivers.Where(d => !used.Contains(d)).ToList();
    if (unused.Count > 0)
    {
      errors.Add($"drivers never argued in pros/cons: [{string.Join(", ", unused)}]");
    }

    foreach ((var heading, var content) in Sections(prosCons, 3))
    {
      if (!BulletRegex().IsMatch(content))
      {
        errors.Add($"option '{heading}' has no pros/cons bullets");
      }
    }
  }

  private static void CheckLinks(
      string path,
      string text,
      string number,
      IReadOnlyDictionary<string,
      string> files,
      List<string> errors)
  {
    var plain = StripCode(text);
    foreach (Match m in BareReferenceRegex().Matches(plain))
    {
      var reference = m.Groups[1].Value;
      if (reference != number)
      {
        var target = files.TryGetValue(reference, out var file) ? file : "?";
        errors.Add($"bare reference ADR-{reference}: link it as [ADR-{reference}]({target})");
      }
    }

    var directory = Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".";
    foreach (Match m in LinkTargetRegex().Matches(plain))
    {
      var target = m.Groups[1].Value;
      if (!SchemeRegex().IsMatch(target) && !Path.Exists(Path.GetFullPath(Path.Combine(directory, target))))
      {
        errors.Add($"broken link: {target}");
      }
    }
  }

  private static void CheckIndexRow(
      string name,
      string number,
      Match title,
      Dictionary<string,
      string> meta,
      string indexText,
      List<string> errors)
  {
    var pattern = $@"^\| \[{number}\]\({Regex.Escape(name)}\) \| (.+?) \| (.+?) \|$";
    Match row = Regex.Match(indexText, pattern, RegexOptions.Multiline, TimeSpan.FromSeconds(1));
    if (!row.Success)
    {
      errors.Add($"no row for {name} in docs/decisions/{IndexFileName}");
      return;
    }
    if (title.Success && row.Groups[1].Value != title.Groups[1].Value.Trim())
    {
      errors.Add($"index title differs from H1: '{row.Groups[1].Value}'");
    }
    var status = meta.GetValueOrDefault("status", "");
    var indexStatus = row.Groups[2].Value.Split(' ')[0];
    if (status.Length > 0 && !status.StartsWith(indexStatus, StringComparison.Ordinal))
    {
      errors.Add($"index status '{row.Groups[2].Value}' differs from front matter '{status}'");
    }
  }

  /// <summary>Splits Markdown into (heading, content) pairs, in document order, for headings of exactly <paramref name="level"/>.</summary>
  private static List<(string Heading, string Content)> Sections(string markdown, int level)
  {
    MatchCollection headings = Regex.Matches(markdown, $"^{new string('#', level)} (.+)$", RegexOptions.Multiline, TimeSpan.FromSeconds(1));
    var result = new List<(string Heading, string Content)>(headings.Count);
    for (var i = 0; i < headings.Count; i++)
    {
      var start = headings[i].Index + headings[i].Length;
      var end = i + 1 < headings.Count ? headings[i + 1].Index : markdown.Length;
      result.Add((headings[i].Groups[1].Value.Trim(), markdown[start..end]));
    }
    return result;
  }

  private static Dictionary<string, string> SectionMap(List<(string Heading, string Content)> sections)
  {
    var map = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach ((var heading, var content) in sections)
    {
      map[heading] = content;
    }
    return map;
  }

  private static List<List<List<string>>> ParseTables(string text)
  {
    var tables = new List<List<List<string>>>();
    var current = new List<List<string>>();
    foreach (var line in text.Split('\n'))
    {
      if (line.StartsWith('|'))
      {
        current.Add([.. line.Trim().Trim('|').Split('|').Select(c => c.Trim())]);
      }
      else if (current.Count > 0)
      {
        tables.Add(current);
        current = [];
      }
    }
    if (current.Count > 0)
    {
      tables.Add(current);
    }
    return tables;
  }

  /// <summary>Blanks out fenced and inline code so references inside code aren't checked.</summary>
  private static string StripCode(string text)
  {
    var withoutFences = FenceRegex().Replace(text, m => new string('\n', m.Value.Count(c => c == '\n')));
    return InlineCodeRegex().Replace(withoutFences, "``");
  }

  [GeneratedRegex(@"^([0-9]{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$", RegexOptions.None, 1000)]
  private static partial Regex FileNameRegex();

  [GeneratedRegex(
    @"^(proposed|accepted|rejected|deprecated|superseded by \[ADR-[0-9]{4}\]\([0-9]{4}-[a-z0-9-]+\.md\))$",
    RegexOptions.None,
    1000)]
  private static partial Regex StatusRegex();

  [GeneratedRegex(@"^[0-9]{4}-[0-9]{2}-[0-9]{2}$", RegexOptions.None, 1000)]
  private static partial Regex DateRegex();

  [GeneratedRegex(@"\A---\n(.*?)\n---\n", RegexOptions.Singleline, 1000)]
  private static partial Regex FrontMatterRegex();

  [GeneratedRegex(@"^# (.+)$", RegexOptions.Multiline, 1000)]
  private static partial Regex H1Regex();

  [GeneratedRegex(@"^### (.+)$", RegexOptions.Multiline, 1000)]
  private static partial Regex H3Regex();

  [GeneratedRegex(@"^\* \*\*(D[0-9]+) [^*]+\*\*: \S", RegexOptions.Multiline, 1000)]
  private static partial Regex DriverRegex();

  [GeneratedRegex(@"^\* ", RegexOptions.Multiline, 1000)]
  private static partial Regex BulletRegex();

  [GeneratedRegex(@"^\* .*$", RegexOptions.Multiline, 1000)]
  private static partial Regex BulletLineRegex();

  [GeneratedRegex(@"^\* (Good|Bad|Neutral), because \*\*D[0-9]+", RegexOptions.None, 1000)]
  private static partial Regex ProConRegex();

  [GeneratedRegex(@"\*\*(D[0-9]+)", RegexOptions.None, 1000)]
  private static partial Regex DriverMentionRegex();

  [GeneratedRegex(@"\*\*[^*]+:\*\* ", RegexOptions.None, 1000)]
  private static partial Regex LabelledChoiceRegex();

  [GeneratedRegex(@"^\*\*.+ \(chosen\)\*\*$", RegexOptions.None, 1000)]
  private static partial Regex ChosenColumnRegex();

  [GeneratedRegex(@"^(D[0-9]+) ", RegexOptions.None, 1000)]
  private static partial Regex RowLabelRegex();

  [GeneratedRegex(@"(?<!\[)ADR-([0-9]{4})(?!\]\()", RegexOptions.None, 1000)]
  private static partial Regex BareReferenceRegex();

  [GeneratedRegex(@"\]\(([^)#\s]+)\)", RegexOptions.None, 1000)]
  private static partial Regex LinkTargetRegex();

  [GeneratedRegex(@"^[a-z]+:", RegexOptions.None, 1000)]
  private static partial Regex SchemeRegex();

  [GeneratedRegex(@"```.*?```", RegexOptions.Singleline, 1000)]
  private static partial Regex FenceRegex();

  [GeneratedRegex(@"`[^`\n]*`", RegexOptions.None, 1000)]
  private static partial Regex InlineCodeRegex();

  [GeneratedRegex(@"```.*?```|`[^`\n]*`", RegexOptions.Singleline, 1000)]
  private static partial Regex CodeRegex();
}
