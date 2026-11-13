import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { run } from "../infrastructure.ts";
import type { Azure } from "../process.ts";
import { join } from "node:path";
export class FakeAzure implements Azure {
  existing = false;
  calls: string[][] = [];
  fileContents = "";
  filePath = "";
  input = "";
  static opsVaultId =
    "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-calendar-staging/providers/Microsoft.KeyVault/vaults/ops-vault";
  runWithInput(input: string, ...args: string[]) {
    this.input = input;
    return this.run(...args);
  }
  runCleanup(...args: string[]) {
    return this.run(...args);
  }
  run(...args: string[]): Promise<string> {
    this.calls.push(args);
    if (args.includes("resource")) return Promise.resolve('["vault"]');
    if (args.includes("list")) {
      if (args.includes("ops-vault")) {
        return Promise.resolve(
          this.existing ? '[{"id":"https://vault/secrets/postgres-admin-password","enabled":true}]' : "[]",
        );
      }
      return Promise.resolve(
        '[{"id":"https://vault/secrets/postgres-admin-password","enabled":true},{"id":"https://vault/secrets/google-client-secret","enabled":false},{"id":"https://vault/secrets/calendar-connection-string","enabled":true},{"id":"https://vault/secrets/allowed-email-2","enabled":true}]',
      );
    }
    if (args.includes("deployment") && args.includes("show")) {
      return Promise.resolve(args.some((a) => a.includes("opsKeyVaultName")) ? "ops-vault" : "app-vault");
    }
    if (args.includes("show") && args.includes("keyvault")) {
      return Promise.resolve(args.includes("secret") ? "secret-value" : FakeAzure.opsVaultId);
    }
    if (args.includes("rest")) return Promise.resolve("00000000-0000-0000-0000-000000000002");
    if (args.includes("build-params")) return Promise.resolve('{"parametersJson":"{\\"parameters\\":{}}"}');
    const fileArg = args.findIndex((x) => x === "--file" || x === "--parameters");
    if (fileArg >= 0 && args[fileArg + 1] !== "/dev/stdin") {
      this.filePath = args[fileArg + 1]!.replace(/^@/, "");
      this.fileContents = Deno.readTextFileSync(this.filePath);
      assertEquals(Deno.statSync(this.filePath).mode! & 0o777, 0o600);
    }
    return Promise.resolve(
      args.includes("what-if")
        ? '{"preview":"no-change","password":"transformed-secret","changes":[{"path":"properties.postgresAdministratorPassword","after":"encoded-value"}]}'
        : "",
    );
  }
}
async function isolated(action: () => Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "infra-runtime-test-" });
  const keys = [
    "XDG_RUNTIME_DIR",
    "AZURE_DEPLOYER_CLIENT_ID",
    "AZURE_ALLOWED_IPS",
    "CALENDAR_CONTAINER_IMAGE",
    "GITHUB_ACTIONS",
  ];
  const previous = keys.map((key) => Deno.env.get(key));
  Deno.env.set("XDG_RUNTIME_DIR", root);
  Deno.env.set("AZURE_DEPLOYER_CLIENT_ID", "00000000-0000-0000-0000-000000000001");
  for (const key of keys.slice(2)) Deno.env.delete(key);
  try {
    await action();
  } finally {
    keys.forEach((key, i) => previous[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[i]!));
    await Deno.remove(root, { recursive: true });
  }
}
Deno.test("secret initialization keeps password off arguments and output", () =>
  isolated(async () => {
    Deno.env.set("GITHUB_ACTIONS", "true");
    const az = new FakeAzure();
    const output: string[] = [];
    const error: string[] = [];
    assertEquals(
      await run(["secret", "init-postgres-password", "staging"], az, (s) => output.push(s), (s) => error.push(s)),
      0,
    );
    assert(az.input.length > 0);
    assert(az.calls.some((c) => c.includes("ops-vault") && c.includes("set") && c.includes("/dev/stdin")));
    assert(!az.calls.flat().includes(az.input));
    assert(!output.join("\n").includes(az.input));
    assert(!error.join("\n").includes(az.input));
    assertEquals(az.filePath, "");
  }));
