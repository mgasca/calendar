using Calendar.Api.Contracts;
using Calendar.Domain.Time;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Calendar.Api.Endpoints;

internal static class AgendaEndpoints
{
  public static IEndpointRouteBuilder MapAgendaEndpoints(this IEndpointRouteBuilder app)
  {
    var agenda = app.MapGroup("/api/agenda").WithTags("Agenda");

    agenda.MapGet("/day", GetDayAsync)
        .WithName("GetDayAgenda")
        .RequireQueryParameters("date", "timeZone")
        .WithSummary("Everything for one local day: all-day events, timed events, and due-today and overdue tasks.");

    agenda.MapGet("/week", GetWeekAsync)
        .WithName("GetWeekAgenda")
        .RequireQueryParameters("date", "timeZone", "today")
        .WithSummary(
            "The ISO week (Monday to Sunday) containing a local date: all-day events once per week, timed events and "
            + "due tasks per day, and the tasks overdue as of today that were due before the week.");

    return app;
  }

  private static async Task<Results<Ok<DayAgendaResponse>, ValidationProblem>> GetDayAsync(
      DateOnly? date,
      string? timeZone,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    var errors = new FieldErrors();
    var day = errors.RequireDate(date, "date");
    var zone = errors.RequireTimeZone(timeZone, "timeZone");
    if (errors.Any || day is null || zone is null)
    {
      return TypedResults.ValidationProblem(errors.ToDictionary());
    }

    // A one-day range whose overdue list is judged against the day itself.
    var range = DateRangeWindow.Create(day.Value, 1, zone);
    var snapshot = await AgendaBuilder.ReadAsync(db, range, range.Days[0], cancellationToken);
    var only = snapshot.Days[0];

    return TypedResults.Ok(new DayAgendaResponse
    {
      Date = only.Window.Date,
      TimeZone = zone.Id,
      Window = Window(only.Window.Start, only.Window.End),
      AllDayEvents = snapshot.AllDayEvents,
      Events = only.Events,
      Tasks = new AgendaTasks
      {
        Overdue = snapshot.Overdue ?? [],
        DueToday = only.Tasks,
      },
    });
  }

  private static async Task<Results<Ok<WeekAgendaResponse>, ValidationProblem>> GetWeekAsync(
      DateOnly? date,
      string? timeZone,
      DateOnly? today,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    var errors = new FieldErrors();
    var anyDate = errors.RequireDate(date, "date");
    var zone = errors.RequireTimeZone(timeZone, "timeZone");
    var todayDate = errors.RequireDate(today, "today");
    if (errors.Any || anyDate is null || zone is null || todayDate is null)
    {
      return TypedResults.ValidationProblem(errors.ToDictionary());
    }

    var week = DateRangeWindow.IsoWeek(anyDate.Value, zone);

    // The server never decides what day it is (ADR-0021): overdue is judged against the client's today, and a
    // week that is wholly in the past has no overdue list (ADR-0024).
    DayWindow? overdueAsOf = todayDate.Value < week.EndDate ? DayWindow.Create(todayDate.Value, zone) : null;
    var snapshot = await AgendaBuilder.ReadAsync(db, week, overdueAsOf, cancellationToken);

    return TypedResults.Ok(new WeekAgendaResponse
    {
      WeekStart = week.StartDate,
      TimeZone = zone.Id,
      Window = Window(week.Start, week.End),
      AllDayEvents = snapshot.AllDayEvents,
      Days = [.. snapshot.Days.Select(d => new AgendaDay
      {
        Date = d.Window.Date,
        Window = Window(d.Window.Start, d.Window.End),
        Events = d.Events,
        Tasks = d.Tasks,
      })],
      Overdue = snapshot.Overdue,
    });
  }

  private static AgendaWindow Window(DateTimeOffset start, DateTimeOffset end) => new() { Start = start, End = end };
}
