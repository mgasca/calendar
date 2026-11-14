import { assertEquals, assertStringIncludes } from "@std/assert";

const root = new URL("../../../", import.meta.url);
const pin = (await Deno.readTextFile(new URL(".deno-version", root))).trim();
const rust =
  (await Deno.readTextFile(new URL("backend/rust-toolchain.toml", root))).match(/channel\s*=\s*"([^"]+)"/)![1];

async function doctor(deno: string | null): Promise<{ code: number; output: string }> {
  const bin = await Deno.makeTempDir({ prefix: "doctor-deno-" });
  try {
    for (const command of ["dirname", "tr", "sed", "sort", "head"]) {
      await Deno.symlink(`/usr/bin/${command}`, `${bin}/${command}`);
    }
    const commands: Record<string, string> = {
      dotnet: "echo 10.0.403",
      cargo: `echo cargo ${rust}`,
      rustc: `echo 'rustc ${rust} (fake)'`,
      cc: "exit 0",
      node: "echo v24.0.0",
      pnpm: "exit 0",
      docker: `[ "$1" = compose ] && echo v2.40.0; exit 0`,
      curl: "echo 'curl 8.0.0 (fake)'",
      just: "echo just 99.0.0",
      gh:
        `if [ "$1" = extension ]; then printf 'gh stack\\tgithub/gh-stack\\tv0.3.0\\n'; else echo 'gh version 2.0.0 (fake)'; fi`,
      jq: "echo jq-1.7",
      git: "echo 'git version 2.36.0'",
    };
    if (deno !== null) commands.deno = deno;
    for (const [command, body] of Object.entries(commands)) {
      await Deno.writeTextFile(`${bin}/${command}`, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
    }
    const result = await new Deno.Command("/bin/bash", {
      args: [new URL("tools/doctor/doctor.sh", root).pathname],
      env: { PATH: bin },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return { code: result.code, output: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
  } finally {
    await Deno.remove(bin, { recursive: true });
  }
}

Deno.test("doctor requires Deno and gives an installation hint", async () => {
  const result = await doctor(null);
  assertEquals(result.code, 1);
  assertStringIncludes(result.output, "deno not found");
  assertStringIncludes(result.output, `Install Deno ${pin}`);
});

Deno.test("doctor rejects a different Deno release", async () => {
  const result = await doctor("echo deno 0.1.0");
  assertEquals(result.code, 1);
  assertStringIncludes(result.output, `.deno-version wants ${pin}`);
});

Deno.test("doctor accepts precisely the pinned Deno release alongside the other runtimes", async () => {
  const result = await doctor(`echo deno ${pin}`);
  assertEquals(result.code, 0);
  assertStringIncludes(result.output, `Deno ${pin} (.deno-version)`);
  assertStringIncludes(result.output, "Toolchain OK");
});

Deno.test("doctor diagnoses an installed Deno that fails to report its version", async () => {
  const result = await doctor("exit 1");
  assertEquals(result.code, 1);
  assertStringIncludes(result.output, "Deno 'unavailable'");
});
