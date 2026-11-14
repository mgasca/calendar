#!/usr/bin/env -S deno run --no-prompt --allow-read --allow-write --allow-run --allow-env
/** Sample Actions durations, pin/back-test baselines, and report exact rank-test trends. */
import { gh } from "./gh.ts";
import {
  type BaselineFile,
  baselinePaths,
  buildBaseline,
  evaluateBaseline,
  type GateConstants,
  gateDefaults,
  isMain,
  isSuccessful,
  rebuildPath,
  sampleBaseline,
  type SampledRun,
  samples,
} from "./baseline.ts";
import {
  backTestTable,
  baselineTable,
  baselineWindow,
  minute,
  readBaseline,
  writeBaseline,
} from "./baseline-report.ts";
import {
  firstJobsStarted,
  jobsTable,
  type JobTiming,
  measurePair,
  ordinal,
  pairRuns,
  parseIssues,
  parseJobs,
  parseRuns,
  stepsTable,
  type SupersededPair,
  supersededTable,
  supersessionSummary,
} from "./timings.ts";
import { evaluateTrend, issueAction, issueLabel, issueTitle, recentRuns, trendDefaults, trendReport } from "./trend.ts";
export const usage =
  "usage: ci-timings [--workflow FILE] [--runs N] [--repo OWNER/NAME] [--branch NAME] [--created RANGE] [--job NAME]... [--superseded] [--baseline --created RANGE [--path NAME] [--holdout RANGE] [--out FILE] [--record FILE] [--min-runs N] [--alpha A] [--floor S] [--margin R]] [--trend [--out FILE] [--issue]]";
