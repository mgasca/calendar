#!/usr/bin/env -S deno run --no-prompt --allow-read --allow-write --allow-run --allow-env
/** Print new discussion and PR states; persist IDs only after writing stdout successfully. */
import { dirname, fromFileUrl, resolve } from "@std/path";
import { gh } from "../ci-timings/gh.ts";
import {
  fetchSnapshot,
  maxFollowUps,
  newItems,
  parseOptions,
  parseSeen,
  queryArguments,
  recordPathFor,
  render,
  seenLines,
  stateItems,
  usage,
} from "./watch.ts";
export async function main(args: readonly string[]): Promise<number> {
  const options = parseOptions(args);
  if (!options) {
    console.error(usage);
    return 2;
  }
  const root = resolve(dirname(fromFileUrl(import.meta.url)), "../..");
  try {
    const snapshot = await fetchSnapshot(options, (request) => gh(queryArguments(request), root, true));
    const prs = snapshot.pullRequests, recordPath = recordPathFor(root, options.issue);
    let record = "";
    try {
      record = await Deno.readTextFile(recordPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const fresh = newItems([...snapshot.items, ...stateItems(prs)], parseSeen(record));
    const output = new TextEncoder().encode(render(options.issue, prs, fresh));
    let offset = 0;
    while (offset < output.length) offset += await Deno.stdout.write(output.subarray(offset));
    if (!options.peek && fresh.length) {
      await Deno.mkdir(dirname(recordPath), { recursive: true });
      await Deno.writeTextFile(recordPath, seenLines(fresh), { append: true });
    }
    if (snapshot.unfinished.length) {
      console.error(
        `handover-watch: stopped after ${maxFollowUps} follow-up rounds; not read to the end: ${
          snapshot.unfinished.join(", ")
        }`,
      );
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(`handover-watch: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
if (import.meta.main) Deno.exit(await main(Deno.args));
