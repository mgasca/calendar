using System.Security.Claims;
using System.Text.Json;
using Calendar.Api.Auth;
using Calendar.Api.Endpoints;
using Calendar.Domain.Users;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Calendar.Api.Tests.Endpoints;

/// <summary>
/// The Google callback glue (ADR-0041): after the allow-list check, <c>OnCreatingTicket</c> resolves the
/// person's users row and puts its id on the ticket. Exercised through the same <see cref="OAuthCreatingTicketContext"/>
/// the handler builds, since the Google round trip itself is not automated.
/// </summary>
public sealed class SignInTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private const string First = "first@example.com";

  [Fact]
  public async Task AttachUser_AddsTheUserIdClaim_ForANewPerson()
  {
    using WebApplicationFactory<Program> host = Host();
    using IServiceScope scope = host.Services.CreateScope();
    OAuthCreatingTicketContext context = Context(scope, "sub-new", "new@example.com", "New Person", "https://pic/new");

    await ApiAuthentication.AttachUserAsync(context, "new@example.com");

    context.Result.ShouldBeNull();
    Guid id = CalendarClaims.UserIdOf(context.Principal).ShouldNotBeNull();
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    User user = await db.Users.SingleAsync(u => u.Id == id, Ct);
    user.GoogleSubject.ShouldBe("sub-new");
    user.Email.ShouldBe("new@example.com");
    user.DisplayName.ShouldBe("New Person");
    user.PictureUrl.ShouldBe("https://pic/new");
  }

  [Fact]
  public async Task AttachUser_LetsTheFirstAllowListedEmail_ClaimTheLegacyOwner()
  {
    await using (CalendarDbContext db = Postgres.Database.CreateMigratorContext())
    {
      await db.Database.ExecuteSqlAsync($"INSERT INTO users (id, created_at) VALUES ({User.LegacyOwnerId}, now())", Ct);
    }

    using WebApplicationFactory<Program> host = Host();
    using IServiceScope scope = host.Services.CreateScope();
    OAuthCreatingTicketContext context = Context(scope, "sub-first", "First@Example.com", "The Owner", null);

    await ApiAuthentication.AttachUserAsync(context, "First@Example.com");

    CalendarClaims.UserIdOf(context.Principal).ShouldBe(User.LegacyOwnerId);
    await using CalendarDbContext check = Postgres.Database.CreateMigratorContext();
    User owner = await check.Users.SingleAsync(u => u.Id == User.LegacyOwnerId, Ct);
    owner.GoogleSubject.ShouldBe("sub-first");
    owner.Email.ShouldBe(First);
  }

  [Fact]
  public async Task AttachUser_FailsTheTicket_WhenGoogleSentNoSubject()
  {
    using WebApplicationFactory<Program> host = Host();
    using IServiceScope scope = host.Services.CreateScope();
    OAuthCreatingTicketContext context = Context(scope, subject: null, "nosub@example.com", "No Subject", null);

    await ApiAuthentication.AttachUserAsync(context, "nosub@example.com");

    context.Result.ShouldNotBeNull().Failure.ShouldNotBeNull();
    CalendarClaims.UserIdOf(context.Principal).ShouldBeNull();
    await using CalendarDbContext db = Postgres.Database.CreateMigratorContext();
    (await db.Users.AnyAsync(u => u.Email == "nosub@example.com", Ct)).ShouldBeFalse();
  }

  private WebApplicationFactory<Program> Host() =>
    Factory.WithWebHostBuilder(builder => builder.UseSetting("Auth:AllowedEmails:0", First));

  /// <summary>The context the Google handler hands to <c>OnCreatingTicket</c>, with the claims it maps and the userinfo JSON.</summary>
  private static OAuthCreatingTicketContext Context(IServiceScope scope, string? subject, string email, string name, string? picture)
  {
    List<Claim> claims = [new(ClaimTypes.Name, name), new(ClaimTypes.Email, email)];
    if (subject is not null)
    {
      claims.Add(new Claim(ClaimTypes.NameIdentifier, subject));
    }

    if (picture is not null)
    {
      claims.Add(new Claim("picture", picture));
    }

    var identity = new ClaimsIdentity(claims, GoogleDefaults.AuthenticationScheme);
    var user = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
    {
      ["sub"] = subject,
      ["email"] = email,
      ["email_verified"] = true,
    });
    var httpContext = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
    return new OAuthCreatingTicketContext(
      new ClaimsPrincipal(identity),
      new AuthenticationProperties(),
      httpContext,
      new AuthenticationScheme(GoogleDefaults.AuthenticationScheme, null, typeof(GoogleHandler)),
      new GoogleOptions(),
      new HttpClient(),
      OAuthTokenResponse.Success(JsonDocument.Parse("{}")),
      user);
  }
}
