import { assertEquals } from "@std/assert";

Deno.test("changing the Deno runtime pin schedules tooling checks", async () => {
  const root = new URL("../../../", import.meta.url);
  const child = new Deno.Command("jq", {
    args: ["-c", "-f", new URL(".github/ci-changes.jq", root).pathname],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify({
    event: "pull_request",
    complete: true,
    files: [".deno-version"],
  })));
  await writer.close();
  const result = await child.output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  assertEquals(JSON.parse(new TextDecoder().decode(result.stdout)).tooling, true);
});
