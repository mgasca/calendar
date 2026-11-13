import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/yaml";

// Fabricated fixture only. No credentials, Azure calls or real migration execute in this test.
const fixtureValue = "fixture:%pass";
const commandData = fixtureValue.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const commandLine = `::add-mask::${commandData}`;

// The runner decodes command data before registering it. For this ASCII fixture, its encoders produce
// the original string, URI encoding or base64 (including offsets); JSON/XML/argument encoders leave it unchanged.
// Sources: actions/runner's ActionCommand.cs, HostContext.cs, and Sdk/DTLogging/Logging/ValueEncoders.cs.
function runnerMaskValues(command: string): string[] {
  const decoded = command.slice("::add-mask::".length).replaceAll("%0D", "\r").replaceAll("%0A", "\n")
    .replaceAll("%25", "%");
  return [decoded, encodeURIComponent(decoded), btoa(decoded), btoa(decoded.slice(1)), btoa(decoded.slice(2))];
}

function scrubSummary(summary: string, stdout: string): string {
  const masks = stdout.split("\n").filter((line) => line.startsWith("::add-mask::")).flatMap(runnerMaskValues);
  return masks.reduce((text, value) => text.replaceAll(value, "***"), summary);
}

async function migrationStep(exitCode: number): Promise<{ code: number; stdout: string; summary: string }> {
  const workflow = parse(
    await Deno.readTextFile(new URL("../../../.github/workflows/migrate.yml", import.meta.url)),
  ) as {
    jobs: { migrate: { steps: { name?: string; run?: string }[] } };
  };
  const script = workflow.jobs.migrate.steps.find((step) => step.name === "Apply migrations")?.run;
  assert(script, "the actual migration step must exist");
  const directory = await Deno.makeTempDir({ prefix: "migration-summary-fixture-" });
  try {
    await Deno.writeTextFile(
      `${directory}/just`,
      `#!/bin/sh\nprintf '%s\\n' '${commandLine}' '::notice::fixture notice' 'Role grants applied.'\nexit ${exitCode}\n`,
      { mode: 0o700 },
    );
    await Deno.symlink("/usr/bin/tee", `${directory}/tee`);
    const summary = `${directory}/summary.md`;
    const result = await new Deno.Command("/bin/bash", {
      args: ["-euo", "pipefail", "-c", script],
      clearEnv: true,
      env: { PATH: directory, GITHUB_STEP_SUMMARY: summary, INFRA_ENVIRONMENT: "staging" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      summary: await Deno.readTextFile(summary),
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("runner masking does not cover every escaped command representation copied to a summary", () => {
  assertEquals(runnerMaskValues(commandLine).includes(commandData), false);
  assertEquals(scrubSummary(commandLine, commandLine), commandLine);
});

Deno.test("migration keeps mask commands on stdout and excludes them from the published summary", async () => {
  const result = await migrationStep(0);
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, commandLine);
  assertStringIncludes(result.stdout, "::notice::fixture notice");
  assertStringIncludes(result.stdout, "Role grants applied.");
  assertStringIncludes(result.summary, "Role grants applied.");
  assertStringIncludes(result.summary, "Database migration: staging");
  assertEquals(result.summary.includes("::add-mask::"), false);
  assertEquals(result.summary.includes("::notice::"), false);
  assertEquals(scrubSummary(result.summary, result.stdout).includes(commandData), false);
});

Deno.test("migration summary filtering preserves the failing command's exit status", async () => {
  const result = await migrationStep(7);
  assertEquals(result.code, 7);
  assertStringIncludes(result.stdout, commandLine);
});
