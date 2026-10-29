using System.Net;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
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
      using var configured = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        services.AddSingleton<IStartupFilter>(new WebRootFilter(root))));
      using var client = configured.CreateClient();
      foreach (var path in new[] { "/", "/day/2026-10-29", "/index.html" })
      {
        using var response = await client.GetAsync(new Uri(path, UriKind.Relative), TestContext.Current.CancellationToken);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).ShouldBe("SPA");
        response.Headers.CacheControl!.ToString().ShouldBe("no-cache");
      }
      using var asset = await client.GetAsync(new Uri("/assets/app-Abc123_X.js", UriKind.Relative), TestContext.Current.CancellationToken);
      asset.Headers.CacheControl!.ToString().ShouldBe("public, max-age=31536000, immutable");
      using var plain = await client.GetAsync(new Uri("/assets/plain.js", UriKind.Relative), TestContext.Current.CancellationToken);
      plain.Headers.CacheControl.ShouldBeNull();
      using var missing = await client.GetAsync(new Uri("/assets/missing.js", UriKind.Relative), TestContext.Current.CancellationToken);
      missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
      using var unknown = await client.GetAsync(new Uri("/api/unknown", UriKind.Relative), TestContext.Current.CancellationToken);
      unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);
      unknown.Content.Headers.ContentType?.MediaType.ShouldNotBe("text/html");
      using var protectedRoute = await client.GetAsync(new Uri("/api/auth/me", UriKind.Relative), TestContext.Current.CancellationToken);
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
    using var host = factory.WithWebHostBuilder(builder =>
    {
      builder.UseEnvironment("Development");
      builder.UseSetting("ConnectionStrings:Calendar", "");
      builder.UseSetting("Auth:Google:ClientId", "test-client");
      builder.UseSetting("Auth:Google:ClientSecret", "test-secret");
      builder.ConfigureTestServices(services => services.AddAuthentication(options => options.DefaultAuthenticateScheme = "Test")
        .AddScheme<AuthenticationSchemeOptions, FakeAuthenticationHandler>("Test", _ => { }));
    });
    var result = await host.Server.SendAsync(context =>
    {
      context.Connection.RemoteIpAddress = IPAddress.Parse("10.0.0.4");
      context.Request.Path = "/api/auth/login";
      context.Request.Host = new Microsoft.AspNetCore.Http.HostString("internal");
      context.Request.Headers["X-Forwarded-Proto"] = "https";
      context.Request.Headers["X-Forwarded-Host"] = "calendar.example";
    }, TestContext.Current.CancellationToken);
    result.Response.StatusCode.ShouldBe(302);
    result.Response.Headers.Location.ToString().ShouldContain("redirect_uri=https%3A%2F%2Fcalendar.example%2Fapi%2Fauth%2Fcallback%2Fgoogle");
    result.Response.Headers.SetCookie.ToString().ShouldContain("secure");
    var logout = await host.Server.SendAsync(context =>
    {
      context.Connection.RemoteIpAddress = IPAddress.Parse("10.0.0.4");
      context.Request.Method = "POST";
      context.Request.Path = "/api/auth/logout";
      context.Request.Headers["X-Forwarded-Proto"] = "https";
    }, TestContext.Current.CancellationToken);
    logout.Response.StatusCode.ShouldBe(204);
    logout.Response.Headers.SetCookie.ToString().ShouldContain("secure");
  }

  private sealed class WebRootFilter(string root) : IStartupFilter
  {
    public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next) => app =>
    {
      app.ApplicationServices.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider = new PhysicalFileProvider(root);
      next(app);
    };
  }
}
