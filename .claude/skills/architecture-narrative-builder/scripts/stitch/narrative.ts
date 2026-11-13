// Stitch rules for docs/narratives/<system>/ part directories (ADR-0059, story 0063).
// Pure functions over a directory listing, so the tests need no filesystem; stitch.ts does the reading and writing.

/** The parts in stitch order. 00 to 04 are required; 05-panel is stitched when it exists. */
export const requiredParts = [
  "00-front-matter.md",
  "01-setup.md",
  "02-confrontation.md",
  "03-resolution.md",
  "04-assumptions.md",
] as const;
export const panelPart = "05-panel.md";
export const stitchedParts: readonly string[] = [...requiredParts, panelPart];

/** Files in a part directory that are never stitched. */
export const unstitchedFiles: readonly string[] = ["ledger.md", "slides.md"];

const systemPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const diagramLine = /^<!--\s*diagram:\s*(\S+)\s*-->$/;
const frontMatter = /^---\n[\s\S]*?\n---(\n|$)/;

/** A part directory as text files by name (only `.md` and `.mmd` files matter). */
export type PartFiles = ReadonlyMap<string, string>;

export type StitchResult = { ok: true; text: string } | { ok: false; errors: string[] };

export function isSystemName(name: string): boolean {
  return systemPattern.test(name);
}

/** The published file for a system, relative to docs/narratives. */
export function outputName(system: string): string {
  return `${system}-narrative.md`;
}

/** Whether a directory listing holds narrative parts (a directory with only slides.md or diagrams does not). */
export function hasParts(names: Iterable<string>): boolean {
  for (const name of names) if (stitchedParts.includes(name)) return true;
  return false;
}

export function generatedNote(system: string): string {
  return `<!-- Generated from docs/narratives/${system}/ by the architecture-narrative-builder stitcher. ` +
    `Edit the parts and restitch; just check fails when this file differs from its parts. -->`;
}

function normalise(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Replaces each diagram directive line with a fenced Mermaid block holding the referenced file. */
function inlineDiagrams(part: string, text: string, files: PartFiles, errors: string[]): string {
  return text.split("\n").map((line) => {
    const match = diagramLine.exec(line.trim());
    if (!match) return line;
    const name = match[1]!;
    if (!name.endsWith(".mmd") || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
      errors.push(`${part}: diagram "${name}" must be a .mmd file in the same directory`);
      return line;
    }
    const diagram = files.get(name);
    if (diagram === undefined) {
      errors.push(`${part}: diagram "${name}" not found`);
      return line;
    }
    return "```mermaid\n" + normalise(diagram).trim() + "\n```";
  }).join("\n");
}

/**
 * Stitches a system's parts into its published narrative.
 * `note` adds the generated-file comment after the front matter; the build mode omits it, because it removes the parts.
 */
export function stitch(system: string, files: PartFiles, options: { note: boolean }): StitchResult {
  const errors: string[] = [];
  if (!isSystemName(system)) errors.push(`system "${system}" is not a kebab-case name`);
  for (const name of files.keys()) {
    if (name.endsWith(".md") && !stitchedParts.includes(name) && !unstitchedFiles.includes(name)) {
      errors.push(`${name}: not a narrative part (expected ${[...stitchedParts, ...unstitchedFiles].join(", ")})`);
    }
  }
  for (const name of requiredParts) {
    if (!files.has(name)) errors.push(`${name}: required part missing`);
  }
  const parts = stitchedParts.filter((name) => files.has(name));
  const bodies = parts.map((name) => inlineDiagrams(name, normalise(files.get(name)!), files, errors).trim());
  const head = bodies[0];
  if (head !== undefined && files.has(requiredParts[0])) {
    const match = frontMatter.exec(head + "\n");
    if (!match) errors.push(`${requiredParts[0]}: must start with a YAML front-matter block between --- lines`);
    else if (options.note) {
      const block = match[0].trimEnd();
      bodies[0] = [block, generatedNote(system), head.slice(block.length).trim()].filter((s) => s !== "").join("\n\n");
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, text: bodies.filter((b) => b !== "").join("\n\n") + "\n" };
}

/** The `.mmd` files that slides.md references with diagram directives; the build mode keeps them. */
export function slideDiagrams(files: PartFiles): Set<string> {
  const slides = files.get("slides.md");
  const keep = new Set<string>();
  if (slides === undefined) return keep;
  for (const line of normalise(slides).split("\n")) {
    const match = diagramLine.exec(line.trim());
    if (match) keep.add(match[1]!);
  }
  return keep;
}

/** The files the build mode removes after stitching: everything but slides.md and the diagrams it uses. */
export function partsToRemove(files: PartFiles): string[] {
  const keep = slideDiagrams(files);
  return [...files.keys()].filter((name) =>
    stitchedParts.includes(name) || name === "ledger.md" || (name.endsWith(".mmd") && !keep.has(name))
  ).sort();
}
