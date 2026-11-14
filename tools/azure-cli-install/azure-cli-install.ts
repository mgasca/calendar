#!/usr/bin/env -S deno run --allow-read
// Checks that CI installs the pinned Azure CLI only through .github/actions/install-azure-cli, and that the action
// configures Microsoft's signed apt repository before it resolves the pin (#745). The ubuntu-24.04 runner image removes
// that repository after installing its own Azure CLI, so an install from the image's sources cannot find the pin.
import { join } from "@std/path";
import { findRoot } from "../delivery-guards/delivery-guards.ts";
import { parseYaml, Workflow, YamlMapping, YamlScalar } from "../delivery-guards/workflow-yaml.ts";

export const actionPath = ".github/actions/install-azure-cli/action.yml", workflowsDir = ".github/workflows";
export const actionUse = "./.github/actions/install-azure-cli";
/** Microsoft (Release signing) <gpgsecurity@microsoft.com>, which signs packages.microsoft.com/repos/azure-cli. */
export const microsoftKeyFingerprint = "BC528686B50D79E339D3721CEB3E94ADBE1229CF";
export const signedBy = "Signed-By: /etc/apt/keyrings/microsoft.gpg";
export const pinnedInstall = '"azure-cli=${AZURE_CLI_VERSION}-1~noble"';

export interface InstallFiles {
  action: string;
  /** Workflow path (relative to the repo root) → its text. */
  workflows: Map<string, string>;
}

export function loadFiles(root: string): InstallFiles {
  const workflows = new Map<string, string>();
  for (const entry of [...Deno.readDirSync(join(root, workflowsDir))].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile && /\.ya?ml$/.test(entry.name)) {
      workflows.set(`${workflowsDir}/${entry.name}`, Deno.readTextFileSync(join(root, workflowsDir, entry.name)));
    }
  }
  return { action: Deno.readTextFileSync(join(root, actionPath)), workflows };
}

// The action's step scripts, in order, joined so that positions compare across steps.
function actionScript(action: string): string {
  const root = parseYaml(action), runs = root instanceof YamlMapping ? root.map("runs") : undefined;
  if (!runs || runs.text("using") !== "composite") throw new Error(`${actionPath} is not a composite action.`);
  return runs.list("steps").filter((s): s is YamlMapping => s instanceof YamlMapping).map(Workflow.run).join("\n");
}

export function checkAction(action: string): string[] {
  const script = actionScript(action), errors: string[] = [];
  const required: [string, string][] = [
    [microsoftKeyFingerprint, "does not check Microsoft's signing key fingerprint before trusting the key"],
    ["/etc/apt/keyrings/microsoft.gpg", "does not keep the key in /etc/apt/keyrings/microsoft.gpg"],
    ["URIs: https://packages.microsoft.com/repos/azure-cli/", "does not add Microsoft's azure-cli apt repository"],
    ["Suites: noble", "does not add the repository's `noble` suite, the one the `-1~noble` pin comes from"],
    [signedBy, "does not restrict the repository to that key with `Signed-By`"],
    ["source tools/azure-versions.env", "does not read the pins from tools/azure-versions.env"],
    [pinnedInstall, `does not install the exact pin ${pinnedInstall}`],
    [
      `test "$(az version --query '"azure-cli"' -o tsv)" = "$AZURE_CLI_VERSION"`,
      "does not assert the installed Azure CLI version",
    ],
    ['az bicep install --version "v${BICEP_VERSION}"', "does not install the pinned Bicep"],
    ['Bicep CLI version $BICEP_VERSION "', "does not assert the installed Bicep version"],
  ];
  for (const [text, problem] of required) if (!script.includes(text)) errors.push(`${actionPath} ${problem}.`);
  const source = script.indexOf(signedBy),
    update = script.indexOf("apt-get update"),
    install = script.indexOf(pinnedInstall);
  if (source >= 0 && update >= 0 && install >= 0 && !(source < update && update < install)) {
    errors.push(
      `${actionPath} must write the signed source, then run \`apt-get update\`, then install the pin; otherwise apt resolves the pin without Microsoft's repository.`,
    );
  }
  return errors;
}

const installsAzureCli = /apt(-get)?\s+install\b[^\n]*\bazure-cli\b/;
// Steps that need the pinned CLI: Bicep itself, and the infra tool, which drives `az`.
const needsCli = /\baz bicep\b|tools\/infra\/infra\.ts|\bjust infra (migrate|what-if|deploy)\b/;
const needsBicep = /\baz bicep\b|tools\/infra\/infra\.ts.*\bwhat-if\b|\bjust infra (what-if|deploy)\b/;

export function checkWorkflow(path: string, text: string): string[] {
  const workflow = Workflow.parse(text), errors: string[] = [];
  for (const job of workflow.jobs) {
    let installed: "none" | "cli" | "bicep" = "none";
    for (const [index, step] of job.steps.entries()) {
      const run = Workflow.run(step), label = `${path}, job \`${job.name}\`, step ${index + 1}`;
      if (step.text("uses") === actionUse) {
        const bicep = step.map("with")?.get("bicep");
        installed = bicep instanceof YamlScalar && bicep.value === "true" ? "bicep" : "cli";
      }
      if (installsAzureCli.test(run)) {
        errors.push(
          `${label} installs azure-cli itself; use \`${actionUse}\`, which adds Microsoft's signed apt repository first (#745).`,
        );
      }
      if (needsCli.test(run) && installed === "none") {
        errors.push(`${label} uses the Azure CLI before any \`${actionUse}\` step installs the pinned one.`);
      } else if (needsBicep.test(run) && installed === "cli") {
        errors.push(`${label} uses Bicep, but the \`${actionUse}\` step before it does not set \`bicep: true\`.`);
      }
    }
  }
  return errors;
}

export function check(files: InstallFiles): string[] {
  const errors: string[] = [];
  const guarded = (name: string, run: () => string[]) => {
    try {
      errors.push(...run());
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      errors.push(`${name} could not be read: ${error.message}`);
    }
  };
  guarded(actionPath, () => checkAction(files.action));
  for (const [path, text] of files.workflows) guarded(path, () => checkWorkflow(path, text));
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
    console.log("ok   CI installs the pinned Azure CLI only through the signed-source action (#745).");
  }
  Deno.exit(errors.length ? 1 : 0);
}
