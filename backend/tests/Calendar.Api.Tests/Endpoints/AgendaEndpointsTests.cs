using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;

namespace Calendar.Api.Tests.Endpoints;

public sealed class AgendaEndpointsTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private const string NewYork = "America/New_York";

  // ---- request validation ----

  [Theory]
  [InlineData("", "date")]
  [InlineData("timeZone=America/New_York", "date")]
  [InlineData("date=2026-10-26", "timeZone")]
  [InlineData("date=2026-10-26&timeZone=", "timeZone")]
  [InlineData("date=2026-10-26&timeZone=Nowhere/Land", "timeZone")]
  [InlineData("date=2026-10-26&timeZone=America", "timeZone")]
  [InlineData("date=2026-10-26&timeZone=Eastern%20Standard%20Time", "timeZone")]
  [InlineData("date=2026-10-26&timeZone=America//New_York", "timeZone")]
  [InlineData("date=0001-01-01&timeZone=UTC", "date")]
  [InlineData("date=1899-12-31&timeZone=UTC", "date")]
  [InlineData("date=2201-01-01&timeZone=UTC", "date")]
  [InlineData("date=9999-12-31&timeZone=Pacific/Kiritimati", "date")]
  public async Task GetDayAgenda_InvalidInput_Returns400ValidationProblem(string query, string field)
  {
    using var response = await Client.GetAsync(new Uri($"/api/agenda/day?{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    var errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue(errors.ToJsonString());
  }

  [Theory]
  [InlineData("date=not-a-date&timeZone=UTC")]
  [InlineData("date=2026-13-45&timeZone=UTC")]
  public async Task GetDayAgenda_UnparsableDate_Returns400(string query)
  {
    using var response = await Client.GetAsync(new Uri($"/api/agenda/day?{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }

  [Theory]
  [InlineData("1900-01-01")]
  [InlineData("2200-12-31")]
  public async Task GetDayAgenda_AtTheSupportedDateLimits_Works(string date) => (await GetAgendaAsync(date, "Pacific/Kiritimati")).Date.ShouldBe(DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture));

  [Theory]
  [InlineData("Asia/Calcutta", "Asia/Kolkata")]
  [InlineData("US/Eastern", "America/New_York")]
  [InlineData("Etc/GMT%2B5", "Etc/GMT+5")]
  public async Task GetDayAgenda_AcceptsLegacyAliasesAndEtcZones_EchoingTheCanonicalId(string requested, string canonical)
  {
    var agenda = await Client.GetFromJsonAsync<Calendar.Api.Contracts.DayAgendaResponse>(
        new Uri($"/api/agenda/day?date=2026-10-26&timeZone={requested}", UriKind.Relative), Ct);

    agenda!.TimeZone.ShouldBe(canonical);
  }

  // ---- shape ----

  [Fact]
  public async Task GetDayAgenda_Empty_ReturnsWindowAndEmptyLists()
  {
    var agenda = await GetAgendaAsync("2026-10-26", NewYork);

    agenda.Date.ShouldBe(new DateOnly(2026, 10, 26));
    agenda.TimeZone.ShouldBe(NewYork);
    agenda.Window.Start.ShouldBe(Utc(2026, 10, 26, 4));
    agenda.Window.End.ShouldBe(Utc(2026, 10, 27, 4));
    agenda.AllDayEvents.ShouldBeEmpty();
    agenda.Events.ShouldBeEmpty();
    agenda.Tasks.Overdue.ShouldBeEmpty();
    agenda.Tasks.DueToday.ShouldBeEmpty();
  }

  [Fact]
  public async Task GetDayAgenda_UsesCamelCasePropertyNames()
  {
    await SeedAsync(
        [CalendarEvent.Create("E", Utc(2026, 10, 26, 14), Utc(2026, 10, 26, 15), NewYork), CalendarEvent.CreateAllDay("A", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 27))],
        [TodoTask.Create("T", new DateOnly(2026, 10, 26))]);

    var json = await Client.GetStringAsync(new Uri("/api/agenda/day?date=2026-10-26&timeZone=America/New_York", UriKind.Relative), Ct);

    var root = JsonNode.Parse(json)!.AsObject();
    root.Select(p => p.Key).ShouldBe(["date", "timeZone", "window", "allDayEvents", "events", "tasks"], ignoreOrder: true);
    root["date"]!.GetValue<string>().ShouldBe("2026-10-26");
    root["events"]![0]!.AsObject().ContainsKey("startsBeforeDay").ShouldBeTrue();
    root["allDayEvents"]![0]!["startDate"]!.GetValue<string>().ShouldBe("2026-10-26");
    root["tasks"]!.AsObject().Select(p => p.Key).ShouldBe(["overdue", "dueToday"], ignoreOrder: true);
  }

  [Fact]
  public async Task GetDayAgenda_EchoesTheCanonicalZoneId() => (await GetAgendaAsync("2026-10-26", "utc")).TimeZone.ShouldBe("UTC");

  // ---- timed events ----

  [Fact]
  public async Task Events_OvernightSpan_AppearsOnBothDaysWithContinuationFlags()
  {
    // 23:00 on the 25th to 06:00 on the 26th, New York (EDT, -4).
    await SeedAsync([CalendarEvent.Create("Night shift", Utc(2026, 10, 26, 3), Utc(2026, 10, 26, 10), NewYork)]);

    var before = await GetAgendaAsync("2026-10-25", NewYork);
    var today = await GetAgendaAsync("2026-10-26", NewYork);
    var after = await GetAgendaAsync("2026-10-27", NewYork);

    var first = before.Events.ShouldHaveSingleItem();
    first.StartsBeforeDay.ShouldBeFalse();
    first.EndsAfterDay.ShouldBeTrue();

    var second = today.Events.ShouldHaveSingleItem();
    second.StartsBeforeDay.ShouldBeTrue();
    second.EndsAfterDay.ShouldBeFalse();
    second.Start.ShouldBe(Utc(2026, 10, 26, 3));
    second.End.ShouldBe(Utc(2026, 10, 26, 10));
    second.TimeZone.ShouldBe(NewYork);

    after.Events.ShouldBeEmpty();
  }

  [Fact]
  public async Task Events_SpanningTheWholeDay_HasBothFlags()
  {
    await SeedAsync([CalendarEvent.Create("Conference", Utc(2026, 10, 24, 12), Utc(2026, 10, 29, 12), NewYork)]);

    var item = (await GetAgendaAsync("2026-10-26", NewYork)).Events.ShouldHaveSingleItem();

    item.StartsBeforeDay.ShouldBeTrue();
    item.EndsAfterDay.ShouldBeTrue();
  }

  [Fact]
  public async Task Events_TouchingTheWindowEdges_AreExcluded()
  {
    // New York 2026-10-26 is [04:00Z, 2026-10-27T04:00Z).
    await SeedAsync(
    [
        CalendarEvent.Create("ends at window start", Utc(2026, 10, 26, 3), Utc(2026, 10, 26, 4), NewYork),
            CalendarEvent.Create("starts at window end", Utc(2026, 10, 27, 4), Utc(2026, 10, 27, 5), NewYork),
            CalendarEvent.Create("ends a second into the day", Utc(2026, 10, 26, 3), Utc(2026, 10, 26, 4).AddSeconds(1), NewYork),
            CalendarEvent.Create("starts a second before the end", Utc(2026, 10, 27, 4).AddSeconds(-1), Utc(2026, 10, 27, 5), NewYork),
        ]);

    var titles = (await GetAgendaAsync("2026-10-26", NewYork)).Events.Select(e => e.Title);

    titles.ShouldBe(["ends a second into the day", "starts a second before the end"]);
  }

  [Fact]
  public async Task Events_OnDstFallBackDay_UseTheTwentyFiveHourWindow()
  {
    // New York 2026-11-01: [04:00Z, 2026-11-02T05:00Z), 25 hours.
    await SeedAsync(
    [
        CalendarEvent.Create("late on the 31st", Utc(2026, 11, 1, 3, 30), Utc(2026, 11, 1, 3, 59), NewYork),
            CalendarEvent.Create("first minute", Utc(2026, 11, 1, 4), Utc(2026, 11, 1, 4, 1), NewYork),
            CalendarEvent.Create("23:30 EST on the 1st", Utc(2026, 11, 2, 4, 30), Utc(2026, 11, 2, 4, 45), NewYork),
            CalendarEvent.Create("00:00 EST on the 2nd", Utc(2026, 11, 2, 5), Utc(2026, 11, 2, 6), NewYork),
        ]);

    var nov1 = await GetAgendaAsync("2026-11-01", NewYork);

    nov1.Window.Start.ShouldBe(Utc(2026, 11, 1, 4));
    nov1.Window.End.ShouldBe(Utc(2026, 11, 2, 5));
    nov1.Events.Select(e => e.Title).ShouldBe(["first minute", "23:30 EST on the 1st"]);
    (await GetAgendaAsync("2026-11-02", NewYork)).Events.Select(e => e.Title).ShouldBe(["00:00 EST on the 2nd"]);
    (await GetAgendaAsync("2026-10-31", NewYork)).Events.Select(e => e.Title).ShouldBe(["late on the 31st"]);
  }

  [Fact]
  public async Task Events_AreSortedByStartThenTitle()
  {
    await SeedAsync(
    [
        CalendarEvent.Create("beta", Utc(2026, 10, 26, 15), Utc(2026, 10, 26, 16), NewYork),
            CalendarEvent.Create("Zulu", Utc(2026, 10, 26, 14), Utc(2026, 10, 26, 16), NewYork),
            CalendarEvent.Create("alpha", Utc(2026, 10, 26, 15), Utc(2026, 10, 26, 15, 30), NewYork),
            CalendarEvent.Create("early", Utc(2026, 10, 26, 5), Utc(2026, 10, 26, 6), NewYork),
        ]);

    (await GetAgendaAsync("2026-10-26", NewYork)).Events.Select(e => e.Title).ShouldBe(["early", "Zulu", "alpha", "beta"]);
  }

  // ---- all-day events ----

  [Fact]
  public async Task AllDayEvents_MultiDay_CoverStartThroughTheDayBeforeTheExclusiveEnd()
  {
    await SeedAsync([CalendarEvent.CreateAllDay("Trip", new DateOnly(2026, 10, 24), new DateOnly(2026, 10, 27))]);

    (await GetAgendaAsync("2026-10-23", NewYork)).AllDayEvents.ShouldBeEmpty();
    (await GetAgendaAsync("2026-10-24", NewYork)).AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-25", NewYork)).AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-26", NewYork)).AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-27", NewYork)).AllDayEvents.ShouldBeEmpty(); // end is exclusive
  }

  [Fact]
  public async Task AllDayEvents_AreFloating_TheSameDateInEveryZone()
  {
    await SeedAsync([CalendarEvent.CreateAllDay("Holiday", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 27))]);

    foreach (var zone in new[] { "Pacific/Kiritimati", "UTC", "Pacific/Pago_Pago" })
    {
      var agenda = await GetAgendaAsync("2026-10-26", zone);
      var item = agenda.AllDayEvents.ShouldHaveSingleItem();
      item.StartDate.ShouldBe(new DateOnly(2026, 10, 26));
      item.EndDate.ShouldBe(new DateOnly(2026, 10, 27));
      (await GetAgendaAsync("2026-10-27", zone)).AllDayEvents.ShouldBeEmpty();
    }
  }

  [Fact]
  public async Task AllDayEvents_AreSortedByStartDateThenTitle_AndNotMixedWithTimedEvents()
  {
    await SeedAsync(
    [
        CalendarEvent.CreateAllDay("b", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 27)),
            CalendarEvent.CreateAllDay("a", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 28)),
            CalendarEvent.CreateAllDay("older", new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 30)),
            CalendarEvent.Create("timed", Utc(2026, 10, 26, 14), Utc(2026, 10, 26, 15), NewYork),
        ]);

    var agenda = await GetAgendaAsync("2026-10-26", NewYork);

    agenda.AllDayEvents.Select(e => e.Title).ShouldBe(["older", "a", "b"]);
    agenda.Events.Select(e => e.Title).ShouldBe(["timed"]);
  }

  // ---- tasks ----

  [Fact]
  public async Task Tasks_DueToday_IncludesDateOnlyAndTimedInWindow_ButNotUndatedOrFuture()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("date today", new DateOnly(2026, 10, 26)),
            TodoTask.Create("timed today", dueAt: Utc(2026, 10, 26, 18)),
            TodoTask.Create("timed at window start", dueAt: Utc(2026, 10, 26, 4)),
            TodoTask.Create("timed at window end", dueAt: Utc(2026, 10, 27, 4)),
            TodoTask.Create("tomorrow", new DateOnly(2026, 10, 27)),
            TodoTask.Create("undated"),
        ]);

    var agenda = await GetAgendaAsync("2026-10-26", NewYork);

    agenda.Tasks.DueToday.Select(t => t.Title).ShouldBe(["timed at window start", "timed today", "date today"]);
    agenda.Tasks.Overdue.ShouldBeEmpty();
  }

  [Fact]
  public async Task Tasks_Overdue_OpenOnesAndOnesCompletedTodayAreShown_ButNotCompletedEarlier()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("open, due last week", new DateOnly(2026, 10, 19)),
            TodoTask.Create("open, timed yesterday", dueAt: Utc(2026, 10, 25, 20)),
            CompletedTask("done this morning", new DateOnly(2026, 10, 20), Utc(2026, 10, 26, 12)),
            CompletedTask("done at window start", new DateOnly(2026, 10, 20), Utc(2026, 10, 26, 4)),
            CompletedTask("done yesterday", new DateOnly(2026, 10, 20), Utc(2026, 10, 26, 3, 59)),
            CompletedTask("done at window end", new DateOnly(2026, 10, 20), Utc(2026, 10, 27, 4)),
            CompletedTask("timed, done today", null, Utc(2026, 10, 26, 6), dueAt: Utc(2026, 10, 24, 15)),
            TodoTask.Create("timed just before window", dueAt: Utc(2026, 10, 26, 3, 59)),
        ]);

    var overdue = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.Overdue;

    overdue.Select(t => t.Title).ShouldBe(
    [
        "open, due last week",
            "done at window start",
            "done this morning",
            "timed, done today",
            "open, timed yesterday",
            "timed just before window",
        ]);
    overdue.Where(t => t.IsCompleted).Select(t => t.Title).ShouldBe(["done this morning", "done at window start", "timed, done today"], ignoreOrder: true);
  }

  [Fact]
  public async Task Tasks_DueToday_StayVisibleWhenCompleted()
  {
    await SeedAsync(tasks:
    [
        CompletedTask("done earlier", new DateOnly(2026, 10, 26), Utc(2026, 10, 24)),
            CompletedTask("done today", new DateOnly(2026, 10, 26), Utc(2026, 10, 26, 13)),
            CompletedTask("done timed", null, Utc(2026, 10, 26, 13), dueAt: Utc(2026, 10, 26, 14)),
        ]);

    var dueToday = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.DueToday;

    dueToday.Select(t => t.Title).ShouldBe(["done timed", "done earlier", "done today"]);
    dueToday.ShouldAllBe(t => t.IsCompleted);
  }

  [Fact]
  public async Task Tasks_Overdue_AreOrderedOldestDueFirst_AcrossDateAndInstantDues()
  {
    // New York local dates: instants are converted to the viewer's zone before comparing with dates.
    await SeedAsync(tasks:
    [
        TodoTask.Create("c: date 10-24", new DateOnly(2026, 10, 24)),
            TodoTask.Create("a: date 10-20", new DateOnly(2026, 10, 20)),
            TodoTask.Create("b2: date 10-22", new DateOnly(2026, 10, 22)),
            TodoTask.Create("b1: timed 10-22 18:00 local", dueAt: Utc(2026, 10, 22, 22)),
            TodoTask.Create("d: timed 10-23 23:30 local", dueAt: Utc(2026, 10, 24, 3, 30)),
            TodoTask.Create("e: timed 10-25 00:30 local", dueAt: Utc(2026, 10, 25, 4, 30)),
        ]);

    var overdue = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.Overdue;

    overdue.Select(t => t.Title).ShouldBe(
    [
        "a: date 10-20",
            "b1: timed 10-22 18:00 local",
            "b2: date 10-22",
            "d: timed 10-23 23:30 local",
            "c: date 10-24",
            "e: timed 10-25 00:30 local",
        ]);
  }

  [Fact]
  public async Task Tasks_DueToday_AreOrderedTimedByInstantThenDateOnlyByTitle()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("zeta", new DateOnly(2026, 10, 26)),
            TodoTask.Create("late", dueAt: Utc(2026, 10, 26, 21)),
            TodoTask.Create("Alpha", new DateOnly(2026, 10, 26)),
            TodoTask.Create("early", dueAt: Utc(2026, 10, 26, 9)),
        ]);

    var dueToday = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.DueToday;

    dueToday.Select(t => t.Title).ShouldBe(["early", "late", "Alpha", "zeta"]);
  }

  [Fact]
  public async Task Tasks_DateOnlyDues_AreFloating_TheSameDateInEveryZone()
  {
    await SeedAsync(tasks: [TodoTask.Create("floating", new DateOnly(2026, 10, 26))]);

    foreach (var zone in new[] { "Pacific/Kiritimati", "UTC", "Pacific/Pago_Pago" })
    {
      (await GetAgendaAsync("2026-10-26", zone)).Tasks.DueToday.ShouldHaveSingleItem();
      (await GetAgendaAsync("2026-10-27", zone)).Tasks.Overdue.ShouldHaveSingleItem();
    }
  }

  [Fact]
  public async Task Tasks_TimedDue_ShiftsDayWithTheViewersZone()
  {
    // 02:00Z on the 27th is 22:00 on the 26th in New York but already the 27th in UTC.
    await SeedAsync(tasks: [TodoTask.Create("late night", dueAt: Utc(2026, 10, 27, 2))]);

    (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.DueToday.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-26", "UTC")).Tasks.DueToday.ShouldBeEmpty();
    (await GetAgendaAsync("2026-10-27", "UTC")).Tasks.DueToday.ShouldHaveSingleItem();
  }

  [Fact]
  public async Task Tasks_CompletingAnOverdueTaskThroughTheApi_KeepsItVisibleAsDone()
  {
    // The flow the Today view relies on: tick an overdue task and it must not vanish.
    var task = TodoTask.Create("late", new DateOnly(2026, 10, 20));
    await SeedAsync(tasks: [task]);
    Clock.SetUtcNow(Utc(2026, 10, 26, 15));

    using var completed = await Client.PostAsync(new Uri($"/api/tasks/{task.Id}/complete", UriKind.Relative), content: null, Ct);
    completed.EnsureSuccessStatusCode();

    var overdue = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.Overdue.ShouldHaveSingleItem();
    overdue.IsCompleted.ShouldBeTrue();
    (await GetAgendaAsync("2026-10-27", NewYork)).Tasks.Overdue.ShouldBeEmpty();
  }

  // ---- skipped / odd days ----

  [Fact]
  public async Task Events_OnADateSkippedByAClockChange_AreNeverShown()
  {
    // Pacific/Apia skipped 2011-12-30 entirely: the window is empty.
    await SeedAsync(
    [
        CalendarEvent.Create("spans the jump", Utc(2011, 12, 29, 12), Utc(2011, 12, 31, 12), "Pacific/Apia"),
            CalendarEvent.CreateAllDay("floating", new DateOnly(2011, 12, 30), new DateOnly(2011, 12, 31)),
        ]);

    var agenda = await GetAgendaAsync("2011-12-30", "Pacific/Apia");

    agenda.Window.Start.ShouldBe(agenda.Window.End);
    agenda.Events.ShouldBeEmpty();
    agenda.AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2011-12-29", "Pacific/Apia")).Events.ShouldHaveSingleItem();
    (await GetAgendaAsync("2011-12-31", "Pacific/Apia")).Events.ShouldHaveSingleItem();
  }

  [Fact]
  public async Task Window_OnAGapStartingAtMidnight_StartsAtTheTransition()
  {
    var agenda = await GetAgendaAsync("2024-10-06", "America/Asuncion");

    agenda.Window.Start.ShouldBe(Utc(2024, 10, 6, 4));
  }
}
