#!/usr/bin/env -S dotnet run
#:package Microsoft.Playwright@1.64.1
#:include Script.cs
// File-based apps default to PublishAot, which turns off the reflection-based JSON that Playwright needs.
#:property PublishAot=false

// Drives the running web app in headless Chromium, signed in through the API's development seed key
// (the X-Dev-Seed-Key header is sent with every request, so no Google sign-in is needed). The key comes from
// --seed-key, else Auth__DevSeedKey, else the disposable local value in .env.example.
// Reads one command per line from stdin and stops at the first command that fails. Script.cs parses the lines;
// tests/browse.tests.cs unit tests it. #:include needs a newer SDK than 10.0.1xx (see SKILL.md).
// When ~/.cache/calendar-chromium-libs holds extracted system libraries (see SKILL.md), Chromium loads them.
//
//   dotnet run browse.cs -- --install                            download Chromium once
//   dotnet run browse.cs -- [--base-url URL] [--out DIR] [--time-zone ZONE] [--seed-key KEY] < script
//   extra options: --viewport WxH (default 1280x900) and --color-scheme light|dark (the OS preference)
//
// Commands (a token with spaces goes in single quotes). Selectors are Playwright selectors, such as
// text=Week, role=button[name="Add task"] or css, plus label=TEXT for the first form field whose label contains TEXT:
//   nav PATH|URL             open a page, relative to --base-url
//   wait-for SELECTOR        wait until the element is visible
//   click SELECTOR           click it
//   fill SELECTOR TEXT...    replace the field's value with the rest of the line
//   press KEY                press a key on the focused element (Enter, Escape, Control+a, ...)
//   select SELECTOR VALUE    choose an option of a <select> by value or label
//   text [SELECTOR]          print the element's visible text (default: main)
//   count SELECTOR           print how many elements match
//   eval JS                  evaluate a JavaScript expression in the page and print the result
//   screenshot [NAME]        save a full-page PNG to --out and print its path
//   errors                   print console errors and failed (>= 400) responses seen so far
//
// Exit code 0 when every command succeeds, 1 when one fails, 2 on usage errors.

using Microsoft.Playwright;
using RunCalendar;

#pragma warning disable S1075 // the dev web address is the documented default of the run-calendar skill
var baseUrl = "http://127.0.0.1:55173";
#pragma warning restore S1075
var seedKey = Environment.GetEnvironmentVariable("Auth__DevSeedKey") ?? "local-development-seed-key-change-me-123456";
var outDir = Path.Combine(Path.GetTempPath(), "calendar-shots");
var timeZone = "UTC";
var width = 1280;
var height = 900;
ColorScheme colorScheme = ColorScheme.NoPreference;
var pending = new Queue<string>(args);
while (pending.TryDequeue(out var arg))
{
  switch (arg)
  {
    case "--install":
      return Microsoft.Playwright.Program.Main(["install", "chromium"]);
    case "--base-url" when pending.Count > 0:
      baseUrl = pending.Dequeue();
      break;
    case "--seed-key" when pending.Count > 0:
      seedKey = pending.Dequeue();
      break;
    case "--out" when pending.Count > 0:
      outDir = pending.Dequeue();
      break;
    case "--time-zone" when pending.Count > 0:
      timeZone = pending.Dequeue();
      break;
    case "--viewport" when pending.Count > 0:
      var size = pending.Dequeue().Split('x');
      if (size.Length != 2 || !int.TryParse(size[0], out width) || !int.TryParse(size[1], out height))
      {
        await Console.Error.WriteLineAsync("--viewport takes WIDTHxHEIGHT, for example 390x844");
        return 2;
      }

      break;
    case "--color-scheme" when pending.Count > 0:
      colorScheme = pending.Dequeue() switch
      {
        "light" => ColorScheme.Light,
        "dark" => ColorScheme.Dark,
        _ => ColorScheme.NoPreference,
      };
      break;
    case "-h" or "--help":
      Console.WriteLine(
        "usage: browse [--install] [--base-url URL] [--out DIR] [--time-zone ZONE] [--viewport WxH] "
        + "[--color-scheme light|dark] [--seed-key KEY] < script");
      return 0;
    default:
      await Console.Error.WriteLineAsync($"unknown option: {arg}");
      return 2;
  }
}

