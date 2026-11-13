import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { main } from "../scripts/stitch/stitch.ts";

const fixture = fromFileUrl(new URL("./fixtures/kata", import.meta.url));

/** A temporary repository root with docs/narratives/kata/ copied from the fixture. */
function repo(): { root: string; narratives: string; dir: string } {
  const root = Deno.makeTempDirSync({ prefix: "narrative-stitch-" });
  const narratives = join(root, "docs", "narratives"), dir = join(narratives, "kata");
  Deno.mkdirSync(dir, { recursive: true });
  for (const entry of Deno.readDirSync(fixture)) Deno.copyFileSync(join(fixture, entry.name), join(dir, entry.name));
  return { root, narratives, dir };
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Runs main with console.error captured. */
function run(args: string[]): { code: number; stderr: string } {
  const lines: string[] = [], error = console.error, log = console.log;
  console.error = (...data: unknown[]) => lines.push(data.join(" "));
  console.log = () => {};
  try {
    return { code: main(args), stderr: lines.join("\n") };
  } finally {
    console.error = error;
    console.log = log;
  }
}

Deno.test("Stitch_writes_the_narrative_and_check_then_passes", () => {
  const { root, narratives } = repo();
  try {
    assertEquals(run(["--root", root]).code, 0);
    const text = Deno.readTextFileSync(join(narratives, "kata-narrative.md"));
    assertStringIncludes(text, "```mermaid\nflowchart LR");
    assertStringIncludes(text, "<!-- Generated from docs/narratives/kata/");
    assert(!text.includes("Gap ledger"));
    assertEquals(run(["--root", root, "--check"]).code, 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Check_fails_when_the_published_file_is_edited_by_hand", () => {
  const { root, narratives } = repo();
  try {
    run(["--root", root]);
    const output = join(narratives, "kata-narrative.md");
    Deno.writeTextFileSync(output, Deno.readTextFileSync(output).replace("Setup text.", "Edited in place."));
    const result = run(["--root", root, "--check"]);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "kata-narrative.md differs from its parts");
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Check_fails_when_a_part_is_edited_without_restitching", () => {
  const { root, dir } = repo();
  try {
    run(["--root", root]);
    Deno.writeTextFileSync(join(dir, "02-confrontation.md"), "## Act 2\n\nChanged.\n");
    assertEquals(run(["--root", root, "--check"]).code, 1);
    assertEquals(run(["--root", root, "kata"]).code, 0);
    assertEquals(run(["--root", root, "--check"]).code, 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Check_fails_when_the_published_file_is_missing", () => {
  const { root } = repo();
  try {
    const result = run(["--root", root, "--check"]);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "kata-narrative.md is missing");
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Check_fails_on_an_invalid_part_directory", () => {
  const { root, dir } = repo();
  try {
    run(["--root", root]);
    Deno.removeSync(join(dir, "04-assumptions.md"));
    const result = run(["--root", root, "--check"]);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "docs/narratives/kata/04-assumptions.md: required part missing");
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Check_skips_single_file_narratives_and_directories_without_parts", () => {
  const { root, narratives, dir } = repo();
  try {
    Deno.removeSync(dir, { recursive: true });
    Deno.writeTextFileSync(join(narratives, "kata-narrative.md"), "---\ntitle: x\n---\n\nHand written.\n");
    Deno.mkdirSync(join(narratives, "deck-only"));
    Deno.writeTextFileSync(join(narratives, "deck-only", "slides.md"), "# Deck\n");
    assertEquals(run(["--root", root, "--check"]).code, 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Check_passes_when_there_are_no_narratives", () => {
  const root = Deno.makeTempDirSync({ prefix: "narrative-stitch-" });
  try {
    assertEquals(run(["--root", root, "--check"]).code, 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Remove_parts_leaves_a_plain_narrative_and_the_deck_source", () => {
  const { root, narratives, dir } = repo();
  try {
    assertEquals(run(["--root", root, "--remove-parts", "kata"]).code, 0);
    const text = Deno.readTextFileSync(join(narratives, "kata-narrative.md"));
    assert(!text.includes("Generated from"), "a narrative without parts carries no generated note");
    assertStringIncludes(text, "```mermaid");
    assertEquals([...Deno.readDirSync(dir)].map((e) => e.name).sort(), ["context.mmd", "slides.md"]);
    assertEquals(run(["--root", root, "--check"]).code, 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Remove_parts_deletes_the_directory_when_nothing_is_kept", () => {
  const { root, dir } = repo();
  try {
    Deno.removeSync(join(dir, "slides.md"));
    assertEquals(run(["--root", root, "--remove-parts", "kata"]).code, 0);
    assert(!exists(dir));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Remove_parts_keeps_everything_when_the_stitch_fails", () => {
  const { root, dir } = repo();
  try {
    Deno.removeSync(join(dir, "01-setup.md"));
    assertEquals(run(["--root", root, "--remove-parts", "kata"]).code, 1);
    assert(exists(join(dir, "ledger.md")));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Usage_errors_exit_2", () => {
  const { root } = repo();
  try {
    assertEquals(run(["--root", root, "--bogus"]).code, 2);
    assertEquals(run(["--root", root, "--check", "kata"]).code, 2);
    assertEquals(run(["--root", root, "missing-system"]).code, 2);
    assertEquals(run(["--root", root, "../escape"]).code, 2);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
