import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("browser CLI executes the script protocol, reports errors and exits on unknown commands", async () => {
  let receivedKey: string | null = null;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
    receivedKey = request.headers.get("X-Dev-Seed-Key");
    if (new URL(request.url).pathname === "/missing") return new Response("missing", { status: 404 });
    return new Response(`<main><label>Task title<input></label><label>Priority<select><option value="low">Low</option></select></label>
      <button onclick="document.querySelector('output').textContent = document.querySelector('input').value">Save</button><output></output></main>`,
      { headers: { "Content-Type": "text/html" } });
  });
  const out = await Deno.makeTempDir({ prefix: "browse-driver-" });
  const driver = fileURLToPath(new URL("../scripts/browse/browse.ts", import.meta.url));
  const config = fileURLToPath(new URL("../deno.json", import.meta.url));
  async function run(script: string) {
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--config", config, "--frozen", "-A", driver, "--base-url", `http://127.0.0.1:${server.addr.port}`,
        "--out", out, "--seed-key", "driver-fixture-key", "--time-zone", "Europe/London", "--viewport", "390x844", "--color-scheme", "dark"],
      stdin: "piped", stdout: "piped", stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(script));
    await writer.close();
    const result = await child.output();
    return { code: result.code, stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr) };
  }
  try {
    const result = await run(`# comment\nnav /\nwait-for main\nfill 'label=Task title' Buy milk\npress Tab\nselect label=Priority low\nclick text=Save\ntext output\ncount button\neval innerWidth\neval Intl.DateTimeFormat().resolvedOptions().timeZone\neval matchMedia('(prefers-color-scheme: dark)').matches\nscreenshot\nerrors\n`);
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "Buy milk\n> count button\n1\n");
    assertStringIncludes(result.stdout, "\n390\n");
    assertStringIncludes(result.stdout, "\nEurope/London\n");
    assertStringIncludes(result.stdout, "\nTrue\n");
    assertStringIncludes(result.stdout, "no errors\n");
    assertEquals(receivedKey, "driver-fixture-key");
    assertEquals(Array.from((await Deno.readFile(`${out}/shot-01.png`)).slice(0, 4)), [137, 80, 78, 71]);
    const unknown = await run("nav /\nbogus selector\ntext main\n");
    assertEquals(unknown.code, 2);
    assertStringIncludes(unknown.stderr, "line 2: unknown command 'bogus'");
    assertEquals(unknown.stdout.includes("> text main"), false);
    const failed = await run("nav /\nclick 'bad[selector'\ntext main\n");
    assertEquals(failed.code, 1);
    assertStringIncludes(failed.stderr, "line 2: click 'bad[selector'");
    assertStringIncludes(failed.stderr, "failure.png");
    assertEquals(Array.from((await Deno.readFile(`${out}/failure.png`)).slice(0, 4)), [137, 80, 78, 71]);
    const errors = await run("nav /\neval console.error('fixture error')\neval fetch('/missing')\nwait-for main\nerrors\n");
    assertEquals(errors.code, 0, errors.stderr);
    assertStringIncludes(errors.stdout, "console: fixture error");
    assertStringIncludes(errors.stdout, "HTTP 404 GET");
  } finally {
    await server.shutdown();
    await Deno.remove(out, { recursive: true });
  }
});
