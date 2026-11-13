import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

Deno.test("Copied_skill_runs_independently_and_preserves_CLI_modes", async () => {
  const root = Deno.makeTempDirSync({ prefix: "adr-portable-" });
  try {
    const skill = join(root, "skill"), decisions = join(root, "decisions");
    Deno.mkdirSync(join(skill, "scripts/check-adr"), { recursive: true });
    Deno.mkdirSync(decisions);
    const source = new URL("../", import.meta.url);
    for (
      const file of ["deno.json", "deno.lock", "scripts/check-adr/check-adr.ts", "scripts/check-adr/adr-validator.ts"]
    ) {
      Deno.copyFileSync(fromFileUrl(new URL(file, source)), join(skill, file));
    }
    for (const entry of Deno.readDirSync(new URL("./fixtures/valid", import.meta.url))) {
      Deno.copyFileSync(
        fromFileUrl(new URL(`./fixtures/valid/${entry.name}`, import.meta.url)),
        join(decisions, entry.name),
      );
    }
    const run = async (args: string[]) => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          join(skill, "deno.json"),
          "--frozen",
          "--cached-only",
          "--no-prompt",
          "--allow-read",
          "--allow-write",
          "--allow-run=git",
          join(skill, "scripts/check-adr/check-adr.ts"),
          "--dir",
          decisions,
          ...args,
        ],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
      };
    };
    assertEquals(await run(["--next-number"]), { code: 0, stdout: "0002\n", stderr: "" });
    const valid = await run([]);
    assertEquals(valid.code, 0, valid.stderr);
    assertEquals(valid.stdout, "OK   0000-first-decision.md\nOK   0001-second-decision.md\n");
    const listed = await run(["--inventory"]);
    assertEquals(listed.code, 0, listed.stderr);
    const records = JSON.parse(listed.stdout);
    assertEquals(records.length, 2);
    assertEquals(records[0].model, null);
    assertStringIncludes(listed.stderr, "firstOnMain omitted: git or origin/main is not available");
    assertEquals((await run(["--unknown"])).code, 2);
    assertEquals((await run(["--model", join(root, "absent.json")])).code, 2);
    assertEquals((await run(["--stories", join(root, "absent")])).code, 2);
    const path = join(decisions, "0000-first-decision.md"), text = Deno.readTextFileSync(path);
    Deno.writeTextFileSync(path, text.replace("[ADR-0001](0001-second-decision.md)", "ADR-0001"));
    assertEquals((await run([])).code, 1);
    const fixed = await run(["--fix-links", path]);
    assertEquals(fixed.code, 0, fixed.stderr);
    assertEquals(fixed.stdout, "0000-first-decision.md: linked 1 reference(s)\nOK   0000-first-decision.md\n");
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
