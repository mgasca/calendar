using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class ContractCheckTests
{
  [Theory]
  [InlineData("backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs")]
  [InlineData("backend/src/Calendar.Api/Contracts/TaskResponse.cs")]
  [InlineData("backend/src/Calendar.Api/Program.cs")]
  public void Changed_contract_sources_without_the_contract_block(string source) =>
    (ContractCheck.Evaluate([source]) ?? string.Empty).ShouldContain("just contracts");

  [Fact]
  public void Changed_contract_without_the_client_blocks() =>
    (ContractCheck.Evaluate(["backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs", "contracts/openapi.json"]) ?? string.Empty)
      .ShouldContain("schema.gen.ts");

  [Fact]
  public void Sources_contract_and_client_together_pass_and_domain_changes_pass()
  {
    ContractCheck.Evaluate(
      [
        "backend/src/Calendar.Api/Endpoints/TaskEndpoints.cs",
        "contracts/openapi.json",
        "frontend/packages/api-client/src/schema.gen.ts",
      ]).ShouldBeNull();
    ContractCheck.Evaluate(["backend/src/Calendar.Domain/Agenda/DayInclusion.cs"]).ShouldBeNull();
    ContractCheck.Evaluate([]).ShouldBeNull();
  }
}
