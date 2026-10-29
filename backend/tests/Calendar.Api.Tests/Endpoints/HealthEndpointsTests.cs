using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Calendar.Api.Tests.Endpoints;

public sealed class HealthEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
  [Fact]
  public async Task GetHealth_ReturnsOk()
  {
    using var client = factory.CreateClient();

    using var response = await client.GetAsync(new Uri("/api/health", UriKind.Relative), TestContext.Current.CancellationToken);

    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    var body = await response.Content.ReadFromJsonAsync<HealthBody>(TestContext.Current.CancellationToken);
    body.ShouldNotBeNull().Status.ShouldBe("ok");
  }

  [Fact]
  public async Task ReadinessWithoutDatabaseReturnsUnavailableWithoutLeakingDetails()
  {
    await using var brokenFactory = factory.WithWebHostBuilder(builder =>
      builder.UseSetting("ConnectionStrings:Calendar", "Host=127.0.0.1;Port=1;Database=calendar;Username=readiness;Password=private-secret;Timeout=2"));
    using var client = brokenFactory.CreateClient();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(7));
    using var response = await client.GetAsync(new Uri("/api/health/ready", UriKind.Relative), timeout.Token);
    response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
    var body = await response.Content.ReadAsStringAsync(timeout.Token);
    body.ShouldBe("{\"status\":\"unavailable\"}");
    using var liveness = await client.GetAsync(new Uri("/api/health", UriKind.Relative), timeout.Token);
    liveness.StatusCode.ShouldBe(HttpStatusCode.OK);
  }

  private sealed record HealthBody(string Status);
}
