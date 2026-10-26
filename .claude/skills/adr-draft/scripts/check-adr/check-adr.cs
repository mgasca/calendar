#!/usr/bin/env -S dotnet run
#:include AdrValidator.cs

// Validates ADRs against this repo's conventions (ADR-0000). See AdrValidator for the rules.
//
//   dotnet run check-adr.cs                      validate every ADR in docs/decisions
//   dotnet run check-adr.cs -- FILE...           validate specific ADRs (repo-level checks still run)
//   dotnet run check-adr.cs -- --fix-links       link bare "ADR-NNNN" mentions, then validate
//   dotnet run check-adr.cs -- --next-number     print the next free ADR number
//   dotnet run check-adr.cs -- --dir PATH        use another decisions directory
//
// Exit code 0 when no errors are found, 1 on validation errors, 2 on usage errors.

using AdrDraft;

var fixLinks = false;
var nextNumber = false;
string? dir = null;
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
        case "--dir" when pending.Count > 0:
            dir = pending.Dequeue();
            break;
        case "-h" or "--help":
            Console.WriteLine("usage: check-adr [--fix-links] [--next-number] [--dir PATH] [FILE...]");
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

var files = AdrValidator.AdrFiles(decisions);
if (nextNumber)
{
    Console.WriteLine(AdrValidator.NextNumber(decisions));
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

var indexPath = Path.Combine(decisions, AdrValidator.IndexFileName);
var indexText = File.Exists(indexPath) ? await File.ReadAllTextAsync(indexPath) : "";
var failed = false;

foreach (var error in AdrValidator.CheckRepository(decisions))
{
    Console.WriteLine($"repo: {error}");
    failed = true;
}

foreach (var target in targets)
{
    var result = AdrValidator.CheckFile(target, files, indexText);
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
