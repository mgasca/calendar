import { assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

interface Step {
  uses?: string;
  run?: string;
  with?: { cache?: boolean | string };
}

interface Workflow {
  jobs: { adr: { steps: Step[] } };
}

// This job has a direct validator invocation. Caching becomes safe when that invocation switches to Deno.
function savesUnpopulatedDenoCache(workflow: Workflow): boolean {
  const steps = workflow.jobs.adr.steps;
  const savesCache = steps.some((step) =>
    step.uses?.startsWith("denoland/setup-deno@") &&
    (step.with?.cache === true || step.with?.cache === "true")
  );
  const runsDeno = steps.some((step) => /^\s*deno\s+/m.test(step.run ?? ""));
  return savesCache && !runsDeno;
}

Deno.test("ADR cold-cache fixture reproduces cache saving without a Deno consumer", async () => {
  const fixture = parse(
    await Deno.readTextFile(new URL("fixtures/adr-deno-cold-cache.yml", import.meta.url)),
  ) as Workflow;
  assertEquals(savesUnpopulatedDenoCache(fixture), true);
  fixture.jobs.adr.steps.push({ run: "deno run --frozen scripts/check-adr.ts" });
  assertEquals(savesUnpopulatedDenoCache(fixture), false);
});

Deno.test("ADR conventions cannot save a cold cache without running Deno", async () => {
  const workflow = parse(
    await Deno.readTextFile(new URL("../../../.github/workflows/ci.yml", import.meta.url)),
  ) as Workflow;
  assertEquals(savesUnpopulatedDenoCache(workflow), false);
});
