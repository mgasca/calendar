using System.Security.Claims;
using Calendar.Api.Contracts;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Calendar.Api.Endpoints;

internal static class AuthEndpoints
{
  public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app, bool googleConfigured)
  {
    app.MapGet("/api/auth/login", (string? returnUrl) => googleConfigured
      ? Results.Challenge(
        new AuthenticationProperties { RedirectUri = ApiAuthentication.LocalReturnUrl(returnUrl) },
        [GoogleDefaults.AuthenticationScheme])
      : Results.Problem(
        statusCode: StatusCodes.Status503ServiceUnavailable,
        title: "Google sign-in is not configured.",
        detail: "Set Auth__Google__ClientId and Auth__Google__ClientSecret for the API, then restart it. "
          + "See the README, 'Google sign-in'."))
      .AllowAnonymous()
      .ExcludeFromDescription();
    app.MapGet("/api/auth/me", Results<Ok<AuthUserResponse>, UnauthorizedHttpResult> (ClaimsPrincipal user) =>
      user.Identity?.IsAuthenticated == true
        ? TypedResults.Ok(new AuthUserResponse(
          user.Identity.Name ?? "",
          user.FindFirstValue(ClaimTypes.Email) ?? "",
          user.FindFirstValue("picture")))
        : TypedResults.Unauthorized()).WithName("GetCurrentUser").WithTags("Auth");
    app.MapPost("/api/auth/logout", async Task<NoContent> (HttpContext context) =>
    {
      await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
      return TypedResults.NoContent();
    }).WithName("Logout").WithTags("Auth");
    return app;
  }
}

internal static class ApiAuthentication
{
  public static bool IsAllowed(string? email, bool verified, string[] allowed) =>
    verified && !string.IsNullOrWhiteSpace(email) && allowed.Contains(email, StringComparer.OrdinalIgnoreCase);

  public static string LocalReturnUrl(string? url) =>
    !string.IsNullOrEmpty(url)
    && url[0] == '/'
    && (url.Length == 1 || (url[1] != '/' && url[1] != '\\'))
    && !url.Contains('\\', StringComparison.Ordinal)
    && !url.Any(char.IsControl)
      ? url
      : "/";

  public static Task RedirectOrStatus(RedirectContext<CookieAuthenticationOptions> context, int status)
  {
    if (context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
    {
      context.Response.StatusCode = status;
    }
    else
    {
      context.Response.Redirect(context.RedirectUri);
    }
    return Task.CompletedTask;
  }
}
