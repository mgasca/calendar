using Calendar.Infrastructure;

namespace Calendar.Api.Endpoints;

internal static class HealthEndpoints
{
  private static readonly Action<ILogger, Exception?> ReadinessFailed = LoggerMessage.Define(LogLevel.Warning, new EventId(1, "ReadinessFailed"), "Database readiness check failed");

  public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
  {
    app.MapGet("/api/health", () => TypedResults.Ok(new HealthResponse("ok")))
        .AllowAnonymous()
        .WithName("GetHealth")
        .WithTags("Health");

    app.MapGet("/api/health/ready", async (HttpContext context, ILoggerFactory loggerFactory) =>
    {
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
      timeout.CancelAfter(TimeSpan.FromSeconds(5));
      try
      {
        var db = context.RequestServices.GetRequiredService<CalendarDbContext>();
        if (await db.Database.CanConnectAsync(timeout.Token))
        {
          return Results.Ok(new HealthResponse("ok"));
        }
        ReadinessFailed(loggerFactory.CreateLogger("Calendar.Readiness"), null);
      }
      catch (Exception ex) when (ex is not OperationCanceledException || !context.RequestAborted.IsCancellationRequested)
      {
        ReadinessFailed(loggerFactory.CreateLogger("Calendar.Readiness"), ex);
      }
      return Results.Json(new HealthResponse("unavailable"), statusCode: StatusCodes.Status503ServiceUnavailable);
    }).AllowAnonymous().WithName("GetReadiness").WithTags("Health");

    return app;
  }
}

internal sealed record HealthResponse(string Status);
