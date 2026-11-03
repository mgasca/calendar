using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Calendar.Api.Contracts;
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
    using HttpResponseMessage response = await Client.GetAsync(new Uri($"/api/agenda/day?{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    JsonObject errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue(errors.ToJsonString());
  }

  [Theory]
  [InlineData("date=not-a-date&timeZone=UTC")]
  [InlineData("date=2026-13-45&timeZone=UTC")]
  public async Task GetDayAgenda_UnparsableDate_Returns400(string query)
  {
    using HttpResponseMessage response = await Client.GetAsync(new Uri($"/api/agenda/day?{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }

  [Theory]
  [InlineData("1900-01-01")]
  [InlineData("2200-12-31")]
  public async Task GetDayAgenda_AtTheSupportedDateLimits_Works(string date)
  {
    DayAgendaResponse agenda = await GetAgendaAsync(date, "Pacific/Kiritimati");
    agenda.Date.ShouldBe(DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture));
  }

  [Theory]
  [InlineData("Asia/Calcutta", "Asia/Kolkata")]
  [InlineData("US/Eastern", "America/New_York")]
  [InlineData("Etc/GMT%2B5", "Etc/GMT+5")]
  public async Task GetDayAgenda_AcceptsLegacyAliasesAndEtcZones_EchoingTheCanonicalId(string requested, string canonical)
  {
    DayAgendaResponse? agenda = await Client.GetFromJsonAsync<Calendar.Api.Contracts.DayAgendaResponse>(
        new Uri($"/api/agenda/day?date=2026-10-26&timeZone={requested}", UriKind.Relative),
        Ct);

    agenda!.TimeZone.ShouldBe(canonical);
  }

  // ---- shape ----

  [Fact]
  public async Task GetDayAgenda_Empty_ReturnsWindowAndEmptyLists()
  {
    DayAgendaResponse agenda = await GetAgendaAsync("2026-10-26", NewYork);

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
        [
          CalendarEvent.Create(Owner, "E", Utc(2026, 10, 26, 14), Utc(2026, 10, 26, 15), NewYork),
          CalendarEvent.CreateAllDay(Owner, "A", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 27)),
        ],
        [TodoTask.Create(Owner, "T", new DateOnly(2026, 10, 26))]);

    var json = await Client.GetStringAsync(new Uri("/api/agenda/day?date=2026-10-26&timeZone=America/New_York", UriKind.Relative), Ct);

    JsonObject root = JsonNode.Parse(json)!.AsObject();
    root.Select(p => p.Key).ShouldBe(["date", "timeZone", "window", "allDayEvents", "events", "tasks"], ignoreOrder: true);
    root["date"]!.GetValue<string>().ShouldBe("2026-10-26");
    root["events"]![0]!.AsObject().ContainsKey("startsBeforeDay").ShouldBeTrue();
    root["allDayEvents"]![0]!["startDate"]!.GetValue<string>().ShouldBe("2026-10-26");
    root["tasks"]!.AsObject().Select(p => p.Key).ShouldBe(["overdue", "overdueTotal", "overdueOpenTotal", "dueToday"], ignoreOrder: true);
  }

  [Fact]
  public async Task GetDayAgenda_EchoesTheCanonicalZoneId() => (await GetAgendaAsync("2026-10-26", "utc")).TimeZone.ShouldBe("UTC");

  // ---- timed events ----

  [Fact]
  public async Task Events_OvernightSpan_AppearsOnBothDaysWithContinuationFlags()
  {
    // 23:00 on the 25th to 06:00 on the 26th, New York (EDT, -4).
    await SeedAsync([CalendarEvent.Create(Owner, "Night shift", Utc(2026, 10, 26, 3), Utc(2026, 10, 26, 10), NewYork)]);

    DayAgendaResponse before = await GetAgendaAsync("2026-10-25", NewYork);
    DayAgendaResponse today = await GetAgendaAsync("2026-10-26", NewYork);
    DayAgendaResponse after = await GetAgendaAsync("2026-10-27", NewYork);

    TimedEventItem first = before.Events.ShouldHaveSingleItem();
    first.StartsBeforeDay.ShouldBeFalse();
    first.EndsAfterDay.ShouldBeTrue();

    TimedEventItem second = today.Events.ShouldHaveSingleItem();
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
    await SeedAsync([CalendarEvent.Create(Owner, "Conference", Utc(2026, 10, 24, 12), Utc(2026, 10, 29, 12), NewYork)]);

    TimedEventItem item = (await GetAgendaAsync("2026-10-26", NewYork)).Events.ShouldHaveSingleItem();

    item.StartsBeforeDay.ShouldBeTrue();
    item.EndsAfterDay.ShouldBeTrue();
  }

  [Fact]
  public async Task Events_TouchingTheWindowEdges_AreExcluded()
  {
    // New York 2026-10-26 is [04:00Z, 2026-10-27T04:00Z).
    await SeedAsync(
    [
        CalendarEvent.Create(Owner, "ends at window start", Utc(2026, 10, 26, 3), Utc(2026, 10, 26, 4), NewYork),
            CalendarEvent.Create(Owner, "starts at window end", Utc(2026, 10, 27, 4), Utc(2026, 10, 27, 5), NewYork),
            CalendarEvent.Create(Owner, "ends a second into the day", Utc(2026, 10, 26, 3), Utc(2026, 10, 26, 4).AddSeconds(1), NewYork),
            CalendarEvent.Create(
              Owner,
              "starts a second before the end",
              Utc(2026, 10, 27, 4).AddSeconds(-1),
              Utc(2026, 10, 27, 5),
              NewYork),
        ]);

    IEnumerable<string> titles = (await GetAgendaAsync("2026-10-26", NewYork)).Events.Select(e => e.Title);

    titles.ShouldBe(["ends a second into the day", "starts a second before the end"]);
  }

  [Fact]
  public async Task Events_OnDstFallBackDay_UseTheTwentyFiveHourWindow()
  {
    // New York 2026-11-01: [04:00Z, 2026-11-02T05:00Z), 25 hours.
    await SeedAsync(
    [
        CalendarEvent.Create(Owner, "late on the 31st", Utc(2026, 11, 1, 3, 30), Utc(2026, 11, 1, 3, 59), NewYork),
            CalendarEvent.Create(Owner, "first minute", Utc(2026, 11, 1, 4), Utc(2026, 11, 1, 4, 1), NewYork),
            CalendarEvent.Create(Owner, "23:30 EST on the 1st", Utc(2026, 11, 2, 4, 30), Utc(2026, 11, 2, 4, 45), NewYork),
            CalendarEvent.Create(Owner, "00:00 EST on the 2nd", Utc(2026, 11, 2, 5), Utc(2026, 11, 2, 6), NewYork),
        ]);

    DayAgendaResponse nov1 = await GetAgendaAsync("2026-11-01", NewYork);

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
        CalendarEvent.Create(Owner, "beta", Utc(2026, 10, 26, 15), Utc(2026, 10, 26, 16), NewYork),
            CalendarEvent.Create(Owner, "Zulu", Utc(2026, 10, 26, 14), Utc(2026, 10, 26, 16), NewYork),
            CalendarEvent.Create(Owner, "alpha", Utc(2026, 10, 26, 15), Utc(2026, 10, 26, 15, 30), NewYork),
            CalendarEvent.Create(Owner, "early", Utc(2026, 10, 26, 5), Utc(2026, 10, 26, 6), NewYork),
        ]);

    (await GetAgendaAsync("2026-10-26", NewYork)).Events.Select(e => e.Title).ShouldBe(["early", "Zulu", "alpha", "beta"]);
  }

  // ---- all-day events ----

  [Fact]
  public async Task AllDayEvents_MultiDay_CoverStartThroughTheDayBeforeTheExclusiveEnd()
  {
    await SeedAsync([CalendarEvent.CreateAllDay(Owner, "Trip", new DateOnly(2026, 10, 24), new DateOnly(2026, 10, 27))]);

    (await GetAgendaAsync("2026-10-23", NewYork)).AllDayEvents.ShouldBeEmpty();
    (await GetAgendaAsync("2026-10-24", NewYork)).AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-25", NewYork)).AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-26", NewYork)).AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-27", NewYork)).AllDayEvents.ShouldBeEmpty(); // end is exclusive
  }

  [Fact]
  public async Task AllDayEvents_AreFloating_TheSameDateInEveryZone()
  {
    await SeedAsync([CalendarEvent.CreateAllDay(Owner, "Holiday", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 27))]);

    foreach (var zone in new[] { "Pacific/Kiritimati", "UTC", "Pacific/Pago_Pago" })
    {
      DayAgendaResponse agenda = await GetAgendaAsync("2026-10-26", zone);
      AllDayEventItem item = agenda.AllDayEvents.ShouldHaveSingleItem();
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
        CalendarEvent.CreateAllDay(Owner, "b", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 27)),
            CalendarEvent.CreateAllDay(Owner, "a", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 28)),
            CalendarEvent.CreateAllDay(Owner, "older", new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 30)),
            CalendarEvent.Create(Owner, "timed", Utc(2026, 10, 26, 14), Utc(2026, 10, 26, 15), NewYork),
        ]);

    DayAgendaResponse agenda = await GetAgendaAsync("2026-10-26", NewYork);

    agenda.AllDayEvents.Select(e => e.Title).ShouldBe(["older", "a", "b"]);
    agenda.Events.Select(e => e.Title).ShouldBe(["timed"]);
  }

  // ---- tasks ----

  [Fact]
  public async Task Tasks_DueToday_IncludesDateOnlyAndTimedInWindow_ButNotUndatedOrFuture()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create(Owner, "date today", new DateOnly(2026, 10, 26)),
            TodoTask.Create(Owner, "timed today", dueAt: Utc(2026, 10, 26, 18)),
            TodoTask.Create(Owner, "timed at window start", dueAt: Utc(2026, 10, 26, 4)),
            TodoTask.Create(Owner, "timed at window end", dueAt: Utc(2026, 10, 27, 4)),
            TodoTask.Create(Owner, "tomorrow", new DateOnly(2026, 10, 27)),
            TodoTask.Create(Owner, "undated"),
        ]);

    DayAgendaResponse agenda = await GetAgendaAsync("2026-10-26", NewYork);

    agenda.Tasks.DueToday.Select(t => t.Title).ShouldBe(["timed at window start", "timed today", "date today"]);
    agenda.Tasks.Overdue.ShouldBeEmpty();
  }

  [Fact]
  public async Task Tasks_Overdue_OpenOnesAndOnesCompletedTodayAreShown_ButNotCompletedEarlier()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create(Owner, "open, due last week", new DateOnly(2026, 10, 19)),
            TodoTask.Create(Owner, "open, timed yesterday", dueAt: Utc(2026, 10, 25, 20)),
            CompletedTask("done this morning", new DateOnly(2026, 10, 20), Utc(2026, 10, 26, 12)),
            CompletedTask("done at window start", new DateOnly(2026, 10, 20), Utc(2026, 10, 26, 4)),
            CompletedTask("done yesterday", new DateOnly(2026, 10, 20), Utc(2026, 10, 26, 3, 59)),
            CompletedTask("done at window end", new DateOnly(2026, 10, 20), Utc(2026, 10, 27, 4)),
            CompletedTask("timed, done today", null, Utc(2026, 10, 26, 6), dueAt: Utc(2026, 10, 24, 15)),
            TodoTask.Create(Owner, "timed just before window", dueAt: Utc(2026, 10, 26, 3, 59)),
        ]);

    IReadOnlyList<AgendaTaskItem> overdue = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.Overdue;

    overdue.Take(3).Select(t => t.Title).ShouldBe(["open, due last week", "open, timed yesterday", "timed just before window"]);
    overdue.Skip(3).ShouldAllBe(t => t.IsCompleted);
    overdue.Where(t => t.IsCompleted)
      .Select(t => t.Title)
      .ShouldBe(["done this morning", "done at window start", "timed, done today"], ignoreOrder: true);
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

    IReadOnlyList<AgendaTaskItem> dueToday = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.DueToday;

    dueToday.Select(t => t.Title).ShouldBe(["done timed", "done earlier", "done today"]);
    dueToday.ShouldAllBe(t => t.IsCompleted);
  }

  [Fact]
  public async Task Tasks_Overdue_AreOrderedOldestDueFirst_AcrossDateAndInstantDues()
  {
    // New York local dates: instants are converted to the viewer's zone before comparing with dates.
    await SeedAsync(tasks:
    [
        TodoTask.Create(Owner, "c: date 10-24", new DateOnly(2026, 10, 24)),
            TodoTask.Create(Owner, "a: date 10-20", new DateOnly(2026, 10, 20)),
            TodoTask.Create(Owner, "b2: date 10-22", new DateOnly(2026, 10, 22)),
            TodoTask.Create(Owner, "b1: timed 10-22 18:00 local", dueAt: Utc(2026, 10, 22, 22)),
            TodoTask.Create(Owner, "d: timed 10-23 23:30 local", dueAt: Utc(2026, 10, 24, 3, 30)),
            TodoTask.Create(Owner, "e: timed 10-25 00:30 local", dueAt: Utc(2026, 10, 25, 4, 30)),
        ]);

    IReadOnlyList<AgendaTaskItem> overdue = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.Overdue;

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
  public async Task Tasks_Overdue_OrdersTimedBeforeDateOnlyOnTheSameDay()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create(Owner, "zeta", new DateOnly(2026, 10, 20), priority: "low"),
            TodoTask.Create(Owner, "later high", new DateOnly(2026, 10, 21), priority: "high"),
            TodoTask.Create(Owner, "date medium", new DateOnly(2026, 10, 20), priority: "medium"),
            TodoTask.Create(Owner, "date high", new DateOnly(2026, 10, 20), priority: "high"),
            TodoTask.Create(Owner, "timed medium", dueAt: Utc(2026, 10, 20, 12), priority: "medium"),
            TodoTask.Create(Owner, "timed low", dueAt: Utc(2026, 10, 20, 12), priority: "low"),
            TodoTask.Create(Owner, "timed high", dueAt: Utc(2026, 10, 20, 12), priority: "high"),
        ]);

    IReadOnlyList<AgendaTaskItem> overdue = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.Overdue;

    overdue.Take(3).ShouldAllBe(t => t.DueAt != null);
    overdue.Skip(3).Take(3).ShouldAllBe(t => t.DueDate == new DateOnly(2026, 10, 20));
    overdue[^1].Title.ShouldBe("later high");
  }

  [Fact]
  public async Task Tasks_DueToday_DeadlinePrecedesPriorityAndPriorityPrecedesTitle()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create(Owner, "date zeta", new DateOnly(2026, 10, 26), priority: "low"),
            TodoTask.Create(Owner, "date medium", new DateOnly(2026, 10, 26), priority: "medium"),
            TodoTask.Create(Owner, "date high", new DateOnly(2026, 10, 26), priority: "high"),
            TodoTask.Create(Owner, "late high", dueAt: Utc(2026, 10, 26, 21), priority: "high"),
            TodoTask.Create(Owner, "early low", dueAt: Utc(2026, 10, 26, 9), priority: "low"),
            TodoTask.Create(Owner, "early medium", dueAt: Utc(2026, 10, 26, 9), priority: "medium"),
            TodoTask.Create(Owner, "early high z", dueAt: Utc(2026, 10, 26, 9), priority: "high"),
            TodoTask.Create(Owner, "early high a", dueAt: Utc(2026, 10, 26, 9), priority: "high"),
        ]);

    IReadOnlyList<AgendaTaskItem> dueToday = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.DueToday;

    dueToday.Select(t => t.Title).ShouldBe(
        ["early high a", "early high z", "early medium", "early low", "late high", "date high", "date medium", "date zeta"]);
  }

  [Fact]
  public async Task Tasks_DateOnlyDues_AreFloating_TheSameDateInEveryZone()
  {
    await SeedAsync(tasks: [TodoTask.Create(Owner, "floating", new DateOnly(2026, 10, 26))]);

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
    await SeedAsync(tasks: [TodoTask.Create(Owner, "late night", dueAt: Utc(2026, 10, 27, 2))]);

    (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.DueToday.ShouldHaveSingleItem();
    (await GetAgendaAsync("2026-10-26", "UTC")).Tasks.DueToday.ShouldBeEmpty();
    (await GetAgendaAsync("2026-10-27", "UTC")).Tasks.DueToday.ShouldHaveSingleItem();
  }

  [Fact]
  public async Task Tasks_CompletingAnOverdueTaskThroughTheApi_KeepsItVisibleAsDone()
  {
    // The flow the Today view relies on: tick an overdue task and it must not vanish.
    var task = TodoTask.Create(Owner, "late", new DateOnly(2026, 10, 20));
    await SeedAsync(tasks: [task]);
    Clock.SetUtcNow(Utc(2026, 10, 26, 15));

    using HttpResponseMessage completed = await Client.PostAsync(
      new Uri($"/api/tasks/{task.Id}/complete", UriKind.Relative),
      content: null,
      Ct);
    completed.EnsureSuccessStatusCode();

    AgendaTaskItem overdue = (await GetAgendaAsync("2026-10-26", NewYork)).Tasks.Overdue.ShouldHaveSingleItem();
    overdue.IsCompleted.ShouldBeTrue();
    (await GetAgendaAsync("2026-10-27", NewYork)).Tasks.Overdue.ShouldBeEmpty();
  }

  [Fact]
  public async Task Overdue_IsCappedAndMatchesTaskListOrderInDayAndWeek()
  {
    var tasks = Enumerable.Range(0, 25).Select(i => TodoTask.Create(Owner, $"open {i}", new DateOnly(2026, 10, 1).AddDays(i % 5))).ToList();
    tasks.Add(CompletedTask("done today", new DateOnly(2026, 10, 1), Utc(2026, 10, 26, 12)));
    await SeedAsync(tasks: tasks);
    DayAgendaResponse day = await GetAgendaAsync("2026-10-26", NewYork);
    WeekAgendaResponse week = await GetWeekAgendaAsync("2026-10-26", NewYork, "2026-10-26");
    TaskPage? page = await Client.GetFromJsonAsync<Calendar.Api.Contracts.TaskPage>(
      new Uri("/api/tasks?view=overdue&today=2026-10-26&timeZone=America/New_York&limit=20", UriKind.Relative),
      Ct);
    day.Tasks.Overdue.Count.ShouldBe(20);
    day.Tasks.OverdueTotal.ShouldBe(26);
    day.Tasks.OverdueOpenTotal.ShouldBe(25);
    day.Tasks.Overdue.Select(t => t.Id).ShouldBe(page!.Items.Select(t => t.Id));
    week.Overdue!.Select(t => t.Id).ShouldBe(day.Tasks.Overdue.Select(t => t.Id));
    week.OverdueTotal.ShouldBe(26);
    week.OverdueOpenTotal.ShouldBe(25);
  }

  [Fact]
  public async Task Overdue_CompletedTodayFollowsOpenTasksEvenWhenDueEarlier()
  {
    await SeedAsync(tasks:
    [
      TodoTask.Create(Owner, "open", new DateOnly(2026, 10, 20)),
      CompletedTask("completed", new DateOnly(2026, 10, 1), Utc(2026, 10, 26, 12)),
    ]);
    DayAgendaResponse day = await GetAgendaAsync("2026-10-26", NewYork);
    WeekAgendaResponse week = await GetWeekAgendaAsync("2026-10-26", NewYork, "2026-10-26");
    day.Tasks.Overdue.Select(t => t.Title).ShouldBe(["open", "completed"]);
    day.Tasks.OverdueTotal.ShouldBe(2);
    day.Tasks.OverdueOpenTotal.ShouldBe(1);
    week.Overdue.ShouldNotBeNull().Select(t => t.Title).ShouldBe(["open", "completed"]);
  }

  [Fact]
  public async Task Agenda_ReportsNotesWithoutIncludingTheirText()
  {
    await SeedAsync(
    [
      CalendarEvent.Create(Owner, "timed", Utc(2026, 10, 26, 14), Utc(2026, 10, 26, 15), NewYork, notes: "secret event"),
      CalendarEvent.CreateAllDay(Owner, "all day", new DateOnly(2026, 10, 26), new DateOnly(2026, 10, 27)),
    ],
    [
      TodoTask.Create(Owner, "with notes", new DateOnly(2026, 10, 26), notes: "secret task"),
      TodoTask.Create(Owner, "without", new DateOnly(2026, 10, 26)),
    ]);
    DayAgendaResponse day = await GetAgendaAsync("2026-10-26", NewYork);
    day.Events.Single().HasNotes.ShouldBeTrue();
    day.AllDayEvents.Single().HasNotes.ShouldBeFalse();
    day.Tasks.DueToday.Single(t => t.Title == "with notes").HasNotes.ShouldBeTrue();
    day.Tasks.DueToday.Single(t => t.Title == "without").HasNotes.ShouldBeFalse();
    var json = await Client.GetStringAsync(new Uri("/api/agenda/day?date=2026-10-26&timeZone=America/New_York", UriKind.Relative), Ct);
    json.ShouldNotContain("\"notes\"");
    json.ShouldNotContain("secret");
    var weekJson = await Client.GetStringAsync(
      new Uri("/api/agenda/week?date=2026-10-26&timeZone=America/New_York&today=2026-10-26", UriKind.Relative),
      Ct);
    weekJson.ShouldNotContain("\"notes\"");
    weekJson.ShouldNotContain("secret");
  }

  // ---- skipped / odd days ----

  [Fact]
  public async Task Events_OnADateSkippedByAClockChange_AreNeverShown()
  {
    // Pacific/Apia skipped 2011-12-30 entirely: the window is empty.
    await SeedAsync(
    [
        CalendarEvent.Create(Owner, "spans the jump", Utc(2011, 12, 29, 12), Utc(2011, 12, 31, 12), "Pacific/Apia"),
            CalendarEvent.CreateAllDay(Owner, "floating", new DateOnly(2011, 12, 30), new DateOnly(2011, 12, 31)),
        ]);

    DayAgendaResponse agenda = await GetAgendaAsync("2011-12-30", "Pacific/Apia");

    agenda.Window.Start.ShouldBe(agenda.Window.End);
    agenda.Events.ShouldBeEmpty();
    agenda.AllDayEvents.ShouldHaveSingleItem();
    (await GetAgendaAsync("2011-12-29", "Pacific/Apia")).Events.ShouldHaveSingleItem();
    (await GetAgendaAsync("2011-12-31", "Pacific/Apia")).Events.ShouldHaveSingleItem();
  }

  [Fact]
  public async Task Window_OnAGapStartingAtMidnight_StartsAtTheTransition()
  {
    DayAgendaResponse agenda = await GetAgendaAsync("2024-10-06", "America/Asuncion");

    agenda.Window.Start.ShouldBe(Utc(2024, 10, 6, 4));
  }
}
