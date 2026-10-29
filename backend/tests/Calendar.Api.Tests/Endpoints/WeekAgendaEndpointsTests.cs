using System.Globalization;
using System.Net;
using System.Text.Json.Nodes;
using Calendar.Domain.Events;
using Calendar.Domain.Tasks;

namespace Calendar.Api.Tests.Endpoints;

public sealed class WeekAgendaEndpointsTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private const string NewYork = "America/New_York";

  // The week of Monday 2026-10-26 in New York ends with the fall-back day, Sunday 2026-11-01 (25 hours).
  private const string Monday = "2026-10-26";
  private const string Wednesday = "2026-10-28";

  private static DateOnly D(string date) => DateOnly.Parse(date, CultureInfo.InvariantCulture);

  // ---- request validation ----

  [Theory]
  [InlineData("timeZone=UTC&today=2026-10-28", "date")]
  [InlineData("date=2026-10-28&today=2026-10-28", "timeZone")]
  [InlineData("date=2026-10-28&timeZone=UTC", "today")]
  [InlineData("date=2026-10-28&timeZone=&today=2026-10-28", "timeZone")]
  [InlineData("date=2026-10-28&timeZone=Nowhere/Land&today=2026-10-28", "timeZone")]
  [InlineData("date=2026-10-28&timeZone=Eastern%20Standard%20Time&today=2026-10-28", "timeZone")]
  [InlineData("date=1899-12-31&timeZone=UTC&today=2026-10-28", "date")]
  [InlineData("date=2201-01-01&timeZone=UTC&today=2026-10-28", "date")]
  [InlineData("date=2026-10-28&timeZone=UTC&today=1899-12-31", "today")]
  [InlineData("date=2026-10-28&timeZone=UTC&today=9999-12-31", "today")]
  public async Task GetWeekAgenda_InvalidInput_Returns400ValidationProblem(string query, string field)
  {
    using var response = await Client.GetAsync(new Uri($"/api/agenda/week?{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    var errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.ContainsKey(field).ShouldBeTrue(errors.ToJsonString());
  }

  [Fact]
  public async Task GetWeekAgenda_NoParameters_ReportsEveryMissingOne()
  {
    using var response = await Client.GetAsync(new Uri("/api/agenda/week", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    var errors = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!["errors"]!.AsObject();
    errors.Select(e => e.Key).ShouldBe(["date", "timeZone", "today"], ignoreOrder: true);
  }

  [Theory]
  [InlineData("date=not-a-date&timeZone=UTC&today=2026-10-28")]
  [InlineData("date=2026-10-28&timeZone=UTC&today=2026-13-45")]
  public async Task GetWeekAgenda_UnparsableDate_Returns400(string query)
  {
    using var response = await Client.GetAsync(new Uri($"/api/agenda/week?{query}", UriKind.Relative), Ct);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
  }

  [Theory]
  [InlineData("1900-01-01", "1900-01-01")]
  [InlineData("2200-12-31", "2200-12-29")]
  public async Task GetWeekAgenda_AtTheSupportedDateLimits_Works(string date, string weekStart) =>
      (await GetWeekAgendaAsync(date, "Pacific/Kiritimati", date)).WeekStart.ShouldBe(D(weekStart));

  // ---- shape ----

  [Fact]
  public async Task GetWeekAgenda_Empty_ReturnsSevenDaysFromMonday_WithDstCorrectWindows()
  {
    var week = await GetWeekAgendaAsync(Wednesday, NewYork, Wednesday);

    week.WeekStart.ShouldBe(D(Monday));
    week.TimeZone.ShouldBe(NewYork);
    week.Window.Start.ShouldBe(Utc(2026, 10, 26, 4));
    week.Window.End.ShouldBe(Utc(2026, 11, 2, 5));
    week.Days.Select(d => d.Date).ShouldBe(Enumerable.Range(0, 7).Select(i => D(Monday).AddDays(i)));
    week.Days[0].Date.DayOfWeek.ShouldBe(DayOfWeek.Monday);
    week.Days[0].Window.Start.ShouldBe(week.Window.Start);
    week.Days[6].Window.End.ShouldBe(week.Window.End);
    (week.Days[6].Window.End - week.Days[6].Window.Start).ShouldBe(TimeSpan.FromHours(25));
    for (var i = 1; i < 7; i++)
    {
      week.Days[i].Window.Start.ShouldBe(week.Days[i - 1].Window.End);
    }

    week.AllDayEvents.ShouldBeEmpty();
    week.Days.ShouldAllBe(d => d.Events.Count == 0 && d.Tasks.Count == 0);
    week.Overdue.ShouldNotBeNull().ShouldBeEmpty();
  }

  [Fact]
  public async Task GetWeekAgenda_UsesCamelCasePropertyNames_AndAlwaysWritesOverdue()
  {
    await SeedAsync(
        [CalendarEvent.Create("E", Utc(2026, 10, 27, 14), Utc(2026, 10, 27, 15), NewYork), CalendarEvent.CreateAllDay("A", D(Monday), D("2026-10-27"))],
        [TodoTask.Create("T", D(Wednesday))]);

    var json = await Client.GetStringAsync(new Uri($"/api/agenda/week?date={Wednesday}&timeZone={NewYork}&today={Wednesday}", UriKind.Relative), Ct);
    var past = await Client.GetStringAsync(new Uri($"/api/agenda/week?date=2026-10-19&timeZone={NewYork}&today={Wednesday}", UriKind.Relative), Ct);

    var root = JsonNode.Parse(json)!.AsObject();
    root.Select(p => p.Key).ShouldBe(["weekStart", "timeZone", "window", "allDayEvents", "days", "overdue", "overdueTotal", "overdueOpenTotal"], ignoreOrder: true);
    root["weekStart"]!.GetValue<string>().ShouldBe(Monday);
    root["days"]!.AsArray().Count.ShouldBe(7);
    root["days"]![0]!.AsObject().Select(p => p.Key).ShouldBe(["date", "window", "events", "tasks"], ignoreOrder: true);
    root["days"]![1]!["events"]![0]!.AsObject().ContainsKey("endsAfterDay").ShouldBeTrue();
    root["days"]![2]!["tasks"]![0]!["title"]!.GetValue<string>().ShouldBe("T");
    root["allDayEvents"]![0]!["startDate"]!.GetValue<string>().ShouldBe(Monday);
    var pastRoot = JsonNode.Parse(past)!.AsObject();
    pastRoot.ContainsKey("overdue").ShouldBeTrue();
    pastRoot["overdue"].ShouldBeNull();
  }

  [Theory]
  [InlineData("2026-10-26")]
  [InlineData("2026-10-27")]
  [InlineData("2026-10-28")]
  [InlineData("2026-10-29")]
  [InlineData("2026-10-30")]
  [InlineData("2026-10-31")]
  [InlineData("2026-11-01")]
  public async Task GetWeekAgenda_AnyDateOfTheWeek_SnapsToItsMonday(string date)
  {
    var week = await GetWeekAgendaAsync(date, NewYork, Wednesday);

    week.WeekStart.ShouldBe(D(Monday));
    week.Days[0].Date.ShouldBe(D(Monday));
  }

  [Fact]
  public async Task GetWeekAgenda_AcrossAYearBoundary_StartsInDecember()
  {
    var week = await GetWeekAgendaAsync("2026-01-01", "UTC", "2026-01-01");

    week.WeekStart.ShouldBe(D("2025-12-29"));
    week.Days[^1].Date.ShouldBe(D("2026-01-04"));
  }

  [Fact]
  public async Task GetWeekAgenda_EchoesTheCanonicalZoneId() => (await GetWeekAgendaAsync(Wednesday, "US/Eastern", Wednesday)).TimeZone.ShouldBe(NewYork);

  // ---- events ----

  [Fact]
  public async Task Events_ArePlacedOnEachDayTheyTouch_WithDayRelativeFlags_AndOrderedByStartThenTitle()
  {
    await SeedAsync(
    [
        CalendarEvent.Create("overnight Tue-Wed", Utc(2026, 10, 28, 2), Utc(2026, 10, 28, 10), NewYork), // 22:00 Tue - 06:00 Wed
        CalendarEvent.Create("beta", Utc(2026, 10, 28, 15), Utc(2026, 10, 28, 16), NewYork),
        CalendarEvent.Create("Alpha", Utc(2026, 10, 28, 15), Utc(2026, 10, 28, 15, 30), NewYork),
        CalendarEvent.Create("from last week", Utc(2026, 10, 25, 12), Utc(2026, 10, 26, 12), NewYork),
        CalendarEvent.Create("into next week", Utc(2026, 11, 2, 4), Utc(2026, 11, 2, 6), NewYork), // 23:00 EST Sun
        CalendarEvent.Create("next week", Utc(2026, 11, 2, 5), Utc(2026, 11, 2, 6), NewYork),
        CalendarEvent.Create("last week", Utc(2026, 10, 25, 12), Utc(2026, 10, 26, 4), NewYork),
    ]);

    var week = await GetWeekAgendaAsync(Wednesday, NewYork, Wednesday);

    var monday = week.Days[0].Events.ShouldHaveSingleItem();
    monday.Title.ShouldBe("from last week");
    monday.StartsBeforeDay.ShouldBeTrue();
    monday.EndsAfterDay.ShouldBeFalse();

    var tuesday = week.Days[1].Events.ShouldHaveSingleItem();
    tuesday.Title.ShouldBe("overnight Tue-Wed");
    (tuesday.StartsBeforeDay, tuesday.EndsAfterDay).ShouldBe((false, true));

    week.Days[2].Events.Select(e => e.Title).ShouldBe(["overnight Tue-Wed", "Alpha", "beta"]);
    (week.Days[2].Events[0].StartsBeforeDay, week.Days[2].Events[0].EndsAfterDay).ShouldBe((true, false));
    week.Days[2].Events.Skip(1).ShouldAllBe(e => !e.StartsBeforeDay && !e.EndsAfterDay);

    week.Days[3].Events.ShouldBeEmpty();
    week.Days[6].Events.Select(e => e.Title).ShouldBe(["into next week"]);
    week.Days.SelectMany(d => d.Events).ShouldNotContain(e => e.Title == "next week" || e.Title == "last week");
  }

  [Fact]
  public async Task AllDayEvents_AreReturnedOncePerWeek_OrderedByStartDateThenTitleThenId()
  {
    var twinA = CalendarEvent.CreateAllDay("Twin", D("2026-10-27"), D("2026-10-28"));
    var twinB = CalendarEvent.CreateAllDay("twin", D("2026-10-27"), D("2026-10-28"));
    await SeedAsync(
    [
        CalendarEvent.CreateAllDay("conference", D("2026-10-27"), D("2026-10-30")),
        twinA,
        twinB,
        CalendarEvent.CreateAllDay("trip from last week", D("2026-10-24"), D("2026-10-27")),
        CalendarEvent.CreateAllDay("into next week", D("2026-11-01"), D("2026-11-04")),
        CalendarEvent.CreateAllDay("ended last week", D("2026-10-20"), D(Monday)),
        CalendarEvent.CreateAllDay("next week", D("2026-11-02"), D("2026-11-03")),
        CalendarEvent.Create("timed", Utc(2026, 10, 27, 14), Utc(2026, 10, 27, 15), NewYork),
    ]);

    var week = await GetWeekAgendaAsync(Wednesday, NewYork, Wednesday);

    var twins = new[] { twinA, twinB }.OrderBy(e => e.Id).Select(e => e.Id);
    string[] expected = ["trip from last week", "conference", "Twin", "twin", "into next week"];
    week.AllDayEvents.Select(e => e.Title).ShouldBe(expected, ignoreOrder: true);
    week.AllDayEvents.Select(e => e.Title).Take(2).ShouldBe(["trip from last week", "conference"]);
    week.AllDayEvents.Skip(2).Take(2).Select(e => e.Id).ShouldBe(twins);
    week.AllDayEvents[^1].Title.ShouldBe("into next week");
    week.AllDayEvents[0].StartDate.ShouldBe(D("2026-10-24"));
    week.Days[1].Events.Select(e => e.Title).ShouldBe(["timed"]);
  }

  // ---- tasks per day ----

  [Fact]
  public async Task Tasks_AreListedOnTheirDueDay_TimedFirstByInstant_ThenDateOnlyByTitle_IncludingCompleted()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("zeta", D(Wednesday)),
        TodoTask.Create("late", dueAt: Utc(2026, 10, 28, 21)),
        CompletedTask("Alpha", D(Wednesday), Utc(2026, 10, 27, 9)),
        TodoTask.Create("early", dueAt: Utc(2026, 10, 28, 9)),
        TodoTask.Create("late Sunday EST", dueAt: Utc(2026, 11, 2, 4, 30)), // 23:30 Sunday after the fall back
        TodoTask.Create("first instant", dueAt: Utc(2026, 10, 26, 4)),
        TodoTask.Create("next Monday", D("2026-11-02")),
        TodoTask.Create("undated"),
    ]);

    var week = await GetWeekAgendaAsync(Wednesday, NewYork, Wednesday);

    week.Days[0].Tasks.Select(t => t.Title).ShouldBe(["first instant"]);
    week.Days[2].Tasks.Select(t => t.Title).ShouldBe(["early", "late", "Alpha", "zeta"]);
    week.Days[2].Tasks.Single(t => t.Title == "Alpha").IsCompleted.ShouldBeTrue();
    week.Days[6].Tasks.Select(t => t.Title).ShouldBe(["late Sunday EST"]);
    week.Days.Sum(d => d.Tasks.Count).ShouldBe(6);
  }

  [Fact]
  public async Task Tasks_InAPastWeek_ShowOpenAndCompleted_AndThereIsNoOverdueList()
  {
    await SeedAsync(tasks:
    [
        CompletedTask("done on time", D("2026-10-14"), Utc(2026, 10, 14, 15)),
        TodoTask.Create("never done", D("2026-10-14")),
        CompletedTask("done late", D("2026-10-12"), Utc(2026, 10, 28, 15)),
        TodoTask.Create("older", D("2026-10-01")),
    ]);

    var week = await GetWeekAgendaAsync("2026-10-14", NewYork, Wednesday);

    week.WeekStart.ShouldBe(D("2026-10-12"));
    week.Days[2].Tasks.Select(t => (t.Title, t.IsCompleted)).ShouldBe([("done on time", true), ("never done", false)]);
    week.Days[0].Tasks.Select(t => (t.Title, t.IsCompleted)).ShouldBe([("done late", true)]);
    week.Overdue.ShouldBeNull();
  }

  // ---- overdue ----

  [Theory]
  [InlineData("2026-10-19", "2026-10-26", true)] // the week ended yesterday
  [InlineData("2026-10-19", "2026-10-25", false)] // today is its Sunday
  [InlineData("2026-10-19", "2026-10-19", false)] // today is its Monday
  [InlineData("2026-10-26", "2026-10-19", false)] // a future week
  public async Task Overdue_IsNullOnlyWhenTheWholeWeekIsBeforeToday(string date, string today, bool isNull)
  {
    var week = await GetWeekAgendaAsync(date, NewYork, today);

    (week.Overdue is null).ShouldBe(isNull);
  }

  [Fact]
  public async Task Overdue_InTheCurrentWeek_HasOnlyTasksDueBeforeMonday_AndNeverRepeatsADayTask()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("last week, open", D("2026-10-20")),
        TodoTask.Create("timed Sunday night, open", dueAt: Utc(2026, 10, 26, 3, 59)),
        CompletedTask("last week, done today", D("2026-10-19"), Utc(2026, 10, 28, 15)),
        CompletedTask("last week, done yesterday", D("2026-10-19"), Utc(2026, 10, 27, 15)),
        TodoTask.Create("Monday, open", D(Monday)),
        TodoTask.Create("Monday first instant, open", dueAt: Utc(2026, 10, 26, 4)),
        TodoTask.Create("Tuesday, open", D("2026-10-27")),
        TodoTask.Create("today, open", D(Wednesday)),
    ]);

    var week = await GetWeekAgendaAsync(Wednesday, NewYork, Wednesday);

    var overdue = week.Overdue.ShouldNotBeNull();
    overdue.Select(t => t.Title).ShouldBe(["last week, open", "timed Sunday night, open", "last week, done today"]);
    overdue.Single(t => t.Title == "last week, done today").IsCompleted.ShouldBeTrue();
    var inDays = week.Days.SelectMany(d => d.Tasks).Select(t => t.Id).ToList();
    overdue.Select(t => t.Id).Intersect(inDays).ShouldBeEmpty();
    week.Days[0].Tasks.Select(t => t.Title).ShouldBe(["Monday first instant, open", "Monday, open"]);
    week.Days[1].Tasks.Select(t => t.Title).ShouldBe(["Tuesday, open"]);
  }

  [Fact]
  public async Task Tasks_InWeekDaysAndOverdue_UsePriorityAfterDeadline()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("old high", D("2026-10-24"), priority: "high"),
            TodoTask.Create("older low", D("2026-10-23"), priority: "low"),
            TodoTask.Create("due date low", D(Monday), priority: "low"),
            TodoTask.Create("due date high", D(Monday), priority: "high"),
            TodoTask.Create("same instant medium", dueAt: Utc(2026, 10, 26, 12), priority: "medium"),
            TodoTask.Create("same instant high z", dueAt: Utc(2026, 10, 26, 12), priority: "high"),
            TodoTask.Create("same instant high a", dueAt: Utc(2026, 10, 26, 12), priority: "high"),
        ]);

    var week = await GetWeekAgendaAsync(Wednesday, NewYork, Wednesday);

    week.Overdue.ShouldNotBeNull().Select(t => t.Title).ShouldBe(["older low", "old high"]);
    week.Days[0].Tasks.Select(t => t.Title).ShouldBe(
        ["same instant high a", "same instant high z", "same instant medium", "due date high", "due date low"]);
  }

  [Fact]
  public async Task Overdue_InAFutureWeek_IsTheFullOverdueListAsOfToday()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("last week, open", D("2026-10-20")),
        TodoTask.Create("this Monday, open", D(Monday)),
        TodoTask.Create("timed yesterday, open", dueAt: Utc(2026, 10, 27, 20)),
        CompletedTask("this Monday, done today", D(Monday), Utc(2026, 10, 28, 15)),
        CompletedTask("this Monday, done yesterday", D(Monday), Utc(2026, 10, 27, 15)),
        TodoTask.Create("today, open", D(Wednesday)),
        TodoTask.Create("timed later today, open", dueAt: Utc(2026, 10, 28, 20)),
        TodoTask.Create("Friday, not yet due", D("2026-10-30")),
        TodoTask.Create("in the week", D("2026-11-03")),
    ]);

    var week = await GetWeekAgendaAsync("2026-11-04", NewYork, Wednesday);

    week.WeekStart.ShouldBe(D("2026-11-02"));
    week.Overdue.ShouldNotBeNull().Select(t => t.Title).ShouldBe(
    [
        "last week, open",
        "this Monday, open",
        "timed yesterday, open",
        "this Monday, done today",
    ]);
    week.Days[1].Tasks.Select(t => t.Title).ShouldBe(["in the week"]);
  }

  [Fact]
  public async Task Overdue_InTheCurrentWeek_WhenTodayIsMonday_MatchesTheDayAgenda()
  {
    await SeedAsync(tasks:
    [
        TodoTask.Create("b", D("2026-10-20")),
        TodoTask.Create("a", dueAt: Utc(2026, 10, 22, 22)),
        CompletedTask("done today", D("2026-10-21"), Utc(2026, 10, 26, 15)),
        CompletedTask("done before", D("2026-10-21"), Utc(2026, 10, 25, 15)),
    ]);

    var week = await GetWeekAgendaAsync(Wednesday, NewYork, Monday);
    var day = await GetAgendaAsync(Monday, NewYork);

    week.Overdue.ShouldNotBeNull().ShouldBe(day.Tasks.Overdue);
    week.Overdue.Count.ShouldBe(3);
  }
}
