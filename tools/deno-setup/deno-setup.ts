#!/usr/bin/env -S deno run --allow-read --allow-run=just
// Checks that every workflow job that calls Deno, directly or through a just recipe, sets up the pinned Deno first
// (#987). `E2E flows` never runs for a pull request (ADR-0046), so when `just e2e up` started calling `deno` (#878),
// only the next nightly found that e2e.yml did not install it (#980, fixed by #986).
import { join } from "@std/path";
import { findRoot } from "../delivery-guards/delivery-guards.ts";
import { Workflow, type YamlMapping } from "../delivery-guards/workflow-yaml.ts";

export const workflowsDir = ".github/workflows";
export const setupAction = "denoland/setup-deno", versionFile = ".deno-version";

/** One line of a recipe body as `just --dump --dump-format json` writes it: text and interpolation fragments. */
type BodyLine = (string | unknown[])[];
interface DumpDependency {
  recipe: string;
}
interface DumpRecipe {
  body: BodyLine[];
  dependencies: DumpDependency[];
  namepath: string;
  parameters: unknown[];
}
export interface DumpModule {
  /** The recipe that runs when the module is named alone. */
  first?: string | null;
  recipes: Record<string, DumpRecipe>;
  aliases?: Record<string, { target: string }>;
  modules: Record<string, DumpModule>;
}

export interface SetupFiles {
  /** Workflow path (relative to the repo root) → its text. */
  workflows: Map<string, string>;
  /** The root justfile and its modules, as `just --dump --dump-format json` prints them. */
  just: DumpModule;
}

