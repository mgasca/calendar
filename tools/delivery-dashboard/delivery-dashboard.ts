#!/usr/bin/env -S deno run --no-prompt --allow-read --allow-write --allow-run --allow-env
/** Public aggregate delivery snapshot collector, validator, alerts and retention CLI. */
import { gh } from "../ci-timings/gh.ts";
import { type GhRunner, isMain, isSuccessful, type SampledRun, samples } from "../ci-timings/baseline.ts";
import { readBaseline } from "../ci-timings/baseline-report.ts";
import { parseIssues, parseJobs, parseRuns } from "../ci-timings/timings.ts";
import { buildCi, currentVersion, queueSeconds, type Snapshot, timeString, writeSnapshot } from "./snapshot.ts";
import { validateSnapshot } from "./snapshot-rules.ts";
import { buildQuality, collectQuality } from "./quality.ts";
import { buildAgents, collectAgents } from "./agents.ts";
import { collectFlow } from "./flow.ts";
import { collectSuperseded } from "./superseded.ts";
import { alertActions, checkRetention, evaluateAlerts, issueLabel, limitBytes } from "./alerts.ts";
const usageText =
  "usage: delivery-dashboard snapshot [--repo OWNER/NAME] [--workflow FILE] [--runs N] [--quality-runs N] [--date YYYY-MM-DD] [--out FILE] | delivery-dashboard check FILE...";
function usage(message: string): number {
  console.error(message);
  console.error(usageText);
  return 2;
}
const uint = (v: string | undefined) =>
  v !== undefined && /^\d+$/.test(v) && Number(v) <= 2147483647 ? Number(v) : null;
const ulong = (v: string | undefined) =>
  v !== undefined && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
