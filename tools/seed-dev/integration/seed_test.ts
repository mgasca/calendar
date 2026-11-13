import { assertEquals, assertStringIncludes } from "@std/assert";
import { build } from "../seed-plan.ts";
import { fileURLToPath } from "node:url";
Deno.test("seed CLI sends the complete plan, authenticates and completes only the marked task", async () => {
  const requests: { path: string; key: string | null; body: unknown }[] = [];
  const id = "00000000-0000-0000-0000-000000000001";
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
    const path = new URL(request.url).pathname;
    requests.push({ path, key: request.headers.get("X-Dev-Seed-Key"), body: request.method === "GET" || path.endsWith("/complete") ? null : await request.json() });
    return Response.json({ id });
  });
  try {
    const url = `http://127.0.0.1:${server.addr.port}`;
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--config", fileURLToPath(new URL("../../deno.json", import.meta.url)), "--frozen", "--allow-net=127.0.0.1", "--allow-env",
        fileURLToPath(new URL("../seed-dev.ts", import.meta.url)), "--seed-key", "fixture-key", "--api-url", url, "--date", "2026-10-26", "--time-zone", "Europe/Berlin"],
      stdout: "piped", stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const plan = build("2026-10-26", "Europe/Berlin");
    const expected = [
      { path: "/api/health", key: "fixture-key", body: null },
      ...plan.events.map((body) => ({ path: "/api/events", key: "fixture-key", body })),
      ...plan.tasks.flatMap((task) => [
        { path: "/api/tasks", key: "fixture-key", body: { ...task, completeAfterCreate: false } },
        ...(task.completeAfterCreate ? [{ path: `/api/tasks/${id}/complete`, key: "fixture-key", body: null }] : []),
      ]),
    ];
    assertEquals(requests, expected);
    const output = new TextDecoder().decode(result.stdout);
    assertStringIncludes(output, `Seeding 2026-10-26 in Europe/Berlin via ${url}`);
    assertStringIncludes(output, "Submit expense report (overdue, completed) (completed)");
    assertStringIncludes(output, `Done. Check: ${url}/api/agenda/day?date=2026-10-26&timeZone=Europe%2FBerlin`);
  } finally { await server.shutdown(); }
});
