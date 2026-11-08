#!/usr/bin/env -S dotnet run
#:include AdrValidator.cs
#:include AdrSweepRules.cs

// Validates ADRs against this repo's conventions (ADR-0000), and the branch-only checks of the adr-sweep skill
// (M2 model, M3 supersession, M6 duplicate numbers, M7 amendment form, J6 planned story cards). See AdrValidator.
//
//   dotnet run check-adr.cs                      validate every ADR in docs/decisions
//   dotnet run check-adr.cs -- FILE...           validate specific ADRs (repo-level checks still run)
//   dotnet run check-adr.cs -- --fix-links       link bare "ADR-NNNN" mentions, then validate
//   dotnet run check-adr.cs -- --next-number     print the next free ADR number
//   dotnet run check-adr.cs -- --inventory       print the adr-sweep inventory as JSON (no validation)
//   dotnet run check-adr.cs -- --dir PATH        use another decisions directory
//   dotnet run check-adr.cs -- --model PATH      architecture model (default: ../architecture/calendar.architecture.json)
//   dotnet run check-adr.cs -- --stories PATH    story cards (default: ../stories)
//
// The model and stories defaults are relative to the decisions directory and skipped when absent; a path given with
// --model or --stories must exist. Exit code 0 when no errors are found, 1 on validation errors, 2 on usage errors.

using System.Diagnostics;
using AdrDraft;

var fixLinks = false;
var nextNumber = false;
var inventory = false;
string? dir = null;
string? modelOption = null;
string? storiesOption = null;
var targets = new List<string>();
var pending = new Queue<string>(args);

while (pending.TryDequeue(out var arg))
{
  switch (arg)
  {
    case "--fix-links":
      fixLinks = true;
      break;
    case "--next-number":
      nextNumber = true;
      break;
    case "--inventory":
      inventory = true;
      break;
    case "--dir" when pending.Count > 0:
      dir = pending.Dequeue();
      break;
    case "--model" when pending.Count > 0:
      modelOption = Path.GetFullPath(pending.Dequeue());
      break;
    case "--stories" when pending.Count > 0:
      storiesOption = Path.GetFullPath(pending.Dequeue());
      break;
    case "-h" or "--help":
      Console.WriteLine(
        "usage: check-adr [--fix-links] [--next-number] [--inventory] [--dir PATH] [--model PATH] [--stories PATH] [FILE...]");
      return 0;
    case var flag when flag.StartsWith('-'):
      await Console.Error.WriteLineAsync($"unknown option: {flag}");
      return 2;
    default:
      targets.Add(Path.GetFullPath(arg));
      break;
  }
}

var decisions = Path.GetFullPath(dir ?? Path.Combine(RepoRoot(), "docs", "decisions"));
if (!Directory.Exists(decisions))
{
  await Console.Error.WriteLineAsync($"decisions directory not found: {decisions}");
  return 2;
}
if (modelOption is not null && !File.Exists(modelOption))
{
  await Console.Error.WriteLineAsync($"architecture model not found: {modelOption}");
  return 2;
}
if (storiesOption is not null && !Directory.Exists(storiesOption))
{
  await Console.Error.WriteLineAsync($"stories directory not found: {storiesOption}");
  return 2;
}

var docs = Path.GetDirectoryName(decisions) ?? decisions;
var defaultModel = Path.Combine(docs, "architecture", "calendar.architecture.json");
var defaultStories = Path.Combine(docs, "stories");
var model = modelOption ?? (File.Exists(defaultModel) ? defaultModel : null);
var stories = storiesOption ?? (Directory.Exists(defaultStories) ? defaultStories : null);

IReadOnlyDictionary<string, string> files = AdrValidator.AdrFiles(decisions);
if (nextNumber)
{
  Console.WriteLine(AdrValidator.NextNumber(decisions));
  return 0;
}

if (inventory)
{
  IReadOnlyDictionary<string, string>? firstOnMain = FirstOnMain(decisions);
  if (firstOnMain is null)
  {
    await Console.Error.WriteLineAsync("firstOnMain omitted: git or origin/main is not available");
  }
  Console.WriteLine(AdrValidator.Inventory(AdrValidator.ReadRecords(decisions), model, firstOnMain));
  return 0;
}

if (targets.Count == 0)
{
  targets.AddRange(files.Values.Select(f => Path.Combine(decisions, f)));
}

if (fixLinks)
{
  foreach (var target in targets)
  {
    var changed = AdrValidator.FixLinks(target, files);
    if (changed > 0)
    {
      Console.WriteLine($"{Path.GetFileName(target)}: linked {changed} reference(s)");
    }
  }
}

var failed = false;
var repositoryErrors = new List<string>(AdrValidator.CheckRepository(decisions));
IReadOnlyList<AdrRecord> records = AdrValidator.ReadRecords(decisions);
if (model is not null)
{
  repositoryErrors.AddRange(AdrValidator.CheckModel(model, records));
}
if (stories is not null)
{
  repositoryErrors.AddRange(AdrValidator.CheckStories(stories, records));
}

foreach (var error in repositoryErrors)
{
  Console.WriteLine($"repo: {error}");
  failed = true;
}

foreach (var target in targets)
{
  AdrFileResult result = AdrValidator.CheckFile(target, files);
  Console.WriteLine($"{(result.Ok ? "OK  " : "FAIL")} {result.FileName}");
  foreach (var error in result.Errors)
  {
    Console.WriteLine($"     - {error}");
  }
  failed |= !result.Ok;
}

return failed ? 1 : 0;

// The nearest ancestor of the working directory containing .git (a directory, or a file in worktrees).
static string RepoRoot()
{
  for (var current = new DirectoryInfo(Directory.GetCurrentDirectory()); current is not null; current = current.Parent)
  {
    if (Path.Exists(Path.Combine(current.FullName, ".git")))
    {
      return current.FullName;
    }
  }
  return Directory.GetCurrentDirectory();
}

// The date each record first reached origin/main, from one local git log (no fetch); null when git or the ref is missing.
static IReadOnlyDictionary<string, string>? FirstOnMain(string decisionsDir)
{
  string[] candidates = ["/usr/bin/git", "/usr/local/bin/git", "/bin/git"];
  var git = candidates.FirstOrDefault(File.Exists);
  if (git is null)
  {
    return null;
  }
  var start = new ProcessStartInfo(git)
  {
    WorkingDirectory = decisionsDir,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
  };
  foreach (var word in new[] { "log", "--diff-filter=A", "--format=%cs", "--name-only", "origin/main", "--", "." })
  {
    start.ArgumentList.Add(word);
  }
  using var process = Process.Start(start);
  if (process is null)
  {
    return null;
  }
  var output = process.StandardOutput.ReadToEnd();
  process.WaitForExit();
  return process.ExitCode == 0 ? AdrValidator.ParseFirstAdded(output) : null;
}
