using Calendar.Testing;

namespace Calendar.Api.Tests;

/// <summary>
/// How an <see cref="ApiTestBase"/> test uses its rented database (#349): it resets it once, and it gives it back
/// even when its setup fails. Runs alone, after the parallel tests, so that no other test resets or rents meanwhile.
/// </summary>
[Collection(nameof(ApiTestLifecycleTests))]
public sealed class ApiTestLifecycleTests(PostgresFixture postgres)
{
  [Fact]
  public async Task EachTest_ResetsItsDatabaseOnce()
  {
    var before = postgres.Database.ResetCount;

    var probe = new ProbeTest(postgres);
    await probe.InitializeAsync();
    await probe.DisposeAsync();

    (postgres.Database.ResetCount - before).ShouldBe(1);
  }

  [Fact]
  public async Task FailedSetups_DoNotUseUpTheDatabaseCopies()
  {
    // More failures than there are copies: each one that kept its copy would leave one fewer to rent.
    for (var i = 0; i <= PostgresTestDatabase.MaxCopies; i++)
    {
      var failing = new FailingSetupTest(postgres);
      await Should.ThrowAsync<InvalidOperationException>(async () => await failing.InitializeAsync());

      // xUnit may or may not dispose a test whose InitializeAsync threw; disposing must be safe either way.
      await failing.DisposeAsync();
    }

    var probe = new ProbeTest(postgres);
    await probe.InitializeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(30), TestContext.Current.CancellationToken);
    await probe.DisposeAsync();
  }

  private sealed class ProbeTest(PostgresFixture postgres) : ApiTestBase(postgres);

  private sealed class FailingSetupTest(PostgresFixture postgres) : ApiTestBase(postgres)
  {
    internal override Task SeedUsersAsync() => throw new InvalidOperationException("setup fails on purpose");
  }
}

[CollectionDefinition(nameof(ApiTestLifecycleTests), DisableParallelization = true)]
public sealed class ApiTestLifecycleRunsAlone;
