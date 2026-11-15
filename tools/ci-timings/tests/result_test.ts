import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
// Runs .github/ci-result.jq, the jobs API check of `CI result` (story 0066), on canned reads of the jobs API. `jq`
// missing fails these tests rather than skipping them, as in gate_test.ts.
const root = fromFileUrl(new URL("../../../", import.meta.url));
function job(name: string, status = "completed", conclusion: string | null = "success") {
  return { name, status, conclusion };
}
async function classify(read: unknown, waited: number, skipped: string[] = [], limit?: number) {
  const dir = await Deno.makeTempDir({ prefix: "ci-result-tests-" });
  try {
    const path = join(dir, "read.json");
    await Deno.writeTextFile(path, JSON.stringify(read));
    const args = ["-r", "-f", join(root, ".github/ci-result.jq"), "--argjson", "skipped", JSON.stringify(skipped)];
    args.push(
      "--argjson",
      "waited",
      String(waited),
      ...(limit === undefined ? [] : ["--argjson", "limit", `${limit}`]),
    );
    const result = await new Deno.Command("jq", { args: [...args, path], stdout: "piped", stderr: "piped" }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const [verdict, ...lines] = new TextDecoder().decode(result.stdout).trimEnd().split("\n");
    return { verdict, lines };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
const finished = [job("Changes"), job("Backend"), job("Docs site"), job("CI result", "in_progress", null)];
Deno.test("EveryJobSucceeded_Passes_AndIgnoresCiResultAndTheCancelJob", async () => {
  const read = { jobs: [...finished, job("Cancel superseded runs", "completed", "failure")] };
  assertEquals(await classify(read, 0), { verdict: "pass", lines: [] });
});
Deno.test("ANeededJobStillShownAsRunning_Waits_AfterFifteenSeconds", async () => {
  // Run 43474865497: Backend had finished, but the API still showed it in_progress after the old 10 s window.
  const read = { jobs: [job("Changes"), job("Backend", "in_progress", null), job("Docs site")] };
  const r = await classify(read, 15);
  assertEquals(r.verdict, "wait");
  assertEquals(r.lines.at(-1), "Backend: in_progress null");
});
Deno.test("AJobQueuedOrRunningJustBeforeTheLimit_Waits", async () => {
  for (const status of ["queued", "in_progress", "waiting"]) {
    assertEquals((await classify({ jobs: [job("Backend", status, null)] }, 119)).verdict, "wait", status);
  }
});
Deno.test("AJobStillShownAsRunningAtTheLimit_Fails_SayingTheApiHadNotCaughtUp", async () => {
  const r = await classify({ jobs: [job("Changes"), job("Backend", "in_progress", null)] }, 120);
  assertEquals(r.verdict, "fail");
  assertStringIncludes(r.lines[0] ?? "", "::error::The jobs API had not caught up: 120 s");
  assertStringIncludes(r.lines[0] ?? "", "Rerun this job");
  assertEquals(r.lines.slice(1), ["Backend: in_progress null"]);
});
Deno.test("TheLimit_IsAnArgument", async () => {
  const read = { jobs: [job("Backend", "in_progress", null)] };
  assertEquals((await classify(read, 30, [], 30)).verdict, "fail");
  assertEquals((await classify(read, 29, [], 30)).verdict, "wait");
});
Deno.test("ACompletedJobThatDidNotSucceed_FailsAtOnce_EvenWhileAnotherIsPending", async () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "action_required"]) {
    const read = { jobs: [job("Changes"), job("Backend", "completed", conclusion), job("Docs site", "queued", null)] };
    const r = await classify(read, 0);
    assertEquals(r.verdict, "fail", conclusion);
    assertEquals(r.lines, [
      "::error::The jobs API reports jobs that did not succeed:",
      `Backend: completed ${conclusion}`,
    ]);
  }
});
Deno.test("ASkipTheChangesJobIntended_Passes_AndAnyOtherSkipFails", async () => {
  const read = { jobs: [job("Changes"), job("Backend", "completed", "skipped"), job("Docs site")] };
  assertEquals((await classify(read, 0, ["Backend"])).verdict, "pass");
  const r = await classify(read, 0, ["Docs site"]);
  assertEquals(r.verdict, "fail");
  assertEquals(r.lines.at(-1), "Backend: completed skipped");
});
Deno.test("AnUnreadableApi_WaitsUntilTheLimit_ThenFails", async () => {
  for (const read of [{}, { message: "Server Error" }]) {
    assertEquals((await classify(read, 60)).verdict, "wait");
    const r = await classify(read, 120);
    assertEquals(r, { verdict: "fail", lines: ["::error::The jobs API could not be read for 120 s."] });
  }
});
Deno.test("TheWorkflow_RunsThisFileOnEachRead_AndKeepsTheLastGoodReadForTheRunTimeGate", async () => {
  const workflow = await Deno.readTextFile(join(root, ".github/workflows/ci.yml")),
    result = workflow.slice(workflow.indexOf("\n  result:\n"));
  for (
    const text of [
      "sparse-checkout: .github",
      'jq -r -f .github/ci-result.jq --argjson skipped "$SKIPPED" --argjson waited "$SECONDS" "$RUNNER_TEMP/read.json"',
      'cp "$RUNNER_TEMP/read.json" "$RUNNER_TEMP/jobs.json"',
      "pass) break",
      "wait) ",
      "sleep 5",
    ]
  ) assertStringIncludes(result, text);
  assert(result.indexOf("ci-result.jq") < result.indexOf("All CI jobs passed."));
  assert(result.indexOf("All CI jobs passed.") < result.indexOf("ci-gate.jq"));
});
