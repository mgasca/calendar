import { chromium } from "playwright";
import { resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { stdin } from "node:process";
import { fileURLToPath } from "node:url";
import config from "../../deno.json" with { type: "json" };
import { parse } from "./script.ts";
import { formatEvaluation } from "./evaluation.ts";

export async function main(args: string[]): Promise<number> {
  let baseURL = "http://127.0.0.1:55173";
  let seedKey = Deno.env.get("Auth__DevSeedKey") ??
    "local-development-seed-key-change-me-123456";
  let outDir = resolve(tmpdir(), "calendar-shots");
  let timezoneId = "UTC";
  let width = 1280;
  let height = 900;
  let colorScheme: "light" | "dark" | "no-preference" = "no-preference";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--install") {
      // Use the npm entry point so Deno preserves npm dependency resolution.
      const cli = config.imports.playwright;
      return (await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          fileURLToPath(new URL("../../deno.json", import.meta.url)),
          "--frozen",
          "--no-prompt",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          "--allow-sys",
          "--allow-net",
          cli,
          "install",
          "chromium",
        ],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn().status).code;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(
        "usage: browse [--install] [--base-url URL] [--out DIR] [--time-zone ZONE] [--viewport WxH] [--color-scheme light|dark] [--seed-key KEY] < script",
      );
      return 0;
    }
    const value = args[i + 1];
    if (
      value === undefined ||
      ![
        "--base-url",
        "--seed-key",
        "--out",
        "--time-zone",
        "--viewport",
        "--color-scheme",
      ].includes(arg ?? "")
    ) {
      console.error(`unknown option: ${arg}`);
      return 2;
    }
    i++;
    switch (arg) {
      case "--base-url":
        baseURL = value;
        break;
      case "--seed-key":
        seedKey = value;
        break;
      case "--out":
        outDir = value;
        break;
      case "--time-zone":
        timezoneId = value;
        break;
      case "--color-scheme":
        colorScheme = value === "light" || value === "dark" ? value : "no-preference";
        break;
      case "--viewport": {
        const size = value.split("x");
        const integer = (x: string | undefined) =>
          x !== undefined && /^\s*[+-]?\d+\s*$/.test(x) &&
          Number(x) >= -2147483648 && Number(x) <= 2147483647;
        if (size.length !== 2 || !integer(size[0]) || !integer(size[1])) {
          console.error("--viewport takes WIDTHxHEIGHT, for example 390x844");
          return 2;
        }
        width = Number(size[0]);
        height = Number(size[1]);
        break;
      }
    }
  }
  const libs = resolve(
    homedir(),
    ".cache/calendar-chromium-libs/usr/lib/x86_64-linux-gnu",
  );
  try {
    if (Deno.statSync(libs).isDirectory) {
      const current = Deno.env.get("LD_LIBRARY_PATH");
      Deno.env.set("LD_LIBRARY_PATH", current ? `${libs}:${current}` : libs);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  await Deno.mkdir(outDir, { recursive: true });
  const problems: string[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      baseURL,
      timezoneId,
      locale: "en-GB",
      viewport: { width, height },
      colorScheme,
      extraHTTPHeaders: { "X-Dev-Seed-Key": seedKey },
    });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        problems.push(`console: ${message.text()}`);
      }
    });
    page.on(
      "pageerror",
      (error) => problems.push(`page error: ${error.message}`),
    );
    page.on("response", (response) => {
      if (response.status() >= 400) {
        problems.push(
          `HTTP ${response.status()} ${response.request().method()} ${response.url()}`,
        );
      }
    });
    const find = (selector: string) =>
      selector.startsWith("label=") ? page.getByLabel(selector.slice(6)) : page.locator(selector);
    let shot = 0;
    let lineNumber = 0;
    for await (
      const line of createInterface({ input: stdin, crlfDelay: Infinity })
    ) {
      lineNumber++;
      const step = parse(line);
      if (step === null) continue;
      const trimmed = line.trim();
      console.log(`> ${trimmed}`);
      const { name: command, target, rest } = step;
      try {
        switch (command) {
          case "nav":
            await page.goto(target);
            break;
          case "wait-for":
            await find(target).first().waitFor({ state: "visible" });
            break;
          case "click":
            await find(target).first().click();
            break;
          case "fill":
            await find(target).first().fill(rest);
            break;
          case "press":
            await page.keyboard.press(target);
            break;
          case "select":
            await find(target).first().selectOption(rest);
            break;
          case "text":
            console.log(await find(target || "main").first().innerText());
            break;
          case "count":
            console.log(await find(target).count());
            break;
          case "eval": {
            const value: unknown = await page.evaluate(target);
            console.log(formatEvaluation(value));
            break;
          }
          case "screenshot": {
            shot++;
            const path = resolve(
              outDir,
              `${target || `shot-${String(shot).padStart(2, "0")}`}.png`,
            );
            await page.screenshot({ path, fullPage: true });
            console.log(path);
            break;
          }
          case "errors":
            console.log(
              problems.length === 0 ? "no errors" : problems.join("\n"),
            );
            break;
          default:
            console.error(`line ${lineNumber}: unknown command '${command}'`);
            return 2;
        }
      } catch (e) {
        const failure = resolve(outDir, "failure.png");
        await page.screenshot({ path: failure, fullPage: true });
        console.error(
          `line ${lineNumber}: ${trimmed}\n${e instanceof Error ? e.message : String(e)}\nscreenshot: ${failure}`,
        );
        if (problems.length > 0) console.error(problems.join("\n"));
        return 1;
      }
    }
    return 0;
  } finally {
    await browser.close();
  }
}
if (import.meta.main) Deno.exit(await main(Deno.args));
