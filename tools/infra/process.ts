import { spawn } from "node:child_process";
export interface Azure {
  run(...args: string[]): Promise<string>;
  runWithInput(input: string, ...args: string[]): Promise<string>;
  runCleanup(...args: string[]): Promise<string>;
}
/** Start a separate process group so cancellation also terminates subprocess descendants. */
export async function execute(command: string, args: string[], options: { input?: string; signal?: AbortSignal; cwd?: string; env?: Record<string, string> } = {}): Promise<{ code: number; output: string }> {
  options.signal?.throwIfAborted();
  const child = spawn(command, args, {
    detached: true, cwd: options.cwd, env: { ...Deno.env.toObject(), ...options.env },
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => output += chunk);
  // Never relay Azure stderr: it can contain secrets. Drain it to avoid a full pipe.
  child.stderr?.resume();
  const abort = () => {
    try { if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const status = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    if (options.input !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.input);
    }
    const code = await status;
    options.signal?.throwIfAborted();
    return { code, output: output.trim() };
  } finally { options.signal?.removeEventListener("abort", abort); }
}
export class AzureProcess implements Azure {
  constructor(private signal?: AbortSignal) {}
  run(...args: string[]) { return this.execute(args, undefined, this.signal); }
  runWithInput(input: string, ...args: string[]) { return this.execute(args, input, this.signal); }
  runCleanup(...args: string[]) { return this.execute(args); }
  private async execute(args: string[], input?: string, signal?: AbortSignal): Promise<string> {
    const result = await execute("az", args, { input, signal, env: { AZURE_BICEP_USE_BINARY_FROM_PATH: "false" } });
    if (result.code !== 0) throw new Error(`Azure CLI failed (exit ${result.code}); check access and parameters.`);
    return result.output;
  }
}
