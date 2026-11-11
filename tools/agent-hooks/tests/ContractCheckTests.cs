using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class ContractCheckTests
{
  [Theory]
  [InlineData("backend/crates/calendar-api/src/endpoints/tasks.rs")]
  [InlineData("backend/crates/calendar-api/src/contracts/tasks.rs")]
  [InlineData("backend/crates/calendar-api/src/openapi.rs")]
  [InlineData("backend/crates/calendar-api/src/endpoints.rs")]
  [InlineData("backend/crates/calendar-api/src/contracts.rs")]
  public void Changed_contract_sources_without_the_contract_block(string source) =>
    (ContractCheck.Evaluate([source]) ?? string.Empty).ShouldContain("just contracts");

  [Fact]
  public void Changed_contract_without_the_client_blocks() =>
    (ContractCheck.Evaluate(["backend/crates/calendar-api/src/endpoints/tasks.rs", "contracts/openapi.json"]) ?? string.Empty)
      .ShouldContain("schema.gen.ts");

  private const string Endpoint = "backend/crates/calendar-api/src/endpoints/tasks.rs";
  private const string Contract = "contracts/openapi.json";
  private const string Client = "frontend/packages/api-client/src/schema.gen.ts";
  private static readonly DateTime Edited = new(2026, 11, 5, 13, 35, 0, DateTimeKind.Utc);

  private static Func<string, DateTime?> Times(Dictionary<string, DateTime> times) =>
    path => times.TryGetValue(path, out DateTime time) ? time : null;

  [Fact]
  public void Contract_regenerated_after_the_source_edit_passes() =>
    ContractCheck.Evaluate([Endpoint], Times(new() { [Endpoint] = Edited, [Contract] = Edited.AddMinutes(3) })).ShouldBeNull();

  [Fact]
  public void Contract_older_than_or_as_old_as_the_source_edit_blocks()
  {
    (ContractCheck.Evaluate([Endpoint], Times(new() { [Endpoint] = Edited, [Contract] = Edited.AddMinutes(-3) })) ?? string.Empty)
      .ShouldContain("just contracts");
    (ContractCheck.Evaluate([Endpoint], Times(new() { [Endpoint] = Edited, [Contract] = Edited })) ?? string.Empty)
      .ShouldContain("just contracts");
  }

  [Fact]
  public void A_deleted_source_blocks_even_after_regeneration()
  {
    const string Deleted = "backend/crates/calendar-api/src/endpoints/old.rs";

    (ContractCheck.Evaluate([Endpoint, Deleted], Times(new() { [Endpoint] = Edited, [Contract] = Edited.AddMinutes(3) }))
      ?? string.Empty).ShouldContain("just contracts");
  }

  [Fact]
  public void Client_regenerated_after_the_contract_passes_and_a_stale_client_blocks()
  {
    ContractCheck.Evaluate([Endpoint, Contract], Times(new() { [Contract] = Edited, [Client] = Edited.AddSeconds(1) }))
      .ShouldBeNull();
    (ContractCheck.Evaluate([Endpoint, Contract], Times(new() { [Contract] = Edited, [Client] = Edited.AddDays(-1) }))
      ?? string.Empty).ShouldContain("schema.gen.ts");
  }

  [Fact]
  public void Sources_contract_and_client_together_pass_and_domain_changes_pass()
  {
    ContractCheck.Evaluate(
      [
        "backend/crates/calendar-api/src/endpoints/tasks.rs",
        "contracts/openapi.json",
        "frontend/packages/api-client/src/schema.gen.ts",
      ]).ShouldBeNull();
    ContractCheck.Evaluate(["backend/crates/calendar-domain/src/agenda/day_inclusion.rs"]).ShouldBeNull();
    ContractCheck.Evaluate([]).ShouldBeNull();
  }
}
