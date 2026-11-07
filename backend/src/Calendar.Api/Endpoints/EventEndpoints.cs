using Calendar.Api.Auth;
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
    RouteGroupBuilder group = app.MapGroup("/api/events").WithTags("Events");

    group.MapPost("/", CreateAsync).WithName("CreateEvent");
    group.MapGet("/{id:guid}", GetAsync).WithName(GetEventName).ProducesProblem(StatusCodes.Status404NotFound);
    group.MapPut("/{id:guid}", UpdateAsync)
      .WithName("UpdateEvent")
      .ProducesProblem(StatusCodes.Status404NotFound)
      .ProducesProblem(StatusCodes.Status409Conflict);
    group.MapDelete("/{id:guid}", DeleteAsync)
      .WithName("DeleteEvent")
      .Produces(StatusCodes.Status204NoContent)
      .ProducesProblem(StatusCodes.Status404NotFound)
      .ProducesProblem(StatusCodes.Status409Conflict);

    return app;
  }

  private static async Task<Results<CreatedAtRoute<EventResponse>, ValidationProblem>> CreateAsync(
      CreateEventRequest request,
      CalendarDbContext db,
      ICurrentUser user,
      CancellationToken cancellationToken)
  {
    FieldErrors errors = CheckShape(request);
    CalendarEvent? created = null;
    if (!errors.Any)
    {
      try
      {
        Guid owner = user.RequireId();
        created = request.AllDay
            ? CalendarEvent.CreateAllDay(
              owner,
              request.Title,
              request.StartDate!.Value,
              request.EndDate!.Value,
              request.Location,
              request.Notes)
            : CalendarEvent.Create(
              owner,
              request.Title,
              request.Start!.Value,
              request.End!.Value,
              request.TimeZone!,
              request.Location,
              request.Notes);
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
    return TypedResults.CreatedAtRoute(ToResponse(created, db.VersionOf(created)), GetEventName, new { id = created.Id });
  }

  private static async Task<Results<Ok<EventResponse>, ProblemHttpResult>> GetAsync(
      Guid id,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    // Tracked, so that the version (a shadow property) can be read.
    CalendarEvent? found = await db.Events.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    return found is null ? NotFound() : TypedResults.Ok(ToResponse(found, db.VersionOf(found)));
  }

  /// <summary>
  /// Replaces an event, provided it is unchanged since the client read its <c>version</c>; a stale version answers
  /// <c>409</c> and changes nothing.
  /// </summary>
  private static async Task<Results<Ok<EventResponse>, ValidationProblem, ProblemHttpResult>> UpdateAsync(
      Guid id,
      UpdateEventRequest request,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    FieldErrors errors = CheckShape(request);
    if (errors.Any)
    {
      return TypedResults.ValidationProblem(errors.ToDictionary());
    }

    CalendarEvent? found = await db.Events.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    if (found is null)
    {
      return NotFound();
    }

    try
    {
      if (request.AllDay)
      {
        found.UpdateAllDay(request.Title, request.StartDate!.Value, request.EndDate!.Value, request.Location, request.Notes);
      }
      else
      {
        found.Update(request.Title, request.Start!.Value, request.End!.Value, request.TimeZone!, request.Location, request.Notes);
      }
    }
    catch (ArgumentException ex)
    {
      errors.AddDomainError(ex);
      return TypedResults.ValidationProblem(errors.ToDictionary());
    }

    db.ExpectVersion(found, request.Version);
    try
    {
      await db.SaveChangesAsync(cancellationToken);
    }
    catch (DbUpdateConcurrencyException)
    {
      return await ConflictOrNotFoundAsync(id, db, cancellationToken);
    }

    return TypedResults.Ok(ToResponse(found, db.VersionOf(found)));
  }

  /// <summary>Deletes an event whatever changed since the client read it.</summary>
  private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(
      Guid id,
      CalendarDbContext db,
      CancellationToken cancellationToken)
  {
    CalendarEvent? found = await db.Events.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    if (found is null)
    {
      return NotFound();
    }

    db.Events.Remove(found);
    try
    {
      await db.SaveChangesAsync(cancellationToken);
    }
    catch (DbUpdateConcurrencyException)
    {
      // Only a write between this request's read and its delete gets here.
      return await ConflictOrNotFoundAsync(id, db, cancellationToken);
    }

    return TypedResults.NoContent();
  }

  /// <summary>After a failed concurrency check: <c>404</c> if the event is gone, else <c>409</c>.</summary>
  private static async Task<ProblemHttpResult> ConflictOrNotFoundAsync(
      Guid id,
      CalendarDbContext db,
      CancellationToken cancellationToken) =>
      await db.Events.AsNoTracking().AnyAsync(e => e.Id == id, cancellationToken)
          ? TypedResults.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: "The event was changed elsewhere. Load it again and retry.")
          : NotFound();

  /// <summary>The fields each kind of event requires and forbids, shared by create and update.</summary>
  private static FieldErrors CheckShape(IEventFields request)
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

    return errors;
  }

  private static ProblemHttpResult NotFound() =>
      TypedResults.Problem(statusCode: StatusCodes.Status404NotFound, title: "Event not found.");

  private static EventResponse ToResponse(CalendarEvent e, uint version) => new()
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
    Version = version,
  };
}
