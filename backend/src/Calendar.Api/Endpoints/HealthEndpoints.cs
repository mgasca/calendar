namespace Calendar.Api.Endpoints;

internal static class HealthEndpoints
{
  public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
  {
    app.MapGet("/api/health", () => TypedResults.Ok(new HealthResponse("ok")))
        .AllowAnonymous()
        .WithName("GetHealth")
        .WithTags("Health");

    return app;
  }
}

internal sealed record HealthResponse(string Status);
