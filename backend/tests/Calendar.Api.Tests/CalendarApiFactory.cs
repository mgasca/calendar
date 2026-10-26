using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Calendar.Api.Tests;

/// <summary>
/// Hosts the API against the shared PostgreSQL container, connecting as the application role.
/// Usage: <c>public sealed class MyTests(PostgresFixture postgres) : IAsyncLifetime</c>, create the factory with
/// <c>new CalendarApiFactory(postgres.Database)</c>, and call <c>postgres.Database.ResetAsync()</c> to clean up.
/// </summary>
public sealed class CalendarApiFactory(Calendar.Testing.PostgresTestDatabase database) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Calendar", database.AppConnectionString);
    }
}