export interface Options {
  workflow: string;
  runs: number;
  repo?: string;
  branch?: string;
  created?: string;
  superseded: boolean;
  baseline: boolean;
  trend: boolean;
  issue: boolean;
  holdout?: string;
  path?: string;
  tunedConstants: boolean;
  output: string;
  record: string;
  minRuns: number;
  constants: GateConstants;
  jobNames: string[];
}
export function parseOptions(
  args: readonly string[],
): { options: Options; error?: never } | { options?: never; error: string } {
  const options: Options = {
    workflow: "ci.yml",
    runs: 40,
    superseded: false,
    baseline: false,
    trend: false,
    issue: false,
    tunedConstants: false,
    output: ".github/ci-baseline.json",
    record: "docs/benchmarks/0017-ci-baseline-with-changes.md",
    minRuns: 30,
    constants: { ...gateDefaults },
    jobNames: [],
  };
  const integer = (s: string) => /^\d+$/.test(s) && Number(s) <= 2147483647;
  const decimal = (s: string) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!, value = args[i + 1];
    if (["--superseded", "--baseline", "--trend", "--issue"].includes(arg)) {
      if (arg === "--superseded") options.superseded = true;
      if (arg === "--baseline") options.baseline = true;
      if (arg === "--trend") options.trend = true;
      if (arg === "--issue") options.issue = true;
      continue;
    }
    if (value === undefined) return { error: arg };
    switch (arg) {
      case "--workflow":
        options.workflow = value;
        break;
      case "--repo":
        options.repo = value;
        break;
      case "--branch":
        options.branch = value;
        break;
      case "--created":
        options.created = value;
        break;
      case "--job":
        options.jobNames.push(value);
        break;
      case "--holdout":
        options.holdout = value;
        break;
      case "--path":
        options.path = value;
        break;
      case "--out":
        options.output = value;
        break;
      case "--record":
        options.record = value;
        break;
      case "--runs":
        if (!integer(value)) return { error: arg };
        options.runs = Number(value);
        break;
      case "--min-runs":
        if (!integer(value)) return { error: arg };
        options.minRuns = Number(value);
        break;
      case "--alpha":
        if (!decimal(value)) return { error: arg };
        options.constants.alpha = Number(value);
        options.tunedConstants = true;
        break;
      case "--floor":
        if (!decimal(value)) return { error: arg };
        options.constants.floorSeconds = Number(value);
        options.tunedConstants = true;
        break;
      case "--margin":
        if (!decimal(value)) return { error: arg };
        options.constants.relativeMargin = Number(value);
        options.tunedConstants = true;
        break;
      default:
        return { error: arg };
    }
    i++;
  }
  return { options };
}
const print = async (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  while (offset < bytes.length) offset += await Deno.stdout.write(bytes.subarray(offset));
};
export async function main(args: readonly string[]): Promise<number> {
  const parsed = parseOptions(args);
  if (parsed.error !== undefined) {
    console.error("unknown argument: " + parsed.error);
    console.error(usage);
    return 2;
  }
  const o = parsed.options;
  const repoName = async () =>
    o.repo ?? (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).trim();
  if (o.trend) {
    const repo = await repoName(), pinned = readBaseline(await Deno.readTextFile(o.output));
    const pushes = parseRuns(
      await gh([
        "run",
        "list",
        "--workflow",
        o.workflow,
        "--branch",
        "main",
        "--event",
        "push",
        "--limit",
        "200",
        "--repo",
        repo,
        "--json",
        "databaseId,status,conclusion,createdAt,event,headBranch,headSha",
      ]),
    );
    const recent: SampledRun[] = [];
    for (const run of recentRuns(pinned, pushes, trendDefaults)) {
      recent.push({
        run,
        samples: samples(
          run,
          parseJobs(run.id, await gh(["api", `repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`])),
        ),
      });
    }
    const result = evaluateTrend(pinned, recent, trendDefaults), report = trendReport(result, pinned, trendDefaults);
    await print(report);
    if (o.issue) {
      const open = parseIssues(
        await gh([
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
      const action = issueAction(result, open);
      if (action !== null) {
        const path = await Deno.makeTempFile({ prefix: "ci-trend-", suffix: ".md" });
        try {
          await Deno.writeTextFile(
            path,
            report + "\nPosted by the scheduled trend check, `.github/workflows/ci-trend.yml`.\n",
          );
          const post = action === 0
            ? ["issue", "create", "--repo", repo, "--title", issueTitle, "--label", issueLabel, "--body-file", path]
            : ["issue", "comment", String(action), "--repo", repo, "--body-file", path];
          console.log((await gh(post)).trim());
        } finally {
          await Deno.remove(path);
        }
      }
    }
    return 0;
  }
  if (o.baseline) {
    if (o.created === undefined) {
      console.error("--baseline needs --created RANGE, the baseline window");
      return 2;
    }
    let existing: BaselineFile | undefined;
    if (o.path !== undefined) {
      if (!(baselinePaths as readonly string[]).includes(o.path)) {
        console.error(`--path must be ${baselinePaths.join(" or ")}, not ${o.path}`);
        return 2;
      }
      if (o.tunedConstants) {
        console.error(
          "--path keeps the constants of the existing baseline; rebuild every path to change --alpha, --floor or --margin",
        );
        return 2;
      }
      try {
        existing = readBaseline(await Deno.readTextFile(o.output));
      } catch (error) {
        console.error(
          `--path needs the existing baseline ${o.output}: ${error instanceof Error ? error.message : error}`,
        );
        return 2;
      }
      if (existing.workflow !== o.workflow) {
        console.error(`--path: ${o.output} is the baseline of ${existing.workflow}, not ${o.workflow}`);
        return 2;
      }
    }
    const repo = await repoName(),
      window = await sampleBaseline(gh, repo, o.workflow, o.created, isMain);
    let file: BaselineFile;
    try {
      file = existing === undefined
        ? buildBaseline(o.workflow, o.record, o.minRuns, o.constants, window)
        : rebuildPath(existing, o.path!, o.record, o.minRuns, window);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
    await Deno.writeTextFile(o.output, writeBaseline(file));
    const kept = Object.keys(file.carried ?? {});
    let output =
      `Baseline: ${window.length} successful runs of \`${o.workflow}\` on \`main\` in ${repo} created ${o.created}, written to \`${o.output}\`` +
      (o.path === undefined ? "" : `; only the ${o.path} path was rebuilt`) +
      (kept.length
        ? `, and ${kept.map((name) => `${name} is kept from ${file.carried![name]!.record}`).join(", ")}`
        : "") +
      ".\n\n" + baselineWindow(file) + "\n" + baselineTable(file);
    if (o.holdout !== undefined) {
      const held = await sampleBaseline(
        gh,
        repo,
        o.workflow,
        o.holdout,
        (run) => isMain(run) || run.event === "pull_request",
      );
      output += `\nBack-test on runs on \`main\` created ${o.holdout}:\n\n` +
        backTestTable(evaluateBaseline(file, held.filter((item) => isMain(item.run)).flatMap((item) => item.samples)));
      output += `\nBack-test on pull request runs created ${o.holdout}:\n\n` +
        backTestTable(
          evaluateBaseline(
            file,
            held.filter((item) => item.run.event === "pull_request").flatMap((item) => item.samples),
          ),
        );
    }
    await print(output);
    return 0;
  }
  const list = parseRuns(
    await gh([
      "run",
      "list",
      "--workflow",
      o.workflow,
      "--limit",
      String(o.runs * (o.superseded ? 5 : 2)),
      "--json",
      "databaseId,status,conclusion,createdAt,event,headBranch",
      ...(o.repo === undefined ? [] : ["--repo", o.repo]),
      ...(o.branch === undefined ? [] : ["--branch", o.branch]),
      ...(o.created === undefined ? [] : ["--created", o.created]),
    ]),
  );
  const repo = await repoName(),
    scope = (o.branch === undefined ? "" : ` on branch \`${o.branch}\``) +
      (o.created === undefined ? "" : ` created ${o.created}`);
  const cache = new Map<number, JobTiming[]>();
  const jobsOf = async (id: number) => {
    let jobs = cache.get(id);
    if (!jobs) {
      jobs = parseJobs(id, await gh(["api", `repos/${repo}/actions/runs/${id}/jobs?per_page=50`]));
      cache.set(id, jobs);
    }
    return jobs;
  };
  if (o.superseded) {
    const pairs: SupersededPair[] = [];
    for (const { cancelled, superseding } of pairRuns(list)) {
      if (pairs.length === o.runs) break;
      const pair = measurePair(cancelled, superseding, await jobsOf(cancelled.id), await jobsOf(superseding.id));
      if (pair) pairs.push(pair);
    }
    if (!pairs.length) {
      console.error(`no superseded pull request runs of ${o.workflow} in the last ${o.runs * 5} runs${scope}`);
      return 1;
    }
    const supersedingIds = new Set(pairs.map((pair) => pair.supersedingRunId)),
      first: number[] = [],
      all: number[] = [];
    for (
      const run of list.filter((run) =>
        run.event === "pull_request" && run.conclusion === "success" && !supersedingIds.has(run.id)
      ).slice(0, o.runs)
    ) {
      const jobs = await jobsOf(run.id);
      if (jobs.length) first.push((Math.min(...jobs.map((job) => job.startedAt)) - run.createdAt) / 1000);
      const started = firstJobsStarted(jobs);
      if (started !== null) all.push((started - run.createdAt) / 1000);
    }
    await print(
      `Sample: ${pairs.length} superseded pull request runs of \`${o.workflow}\` in ${repo}${scope}, superseded ${
        minute(pairs.at(-1)!.supersededAt)
      } to ${minute(pairs[0]!.supersededAt)}, and ${first.length} pull request runs that superseded nothing.\n\n` +
        supersessionSummary(pairs, first, all) + "\n" + supersededTable(pairs),
    );
    return 0;
  }
  const sample = list.filter(isSuccessful).slice(0, o.runs);
  if (!sample.length) {
    console.error(`no successful runs of ${o.workflow} in the last ${o.runs * 2} runs`);
    return 1;
  }
  const jobs: JobTiming[] = [];
  for (const run of sample) jobs.push(...await jobsOf(run.id));
  const events = [...new Set(sample.map((run) => run.event))].sort(ordinal);
  let output =
    `Sample: ${sample.length} successful runs of \`${o.workflow}\` in ${repo}${scope}, ${
      minute(sample.at(-1)!.createdAt)
    } to ${minute(sample[0]!.createdAt)} (events: ${events.join(", ")}).\n\n` + jobsTable(jobs);
  for (const name of o.jobNames) output += `\nSteps of \`${name}\`:\n\n` + stepsTable(jobs, name);
  await print(output);
  return 0;
}
if (import.meta.main) Deno.exit(await main(Deno.args));
