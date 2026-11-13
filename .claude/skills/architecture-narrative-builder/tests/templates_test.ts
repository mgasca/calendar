import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { partsToRemove, stitch } from "../scripts/stitch/narrative.ts";

// The part templates the skill writes from must stitch cleanly and give the front matter the docs site accepts (#706):
// only these keys, then exactly one H1 for the whole narrative.
const templates = fromFileUrl(new URL("../references/templates/", import.meta.url));
const siteKeys = ["system", "audience", "date", "status", "slides"];

function templateFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of Deno.readDirSync(templates)) {
    files.set(entry.name, Deno.readTextFileSync(join(templates, entry.name)));
  }
  return files;
}

Deno.test("Templates_stitch_without_errors_and_inline_their_diagrams", () => {
  const result = stitch("system-name", templateFiles(), { note: true });
  assert(result.ok, result.ok ? "" : result.errors.join("\n"));
  assert(!result.text.includes("<!-- diagram:"), "every diagram directive resolves to a template .mmd file");
  assert(result.text.includes("```mermaid"));
  assert(!result.text.includes("# Ledger"), "the ledger is never stitched");
});

Deno.test("Templates_give_one_h1_and_only_the_front_matter_keys_the_site_accepts", () => {
  const result = stitch("system-name", templateFiles(), { note: true });
  assert(result.ok);
  const [, block = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(result.text) ?? [];
  const keys = block.split("\n").map((line) => line.split(":")[0]!.trim());
  assert(keys.every((key) => siteKeys.includes(key)), `unexpected front-matter keys: ${keys.join(", ")}`);
  for (const required of ["system", "audience", "date", "status"]) assert(keys.includes(required), required);
  const outsideFences = body.replace(/```[\s\S]*?```/g, "");
  assertEquals(outsideFences.split("\n").filter((line) => /^# /.test(line)).length, 1);
});

Deno.test("Every_template_part_after_the_front_matter_starts_at_h2", () => {
  for (const [name, text] of templateFiles()) {
    if (/^0[1-5]-.*\.md$/.test(name)) assert(text.startsWith("## "), `${name} must start with an H2`);
  }
});

Deno.test("The_slides_template_is_kept_by_the_build_mode", () => {
  assert(!partsToRemove(templateFiles()).includes("slides.md"));
});
