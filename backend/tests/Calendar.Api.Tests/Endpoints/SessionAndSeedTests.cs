using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Calendar.Api.Auth;
using Calendar.Api.Contracts;
using Calendar.Domain.Tasks;
using Calendar.Domain.Users;
using Calendar.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Calendar.Api.Tests.Endpoints;

/// <summary>
/// Sessions carry the user id (ADR-0041): a cookie issued before per-user ownership is rejected, and the
/// Development seed scheme acts as the first allow-listed email's user.
/// </summary>
public sealed class SessionAndSeedTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  private const string SeedKey = "12345678901234567890123456789012";
  private const string FirstAllowed = "Owner@Example.com";

  [Theory]
  [InlineData(false, HttpStatusCode.Unauthorized)]
  [InlineData(true, HttpStatusCode.OK)]
  public async Task CookieSession_IsAcceptedOnlyWithAUserId(bool withUserId, HttpStatusCode expected)
  {
    // The real cookie scheme, with a ticket protected by this host's own data protection keys.
    using WebApplicationFactory<Program> host = Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
      services.AddAuthentication(options =>
      {
        options.DefaultAuthenticateScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
      })));
    CookieAuthenticationOptions options = host.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
      .Get(CookieAuthenticationDefaults.AuthenticationScheme);
    List<Claim> claims = [new(ClaimTypes.Name, "Someone"), new(ClaimTypes.Email, "someone@example.com")];
    if (withUserId)
    {
      claims.Add(new Claim(CalendarClaims.UserId, UserA.ToString()));
    }

    var ticket = new AuthenticationTicket(
      new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)),
      CookieAuthenticationDefaults.AuthenticationScheme);
    var cookie = options.TicketDataFormat.Protect(ticket);

    using HttpClient client = host.CreateClient();
    using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/api/auth/me", UriKind.Relative));
    request.Headers.Add("Cookie", $"{options.Cookie.Name}={cookie}");
    using HttpResponseMessage response = await client.SendAsync(request, Ct);

    response.StatusCode.ShouldBe(expected);
    if (!withUserId)
    {
      // Rejected and signed out: the browser stops presenting the stale cookie.
      response.Headers.GetValues("Set-Cookie").Single().ShouldContain("expires=");
    }
  }

  [Theory]
  [InlineData("Development", SeedKey, SeedKey, HttpStatusCode.OK)]
  [InlineData("Development", SeedKey, "wrong", HttpStatusCode.Unauthorized)]
  [InlineData("Development", SeedKey, null, HttpStatusCode.Unauthorized)]
  [InlineData("Development", "", SeedKey, HttpStatusCode.Unauthorized)]
  [InlineData("Production", SeedKey, SeedKey, HttpStatusCode.Unauthorized)]
  public async Task SeedKey_OnlyAuthenticatesInDevelopment(string environment, string key, string? header, HttpStatusCode expected)
  {
    using WebApplicationFactory<Program> host = SeedHost(environment, key, FirstAllowed);
    using HttpClient client = host.CreateClient();
    using HttpResponseMessage response = await SendSeedAsync(client, HttpMethod.Get, "/api/auth/me", header, null);

    response.StatusCode.ShouldBe(expected);
    IAuthenticationSchemeProvider schemes = host.Services.GetRequiredService<IAuthenticationSchemeProvider>();
    (await schemes.GetSchemeAsync("DevSeed") is not null).ShouldBe(environment == "Development" && key.Length > 0);
    if (expected == HttpStatusCode.OK)
    {
      (await response.Content.ReadFromJsonAsync<AuthUserResponse>(Ct))!.Email.ShouldBe("owner@example.com");
    }
  }

  [Fact]
  public async Task SeedScheme_RequiresAnAllowList_AndSaysSo()
  {
    using WebApplicationFactory<Program> host = SeedHost("Development", SeedKey, allowedEmail: null);
    using HttpClient client = host.CreateClient();
    using HttpResponseMessage response = await SendSeedAsync(client, HttpMethod.Get, "/api/auth/me", SeedKey, null);
    response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

    using IServiceScope scope = host.Services.CreateScope();
    var httpContext = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
    httpContext.Request.Headers["X-Dev-Seed-Key"] = SeedKey;
    AuthenticateResult result = await scope.ServiceProvider.GetRequiredService<IAuthenticationService>()
      .AuthenticateAsync(httpContext, DevSeedAuthenticationHandler.SchemeName);
    result.Failure.ShouldNotBeNull().Message.ShouldBe(DevSeedAuthenticationHandler.NoAllowedEmailMessage);
  }

  [Fact]
  public async Task SeedScheme_StillWorks_AfterTheOwnerHasSignedInForReal()
  {
    await using (CalendarDbContext db = Postgres.Database.CreateMigratorContext())
    {
      // The owner's row after a real Google sign-in: subject and email set.
      db.Users.Add(User.Create(Clock.GetUtcNow(), FirstAllowed, "sub-owner", "The Owner", null));
      await db.SaveChangesAsync(Ct);
    }

    using WebApplicationFactory<Program> host = SeedHost("Development", SeedKey, FirstAllowed);
    using HttpClient client = host.CreateClient();
    using HttpResponseMessage created = await SendSeedAsync(client, HttpMethod.Post, "/api/tasks", SeedKey, new { title = "seeded later" });
    created.StatusCode.ShouldBe(HttpStatusCode.Created);

    await using CalendarDbContext check = Postgres.Database.CreateMigratorContext();
    User owner = await check.Users.SingleAsync(u => u.Email == "owner@example.com", Ct);
    owner.GoogleSubject.ShouldBe("sub-owner");
    (await check.Tasks.IgnoreQueryFilters().SingleAsync(t => t.Title == "seeded later", Ct)).OwnerId.ShouldBe(owner.Id);
  }

  [Fact]
  public async Task SeededRows_BelongToTheFirstAllowListedEmail_WhoAlsoClaimsTheLegacyOwner()
  {
    await using (CalendarDbContext db = Postgres.Database.CreateMigratorContext())
    {
      await db.Database.ExecuteSqlAsync($"INSERT INTO users (id, created_at) VALUES ({User.LegacyOwnerId}, now())", Ct);
      db.Tasks.Add(TodoTask.Create(User.LegacyOwnerId, "from before ownership"));
      await db.SaveChangesAsync(Ct);
    }

    using WebApplicationFactory<Program> host = SeedHost("Development", SeedKey, FirstAllowed);
    using HttpClient client = host.CreateClient();
    using HttpResponseMessage created = await SendSeedAsync(client, HttpMethod.Post, "/api/tasks", SeedKey, new { title = "seeded" });
    created.StatusCode.ShouldBe(HttpStatusCode.Created);
    Guid seededId = (await created.Content.ReadFromJsonAsync<TaskResponse>(Ct))!.Id;

    await using CalendarDbContext check = Postgres.Database.CreateMigratorContext();
    User owner = await check.Users.SingleAsync(u => u.Email == "owner@example.com", Ct);
    owner.Id.ShouldBe(User.LegacyOwnerId);
    owner.GoogleSubject.ShouldBeNull();
    (await check.Tasks.IgnoreQueryFilters().SingleAsync(t => t.Id == seededId, Ct)).OwnerId.ShouldBe(User.LegacyOwnerId);

    // The seed sees the pre-ownership rows as its own.
    using HttpResponseMessage list = await SendSeedAsync(client, HttpMethod.Get, "/api/tasks?view=no-deadline", SeedKey, null);
    (await list.Content.ReadFromJsonAsync<TaskPage>(Ct))!.Items.Select(t => t.Title).Order().ShouldBe(["from before ownership", "seeded"]);
  }

  /// <summary>A host where only the cookie and seed schemes count, as in the real app: the test scheme is not the default.</summary>
  private WebApplicationFactory<Program> SeedHost(string environment, string key, string? allowedEmail) =>
    Factory.WithWebHostBuilder(builder =>
    {
      builder.UseEnvironment(environment);
      builder.UseSetting("Auth:DevSeedKey", key);
      if (allowedEmail is not null)
      {
        builder.UseSetting("Auth:AllowedEmails:0", allowedEmail);
      }

      builder.ConfigureServices(services => services.AddAuthentication(options =>
      {
        options.DefaultAuthenticateScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
      }));
    });

  private static async Task<HttpResponseMessage> SendSeedAsync(HttpClient client, HttpMethod method, string path, string? key, object? body)
  {
    using var request = new HttpRequestMessage(method, new Uri(path, UriKind.Relative));
    if (key is not null)
    {
      request.Headers.Add("X-Dev-Seed-Key", key);
    }

    if (body is not null)
    {
      request.Content = JsonContent.Create(body);
    }

    return await client.SendAsync(request, Ct);
  }
}
