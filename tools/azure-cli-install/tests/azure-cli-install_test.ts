import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl } from "@std/path";
import { findRoot } from "../../delivery-guards/delivery-guards.ts";
import { actionPath, actionUse, check, checkWorkflow, type InstallFiles, loadFiles } from "../azure-cli-install.ts";

const root = findRoot(dirname(fromFileUrl(import.meta.url)))!;
const whatIf = ".github/workflows/infra-whatif.yml", migrate = ".github/workflows/migrate.yml";

// The install step as it was before #745, which resolved the pin from the runner image's apt sources.
const oldBicepStep = `      - name: Install pinned Azure CLI and Bicep
        run: |
          source tools/azure-versions.env
          sudo apt-get update -qq
          sudo apt-get install -y --allow-downgrades "azure-cli=\${AZURE_CLI_VERSION}-1~noble"
          az bicep install --version "v\${BICEP_VERSION}"
          test "$(az version --query '"azure-cli"' -o tsv)" = "$AZURE_CLI_VERSION"
          az bicep version | grep -F "Bicep CLI version $BICEP_VERSION "
`;
const oldCliStep = `      - name: Install pinned Azure CLI
        run: |
          source tools/azure-versions.env
          sudo apt-get update -qq
          sudo apt-get install -y --allow-downgrades "azure-cli=\${AZURE_CLI_VERSION}-1~noble"
          test "$(az version --query '"azure-cli"' -o tsv)" = "$AZURE_CLI_VERSION"
`;
const newBicepStep = `      - name: Install pinned Azure CLI and Bicep
        uses: ${actionUse}
        with:
          bicep: true
`;
const newCliStep = `      - name: Install pinned Azure CLI
        uses: ${actionUse}
`;

function files(): InstallFiles {
  return loadFiles(root);
}
function mutate(text: string, from: string, to: string): string {
  assertStringIncludes(text, from, "mutation must alter the file");
  return text.replaceAll(from, to);
}
function withWorkflow(path: string, from: string, to: string): InstallFiles {
  const f = files();
  f.workflows.set(path, mutate(f.workflows.get(path)!, from, to));
  return f;
}
function withAction(from: string, to: string): InstallFiles {
  const f = files();
  f.action = mutate(f.action, from, to);
  return f;
}
function assertFails(f: InstallFiles, expected: string): void {
  const errors = check(f);
  assert(errors.some((e) => e.includes(expected)), `expected a failure containing "${expected}", got: ${errors}`);
}

Deno.test("ThisCheckout_Passes", () => assertEquals(check(files()), []));

Deno.test("TheCheckout_HasTheWorkflowsThatInstallTheCli", () => {
  const f = files();
  assertStringIncludes(f.workflows.get(whatIf)!, newBicepStep);
  assertStringIncludes(f.workflows.get(migrate)!, newCliStep);
});

// The regression: the workflows before the fix fail, in every job that had the step.
Deno.test("TheWorkflowsBeforeTheFix_Fail", () => {
  const f = files();
  f.workflows.set(whatIf, mutate(f.workflows.get(whatIf)!, newBicepStep, oldBicepStep));
  f.workflows.set(migrate, mutate(f.workflows.get(migrate)!, newCliStep, oldCliStep));
  const installs = check(f).filter((e) => e.includes("installs azure-cli itself"));
  assertEquals(installs.length, 3, installs.join("\n"));
  assert(installs.some((e) => e.includes(migrate)));
});

Deno.test("AJobUsingBicepWithoutTheAction_Fails", () =>
  assertFails(withWorkflow(whatIf, newBicepStep, ""), "uses the Azure CLI before any"));

Deno.test("AMigrationWithoutTheAction_Fails", () =>
  assertFails(withWorkflow(migrate, newCliStep, ""), "uses the Azure CLI before any"));

Deno.test("ABicepJobWithoutBicepTrue_Fails", () =>
  assertFails(withWorkflow(whatIf, "          bicep: true\n", ""), "does not set `bicep: true`"));

// A workflow step that runs the Deno infra tool directly, as infra-whatif.yml does, needs the CLI (and Bicep for what-if)
// just as `just infra` does; the pattern matched only the retired C# entry point (#685).
for (
  const [name, command, expected] of [
    ["WhatIf", "what-if staging --phase full", "uses the Azure CLI before any"],
    ["Migrate", "migrate staging", "uses the Azure CLI before any"],
  ] as const
) {
  Deno.test(`TheInfraToolRunDirectly_${name}WithoutTheAction_Fails`, () => {
    const workflow = `jobs:
  infra:
    name: Infra
    steps:
      - run: deno run --config tools/deno.json --frozen tools/infra/infra.ts ${command}
`;
    const errors = checkWorkflow("w.yml", workflow);
    assert(errors.some((e) => e.includes(expected)), errors.join("\n"));
  });
}

Deno.test("TheInfraToolWhatIfAfterACliOnlyAction_FailsForBicep", () => {
  const workflow = `jobs:
  infra:
    name: Infra
    steps:
      - uses: ${actionUse}
      - run: deno run --config tools/deno.json --frozen tools/infra/infra.ts what-if staging
`;
  const errors = checkWorkflow("w.yml", workflow);
  assert(errors.some((e) => e.includes("does not set `bicep: true`")), errors.join("\n"));
});

Deno.test("AnyOtherWorkflowInstallingAzureCli_Fails", () => {
  const f = files();
  f.workflows.set(
    ".github/workflows/new.yml",
    "on: push\njobs:\n  x:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: sudo apt-get install -y azure-cli\n",
  );
  assertFails(f, ".github/workflows/new.yml, job `x`, step 1 installs azure-cli itself");
});

const actionBreaks: [string, string, string, string][] = [
  ["AnUncheckedKey", "BC528686B50D79E339D3721CEB3E94ADBE1229CF", "0000", "fingerprint"],
  ["AnUnsignedSource", "'Signed-By: /etc/apt/keyrings/microsoft.gpg' \\\n", "", "`Signed-By`"],
  ["AnotherSuite", "'Suites: noble'", "'Suites: jammy'", "`noble` suite"],
  ["ALoosePin", '"azure-cli=${AZURE_CLI_VERSION}-1~noble"', "azure-cli", "exact pin"],
  ["NoCliVersionCheck", 'test "$(az version', 'echo "$(az version', "Azure CLI version"],
  ["NoBicepVersionCheck", 'grep -F "Bicep CLI version $BICEP_VERSION "', "true", "Bicep version"],
];
for (const [name, from, to, expected] of actionBreaks) {
  Deno.test(`TheAction_With${name}_Fails`, () => assertFails(withAction(from, to), expected));
}

Deno.test("TheAction_UpdatingBeforeItAddsTheSource_Fails", () => {
  // Move the source step after the install: apt would resolve the pin without the repository.
  const f = files(),
    start = f.action.indexOf("    - name: Add Microsoft"),
    end = f.action.indexOf("    - name: Install the pinned Azure CLI");
  assert(start > 0 && end > start);
  const addSource = f.action.slice(start, end), bicep = f.action.indexOf("    - name: Install the pinned Bicep CLI");
  f.action = f.action.slice(0, start) + f.action.slice(end, bicep) + addSource + f.action.slice(bicep);
  assertFails(f, "must write the signed source, then run `apt-get update`");
});

Deno.test("AnUnreadableAction_Fails", () => {
  const f = files();
  f.action = "runs:\n  using: node24\n";
  assertFails(f, `${actionPath} could not be read`);
});
