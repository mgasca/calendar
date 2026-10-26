using Calendar.Api.Contracts;
using Calendar.Domain.Time;
using Calendar.Infrastructure;
using Calendar.Infrastructure.Queries;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi;

namespace Calendar.Api.Endpoints;

internal static class AgendaEndpoints
{
    public static IEndpointRouteBuilder MapAgendaEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/api/agenda").WithTags("Agenda")
            .MapGet("/day", GetDayAsync)
            .WithName("GetDayAgenda")
            .AddOpenApiOperationTransformer((operation, _, _) =>
            {
                // Missing values are reported as a validation problem; the contract still says they are required.
                foreach (var parameter in operation.Parameters ?? [])
                {
                    if (parameter is OpenApiParameter { Name: "date" or "timeZone" } concrete)
                    {
                        concrete.Required = true;
                    }
                }

                return Task.CompletedTask;
            })
            .WithSummary("Everything for one local day: all-day events, timed events, and due-today and overdue tasks.");

        return app;
    }

    private static async Task<Results<Ok<DayAgendaResponse>, ValidationProblem>> GetDayAsync(
        DateOnly? date,
        string? timeZone,
        CalendarDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = new FieldErrors();
        TimeZoneInfo? zone = null;
        if (date is null)
        {
            errors.Add("date", "date is required (YYYY-MM-DD).");
        }
        else
        {
            errors.CheckDate(date, "date");
        }

        if (string.IsNullOrWhiteSpace(timeZone))
        {
            errors.Add("timeZone", "timeZone is required (IANA id, e.g. America/New_York).");
        }
        else if (TimeZones.TryFindIana(timeZone, out var found))
        {
            zone = found;
        }
        else
        {
            errors.Add("timeZone", $"'{timeZone}' is not a valid IANA time zone id.");
        }

        if (errors.Any || date is null || zone is null)
        {
            return TypedResults.ValidationProblem(errors.ToDictionary());
        }

        var window = DayWindow.Create(date.Value, zone);

        var allDay = await db.Events.AsNoTracking()
            .AllDayOn(window)
            .Select(e => new AllDayEventItem
            {
                Id = e.Id,
                Title = e.Title,
                Location = e.Location,
                Notes = e.Notes,
                StartDate = e.StartDate!.Value,
                EndDate = e.EndDate!.Value,
            })
            .ToListAsync(cancellationToken);

        var timed = await db.Events.AsNoTracking()
            .TimedOn(window)
            .Select(e => new TimedEventItem
            {
                Id = e.Id,
                Title = e.Title,
                Location = e.Location,
                Notes = e.Notes,
                Start = e.Start!.Value,
                End = e.End!.Value,
                TimeZone = e.TimeZoneId!,
                StartsBeforeDay = e.Start < window.Start,
                EndsAfterDay = e.End > window.End,
            })
            .ToListAsync(cancellationToken);

        var dueToday = await db.Tasks.AsNoTracking().DueOn(window).Select(TaskResponse.Projection).ToListAsync(cancellationToken);
        var overdue = await db.Tasks.AsNoTracking().OverdueFor(window).Select(TaskResponse.Projection).ToListAsync(cancellationToken);

        // Ordering happens here, ordinally and case-insensitively, so it does not depend on the database collation.
        return TypedResults.Ok(new DayAgendaResponse
        {
            Date = window.Date,
            TimeZone = zone.Id,
            Window = new AgendaWindow { Start = window.Start, End = window.End },
            AllDayEvents = [.. allDay.OrderBy(e => e.StartDate).ThenBy(e => e.Title, Title).ThenBy(e => e.Id)],
            Events = [.. timed.OrderBy(e => e.Start).ThenBy(e => e.Title, Title).ThenBy(e => e.Id)],
            Tasks = new AgendaTasks
            {
                Overdue = [.. overdue
                    .OrderBy(t => t.DueDate ?? LocalDate(t.DueAt!.Value, zone))
                    .ThenBy(t => t.DueAt is null)
                    .ThenBy(t => t.DueAt)
                    .ThenBy(t => t.Title, Title)
                    .ThenBy(t => t.Id)],
                DueToday = [.. dueToday
                    .OrderBy(t => t.DueAt is null)
                    .ThenBy(t => t.DueAt)
                    .ThenBy(t => t.Title, Title)
                    .ThenBy(t => t.Id)],
            },
        });
    }

    private static readonly StringComparer Title = StringComparer.OrdinalIgnoreCase;

    private static DateOnly LocalDate(DateTimeOffset instant, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
}
