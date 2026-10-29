using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Trace;

namespace Calendar.Api.Tests;

public sealed class TelemetryTests
{
  [Fact]
  public async Task TracingIsRegisteredOnlyWhenConnectionStringIsConfigured()
  {
    await using var disabled = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
      builder.UseSetting("APPLICATIONINSIGHTS_CONNECTION_STRING", ""));
    disabled.Services.GetService<TracerProvider>().ShouldBeNull();

    await using var enabled = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
      builder.UseSetting("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://127.0.0.1/"));
    enabled.Services.GetService<TracerProvider>().ShouldNotBeNull();
  }
}
