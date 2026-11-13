import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
const config = fileURLToPath(new URL("../../deno.json", import.meta.url));
const tool = fileURLToPath(new URL("../infra.ts", import.meta.url));
Deno.test("migration runs a local fixture and always removes its temporary firewall rule", async () => {
  const directory = await Deno.makeTempDir({ prefix: "infra-migration-fixture-" });
  try {
    await Deno.mkdir(`${directory}/bin`);
    await Deno.mkdir(`${directory}/backend/target/release`, { recursive: true });
    await Deno.mkdir(`${directory}/runtime`);
    await Deno.writeTextFile(
      `${directory}/bin/az`,
      `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$PARITY_LOG"
case "$1 $2 $3" in
  'resource list --resource-group') echo '["test-postgres"]' ;;
  'deployment group show') echo ops-vault ;;
  'postgres flexible-server show') if [[ "$*" == *"--query state"* ]]; then echo Ready; else echo pg.example.test; fi ;;
  'postgres flexible-server wait') ;;
  'postgres flexible-server firewall-rule') if [[ "$*" == *" list "* ]]; then echo '[]'; fi ;;
  'keyvault secret show') echo synthetic-password ;;
  *) echo 'unexpected fixture command' >&2; exit 7 ;;
esac
`,
      { mode: 0o700 },
    );
    await Deno.writeTextFile(`${directory}/bin/cargo`, '#!/bin/bash\nprintf "cargo %s\\n" "$*" >> "$PARITY_LOG"\n', {
      mode: 0o700,
    });
    await Deno.writeTextFile(
      `${directory}/backend/target/release/calendar-migrate`,
      `#!/bin/bash
printf 'migrator ran\\n' >> "$PARITY_LOG"
[[ "$PARITY_FAIL_MIGRATION" != 1 ]] || exit 9
[[ "$CALENDAR_MIGRATOR_CONNECTION" == 'Host=pg.example.test;Database=calendar;Username=calendar_migrator;Password=synthetic-password;SSL Mode=VerifyFull' ]]
`,
      { mode: 0o700 },
    );
    for (const failure of [false, true]) {
      const log = `${directory}/${failure ? "failure" : "success"}.log`;
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--config", config, "--frozen", "-A", tool, "migrate", "staging", "--client-ip", "192.0.2.1"],
        cwd: directory,
        env: {
          PATH: `${directory}/bin:${Deno.env.get("PATH") ?? ""}`,
          XDG_RUNTIME_DIR: `${directory}/runtime`,
          PARITY_LOG: log,
          PARITY_FAIL_MIGRATION: failure ? "1" : "0",
          GITHUB_ACTIONS: "true",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, failure ? 1 : 0);
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      assert(!stdout.includes("synthetic-password") && !stderr.includes("synthetic-password"));
      assert(!stdout.includes("::add-mask::"));
      if (failure) assertStringIncludes(stderr, "The migrator failed; the existing revision keeps serving.");
      const calls = await Deno.readTextFile(log);
      assertStringIncludes(calls, "cargo build --release --locked -p calendar-migrate");
      assertStringIncludes(calls, "firewall-rule create");
      assertStringIncludes(calls, "firewall-rule delete");
      const names = [...calls.matchAll(/calendar-migration-[a-f0-9]{32}/g)].map((match) => match[0]);
      assertEquals(names.length, 2);
      assertEquals(names[0], names[1]);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
