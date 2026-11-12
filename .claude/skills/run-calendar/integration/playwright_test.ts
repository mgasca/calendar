import { assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "playwright";

// Explicit feasibility check for the APIs required by the browse command protocol.
// Run `deno task browser-install`, then `deno task test-browser` from this skill.
Deno.test("Deno Playwright supports the browse protocol and authenticated browser context", async () => {
  let receivedSeedKey: string | null = null;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
    receivedSeedKey = request.headers.get("X-Dev-Seed-Key");
    return new Response(
      `<main><label>Name<input></label><select><option value="week">Week</option></select>
       <button onclick="document.querySelector('output').textContent = document.querySelector('input').value">Save</button>
       <output></output></main>`,
      { headers: { "Content-Type": "text/html" } },
    );
  });
  const out = await Deno.makeTempDir({ prefix: "deno-playwright-" });
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        extraHTTPHeaders: { "X-Dev-Seed-Key": "fixture-seed-key" },
        timezoneId: "Europe/London",
        viewport: { width: 390, height: 844 },
        colorScheme: "dark",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      // nav, wait-for, fill (label selector), press, select, click, text, count, eval, screenshot, errors.
      await page.goto(`http://127.0.0.1:${server.addr.port}/`);
      await page.locator("main").waitFor();
      await page.getByLabel("Name").fill("Deno browser");
      await page.getByLabel("Name").press("Tab");
      await page.locator("select").selectOption("week");
      await page.getByRole("button", { name: "Save" }).click();
      assertEquals(await page.locator("output").innerText(), "Deno browser");
      assertEquals(await page.locator("button").count(), 1);
      assertEquals(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Europe/London");
      assertEquals(await page.evaluate("innerWidth"), 390);
      assertEquals(await page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), true);
      const shot = `${out}/fixture.png`;
      await page.screenshot({ path: shot, fullPage: true });
      assertStringIncludes(new TextDecoder().decode((await Deno.readFile(shot)).slice(1, 4)), "PNG");
      assertEquals(receivedSeedKey, "fixture-seed-key");
      assertEquals(errors, []);
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    await server.shutdown();
    await Deno.remove(out, { recursive: true });
  }
});
