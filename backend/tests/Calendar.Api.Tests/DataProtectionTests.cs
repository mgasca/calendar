using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Calendar.Api.Tests;

public sealed class DataProtectionTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
  [Fact]
  public async Task KeysAreStoredInPostgresAndVisibleToAnotherInstance()
  {
    using var first = new CalendarApiFactory(Postgres.Database);
    using var firstClient = first.CreateClient();
    first.Services.GetRequiredService<IDataProtectionProvider>()
      .CreateProtector("key-ring-test").Protect("create a key");
    var keysA = first.Services.GetRequiredService<IKeyManager>().GetAllKeys();
    keysA.Count.ShouldBeGreaterThan(0);
    await using var database = Postgres.Database.CreateAppContext();
    var stored = await database.DataProtectionKeys.AsNoTracking().ToListAsync(Ct);
    stored.Count.ShouldBeGreaterThan(0);

    using var second = new CalendarApiFactory(Postgres.Database);
    using var secondClient = second.CreateClient();
    var keysB = second.Services.GetRequiredService<IKeyManager>().GetAllKeys();
    keysB.Select(key => key.KeyId).ShouldBe(keysA.Select(key => key.KeyId), ignoreOrder: true);
  }

  [Fact]
  public async Task ProtectedPayloadSurvivesAnotherInstance()
  {
    using var first = new CalendarApiFactory(Postgres.Database);
    using var firstClient = first.CreateClient();
    var protectedValue = first.Services.GetRequiredService<IDataProtectionProvider>()
      .CreateProtector("cross-instance-test").Protect("calendar session");
    await using var database = Postgres.Database.CreateAppContext();
    (await database.DataProtectionKeys.CountAsync(Ct)).ShouldBeGreaterThan(0);

    using var second = new CalendarApiFactory(Postgres.Database);
    using var secondClient = second.CreateClient();
    var value = second.Services.GetRequiredService<IDataProtectionProvider>()
      .CreateProtector("cross-instance-test").Unprotect(protectedValue);
    value.ShouldBe("calendar session");
  }
}