export function dumpJust(dir: string): DumpModule {
  const output = new Deno.Command("just", {
    args: ["--dump", "--dump-format", "json"],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!output.success) throw new Error(`just --dump failed in ${dir}: ${new TextDecoder().decode(output.stderr)}`);
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

export function loadFiles(root: string): SetupFiles {
  const workflows = new Map<string, string>();
  for (const entry of [...Deno.readDirSync(join(root, workflowsDir))].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile && /\.ya?ml$/.test(entry.name)) {
      workflows.set(`${workflowsDir}/${entry.name}`, Deno.readTextFileSync(join(root, workflowsDir, entry.name)));
    }
  }
  return { workflows, just: dumpJust(root) };
}

// An interpolation fragment as text: `just_executable()` (quoted or not) is `just`, `module_path()` is the module's
// path, and anything else is a placeholder that matches no recipe and no Deno call.
function renderFragment(fragment: unknown, modulePath: string): string {
  const isCall = (node: unknown, name: string) => Array.isArray(node) && node[0] === "call" && node[1] === name;
  const node = Array.isArray(fragment) && fragment.length === 1 ? fragment[0] : fragment;
  if (isCall(node, "just_executable")) return "just";
  if (isCall(node, "quote") && Array.isArray(node) && isCall(node[2], "just_executable")) return "just";
  if (isCall(node, "module_path")) return modulePath;
  return "{{…}}";
}
function renderLine(line: BodyLine, modulePath: string): string {
  return line.map((part) => typeof part === "string" ? part : renderFragment(part, modulePath)).join("");
}

// A command starts at the beginning of a line (after just's `@` and `-` prefixes) or after a shell separator.
const commandStart = String.raw`(?:^[@\-\s]*|[;&|({]\s*|\$\(\s*|\b(?:then|do|else|exec|time)\s+)`;
const denoCall = new RegExp(String.raw`${commandStart}deno\s`, "m");
const denoShebang = /^#!\S*(?:\/env\s+(?:-S\s+)?)?\S*\bdeno\b/;
const justCall = new RegExp(String.raw`${commandStart}just(?=\s)([^\n;&|)]*)`, "gm");

/** The line that calls Deno, if `text` (a step script or a rendered recipe line) does. */
function callsDeno(lines: string[]): string | null {
  for (const [index, line] of lines.entries()) {
    if (index === 0 && denoShebang.test(line)) return line.trim();
    if (/^\s*#/.test(line)) continue;
    if (denoCall.test(line)) return line.trim();
  }
  return null;
}

// Options of just that take a value, and options that make just print instead of running a recipe.
const valueOptions = new Set([
  "-f",
  "--justfile",
  "-d",
  "--working-directory",
  "--set",
  "--shell",
  "--shell-arg",
  "--dotenv-filename",
  "--dotenv-path",
  "--color",
  "--chooser",
  "--command-color",
  "--list-heading",
  "--list-prefix",
  "--timestamp-format",
]);
const noRunOptions =
  /^(-l|--list|--fmt|--show|-s|--dump|--summary|--evaluate|--variables|--version|-V|--choose|--edit|--init|--groups|--completions|--help|-h|--man|--request|--usage)(=|$)/;

function words(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

/** The recipe namepaths a `just …` command line runs, or null when it runs none. Unknown names come back as given. */
export function invokedRecipes(args: string, just: DumpModule): string[] | null {
  const rest = words(args);
  while (rest.length && rest[0]!.startsWith("-")) {
    const option = rest.shift()!;
    if (noRunOptions.test(option)) return null;
    if (option === "--set") rest.splice(0, 2);
    else if (valueOptions.has(option)) rest.shift();
  }
  // Positional `NAME=VALUE` overrides come before the recipe.
  while (rest.length && /^[A-Za-z_][\w-]*=/.test(rest[0]!)) rest.shift();
  const first = rest.shift();
  if (first === undefined) return defaultRecipe(just, "");
  if (first.includes("::")) return [first];
  const module = just.modules[first];
  if (!module) return [first];
  const recipe = rest.shift();
  if (recipe === undefined) return defaultRecipe(module, first);
  // `just <module> run a b -- args` runs each named recipe of that module (just/run.just), up to the first option.
  if (recipe === "run" && module.recipes.run) {
    const end = rest.findIndex((w) => w.startsWith("-"));
    return [`${first}::run`, ...rest.slice(0, end < 0 ? rest.length : end).map((n) => `${first}::${n}`)];
  }
  return [`${first}::${recipe}`];
}

// The recipe just runs when a module (or the root) is named alone: its `[default]` recipe or its first.
function defaultRecipe(module: DumpModule, path: string): string[] {
  return module.first ? [path ? `${path}::${module.first}` : module.first] : [];
}

export function findRecipe(just: DumpModule, namepath: string): DumpRecipe | null {
  const parts = namepath.split("::"), name = parts.pop()!;
  let module: DumpModule | undefined = just;
  for (const part of parts) module = module?.modules[part];
  if (!module) return null;
  const target = module.aliases?.[name]?.target ?? name;
  return module.recipes[target] ?? null;
}

export interface DenoPath {
  /** Recipe namepaths from the invoked one to the one that calls Deno. */
  chain: string[];
  line: string;
}

/** How recipe `namepath` reaches Deno through its dependencies, its body and the just calls in it, or null. */
export function denoPath(just: DumpModule, namepath: string, seen = new Set<string>()): DenoPath | null {
  if (seen.has(namepath)) return null;
  seen.add(namepath);
  const recipe = findRecipe(just, namepath);
  if (!recipe) return null;
  const modulePath = recipe.namepath.split("::").slice(0, -1).join("::");
  const sibling = (name: string) => modulePath ? `${modulePath}::${name}` : name;
  const follow = (next: string): DenoPath | null => {
    const found = denoPath(just, next, seen);
    return found ? { chain: [recipe.namepath, ...found.chain], line: found.line } : null;
  };
  for (const dependency of recipe.dependencies) {
    const found = follow(sibling(dependency.recipe));
    if (found) return found;
  }
  const lines = recipe.body.map((line) => renderLine(line, modulePath));
  const line = callsDeno(lines);
  if (line) return { chain: [recipe.namepath], line };
  // A just call in a recipe body runs from the recipe's working directory, which is the repo root for every module
  // here (each sets `working-directory` to the root or runs at it), so it resolves against the root justfile.
  for (const text of lines.filter((l) => !/^\s*#/.test(l))) {
    for (const match of text.matchAll(justCall)) {
      for (const next of invokedRecipes(match[1]!, just) ?? []) {
        const found = follow(next);
        if (found) return found;
      }
    }
  }
  return null;
}

function setsUpDeno(step: YamlMapping): "pinned" | "unpinned" | "no" {
  if (!(step.text("uses") ?? "").startsWith(`${setupAction}@`)) return "no";
  return step.map("with")?.text("deno-version-file") === versionFile ? "pinned" : "unpinned";
}

export function checkWorkflow(path: string, text: string, just: DumpModule): string[] {
  const workflow = Workflow.parse(text), errors: string[] = [];
  for (const job of workflow.jobs) {
    let setup: "pinned" | "unpinned" | "no" = "no";
    for (const [index, step] of job.steps.entries()) {
      const name = step.text("name"),
        label = `${path}, job \`${job.name}\`, step ${index + 1}${name ? ` (\`${name}\`)` : ""}`;
      const state = setsUpDeno(step);
      if (state !== "no") {
        setup = state;
        if (state === "unpinned") {
          errors.push(
            `${label} sets up Deno without \`deno-version-file: ${versionFile}\`, so it is not the pinned one.`,
          );
        }
        continue;
      }
      const run = Workflow.run(step), uses: string[] = [];
      const direct = callsDeno(run.replaceAll(/\\\n\s*/g, " ").split("\n"));
      if (direct) uses.push(`runs \`${direct}\``);
      for (const match of run.matchAll(justCall)) {
        const command = `just${match[1]!.trimEnd()}`;
        for (const recipe of invokedRecipes(match[1]!, just) ?? []) {
          if (!findRecipe(just, recipe)) {
            errors.push(`${label}: \`${command}\` names recipe \`${recipe}\`, which does not exist.`);
            continue;
          }
          const found = denoPath(just, recipe);
          if (found) uses.push(`runs \`${command}\`: \`${found.chain.join("` → `")}\` calls Deno in \`${found.line}\``);
        }
      }
      if (uses.length && setup === "no") {
        for (const use of uses) {
          errors.push(
            `${label} ${use}, but no earlier step uses \`${setupAction}\` with \`deno-version-file: ${versionFile}\`.`,
          );
        }
      }
    }
  }
  return errors;
}

export function check(files: SetupFiles): string[] {
  const errors: string[] = [];
  for (const [path, text] of files.workflows) {
    try {
      errors.push(...checkWorkflow(path, text, files.just));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      errors.push(`${path} could not be read: ${error.message}`);
    }
  }
  return errors;
}

if (import.meta.main) {
  const root = findRoot(Deno.cwd());
  if (!root) {
    console.error("No repo root (a directory with .just-version) above the current directory.");
    Deno.exit(2);
  }
  const errors = check(loadFiles(root));
  for (const error of errors) console.log(`FAIL ${error}`);
  if (!errors.length) {
    console.log(
      "ok   every workflow job that calls Deno, directly or through a just recipe, sets up the pinned Deno first (#987).",
    );
  }
  Deno.exit(errors.length ? 1 : 0);
}
