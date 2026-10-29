using Calendar.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Calendar.Api.Tests;

public sealed class DatabaseConnectivityTests(PostgresFixture postgres)
{
  [Fact]
  public async Task Api_ConnectsToRealPostgres_AsAppRole()
  {
    await using var factory = new CalendarApiFactory(postgres.Database);
    using IServiceScope scope = factory.Services.CreateScope();
    CalendarDbContext db = scope.ServiceProvider.GetRequiredService<CalendarDbContext>();

    (await db.Database.CanConnectAsync(TestContext.Current.CancellationToken)).ShouldBeTrue();
    var user = await db.Database.SqlQuery<string>($"SELECT current_user AS \"Value\"").SingleAsync(TestContext.Current.CancellationToken);
    user.ShouldBe("calendar_app");
  }
}
