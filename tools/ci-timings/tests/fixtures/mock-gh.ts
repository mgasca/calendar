#!/usr/bin/env -S deno run --no-prompt --allow-read --allow-env
// Deterministic Actions responder. Deliberately no network or GitHub authentication.
const responses: Record<string,string> = JSON.parse(await Deno.readTextFile(Deno.env.get("CI_TIMINGS_RESPONSES")!));
const command = Deno.args[0];
if (command === "run" && Deno.args[1] === "list") console.log(responses.runs);
else if (command === "repo" && Deno.args[1] === "view") console.log("o/r");
else if (command === "api") {
 const match = Deno.args[1]!.match(/\/runs\/(\d+)\/jobs/);
 if (!match || responses[match[1]!] === undefined) throw new Error("unexpected API request");
 console.log(responses[match[1]!]!);
} else if (command === "issue" && Deno.args[1] === "list") console.log("[]");
else throw new Error("unexpected gh command");
