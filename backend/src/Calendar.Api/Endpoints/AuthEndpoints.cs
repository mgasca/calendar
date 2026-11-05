using System.Security.Claims;
using System.Text.Json;
using Calendar.Api.Auth;
using Calendar.Api.Contracts;
using Calendar.Domain.Users;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OAuth;
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
          + "See backend/README.md, 'Google sign-in setup'."))
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

  /// <summary>
  /// Resolves the signed-in person's <see cref="User"/> row from the Google claims and adds its id to the
  /// ticket's identity (ADR-0041). Fails the ticket when Google sent no subject.
  /// </summary>
  public static async Task AttachUserAsync(OAuthCreatingTicketContext context, string email)
  {
    var subject = context.User.TryGetProperty("sub", out JsonElement sub) && sub.ValueKind == JsonValueKind.String
      ? sub.GetString()
      : context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
    if (string.IsNullOrWhiteSpace(subject) || context.Identity is null)
    {
      context.Fail("The identity provider sent no subject.");
      return;
    }

    UserDirectory directory = context.HttpContext.RequestServices.GetRequiredService<UserDirectory>();
    User user = await directory.ResolveAsync(
      email,
      subject,
      context.Principal?.FindFirstValue(ClaimTypes.Name),
      context.Principal?.FindFirstValue("picture"),
      context.HttpContext.RequestAborted);
    context.Identity.AddClaim(new Claim(CalendarClaims.UserId, user.Id.ToString()));
  }

  /// <summary>Rejects, and signs out, a cookie principal that carries no user id (one issued before ADR-0041).</summary>
  public static async Task RequireUserIdAsync(CookieValidatePrincipalContext context)
  {
    if (CalendarClaims.UserIdOf(context.Principal) is null)
    {
      context.RejectPrincipal();
      await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    }
  }

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
