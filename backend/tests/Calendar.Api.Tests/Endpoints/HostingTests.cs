using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;

namespace Calendar.Api.Tests.Endpoints;

public sealed class HostingTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
  [Fact]
  public async Task SpaRoutingAndCacheHeaders()
  {
    var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    Directory.CreateDirectory(Path.Combine(root, "assets"));
    await File.WriteAllTextAsync(Path.Combine(root, "index.html"), "SPA", TestContext.Current.CancellationToken);
    await File.WriteAllTextAsync(Path.Combine(root, "assets", "app-Abc123_X.js"), "asset", TestContext.Current.CancellationToken);
    await File.WriteAllTextAsync(Path.Combine(root, "assets", "plain.js"), "plain", TestContext.Current.CancellationToken);
    try
    {
      using WebApplicationFactory<Program> configured = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        services.AddSingleton<IStartupFilter>(new WebRootFilter(root))));
      using HttpClient client = configured.CreateClient();
      foreach (var path in new[] { "/", "/day/2026-10-29", "/index.html" })
      {
        using HttpResponseMessage response = await client.GetAsync(new Uri(path, UriKind.Relative), TestContext.Current.CancellationToken);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).ShouldBe("SPA");
        response.Headers.CacheControl!.ToString().ShouldBe("no-cache");
      }
      using HttpResponseMessage asset = await client.GetAsync(
        new Uri("/assets/app-Abc123_X.js", UriKind.Relative),
        TestContext.Current.CancellationToken);
      asset.StatusCode.ShouldBe(HttpStatusCode.OK);
      (await asset.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).ShouldBe("asset");
      asset.Headers.CacheControl!.ToString().ShouldBe("public, max-age=31536000, immutable");
      using HttpResponseMessage plain = await client.GetAsync(
        new Uri("/assets/plain.js", UriKind.Relative),
        TestContext.Current.CancellationToken);
      plain.Headers.CacheControl.ShouldBeNull();
      using HttpResponseMessage missing = await client.GetAsync(
        new Uri("/assets/missing.js", UriKind.Relative),
        TestContext.Current.CancellationToken);
      missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
      using HttpResponseMessage unknown = await client.GetAsync(
        new Uri("/api/unknown", UriKind.Relative),
        TestContext.Current.CancellationToken);
      unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);
      unknown.Content.Headers.ContentType?.MediaType.ShouldBe("application/problem+json");
      using var problem = JsonDocument.Parse(await unknown.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
      problem.RootElement.GetProperty("status").GetInt32().ShouldBe(404);
      using HttpResponseMessage protectedRoute = await client.GetAsync(
        new Uri("/api/auth/me", UriKind.Relative),
        TestContext.Current.CancellationToken);
      protectedRoute.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
    finally
    {
      Directory.Delete(root, true);
    }
  }

  [Fact]
  public async Task ForwardedHttpsSetsGoogleRedirectAndSecureCookie()
  {
    using WebApplicationFactory<Program> host = factory.WithWebHostBuilder(builder =>
    {
      builder.UseEnvironment("Development");
      builder.UseSetting("ConnectionStrings:Calendar", "");
      builder.UseSetting("Auth:Google:ClientId", "test-client");
      builder.UseSetting("Auth:Google:ClientSecret", "test-secret");
      builder.ConfigureTestServices(services => services.AddAuthentication(options => options.DefaultAuthenticateScheme = "Test")
        .AddScheme<AuthenticationSchemeOptions, FakeAuthenticationHandler>("Test", _ => { }));
    });
    HttpContext result = await host.Server.SendAsync(
      context =>
      {
        context.Connection.RemoteIpAddress = IPAddress.Parse("10.0.0.4");
        context.Request.Path = "/api/auth/login";
        context.Request.Host = new Microsoft.AspNetCore.Http.HostString("internal");
        context.Request.Headers["X-Forwarded-Proto"] = "https";
        context.Request.Headers["X-Forwarded-Host"] = "calendar.example";
      },
      TestContext.Current.CancellationToken);
    result.Response.StatusCode.ShouldBe(302);
    result.Response.Headers.Location.ToString()
      .ShouldContain("redirect_uri=https%3A%2F%2Fcalendar.example%2Fapi%2Fauth%2Fcallback%2Fgoogle");
    result.Response.Headers.SetCookie.ToString().ShouldContain("secure");
    HttpContext logout = await host.Server.SendAsync(
      context =>
      {
        context.Connection.RemoteIpAddress = IPAddress.Parse("10.0.0.4");
        context.Request.Method = "POST";
        context.Request.Path = "/api/auth/logout";
        context.Request.Headers["X-Forwarded-Proto"] = "https";
      },
      TestContext.Current.CancellationToken);
    logout.Response.StatusCode.ShouldBe(204);
    logout.Response.Headers.SetCookie.ToString().ShouldContain("secure");
  }

  [Fact]
  public async Task DeniedApiRequestIsForbiddenNotRedirected()
  {
    using WebApplicationFactory<Program> host = factory.WithWebHostBuilder(builder =>
    {
      builder.UseSetting("ConnectionStrings:Calendar", "");
      builder.ConfigureTestServices(services =>
      {
        services.AddAuthentication(options =>
        {
          options.DefaultAuthenticateScheme = "Test";
          options.DefaultChallengeScheme = "Test";
          options.DefaultForbidScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        }).AddScheme<AuthenticationSchemeOptions, FakeAuthenticationHandler>("Test", _ => { });
        // A signed-in user who fails the policy: no production route denies a signed-in user today.
        services.Configure<AuthorizationOptions>(options =>
          options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireClaim("never-granted").Build());
      });
    });
    using HttpClient client = host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    using HttpResponseMessage response = await client.GetAsync(
      new Uri("/api/tasks", UriKind.Relative),
      TestContext.Current.CancellationToken);
    response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    response.Headers.Location.ShouldBeNull();
  }

  [Fact]
  public async Task SessionCookieIsHttpOnlyAndSameSiteLax()
  {
    using WebApplicationFactory<Program> host = factory.WithWebHostBuilder(builder =>
    {
      builder.UseSetting("ConnectionStrings:Calendar", "");
      builder.ConfigureTestServices(services => services.AddAuthentication(options => options.DefaultAuthenticateScheme = "Test")
        .AddScheme<AuthenticationSchemeOptions, FakeAuthenticationHandler>("Test", _ => { }));
    });
    using HttpClient client = host.CreateClient();
    using HttpResponseMessage response = await client.PostAsync(
      new Uri("/api/auth/logout", UriKind.Relative),
      null,
      TestContext.Current.CancellationToken);
    var cookie = response.Headers.GetValues("Set-Cookie").Single().ToLowerInvariant();
    cookie.ShouldContain("httponly");
    cookie.ShouldContain("samesite=lax");
  }

  private sealed class WebRootFilter(string root) : IStartupFilter
  {
    public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(
      Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next) => app =>
    {
      app.ApplicationServices.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider = new PhysicalFileProvider(root);
      next(app);
    };
  }
}
