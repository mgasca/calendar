using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Calendar.Api.Tests;

/// <summary>
/// Hosts the API against the shared PostgreSQL container, connecting as the application role.
/// Usage: <c>public sealed class MyTests(PostgresFixture postgres) : IAsyncLifetime</c>, create the factory with
/// <c>new CalendarApiFactory(postgres.Database)</c>, and call <c>postgres.Database.ResetAsync()</c> to clean up.
/// Pass a <c>FakeTimeProvider</c> to control "now".
/// </summary>
public sealed class CalendarApiFactory(Calendar.Testing.PostgresTestDatabase database, TimeProvider? timeProvider = null)
    : WebApplicationFactory<Program>
{
  protected override void ConfigureWebHost(IWebHostBuilder builder)
  {
    builder.UseSetting("ConnectionStrings:Calendar", database.AppConnectionString);
    builder.ConfigureTestServices(services => services.AddAuthentication(options =>
    {
      options.DefaultAuthenticateScheme = "Test";
      options.DefaultChallengeScheme = "Test";
    }).AddScheme<AuthenticationSchemeOptions, FakeAuthenticationHandler>("Test", _ => { }));
    if (timeProvider is not null)
    {
      builder.ConfigureTestServices(services => services.AddSingleton(timeProvider));
    }
  }
}
