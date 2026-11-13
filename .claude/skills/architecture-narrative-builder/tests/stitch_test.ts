import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { generatedNote, hasParts, partsToRemove, stitch } from "../scripts/stitch/narrative.ts";

const front = "---\ntitle: Kata narrative\nsystem: kata\nstatus: draft\n---\n";

function parts(extra: Record<string, string> = {}): Map<string, string> {
  return new Map(Object.entries({
    "00-front-matter.md": front,
    "01-setup.md": "## Act 1: Setup\n\nSetup text.\n",
    "02-confrontation.md": "## Act 2: Confrontation\n\nConfrontation text.\n",
    "03-resolution.md": "## Act 3: Resolution\n\nResolution text.\n",
    "04-assumptions.md": "## Assumptions\n\n- A1 labelled.\n",
    ...extra,
  }));
}

function stitched(files: Map<string, string>, note = true): string {
  const result = stitch("kata", files, { note });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.text;
}

function errors(files: Map<string, string>, system = "kata"): string {
  const result = stitch(system, files, { note: true });
  assert(!result.ok, "expected the stitch to fail");
  return result.errors.join("\n");
}

Deno.test("Parts_are_joined_in_act_order_with_the_note_after_the_front_matter", () => {
  const files = parts();
  // Insertion order must not matter.
  const reversed = new Map([...files].reverse());
  assertEquals(
    stitched(reversed),
    front + "\n" + generatedNote("kata") + "\n\n## Act 1: Setup\n\nSetup text.\n\n## Act 2: Confrontation\n\n" +
      "Confrontation text.\n\n## Act 3: Resolution\n\nResolution text.\n\n## Assumptions\n\n- A1 labelled.\n",
  );
});

Deno.test("Front_matter_part_may_carry_text_after_the_block", () => {
  const text = stitched(parts({ "00-front-matter.md": front + "\n# Kata\n\nIntro.\n" }));
  assert(text.startsWith(front + "\n" + generatedNote("kata") + "\n\n# Kata\n\nIntro.\n\n## Act 1"));
});

Deno.test("Without_the_note_the_front_matter_is_followed_by_the_acts", () => {
  assert(stitched(parts(), false).startsWith(front + "\n## Act 1: Setup"));
});

Deno.test("The_panel_appendix_is_stitched_last_only_when_its_part_exists", () => {
  assert(!stitched(parts()).includes("Panel"));
  const text = stitched(parts({ "05-panel.md": "## Appendix: Panel\n\nSign-offs.\n" }));
  assert(text.endsWith("- A1 labelled.\n\n## Appendix: Panel\n\nSign-offs.\n"));
});

Deno.test("Ledger_and_slides_are_never_stitched", () => {
  const text = stitched(parts({ "ledger.md": "LEDGER-SECRET\n", "slides.md": "SLIDES-SECRET\n" }));
  assert(!text.includes("LEDGER-SECRET"));
  assert(!text.includes("SLIDES-SECRET"));
});

Deno.test("An_unknown_markdown_file_is_an_error_rather_than_left_out", () => {
  assertStringIncludes(errors(parts({ "01-set-up.md": "typo\n" })), "01-set-up.md: not a narrative part");
});

Deno.test("Every_required_part_must_exist", () => {
  for (
    const name of ["00-front-matter.md", "01-setup.md", "02-confrontation.md", "03-resolution.md", "04-assumptions.md"]
  ) {
    const files = parts();
    files.delete(name);
    assertStringIncludes(errors(files), `${name}: required part missing`);
  }
});

Deno.test("The_front_matter_part_must_start_with_a_yaml_block", () => {
  assertStringIncludes(errors(parts({ "00-front-matter.md": "title: no fences\n" })), "front-matter block");
});

Deno.test("The_system_name_must_be_kebab_case", () => {
  assertStringIncludes(errors(parts(), "My_System"), "kebab-case");
});

Deno.test("A_diagram_directive_is_replaced_by_a_fenced_mermaid_block", () => {
  const text = stitched(parts({
    "03-resolution.md": "## Act 3\n\n<!-- diagram: context.mmd -->\n\nAfter.\n",
    "context.mmd": "flowchart LR\n  a --> b\n\n",
  }));
  assertStringIncludes(text, "## Act 3\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\nAfter.\n");
  assert(!text.includes("diagram:"));
});

Deno.test("Unreferenced_diagrams_are_allowed_and_not_inlined", () => {
  assert(!stitched(parts({ "unused.mmd": "flowchart LR\n  x\n" })).includes("mermaid"));
});

Deno.test("A_missing_or_out_of_directory_diagram_is_an_error", () => {
  assertStringIncludes(
    errors(parts({ "01-setup.md": "<!-- diagram: nope.mmd -->\n" })),
    'diagram "nope.mmd" not found',
  );
  for (const name of ["../x.mmd", "sub/x.mmd", "x.md"]) {
    assertStringIncludes(errors(parts({ "01-setup.md": `<!-- diagram: ${name} -->\n` })), "same directory");
  }
});

Deno.test("Line_endings_are_normalised_and_the_file_ends_in_one_newline", () => {
  const text = stitched(parts({ "01-setup.md": "## Act 1\r\n\r\nText.\r\n\r\n\r\n" }));
  assert(!text.includes("\r"));
  assert(text.endsWith("labelled.\n") && !text.endsWith("\n\n"));
});

Deno.test("Only_stitched_parts_make_a_directory_one_with_parts", () => {
  assert(hasParts(["01-setup.md"]));
  assert(!hasParts(["slides.md", "context.mmd"]));
});

Deno.test("Build_mode_removes_parts_and_ledger_but_keeps_slides_and_their_diagrams", () => {
  const files = parts({
    "05-panel.md": "p",
    "ledger.md": "l",
    "slides.md": "# Deck\n\n<!-- diagram: context.mmd -->\n",
    "context.mmd": "c",
    "detail.mmd": "d",
  });
  assertEquals(partsToRemove(files), [
    "00-front-matter.md",
    "01-setup.md",
    "02-confrontation.md",
    "03-resolution.md",
    "04-assumptions.md",
    "05-panel.md",
    "detail.mmd",
    "ledger.md",
  ]);
});
