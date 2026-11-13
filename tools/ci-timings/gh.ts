import { join } from "@std/path";
export const attempts = 3;
export function isTransient(error: string): boolean {
  return error.includes("Server Error") || error.includes("HTTP 5");
}
let executable: string | undefined;
function ghPath(): string {
  if (executable) return executable;
  for (const dir of (Deno.env.get("PATH") ?? "").split(Deno.build.os === "windows" ? ";" : ":")) {
    if (!dir) continue;
    const candidate = join(dir, Deno.build.os === "windows" ? "gh.exe" : "gh");
    try {
      if (Deno.statSync(candidate).isFile) return executable = candidate;
    } catch { /* try next PATH entry */ }
  }
  return executable = "/usr/bin/gh";
}
export async function gh(args: readonly string[], cwd?: string, shortError = false): Promise<string> {
  const decode = new TextDecoder();
  for (let attempt = 1;; attempt++) {
    const result = await new Deno.Command(ghPath(), { args: [...args], cwd, stdout: "piped", stderr: "piped" })
      .output();
    if (result.success) return decode.decode(result.stdout);
    const error = decode.decode(result.stderr);
    if (attempt < attempts && isTransient(error)) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      continue;
    }
    const command = shortError
      ? args.slice(
        0,
        args.findIndex((arg) => arg.startsWith("-")) < 0 ? args.length : args.findIndex((arg) => arg.startsWith("-")),
      ).join(" ")
      : args.join(" ");
    throw new Error(`gh ${command} failed (${result.code}): ${error.trim()}`);
  }
}
