using Calendar.Api.Contracts;
using Calendar.Domain.Events;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Calendar.Api.Endpoints;

internal static class EventEndpoints
{
    private const string GetEventName = "GetEvent";

    public static IEndpointRouteBuilder MapEventEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/events").WithTags("Events");

        group.MapPost("/", CreateAsync).WithName("CreateEvent");
        group.MapGet("/{id:guid}", GetAsync).WithName(GetEventName).ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }

    private static async Task<Results<CreatedAtRoute<EventResponse>, ValidationProblem>> CreateAsync(
        CreateEventRequest request,
        CalendarDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = new FieldErrors();
        if (request.AllDay)
        {
            errors.Require(request.StartDate is not null, "startDate", "startDate is required for an all-day event.");
            errors.Require(request.EndDate is not null, "endDate", "endDate is required for an all-day event.");
            errors.Forbid(request.Start is not null, "start", "start is only for timed events; use startDate.");
            errors.Forbid(request.End is not null, "end", "end is only for timed events; use endDate.");
            errors.Forbid(request.TimeZone is not null, "timeZone", "timeZone is only for timed events.");
            errors.CheckDate(request.StartDate, "startDate");
            errors.CheckDate(request.EndDate, "endDate");
        }
        else
        {
            errors.Require(request.Start is not null, "start", "start is required for a timed event.");
            errors.Require(request.End is not null, "end", "end is required for a timed event.");
            errors.Require(request.TimeZone is not null, "timeZone", "timeZone is required for a timed event.");
            errors.Forbid(request.StartDate is not null, "startDate", "startDate is only for all-day events; use start.");
            errors.Forbid(request.EndDate is not null, "endDate", "endDate is only for all-day events; use end.");
        }

        CalendarEvent? created = null;
        if (!errors.Any)
        {
            try
            {
                created = request.AllDay
                    ? CalendarEvent.CreateAllDay(request.Title, request.StartDate!.Value, request.EndDate!.Value, request.Location, request.Notes)
                    : CalendarEvent.Create(request.Title, request.Start!.Value, request.End!.Value, request.TimeZone!, request.Location, request.Notes);
            }
            catch (ArgumentException ex)
            {
                errors.AddDomainError(ex);
            }
        }

        if (created is null)
        {
            return TypedResults.ValidationProblem(errors.ToDictionary());
        }

        db.Events.Add(created);
        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.CreatedAtRoute(ToResponse(created), GetEventName, new { id = created.Id });
    }

    private static async Task<Results<Ok<EventResponse>, ProblemHttpResult>> GetAsync(
        Guid id,
        CalendarDbContext db,
        CancellationToken cancellationToken)
    {
        var found = await db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
        return found is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Event not found.")
            : TypedResults.Ok(ToResponse(found));
    }

    private static EventResponse ToResponse(CalendarEvent e) => new()
    {
        Id = e.Id,
        Title = e.Title,
        AllDay = e.IsAllDay,
        Location = e.Location,
        Notes = e.Notes,
        Start = e.Start,
        End = e.End,
        TimeZone = e.TimeZoneId,
        StartDate = e.StartDate,
        EndDate = e.EndDate,
    };
}
