using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;

namespace Calendar.Api.Tests;

/// <summary>
/// Authenticates every request as a test user. The user is <see cref="ApiTestBase.UserA"/> unless the request
/// carries the <see cref="UserHeader"/> header with another id, so one host can act as several people.
/// </summary>
internal sealed class FakeAuthenticationHandler(
  IOptionsMonitor<AuthenticationSchemeOptions> options,
  ILoggerFactory logger,
  UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  public const string UserHeader = "X-Test-User";

  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    StringValues header = Request.Headers[UserHeader];
    Guid user = header.Count == 1 && Guid.TryParse(header.ToString(), out Guid requested) ? requested : ApiTestBase.UserA;
    var identity = new ClaimsIdentity(
      [
        new Claim(ClaimTypes.Name, "Test"),
        new Claim(ClaimTypes.Email, user == ApiTestBase.UserB ? ApiTestBase.UserBEmail : ApiTestBase.UserAEmail),
        new Claim(Auth.CalendarClaims.UserId, user.ToString()),
      ],
      Scheme.Name);
    return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
  }
}
