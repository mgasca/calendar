import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import {
  checkConnectionSecret,
  confirmCreationState,
  grantsSql,
  reconcileRole,
  storeNewSecret,
  storeSecret,
  sweepFirewall,
  withFirewall,
} from "../database.ts";
import { maskSecret } from "../common.ts";
import type { Azure } from "../process.ts";
class FakeAzure implements Azure {
  calls: string[][] = [];
  failDelete = false;
  overrideSecret: string | undefined;
  ruleList = "[]";
  input = "";
  runWithInput(input: string, ...args: string[]) {
    this.input = input;
    return this.run(...args);
  }
  runCleanup(...args: string[]) {
    return this.run(...args);
  }
  run(...args: string[]): Promise<string> {
    this.calls.push(args);
    if (args.includes("list")) return Promise.resolve(this.ruleList);
    if (args.includes("show")) return Promise.resolve(this.overrideSecret ?? this.input);
    if (this.failDelete && args.includes("delete")) return Promise.reject(new Error("Azure failure"));
    return Promise.resolve("");
  }
}
for (
  const [role, secret, expected] of [[false, false, "store,read,create,report"], [false, true, "read,create,report"], [
    true,
    true,
    "read,verify,report",
  ]] as const
) {
  Deno.test(`reconcile role=${role} secret=${secret}`, async () => {
    const steps: string[] = [];
    const result = await reconcileRole(role, secret, () => {
      steps.push("store");
      return Promise.resolve("password");
    }, () => {
      steps.push("read");
      return Promise.resolve("password");
    }, (password) => {
      assertEquals(password, "password");
      steps.push("verify");
      return Promise.resolve(true);
    }, (password) => {
      assertEquals(password, "password");
      steps.push("create");
      return Promise.resolve();
    }, () => {
      steps.push("report");
    });
    assertEquals(result, "password");
    assertEquals(steps.join(","), expected);
  });
}
Deno.test("existing role without secret refuses before any action", async () => {
  let calls = 0;
  const action = () => {
    calls++;
    return Promise.resolve("password");
  };
  await assertRejects(() =>
    reconcileRole(true, false, action, action, () => {
      calls++;
      return Promise.resolve(true);
    }, () => {
      calls++;
      return Promise.resolve();
    }, () => {
      calls++;
    })
  );
  assertEquals(calls, 0);
});
Deno.test("existing role with wrong secret refuses", async () => {
  let created = false;
  await assertRejects(() =>
    reconcileRole(
      true,
      true,
      () => Promise.resolve("wrong"),
      () => Promise.resolve("wrong"),
      () => Promise.resolve(false),
      () => {
        created = true;
        return Promise.resolve();
      },
      () => {},
    )
  );
  assertEquals(created, false);
});
Deno.test("existing connection string must match", () => {
  checkConnectionSecret("expected", "expected");
  assertThrows(() => checkConnectionSecret("different", "expected"));
});
Deno.test("grants include idempotent schema privileges", () => {
  for (
    const sql of [
      "GRANT CONNECT ON DATABASE calendar TO CURRENT_USER;",
      "REVOKE CREATE ON SCHEMA public FROM PUBLIC;",
      "GRANT USAGE, CREATE ON SCHEMA public TO calendar_migrator;",
      "GRANT USAGE ON SCHEMA public TO calendar_app;",
    ]
  ) assertStringIncludes(grantsSql, sql);
  assert(!grantsSql.includes("ALTER SCHEMA public OWNER"));
});
Deno.test("secret storage uses stdin, never arguments or files", async () => {
  const az = new FakeAzure();
  await storeSecret(az, "ops-vault", "calendar-app-password", "secret-value");
  assertEquals(az.input, "secret-value");
  assert(!az.calls.flat().includes("secret-value"));
  assert(az.calls.some((c) => c.includes("set") && c.includes("--file") && c.includes("/dev/stdin")));
});
Deno.test("firewall removed after failure", async () => {
  const az = new FakeAzure();
  await assertRejects(() =>
    withFirewall(az, "rg", "server", "192.0.2.1", () => Promise.reject(new Error("bundle failure")))
  );
  assertEquals(az.calls.length, 2);
  assert(az.calls[0]!.includes("create"));
  assert(az.calls[1]!.includes("delete"));
  assert(az.calls.every((c) => c.includes("--server-name")));
  assertEquals(az.calls[0]![az.calls[0]!.indexOf("--name") + 1], az.calls[1]![az.calls[1]!.indexOf("--name") + 1]);
  assert(!az.calls.flat().includes("secret-value"));
});
Deno.test("failed firewall cleanup reports rule for manual removal", async () => {
  const az = new FakeAzure();
  az.failDelete = true;
  const error = await assertRejects(() => withFirewall(az, "rg", "server", "192.0.2.1", () => Promise.resolve()));
  assert(error instanceof Error);
  assertStringIncludes(error.message, "remove it manually");
  assertStringIncludes(error.message, az.calls[1]![az.calls[1]!.indexOf("--name") + 1]!);
});
Deno.test("new secret refuses concurrent writer", async () => {
  const az = new FakeAzure();
  az.ruleList = '[{"id":"https://vault/secrets/password","enabled":true}]';
  await assertRejects(() => storeNewSecret(az, "ops", "password", "secret", () => {}));
  assert(!az.calls.some((c) => c.includes("set")));
});
Deno.test("concurrent secret change rejected", async () => {
  const az = new FakeAzure();
  az.overrideSecret = "changed";
  const error = await assertRejects(() => storeSecret(az, "ops", "password", "original"));
  assert(error instanceof Error);
  assertStringIncludes(error.message, "Concurrent initialization");
});
Deno.test("reconcile rejects changed secret before create", async () => {
  let created = false;
  await assertRejects(() =>
    reconcileRole(
      false,
      false,
      () => Promise.resolve("original"),
      () => Promise.resolve("changed"),
      () => Promise.resolve(true),
      () => {
        created = true;
        return Promise.resolve();
      },
      () => {},
    )
  );
  assertEquals(created, false);
});
Deno.test("creation rechecks role and secret", async () => {
  await confirmCreationState(() => Promise.resolve(false), () => Promise.resolve("same"), "same");
  await assertRejects(() => confirmCreationState(() => Promise.resolve(true), () => Promise.resolve("same"), "same"));
  await assertRejects(() =>
    confirmCreationState(() => Promise.resolve(false), () => Promise.resolve("changed"), "same")
  );
});
Deno.test("mask commands escape secrets without other output", () => {
  const previous = Deno.env.get("GITHUB_ACTIONS");
  Deno.env.set("GITHUB_ACTIONS", "true");
  try {
    const output: string[] = [];
    maskSecret((line) => output.push(line), "secret%\r\nvalue");
    assertEquals(output, ["::add-mask::secret%25%0D%0Avalue"]);
  } finally {
    if (previous === undefined) Deno.env.delete("GITHUB_ACTIONS");
    else Deno.env.set("GITHUB_ACTIONS", previous);
  }
});
Deno.test("stored and read secrets only appear in masks", async () => {
  const previous = Deno.env.get("GITHUB_ACTIONS");
  Deno.env.set("GITHUB_ACTIONS", "true");
  try {
    const output: string[] = [];
    const az = new FakeAzure();
    await storeSecret(az, "ops", "password", "secret-value", (line) => output.push(line));
    assertEquals(output, ["::add-mask::secret-value", "::add-mask::secret-value"]);
    assert(!az.calls.flat().includes("secret-value"));
  } finally {
    if (previous === undefined) Deno.env.delete("GITHUB_ACTIONS");
    else Deno.env.set("GITHUB_ACTIONS", previous);
  }
});
Deno.test("cleanup failure never masks original error", async () => {
  const az = new FakeAzure();
  az.failDelete = true;
  const error = await assertRejects(() =>
    withFirewall(az, "rg", "server", "192.0.2.1", () => Promise.reject(new Error("original")))
  );
  assert(error instanceof Error);
  assertEquals(error.message, "original");
  assert("firewallCleanup" in error);
});
Deno.test("cancellation still removes firewall", async () => {
  const az = new FakeAzure();
  await assertRejects(() =>
    withFirewall(az, "rg", "server", "192.0.2.1", () => Promise.reject(new DOMException("cancelled", "AbortError")))
  );
  assert(az.calls.at(-1)!.includes("delete"));
});
Deno.test("sweep deletes only migration rules", async () => {
  const az = new FakeAzure();
  az.ruleList = '["calendar-migration-old","other"]';
  await sweepFirewall(az, "rg", "server");
  assertEquals(az.calls.length, 2);
  assert(az.calls[1]!.includes("calendar-migration-old"));
});

Deno.test("connection strings match Npgsql for persisted secrets", async () => {
  const { connectionString } = await import("../database.ts");
  const prefix = "Host=server.example;Database=calendar;Username=calendar_app;Password=";
  const cases = [
    ["simple", "simple"],
    ["a;b", '"a;b"'],
    [" a ", '" a "'],
    ['a"b', "'a\"b'"],
    ["Aa1!abc+/==", '"Aa1!abc+/=="'],
    ["", ""],
    ["x=y", '"x=y"'],
  ] as const;
  for (const [password, expected] of cases) {
    assertEquals(
      connectionString("server.example", "calendar_app", password),
      `${prefix}${expected};SSL Mode=VerifyFull`,
    );
  }
});