var libs = Path.Combine(
  Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
  ".cache/calendar-chromium-libs/usr/lib/x86_64-linux-gnu");
if (Directory.Exists(libs))
{
  // Playwright's node driver and Chromium inherit this process's environment.
  var current = Environment.GetEnvironmentVariable("LD_LIBRARY_PATH");
  Environment.SetEnvironmentVariable("LD_LIBRARY_PATH", string.IsNullOrEmpty(current) ? libs : $"{libs}:{current}");
}

Directory.CreateDirectory(outDir);
var problems = new List<string>();
using IPlaywright playwright = await Playwright.CreateAsync();
await using IBrowser browser = await playwright.Chromium.LaunchAsync(new() { Headless = true });
await using IBrowserContext context = await browser.NewContextAsync(new()
{
  BaseURL = baseUrl,
  TimezoneId = timeZone,
  Locale = "en-GB",
  ViewportSize = new() { Width = width, Height = height },
  ColorScheme = colorScheme,
  ExtraHTTPHeaders = new Dictionary<string, string> { ["X-Dev-Seed-Key"] = seedKey },
});
context.SetDefaultTimeout(15_000);
IPage page = await context.NewPageAsync();
page.Console += (_, message) =>
{
  if (message.Type == "error")
  {
    problems.Add($"console: {message.Text}");
  }
};
page.PageError += (_, error) => problems.Add($"page error: {error}");
page.Response += (_, response) =>
{
  if (response.Status >= 400)
  {
    problems.Add($"HTTP {response.Status} {response.Request.Method} {response.Url}");
  }
};

var shot = 0;
var lineNumber = 0;

// Playwright has no label= selector engine, so label=TEXT is mapped to GetByLabel. The match is a substring:
// the app nests each field inside its <label>, so a select's label text also contains its options.
ILocator Find(string selector) => selector.StartsWith("label=", StringComparison.Ordinal)
  ? page.GetByLabel(selector["label=".Length..])
  : page.Locator(selector);

while (await Console.In.ReadLineAsync() is { } line)
{
  lineNumber++;
  if (Script.Parse(line) is not { } step)
  {
    continue;
  }

  var trimmed = line.Trim();
  Console.WriteLine($"> {trimmed}");
  var command = step.Name;
  var target = step.Target;
  var rest = step.Rest;
  try
  {
    switch (command)
    {
      case "nav":
        await page.GotoAsync(target);
        break;
      case "wait-for":
        await Find(target).First.WaitForAsync();
        break;
      case "click":
        await Find(target).First.ClickAsync();
        break;
      case "fill":
        await Find(target).First.FillAsync(rest);
        break;
      case "press":
        await page.Keyboard.PressAsync(target);
        break;
      case "select":
        await Find(target).First.SelectOptionAsync(rest);
        break;
      case "text":
        Console.WriteLine(await Find(target.Length > 0 ? target : "main").First.InnerTextAsync());
        break;
      case "count":
        Console.WriteLine(await Find(target).CountAsync());
        break;
      case "eval":
        Console.WriteLine(await page.EvaluateAsync<object?>(target));
        break;
      case "screenshot":
        shot++;
        var name = target.Length > 0 ? target : $"shot-{shot:D2}";
        var path = Path.GetFullPath(Path.Combine(outDir, $"{name}.png"));
        await page.ScreenshotAsync(new() { Path = path, FullPage = true });
        Console.WriteLine(path);
        break;
      case "errors":
        Console.WriteLine(problems.Count == 0 ? "no errors" : string.Join('\n', problems));
        break;
      default:
        await Console.Error.WriteLineAsync($"line {lineNumber}: unknown command '{command}'");
        return 2;
    }
  }
  catch (Exception e) when (e is PlaywrightException or TimeoutException or ArgumentOutOfRangeException)
  {
    var failure = Path.GetFullPath(Path.Combine(outDir, "failure.png"));
    await page.ScreenshotAsync(new() { Path = failure, FullPage = true });
    await Console.Error.WriteLineAsync($"line {lineNumber}: {trimmed}\n{e.Message}\nscreenshot: {failure}");
    if (problems.Count > 0)
    {
      await Console.Error.WriteLineAsync(string.Join('\n', problems));
    }
    return 1;
  }
}

return 0;
