using Shouldly;
using Xunit;

namespace AgentHooks.Tests;

public sealed class EditGuardTests
{
  [Theory]
  [InlineData("/repo/contracts/openapi.json")]
  [InlineData("/repo/frontend/packages/api-client/src/schema.gen.ts")]
  [InlineData("/repo/tools/agent-hooks/packages.lock.json")]
  [InlineData("/repo/backend/Cargo.lock")]
  [InlineData("/repo/frontend/pnpm-lock.yaml")]
  public void Generated_files_are_denied(string path)
  {
    Verdict verdict = EditGuard.Evaluate(path).ShouldNotBeNull();

    verdict.Decision.ShouldBe("deny");
    verdict.Reason.ShouldContain("generated");
  }

  [Theory]
  [InlineData("/repo/backend/crates/calendar-api/src/main.rs")]
  [InlineData("/repo/backend/Cargo.toml")]
  [InlineData("/repo/contracts/README.md")]
  [InlineData("/repo/frontend/packages/api-client/src/index.ts")]
  public void Source_files_pass(string path) =>
    EditGuard.Evaluate(path).ShouldBeNull();
}
