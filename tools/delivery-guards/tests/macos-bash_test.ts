// The Native job's macOS row runs `just native run …` under macOS's bash 3.2, which treats an empty array as unset
// under `set -u`, so a bare "${a[@]}" of an empty array aborts the recipe before anything runs (#1009). Linux and Git
// Bash on Windows are bash 5 and never show it, so this checks the text: in the recipes that row runs, every array a
// recipe starts empty expands through ${a[@]+"${a[@]}"}.
import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { findRoot } from "../delivery-guards.ts";

const root = findRoot(dirname(fromFileUrl(import.meta.url)))!;
/** The recipe files the macOS and Windows rows run: `just native run …` is just/run.just imported by native/mod.just. */
export const macosRecipeFiles = ["just/run.just", "native/mod.just"];

/** Each bare "${a[@]}" of an array that the text assigns `a=()`, as `file:line: a`. */
export function unguardedEmptyArrays(file: string, text: string): string[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n"),
    empty = new Set([...text.matchAll(/(?:^|[\s;])([A-Za-z_]\w*)=\(\)/gm)].map((m) => m[1]!)),
    found: string[] = [];
  lines.forEach((line, i) => {
    const unguarded = line.replace(/\$\{(\w+)\[@\]\+"\$\{\1\[@\]\}"\}/g, "");
    for (const m of unguarded.matchAll(/"\$\{(\w+)\[@\]\}"/g)) {
      if (empty.has(m[1]!)) found.push(`${file}:${i + 1}: ${m[1]}`);
    }
  });
  return found;
}

for (const file of macosRecipeFiles) {
  Deno.test(`MacosRecipes_ExpandEmptyArraysSafely: ${file}`, () => {
    assertEquals(unguardedEmptyArrays(file, Deno.readTextFileSync(join(root, file))), []);
  });
}
Deno.test("TheBareFormThatFailedOnMacos_IsFound", () => {
  const before = 'options=()\nrun() { just "${options[@]}" "$@"; }\nnames=(); for n in "${names[@]}"; do :; done\n';
  assertEquals(unguardedEmptyArrays("run.just", before), ["run.just:2: options", "run.just:3: names"]);
});
Deno.test("TheGuardedForm_AndArraysThatStartFull_PassCheck", () => {
  const after = 'options=()\nrun() { just ${options[@]+"${options[@]}"} "$@"; }\nfull=(a b)\necho "${full[@]}" "$@"\n';
  assertEquals(unguardedEmptyArrays("run.just", after), []);
});
