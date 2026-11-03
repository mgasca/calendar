using System.Security.Claims;
using Calendar.Infrastructure;

namespace Calendar.Api.Auth;

/// <summary>Claim types the API adds to a session principal.</summary>
internal static class CalendarClaims
{
  /// <summary>The <c>users.id</c> of the signed-in person (ADR-0041). A principal without it is not signed in.</summary>
  public const string UserId = "urn:calendar:user-id";

  /// <summary>The user id carried by <paramref name="principal"/>, or <c>null</c> when it has none.</summary>
  public static Guid? UserIdOf(ClaimsPrincipal? principal) =>
    Guid.TryParse(principal?.FindFirstValue(UserId), out Guid id) ? id : null;

  /// <summary>The signed-in user's id. Every data endpoint runs behind the authentication policy, so a missing id is a bug.</summary>
  public static Guid RequireId(this ICurrentUser user) =>
    user.Id ?? throw new InvalidOperationException("The request has no signed-in user.");
}
