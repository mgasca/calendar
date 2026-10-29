using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;

namespace Calendar.Api;

internal sealed class DevSeedAuthenticationHandler(
  IOptionsMonitor<AuthenticationSchemeOptions> options,
  ILoggerFactory logger,
  UrlEncoder encoder,
  IConfiguration configuration)
  : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  public const string SchemeName = "DevSeed";
  public const int MinimumKeyLength = 32;

  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    StringValues provided = Request.Headers["X-Dev-Seed-Key"];
    if (provided.Count != 1
      || !CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(provided.ToString()),
        Encoding.UTF8.GetBytes(configuration["Auth:DevSeedKey"]!)))
    {
      return Task.FromResult(AuthenticateResult.NoResult());
    }

    var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, "dev-seed")], Scheme.Name);
    return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
  }
}
