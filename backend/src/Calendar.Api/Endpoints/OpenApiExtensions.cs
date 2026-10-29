using Microsoft.OpenApi;

namespace Calendar.Api.Endpoints;

internal static class OpenApiExtensions
{
  /// <summary>
  /// Marks query parameters required in the OpenAPI document. They bind as nullable so that a missing value is
  /// reported as a validation problem, but the contract still says they are required.
  /// </summary>
  public static RouteHandlerBuilder RequireQueryParameters(this RouteHandlerBuilder builder, params string[] names) =>
      builder.AddOpenApiOperationTransformer((operation, _, _) =>
      {
        foreach (IOpenApiParameter parameter in operation.Parameters ?? [])
        {
          if (parameter is OpenApiParameter concrete && names.Contains(concrete.Name, StringComparer.Ordinal))
          {
            concrete.Required = true;
          }
        }

        return Task.CompletedTask;
      });
}
