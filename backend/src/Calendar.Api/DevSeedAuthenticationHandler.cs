using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Calendar.Api.Auth;
using Calendar.Domain.Users;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;

namespace Calendar.Api;

/// <summary>
/// Development-only authentication for <c>just db-seed</c> (ADR-0027): a shared key in <c>X-Dev-Seed-Key</c>.
/// The seed has no Google identity, so it acts as the user of the first allow-listed email, resolving (or
/// creating, or claiming the legacy placeholder for) that row on every request (ADR-0041).
/// </summary>
internal sealed class DevSeedAuthenticationHandler(
  IOptionsMonitor<AuthenticationSchemeOptions> options,
  ILoggerFactory logger,
  UrlEncoder encoder,
  IConfiguration configuration)
  : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  public const string SchemeName = "DevSeed";
  public const int MinimumKeyLength = 32;

  /// <summary>Why the seed scheme refuses a request with a valid key when nobody is allow-listed.</summary>
  public const string NoAllowedEmailMessage =
    "Auth:AllowedEmails is empty. The seed scheme acts as its first entry, so set Auth__AllowedEmails__0.";

  protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    StringValues provided = Request.Headers["X-Dev-Seed-Key"];
    if (provided.Count != 1
      || !CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(provided.ToString()),
        Encoding.UTF8.GetBytes(configuration["Auth:DevSeedKey"]!)))
    {
      return AuthenticateResult.NoResult();
    }

    UserDirectory directory = Context.RequestServices.GetRequiredService<UserDirectory>();
    var email = directory.FirstAllowedEmail();
    if (email is null)
    {
      return AuthenticateResult.Fail(NoAllowedEmailMessage);
    }

    User user = await directory.ResolveAsync(email, googleSubject: null, displayName: null, pictureUrl: null, Context.RequestAborted);
    var identity = new ClaimsIdentity(
      [
        new Claim(ClaimTypes.Name, "dev-seed"),
        new Claim(ClaimTypes.Email, user.Email!),
        new Claim(CalendarClaims.UserId, user.Id.ToString()),
      ],
      Scheme.Name);
    return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
  }
}
