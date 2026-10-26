#!/usr/bin/env -S dotnet run
#:include SeedPlan.cs

// Seeds a running local API with a realistic day of events and tasks so the Today view can be demoed.
// Additive: it never deletes anything. For a clean slate run `make db-reset` and `make db-migrate` first.
//
//   make db-seed                                  seed today (local zone) via http://localhost:5041
//   make db-seed ARGS="--date 2026-10-26 --time-zone Europe/Berlin --api-url http://localhost:5041"
//
// Timed events and the timed task are anchored to local wall-clock times in the zone; every date-time is
// sent with an explicit offset. The completed overdue task is completed "now", so it appears in the
// agenda only when the seeded date is today in that zone.

using System.Net.Http.Json;
using SeedDev;

#pragma warning disable S1075 // the dev API address is the documented default (make dev-api)
var apiUrl = "http://localhost:5041";
#pragma warning restore S1075
string? zoneId = null;
DateOnly? date = null;
var pending = new Queue<string>(args);
while (pending.TryDequeue(out var arg))
{
  switch (arg)
  {
    case "--api-url" when pending.Count > 0:
      apiUrl = pending.Dequeue();
      break;
    case "--time-zone" when pending.Count > 0:
      zoneId = pending.Dequeue();
      break;
    case "--date" when pending.Count > 0 && DateOnly.TryParseExact(pending.Peek(), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed):
      date = parsed;
      pending.Dequeue();
      break;
    default:
      await Console.Error.WriteLineAsync($"unknown or invalid argument: {arg}\nusage: seed-dev [--api-url URL] [--time-zone IANA_ID] [--date YYYY-MM-DD]");
      return 2;
  }
}

zoneId ??= SeedPlan.LocalIanaId();
TimeZoneInfo zone;
try
{
  zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
}
catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
{
  await Console.Error.WriteLineAsync($"unknown time zone '{zoneId}'; pass an IANA id such as Europe/Berlin with --time-zone");
  return 2;
}

date ??= DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).DateTime);
var plan = SeedPlan.Build(date.Value, zone);

const string BaseSlash = "/"; // HttpClient needs a trailing slash to resolve relative paths
using var http = new HttpClient { BaseAddress = new Uri(apiUrl.TrimEnd('/') + BaseSlash), Timeout = TimeSpan.FromSeconds(30) };

try
{
  using var health = await http.GetAsync("api/health");
  health.EnsureSuccessStatusCode();
}
catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
{
  await Console.Error.WriteLineAsync($"""
        The API at {apiUrl} is not reachable ({e.Message}).
        Start it first:  make db-up && make db-migrate && make dev-api
        (set the connection string as described in the README, "Local database").
        """);
  return 1;
}

Console.WriteLine($"Seeding {date:yyyy-MM-dd} in {zone.Id} via {apiUrl}");

foreach (var item in plan.Events)
{
  using var response = await http.PostAsJsonAsync("api/events", item, SeedJson.Default.EventSeed);
  await EnsureCreatedAsync(response, $"event '{item.Title}'");
  Console.WriteLine($"  event  {item.Title}");
}

foreach (var item in plan.Tasks)
{
  using var response = await http.PostAsJsonAsync("api/tasks", item with { CompleteAfterCreate = false }, SeedJson.Default.TaskSeed);
  var created = await EnsureCreatedAsync(response, $"task '{item.Title}'");
  if (item.CompleteAfterCreate)
  {
    using var completed = await http.PostAsync($"api/tasks/{created.Id}/complete", content: null);
    await EnsureCreatedAsync(completed, $"completing task '{item.Title}'");
  }
  Console.WriteLine($"  task   {item.Title}{(item.CompleteAfterCreate ? " (completed)" : "")}");
}

Console.WriteLine($"Done. Check: {apiUrl}/api/agenda/day?date={date:yyyy-MM-dd}&timeZone={Uri.EscapeDataString(zone.Id)}");
return 0;

static async Task<Created> EnsureCreatedAsync(HttpResponseMessage response, string what)
{
  if (!response.IsSuccessStatusCode)
  {
    throw new InvalidOperationException($"API rejected {what}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
  }
  return await response.Content.ReadFromJsonAsync(SeedJson.Default.Created) ?? throw new InvalidOperationException($"empty response for {what}");
}
