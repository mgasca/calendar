namespace Calendar.Api.Tests;

/// <summary>
/// An API test resets its database once (#349): the reset before each test also clears what the previous test left.
/// Runs alone, after the parallel tests, so that no other test resets a database meanwhile.
/// </summary>
[Collection(nameof(ResetCountTests))]
public sealed class ResetCountTests(PostgresFixture postgres)
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

  private sealed class ProbeTest(PostgresFixture postgres) : ApiTestBase(postgres);
}

[CollectionDefinition(nameof(ResetCountTests), DisableParallelization = true)]
public sealed class ResetCountRunsAlone;
