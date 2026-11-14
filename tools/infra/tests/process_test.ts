import { assert, assertEquals, assertRejects } from "@std/assert";
import { execute } from "../process.ts";

Deno.test("cancellation terminates the subprocess group and does not return captured output", async () => {
  const dir = await Deno.makeTempDir({ prefix: "infra-cancel-" });
  const marker = `${dir}/child.pid`;
  const controller = new AbortController();
  try {
    const execution = execute("/bin/sh", ["-c", 'sleep 30 & echo "$!" > "$1"; wait', "fixture", marker], {
      signal: controller.signal,
    });
    const deadline = Date.now() + 5000;
    let pid: number | undefined;
    while (Date.now() < deadline) {
      try {
        pid = Number(await Deno.readTextFile(marker));
        break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert(pid && Number.isInteger(pid), "fixture child must start");
    controller.abort();
    await assertRejects(() => execution, DOMException);
    let running = true;
    for (let i = 0; i < 50; i++) {
      const status = await new Deno.Command("ps", { args: ["-o", "stat=", "-p", String(pid)], stdout: "piped" })
        .output();
      running = status.success && !new TextDecoder().decode(status.stdout).trim().startsWith("Z");
      if (!running) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assertEquals(running, false, "cancelled subprocess must not continue running");
  } finally {
    controller.abort();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("subprocess stderr is never returned alongside a failing exit", async () => {
  const result = await execute("/bin/sh", ["-c", "printf safe; printf secret-to-stderr >&2; exit 9"]);
  assertEquals(result, { code: 9, output: "safe" });
});
