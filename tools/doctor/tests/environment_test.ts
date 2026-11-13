import { assertEquals, assertStringIncludes } from "@std/assert";

const root = new URL("../../../", import.meta.url);
const rustPin = (await Deno.readTextFile(new URL("backend/rust-toolchain.toml", root)))
  .match(/channel\s*=\s*"([^"]+)"/)?.[1];
if (!rustPin) throw new Error("backend/rust-toolchain.toml has no channel");
const denoPin = (await Deno.readTextFile(new URL(".deno-version", root))).trim();
const azurePins = await Deno.readTextFile(new URL("tools/azure-versions.env", root));
const azurePin = azurePins.match(/^AZURE_CLI_VERSION=(.+)$/m)?.[1];
const bicepPin = azurePins.match(/^BICEP_VERSION=(.+)$/m)?.[1];
if (!azurePin || !bicepPin) throw new Error("Azure version manifest has missing pins");

// Port the non-SDK cases of doctor.tests.cs. Foundation's doctor_test.ts covers
// missing/wrong/correct/broken Deno; the obsolete .NET cases retire at cutover.
async function withCommands(run: (bin: string) => Promise<void>): Promise<void> {
  const bin = await Deno.makeTempDir({ prefix: "doctor-environment-" });
  try {
    for (const name of ["dirname", "tr", "sed", "sort", "head"]) {
      await Deno.symlink(`/usr/bin/${name}`, `${bin}/${name}`);
    }
    const commands: Record<string, string> = {
      dotnet: "echo 10.0.404", // Needed only while unmigrated tools coexist.
      deno: `echo deno ${denoPin}`,
      cargo: `echo cargo ${rustPin}`,
      rustc: `echo 'rustc ${rustPin} (fake)'`,
      cc: "exit 0",
      node: "echo v24.0.0",
      pnpm: "exit 0",
      docker: "exit 0",
      just: "echo just 99.0.0",
      gh: "echo 'gh version 2.0.0 (fake)'",
      jq: "echo jq-1.7",
    };
    for (const [name, body] of Object.entries(commands)) await executable(bin, name, body);
    await run(bin);
  } finally {
    await Deno.remove(bin, { recursive: true });
  }
}

