import { AzureProcess } from "./process.ts";
import { run } from "./infrastructure.ts";
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
Deno.addSignalListener("SIGINT", cancel);
Deno.addSignalListener("SIGTERM", cancel);
try { Deno.exitCode = await run(Deno.args, new AzureProcess(cancellation.signal), console.log, console.error, cancellation.signal); }
finally { Deno.removeSignalListener("SIGINT", cancel); Deno.removeSignalListener("SIGTERM", cancel); }
