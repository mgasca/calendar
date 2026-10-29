using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Calendar.Api.Tests.Endpoints;

public sealed class ReadinessEndpointsTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  [Fact]
  public async Task ReadyIsAnonymousAndReturnsOkWithHealthyDatabase()
  {
    await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
      builder.UseSetting("ConnectionStrings:Calendar", Postgres.Database.AppConnectionString));
    using var client = factory.CreateClient();
    using var response = await client.GetAsync(new Uri("/api/health/ready", UriKind.Relative), Ct);
    response.StatusCode.ShouldBe(HttpStatusCode.OK);
    (await response.Content.ReadFromJsonAsync<ReadinessBody>(Ct)).ShouldNotBeNull().Status.ShouldBe("ok");
  }

  private sealed record ReadinessBody(string Status);
}