async function executable(bin: string, name: string, body: string): Promise<void> {
  await Deno.writeTextFile(`${bin}/${name}`, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
}

async function doctor(bin: string, infra = false): Promise<{ code: number; text: string }> {
  const output = await new Deno.Command("/bin/bash", {
    args: [new URL("tools/doctor/doctor.sh", root).pathname, ...(infra ? ["--infra"] : [])],
    clearEnv: true,
    env: { PATH: bin },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: output.code, text: decoder.decode(output.stdout) + decoder.decode(output.stderr) };
}

Deno.test("doctor infra reports a missing Azure CLI with an installation hint", async () => {
  await withCommands(async (bin) => {
    const result = await doctor(bin, true);
    assertEquals(result.code, 1);
    assertStringIncludes(result.text, "Azure CLI not found");
    assertStringIncludes(result.text, "Install Azure CLI");
  });
});

for (
  const [azure, bicep, success, expected] of [
    [azurePin, "", false, "Bicep version 'unavailable'"],
    ["0.1.0", bicepPin, false, "Azure CLI version '0.1.0'"],
    [azurePin, "0.1.0", false, "Bicep version '0.1.0'"],
    [azurePin, bicepPin, true, "Toolchain OK"],
  ] as const
) {
  Deno.test(`doctor checks Azure ${azure} and Bicep ${bicep || "unavailable"} independently`, async () => {
    await withCommands(async (bin) => {
      const bicepCommand = bicep ? `echo 'Bicep CLI version ${bicep} (fake)'` : "exit 1";
      await executable(bin, "az", `case "$1" in version) echo ${azure};; bicep) ${bicepCommand};; esac`);
      const result = await doctor(bin, true);
      assertEquals(result.code === 0, success, result.text);
      assertStringIncludes(result.text, expected);
    });
  });
}

for (
  const [tool, expected, hint] of [
    ["just", "just not found", "Install just"],
    ["gh", "gh not found", "Install the GitHub CLI"],
    ["jq", "jq not found", "Install jq"],
    ["cargo", "cargo or rustc not found", "rustup"],
    ["rustc", "cargo or rustc not found", "rustup"],
    ["cc", "no C compiler (cc, gcc or clang) found", "Install one"],
  ] as const
) {
  Deno.test(`doctor reports missing ${tool} with an installation hint`, async () => {
    await withCommands(async (bin) => {
      await Deno.remove(`${bin}/${tool}`);
      const result = await doctor(bin);
      assertEquals(result.code, 1);
      assertStringIncludes(result.text, expected);
      assertStringIncludes(result.text, hint);
    });
  });
}

Deno.test("doctor rejects just older than the minimum pin", async () => {
  await withCommands(async (bin) => {
    await executable(bin, "just", "echo just 0.1.0");
    const result = await doctor(bin);
    assertEquals(result.code, 1);
    assertStringIncludes(result.text, "just 0.1.0, but .just-version wants");
  });
});

Deno.test("doctor accepts the pinned Rust toolchain and a C compiler", async () => {
  await withCommands(async (bin) => {
    const result = await doctor(bin);
    assertEquals(result.code, 0, result.text);
    assertStringIncludes(result.text, `Rust ${rustPin} (backend/rust-toolchain.toml)`);
    assertStringIncludes(result.text, "C compiler and linker");
  });
});

for (
  const [command, expected] of [
    ["echo 'rustc 1.0.0 (fake)'", "Rust '1.0.0' in backend/"],
    ["echo 'error: toolchain is not installed' >&2; exit 1", "Rust 'unavailable' in backend/"],
  ] as const
) {
  Deno.test(`doctor diagnoses ${expected}`, async () => {
    await withCommands(async (bin) => {
      await executable(bin, "rustc", command);
      const result = await doctor(bin);
      assertEquals(result.code, 1);
      assertStringIncludes(result.text, expected);
      assertStringIncludes(result.text, `backend/rust-toolchain.toml wants ${rustPin}`);
      assertStringIncludes(result.text, "rustup toolchain install");
    });
  });
}

Deno.test("ordinary doctor does not require Azure", async () => {
  await withCommands(async (bin) => {
    const result = await doctor(bin);
    assertEquals(result.code, 0, result.text);
    assertEquals(result.text.includes("Azure CLI not found"), false);
  });
});

for (
  const [module, recipe] of [
    ["tools", "ci-timings"],
    ["tools", "versions"],
    ["tools", "handover-watch"],
    ["tools", "adr"],
    ["backend", "restore"],
    ["backend", "test"],
    ["db", "seed"],
    ["frontend", "test-web"],
    ["docs", "test"],
    ["infra", "migrate"],
    ["infra", "init-roles"],
  ] as const
) {
  Deno.test(`just ${module} ${recipe} forwards arguments as literal values`, async () => {
    await withCommands(async (bin) => {
      await Deno.remove(`${bin}/just`);
      for (const tool of ["dotnet", "deno", "cargo", "pnpm"]) {
        await executable(bin, tool, 'printf "<%s>\\n" "$@"');
      }
      const result = await new Deno.Command("just", {
        cwd: root,
        args: [module, recipe, ...(module === "infra" ? ["staging"] : []), "--example", "Docs site", "literal;$HOME"],
        clearEnv: true,
        env: { PATH: `${bin}:${Deno.env.get("PATH") ?? ""}` },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const decoder = new TextDecoder();
      assertEquals(result.code, 0, decoder.decode(result.stderr));
      assertStringIncludes(decoder.decode(result.stdout), "<--example>\n<Docs site>\n<literal;$HOME>");
    });
  });
}
