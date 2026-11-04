using Calendar.Infrastructure;

namespace Calendar.Api.Auth;

/// <summary>The current user of a request: the user-id claim of its principal (ADR-0041).</summary>
internal sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
  /// <inheritdoc />
  public Guid? Id => CalendarClaims.UserIdOf(accessor.HttpContext?.User);
}
