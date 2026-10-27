using Calendar.Api.Contracts;
using Calendar.Domain.Time;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.OpenApi;

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

  private static AgendaWindow Window(DateTimeOffset start, DateTimeOffset end) => new() { Start = start, End = end };

  /// <summary>
  /// Marks query parameters required in the OpenAPI document. They bind as nullable so that a missing value is
  /// reported as a validation problem, but the contract still says they are required.
  /// </summary>
  private static RouteHandlerBuilder RequireQueryParameters(this RouteHandlerBuilder builder, params string[] names) =>
      builder.AddOpenApiOperationTransformer((operation, _, _) =>
      {
        foreach (var parameter in operation.Parameters ?? [])
        {
          if (parameter is OpenApiParameter concrete && names.Contains(concrete.Name, StringComparer.Ordinal))
          {
            concrete.Required = true;
          }
        }

        return Task.CompletedTask;
      });
}
