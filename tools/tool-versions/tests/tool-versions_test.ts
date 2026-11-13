import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { compareVersions, findDrift, findPins, fix, newestVersions } from "../tool-versions.ts";
function fixture(run: (root: string) => void): void {
  const root = Deno.makeTempDirSync({ prefix: "tool-versions-" });
  try {
    write(root, "tools/deno.json", { imports: { assert: "jsr:@std/assert@2.0.0", yaml: "jsr:@std/yaml@4.3.0" } });
    write(root, ".claude/skills/demo/deno.json", {
      imports: { assert: "jsr:@std/assert@1.0.0", yaml: "jsr:@std/yaml@4.3.0", extra: "npm:untracked-package@9.9.9" },
    });
    write(root, "tools/demo/tests/fixtures/deno.json", { imports: { yaml: "jsr:@std/yaml@0.0.1" } });
    run(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}
function write(root: string, path: string, config: unknown): void {
  Deno.mkdirSync(join(root, dirname(path)), { recursive: true });
  Deno.writeTextFileSync(join(root, path), JSON.stringify(config, null, 2) + "\n");
}
const drifts = (root: string) => findDrift(findPins(root));
Deno.test("NewestVersions_TakesTheHighestPin", () =>
  fixture((root) => {
    const newest = newestVersions(findPins(root));
    assertEquals(newest.get("jsr:@std/assert"), "2.0.0");
    assertEquals(newest.get("jsr:@std/yaml"), "4.3.0");
    assertEquals(newest.get("npm:untracked-package"), "9.9.9");
  }));
for (
  const [newer, older] of [["4.10.0", "4.9.0"], ["10.35.0.4138", "10.35.0"], ["4.0.3", "4.0.3-pre.1"], [
    "4.0.3-pre.2",
    "4.0.3-pre.1",
  ], ["2.0.0", "1.99.99"]]
) {
  Deno.test(`VersionOrder_ComparesPartsAsNumbers_AndAReleaseAfterItsPrereleases: ${newer}`, () => {
    assert(compareVersions(newer!, older!) > 0);
    assert(compareVersions(older!, newer!) < 0);
    assertEquals(compareVersions(newer!, newer!), 0);
  });
}
Deno.test("FindPins_ReadsDenoImports_AndSkipsFixtures", () =>
  fixture((root) => {
    const pins = findPins(root);
    assertEquals(pins.length, 5);
    assertEquals(pins.filter((p) => p.package === "jsr:@std/assert").map((p) => [p.version, p.file]), [[
      "1.0.0",
      ".claude/skills/demo/deno.json",
    ], ["2.0.0", "tools/deno.json"]]);
    assert(!pins.some((p) => p.version === "0.0.1"));
  }));
Deno.test("FindDrift_ReportsOnlyPinsBehindTheNewestPinOfTheirPackage", () =>
  fixture((root) => {
    const list = drifts(root);
    assertEquals(list.length, 1);
    assertEquals([list[0]!.pin.package, list[0]!.expectedVersion, list[0]!.pin.file], [
      "jsr:@std/assert",
      "2.0.0",
      ".claude/skills/demo/deno.json",
    ]);
  }));
Deno.test("Fix_UpdatesImports_ThenNoDriftRemains", () =>
  fixture((root) => {
    write(root, ".claude/skills/demo/deno.json", {
      imports: { assert: "jsr:@std/assert@1.0.0", yaml: "jsr:@std/yaml@4.0.0" },
    });
    assertEquals(fix(root, drifts(root)).changed, 2);
    assertEquals(drifts(root), []);
    const text = Deno.readTextFileSync(join(root, ".claude/skills/demo/deno.json"));
    assertStringIncludes(text, "jsr:@std/assert@2.0.0");
    assertStringIncludes(text, "jsr:@std/yaml@4.3.0");
  }));
Deno.test("Fix_LeavesOtherContentUntouched", () =>
  fixture((root) => {
    const path = join(root, ".claude/skills/demo/deno.json"), before = Deno.readTextFileSync(path);
    fix(root, drifts(root));
    assertEquals(Deno.readTextFileSync(path), before.replace("jsr:@std/assert@1.0.0", "jsr:@std/assert@2.0.0"));
  }));
Deno.test("FindPins_DistinguishesRegistriesAndSubpathImports", () =>
  fixture((root) => {
    write(root, "tools/deno.json", {
      imports: { a: "jsr:@std/assert@1.0.0/assert-equals", b: "npm:@std/assert@8.0.0" },
    });
    assertEquals(newestVersions(findPins(root)).get("jsr:@std/assert"), "1.0.0");
    assertEquals(drifts(root), []);
  }));
Deno.test("FindPins_RejectsFloatingVersionPins", () =>
  fixture((root) => {
    write(root, "tools/deno.json", { imports: { a: "jsr:@std/assert@^1.0.0" } });
    assertThrows(() => findPins(root), Error, "exact package version");
  }));
Deno.test("FindPins_AndFix_IncludeExecutableTaskDependencies", () =>
  fixture((root) => {
    write(root, "tools/deno.json", {
      imports: { browser: "npm:playwright@1.65.0" },
      tasks: { install: "deno run -A npm:playwright@1.64.0 install chromium" },
    });
    const list = drifts(root);
    assertEquals(list.length, 1);
    assertEquals(list[0]!.pin.alias, "task:install");
    assertEquals(fix(root, list).changed, 1);
    assertEquals(drifts(root), []);
    assertStringIncludes(
      Deno.readTextFileSync(join(root, "tools/deno.json")),
      "npm:playwright@1.65.0 install chromium",
    );
  }));
Deno.test("FindPins_UsesCaseSensitiveRegistryPackageNames", () =>
  fixture((root) => {
    // NuGet package names were case-insensitive. Registry specifiers are identities, so do not merge distinct names.
    write(root, "tools/deno.json", { imports: { first: "npm:Example@1.0.0", second: "npm:example@2.0.0" } });
    assertEquals(newestVersions(findPins(root)).get("npm:Example"), "1.0.0");
    assertEquals(newestVersions(findPins(root)).get("npm:example"), "2.0.0");
  }));

Deno.test("CLI_fix_refreshes_each_affected_lockfile_and_reports_remaining_drift", async () => {
  const root = Deno.makeTempDirSync({ prefix: "tool-versions-cli-" });
  const script = fromFileUrl(new URL("../tool-versions.ts", import.meta.url));
  const config = resolve(dirname(script), "../deno.json");
  try {
    write(root, "tools/deno.json", { imports: { assert: "jsr:@std/assert@1.0.19" } });
    write(root, ".claude/skills/demo/deno.json", { imports: { assert: "jsr:@std/assert@1.0.18" } });
    const command = async (args: string[]) => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          config,
          "--cached-only",
          "--no-prompt",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          script,
          "--root",
          root,
          ...args,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
      };
    };
    assertEquals((await command([])).code, 1);
    const fixed = await command(["--fix"]);
    assertEquals(fixed.code, 0, fixed.stderr);
    assertStringIncludes(fixed.stdout, "Updated 1 pin(s) and refreshed affected deno.lock files.");
    const lock = JSON.parse(Deno.readTextFileSync(join(root, ".claude/skills/demo/deno.lock")));
    assertEquals(lock.specifiers["jsr:@std/assert@1.0.19"], "1.0.19");
    assertEquals((await command([])).code, 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
