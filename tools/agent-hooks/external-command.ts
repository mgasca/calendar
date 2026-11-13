import { spawn } from "node:child_process";
import process from "node:process";
import { isAbsolute, join } from "node:path";
export interface CommandOutput {
  exitCode: number;
  stdout: string;
}
export function onPath(executable: string): string {
  if (isAbsolute(executable)) return executable;
  for (const dir of (Deno.env.get("PATH") ?? "").split(":")) {
    if (!dir) continue;
    const path = join(dir, executable);
    try {
      if (Deno.statSync(path).isFile) return path;
    } catch { /* missing PATH entry */ }
  }
  return executable;
}
/** Linux/WSL: a detached process group lets timeout cleanup kill the entire descendant tree. */
export async function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  environment: Record<string, string> = {},
): Promise<CommandOutput | null> {
  try {
    if (!Deno.statSync(cwd).isDirectory) return null;
  } catch {
    return null;
  }
  const deadline = performance.now() + 2000;
  while (true) {
    const result = await new Promise<CommandOutput | "busy" | null>((resolve) => {
      const child = spawn(onPath(executable), args, {
        cwd,
        env: { ...Deno.env.toObject(), ...environment },
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", timedOut = false, failed = false;
      child.stdin.end();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.resume();
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch { /* exited concurrently */ }
        }
      }, timeoutMs);
      child.on("error", (error: Error & { code?: string }) => {
        failed = true;
        clearTimeout(timer);
        resolve(error.code === "ETXTBSY" || error.message.endsWith("Text file busy (os error 26)") ? "busy" : null);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (failed) return;
        // Match the old line reader's newline convention.
        resolve(
          timedOut || code === null
            ? null
            : { exitCode: code, stdout: stdout.length ? stdout.replace(/\r\n/g, "\n").replace(/\n?$/, "\n") : "" },
        );
      });
    });
    if (result !== "busy") return result;
    if (performance.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 20));
  }
}
