using System.Net;
using Calendar.Api.Endpoints;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Calendar.Api.Tests.Endpoints;

public sealed class AuthenticationTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
  [Theory]
  [InlineData("Development", "12345678901234567890123456789012", "12345678901234567890123456789012", HttpStatusCode.OK)]
  [InlineData("Development", "12345678901234567890123456789012", "wrong", HttpStatusCode.Unauthorized)]
  [InlineData("Development", "12345678901234567890123456789012", null, HttpStatusCode.Unauthorized)]
  [InlineData("Development", "", "12345678901234567890123456789012", HttpStatusCode.Unauthorized)]
  [InlineData("Production", "12345678901234567890123456789012", "12345678901234567890123456789012", HttpStatusCode.Unauthorized)]
  public async Task SeedKeyOnlyAuthenticatesInDevelopment(string environment, string key, string? header, HttpStatusCode expected)
  {
    using var host = factory.WithWebHostBuilder(builder =>
    {
      builder.UseEnvironment(environment);
      builder.UseSetting("Auth:DevSeedKey", key);
    });
    using var client = host.CreateClient();
    using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/api/auth/me", UriKind.Relative));
    if (header is not null)
    {
      request.Headers.Add("X-Dev-Seed-Key", header);
    }
    using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(expected);
    var schemes = host.Services.GetRequiredService<IAuthenticationSchemeProvider>();
    (await schemes.GetSchemeAsync("DevSeed") is not null).ShouldBe(environment == "Development" && key.Length > 0);
  }

  [Theory]
  [InlineData("/api/events/00000000-0000-0000-0000-000000000000")]
  [InlineData("/api/tasks")]
  [InlineData("/api/agenda/day")]
  [InlineData("/api/agenda/week")]
  [InlineData("/api/auth/me")]
  public async Task AnonymousRoutesReturnUnauthorized(string path)
  {
    using var client = factory.CreateClient();
    using var response = await client.GetAsync(new Uri(path, UriKind.Relative), TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
  }

  [Theory]
  [InlineData("/api/health")]
  [InlineData("/openapi/v1.json")]
  public async Task PublicRoutesAreAccessible(string path)
  {
    using var client = factory.CreateClient();
    using var response = await client.GetAsync(new Uri(path, UriKind.Relative), TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(HttpStatusCode.OK);
  }

  [Theory]
  [InlineData("USER@example.com", true, true)]
  [InlineData("other@example.com", true, false)]
  [InlineData("user@example.com", false, false)]
  [InlineData(null, true, false)]
  public void OnlyVerifiedAllowedEmailsPass(string? email, bool verified, bool expected) =>
    ApiAuthentication.IsAllowed(email, verified, ["user@example.com"]).ShouldBe(expected);

  [Theory]
  [InlineData("/day/2026-10-29?x=1", "/day/2026-10-29?x=1")]
  [InlineData("//evil.test", "/")]
  [InlineData("/\\evil.test", "/")]
  [InlineData("https://evil.test", "/")]
  [InlineData(null, "/")]
  public void ReturnUrlsAreLocal(string? input, string expected) => ApiAuthentication.LocalReturnUrl(input).ShouldBe(expected);

  [Fact]
  public async Task LogoutClearsCookie()
  {
    using var authenticated = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
      services.AddAuthentication(options => options.DefaultAuthenticateScheme = "Test")
        .AddScheme<AuthenticationSchemeOptions, FakeAuthenticationHandler>("Test", _ => { })));
    using var client = authenticated.CreateClient();
    using var response = await client.PostAsync(new Uri("/api/auth/logout", UriKind.Relative), null, TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(HttpStatusCode.NoContent);
    response.Headers.GetValues("Set-Cookie").Single().ShouldContain("expires=");
  }

  [Fact]
  public async Task LoginExplainsWhenGoogleIsNotConfigured()
  {
    using var host = factory.WithWebHostBuilder(builder =>
    {
      builder.UseSetting("Auth:Google:ClientId", "");
      builder.UseSetting("Auth:Google:ClientSecret", "");
    });
    using var client = host.CreateClient();
    using var response = await client.GetAsync(new Uri("/api/auth/login", UriKind.Relative), TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
    var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
    body.ShouldContain("Google sign-in is not configured.");
    body.ShouldContain("Auth__Google__ClientId");
  }

  [Fact]
  public async Task CrossOriginRequestHasNoCorsHeaders()
  {
    using var client = factory.CreateClient();
    using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/api/health", UriKind.Relative));
    request.Headers.Add("Origin", "https://example.com");
    using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
    response.Headers.Contains("Access-Control-Allow-Origin").ShouldBeFalse();
  }
}