Deno.test("existing password cannot be overwritten", () =>
  isolated(async () => {
    const az = new FakeAzure();
    az.existing = true;
    assertEquals(await run(["secret", "init-postgres-password", "staging"], az, () => {}, () => {}), 1);
    assert(!az.calls.some((c) => c.includes("set")));
    assertEquals(await run(["secret", "init-postgres-password", "staging", "--force"], az, () => {}, () => {}), 1);
  }));
Deno.test("full preview keeps password off arguments and output", () =>
  isolated(async () => {
    const az = new FakeAzure();
    az.existing = true;
    const output: string[] = [];
    assertEquals(await run(["what-if", "staging"], az, (s) => output.push(s), () => {}), 0);
    assert(!az.calls.flat().includes("secret-value"));
    assert(!output.join("\n").includes("transformed-secret"));
    assert(!output.join("\n").includes("encoded-value"));
    assert(!az.fileContents.includes("secret-value"));
    assertStringIncludes(
      az.fileContents,
      '"postgresAdministratorPassword":{"reference":{"keyVault":{"id":"' + FakeAzure.opsVaultId +
        '"},"secretName":"postgres-admin-password"}}',
    );
    assertStringIncludes(az.fileContents, "calendar-connection-string");
    assertStringIncludes(az.fileContents, "allowed-email-2");
    assertStringIncludes(
      az.fileContents,
      '"keyVaultSecretNames":{"value":["allowed-email-2","calendar-connection-string"]}',
    );
    assert(!az.fileContents.includes("google-client-secret"));
    assert(az.calls.some((c) => c.includes("ops-vault") && c.includes("show")));
    assert(!az.calls.some((c) => c.includes("secret") && c.includes("show")));
    assert(az.calls.some((c) => c.includes("app-vault") && c.includes("list")));
    let exists = true;
    try {
      await Deno.stat(az.filePath);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) exists = false;
      else throw e;
    }
    assertEquals(exists, false);
  }));
Deno.test("foundation preview does not access vault", () =>
  isolated(async () => {
    const az = new FakeAzure();
    assertEquals(await run(["what-if", "staging", "--phase", "foundation"], az, () => {}, () => {}), 0);
    assert(!az.calls.some((c) => c.includes("keyvault")));
    assertStringIncludes(az.fileContents, '"deployDatabaseAndApp":{"value":false}');
  }));
Deno.test("firewall addresses validated and passed", () =>
  isolated(async () => {
    Deno.env.set("AZURE_ALLOWED_IPS", "192.0.2.2,198.51.100.0/24");
    const az = new FakeAzure();
    assertEquals(
      await run(
        ["what-if", "staging", "--phase", "foundation", "--allow-ip", "203.0.113.0/24"],
        az,
        () => {},
        () => {},
      ),
      0,
    );
    for (const address of ["203.0.113.0", "203.0.113.255", "192.0.2.2"]) assertStringIncludes(az.fileContents, address);
    assertEquals(await run(["what-if", "staging", "--allow-ip", "1.2.3.4/33"], az, () => {}, () => {}), 1);
  }));
Deno.test("startup removes only stale files", () =>
  isolated(async () => {
    const directory = join(Deno.env.get("XDG_RUNTIME_DIR")!, "calendar-infra-private");
    await Deno.mkdir(directory, { mode: 0o700 });
    const stale = join(directory, "calendar-infra-old");
    const fresh = join(directory, "calendar-infra-fresh");
    await Deno.writeTextFile(stale, "stale");
    await Deno.writeTextFile(fresh, "fresh");
    const old = new Date(Date.now() - 172800000);
    await Deno.utime(stale, old, old);
    await run([], new FakeAzure(), () => {}, () => {});
    assertEquals([...Deno.readDirSync(directory)].map((entry) => entry.name), ["calendar-infra-fresh"]);
  }));