export async function main(args: readonly string[], runner: GhRunner = gh): Promise<number> {
  if (!args.length) return usage("a command is needed");
  const [command, ...rest] = args;
  if (command === "check") {
    if (!rest.length) return usage("check needs at least one file");
    let failed = false;
    for (const file of rest) {
      const problems = validateSnapshot(await Deno.readTextFile(file));
      console.log(`${problems.length ? "FAIL" : "OK  "} ${file}`);
      for (const problem of problems) console.log("  " + problem);
      failed ||= problems.length > 0;
    }
    return failed ? 1 : 0;
  }
  if (command === "retention") {
    let limit = limitBytes, incoming = 0;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i], value = ulong(rest[++i]);
      if (value === null) return usage(`unknown or incomplete argument: ${arg}`);
      if (arg === "--limit-mb") limit = value * 1024 * 1024;
      else if (arg === "--add") incoming = value;
      else return usage(`unknown or incomplete argument: ${arg}`);
    }
    const verdict = checkRetention(await new Response(Deno.stdin.readable).text(), limit, incoming);
    console.log(verdict.message);
    if (verdict.status === "warning") console.log("::warning::" + verdict.message);
    return verdict.status === "over" ? 1 : 0;
  }
  if (command === "alerts") {
    let file: string | null = null, repo: string | null = null, pageUrl = "", post = false;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--issue") {
        post = true;
        continue;
      }
      const value = rest[++i];
      if (value === undefined) return usage(`unknown or incomplete argument: ${arg}`);
      if (arg === "--snapshot") file = value;
      else if (arg === "--repo") repo = value;
      else if (arg === "--page-url") pageUrl = value;
      else return usage(`unknown or incomplete argument: ${arg}`);
    }
    if (file === null) return usage("alerts needs --snapshot FILE");
    const json = await Deno.readTextFile(file), problems = validateSnapshot(json);
    if (problems.length) {
      for (const p of problems) console.error(p);
      console.error("the snapshot does not pass the rules; no alert is evaluated");
      return 1;
    }
    const breaches = evaluateAlerts(json);
    console.log(
      breaches.length ? breaches.map((b) => `- [${b.kind}] ${b.text}`).join("\n") : "No threshold is breached.",
    );
    if (!post || !breaches.length) return 0;
    repo ??= (await runner(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).trim();
    const open = parseIssues(
      await runner([
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--label",
        issueLabel,
        "--limit",
        "100",
        "--json",
        "number,title",
      ]),
    );
    for (const action of alertActions(breaches, open, pageUrl)) {
      const path = await Deno.makeTempFile({ prefix: `dashboard-alert-${Deno.pid}-${action.kind}-`, suffix: ".md" });
      try {
        await Deno.writeTextFile(path, action.body);
        const command = action.issue === 0
          ? ["issue", "create", "--repo", repo, "--title", action.title, "--label", issueLabel, "--body-file", path]
          : ["issue", "comment", String(action.issue), "--repo", repo, "--body-file", path];
        console.log((await runner(command)).trim());
      } finally {
        await Deno.remove(path);
      }
    }
    return 0;
  }
  if (command !== "snapshot") return usage(`unknown command: ${command}`);
  let workflow = "ci.yml",
    baselinePath = ".github/ci-baseline.json",
    runCount = 30,
    qualityRuns = 100,
    repo: string | null = null,
    output: string | null = null,
    date: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i], value = rest[++i];
    if (value === undefined) return usage(`unknown or incomplete argument: ${arg}`);
    if (arg === "--workflow") workflow = value;
    else if (arg === "--baseline") baselinePath = value;
    else if (arg === "--repo") repo = value;
    else if (arg === "--out") output = value;
    else if (arg === "--runs" || arg === "--quality-runs") {
      const n = uint(value);
      if (n === null) return usage(`unknown or incomplete argument: ${arg}`);
      if (arg === "--runs") runCount = n;
      else qualityRuns = n;
    } else if (
      arg === "--date" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value && !value.startsWith("0000")
    ) date = value;
    else return usage(`unknown or incomplete argument: ${arg}`);
  }
  const repository = repo ??
    (await runner(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).trim();
  const listed = parseRuns(
    await runner([
      "run",
      "list",
      "--workflow",
      workflow,
      "--branch",
      "main",
      "--event",
      "push",
      "--status",
      "success",
      "--repo",
      repository,
      "--limit",
      String(Math.max(runCount * 2, 20)),
      "--json",
      "databaseId,status,conclusion,createdAt,event,headBranch,headSha",
    ]),
  );
  const sampled: SampledRun[] = [], fetchedJobs = new Map<number, string>(), queue: number[] = [];
  for (const run of listed.filter((r) => isSuccessful(r) && isMain(r)).slice(0, runCount)) {
    const json = await runner(["api", `repos/${repository}/actions/runs/${run.id}/jobs?per_page=50`]);
    fetchedJobs.set(run.id, json);
    const jobs = parseJobs(run.id, json);
    sampled.push({ run, samples: samples(run, jobs) });
    const wait = queueSeconds(run, jobs);
    if (wait !== null) queue.push(wait);
  }
  let pinned = null;
  try {
    pinned = readBaseline(await Deno.readTextFile(baselinePath));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const now = Math.floor(Date.now() / 1000) * 1000;
  const snapshot: Snapshot = {
    version: currentVersion,
    date: date ?? timeString(now).slice(0, 10),
    generatedAt: timeString(now),
    repository,
    ci: buildCi(workflow, sampled, pinned, undefined, queue),
    quality: buildQuality(workflow, await collectQuality(repository, workflow, qualityRuns, fetchedJobs, runner)),
    flow: await collectFlow(repository, now, runner),
    agents: buildAgents(await collectAgents(repository, 100, runner)),
    superseded: await collectSuperseded(repository, workflow, 30, runner),
  };
  const json = writeSnapshot(snapshot), problems = validateSnapshot(json);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    console.error("the snapshot does not pass the rules; nothing was written");
    return 1;
  }
  if (output === null) {
    const bytes = new TextEncoder().encode(json);
    let offset = 0;
    while (offset < bytes.length) offset += await Deno.stdout.write(bytes.subarray(offset));
  } else {
    await Deno.writeTextFile(output, json);
    console.log(`wrote ${output}: ${sampled.length} runs of ${workflow}, ${snapshot.ci.jobs.length} job and path rows`);
    const quality = snapshot.quality as ReturnType<typeof buildQuality>,
      agents = snapshot.agents as ReturnType<typeof buildAgents>;
    console.log(`quality: ${quality.sample.runs} runs in scope, ${quality.sample.ignoredRuns} ignored`);
    console.log(
      `agents: ${agents.sample.scanned} issues scanned, ${agents.activity.issues} listed, ${agents.activity.withCounts} with count comments`,
    );
  }
  return 0;
}
if (import.meta.main) Deno.exit(await main(Deno.args));
