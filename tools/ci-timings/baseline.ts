import { normalQuantile, percentile, roundEven } from "./statistics.ts";
import { type JobTiming, ordinal, parseJobs, parseRuns, type WorkflowRun } from "./timings.ts";
export interface GateConstants {
  alpha: number;
  jobs: number;
  floorSeconds: number;
  relativeMargin: number;
}
export const gateDefaults: GateConstants = { alpha: 0.001, jobs: 5, floorSeconds: 15, relativeMargin: 0.1 };
export interface JobBaseline {
  count: number;
  median: number;
  logMedian: number;
  logMad: number;
  p90: number;
  p95: number;
  max: number;
  threshold: number;
  seconds: number[];
}
export interface PathBaseline {
  path: string;
  status: string;
  runs: WorkflowRun[];
  jobs: Record<string, JobBaseline>;
}
/** Where a path kept by a one-path rebuild was derived: its record and the constants of its thresholds. */
export interface CarriedPath {
  record: string;
  constants: GateConstants;
}
export interface BaselineFile {
  workflow: string;
  record: string;
  minRuns: number;
  constants: GateConstants;
  paths: Record<string, PathBaseline>;
  /** Paths copied unchanged from an earlier file, keyed by path; absent when every path was built from one window. */
  carried?: Record<string, CarriedPath>;
}
export const baselinePaths = ["check", "publication"] as const;
export interface PathSample {
  runId: number;
  job: string;
  path: string;
  seconds: number;
}
export interface SampledRun {
  run: WorkflowRun;
  samples: PathSample[];
}
export const publicationStep = "Build and verify publication artifact";
export const ungated = new Set(["CI result", "Cancel superseded runs"]);
export function pathOf(jobs: readonly JobTiming[]): string {
  return jobs.some((job) =>
      job.name === "Docs site" &&
      job.steps.some((step) => step.name === publicationStep && step.conclusion === "success")
    )
    ? "publication"
    : "check";
}
export function samples(run: WorkflowRun, jobs: readonly JobTiming[]): PathSample[] {
  const path = pathOf(jobs);
  return jobs.filter((job) => job.conclusion === "success" && !ungated.has(job.name)).map((job) => ({
    runId: run.id,
    job: job.name,
    path,
    seconds: job.seconds,
  }));
}
export function threshold(median: number, logMedian: number, logMad: number, constants: GateConstants): number {
  const bound = Math.exp(logMedian + normalQuantile(1 - constants.alpha / constants.jobs) * 1.4826 * logMad);
  const practical = median + Math.max(constants.floorSeconds, constants.relativeMargin * median);
  return Math.ceil(roundEven(Math.max(bound, practical), 6));
}
export function derive(seconds: Iterable<number>, constants: GateConstants): JobBaseline {
  const sorted = [...seconds].sort((a, b) => a - b);
  if (!sorted.length) throw new Error("a baseline needs at least one duration");
  const logs = sorted.map(Math.log), logMedian = percentile(logs, 0.5);
  const logMad = percentile(logs.map((v) => Math.abs(v - logMedian)).sort((a, b) => a - b), 0.5);
  const median = percentile(sorted, 0.5);
  return {
    count: sorted.length,
    median,
    logMedian: roundEven(logMedian, 6),
    logMad: roundEven(logMad, 6),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1]!,
    threshold: threshold(median, logMedian, logMad, constants),
    seconds: sorted,
  };
}
export function buildPath(
  path: string,
  runs: readonly WorkflowRun[],
  all: readonly PathSample[],
  minRuns: number,
  constants: GateConstants,
): PathBaseline | null {
  const onPath = all.filter((sample) => sample.path === path);
  if (!onPath.length) return null;
  const ids = new Set(onPath.map((sample) => sample.runId));
  const names = [...new Set(onPath.map((sample) => sample.job))].sort(ordinal);
  const jobs = Object.fromEntries(
    names.map((name) => [
      name,
      derive(onPath.filter((sample) => sample.job === name).map((sample) => sample.seconds), constants),
    ]),
  );
  return {
    path,
    status: Object.values(jobs).every((job) => job.count >= minRuns) ? "pinned" : "provisional",
    runs: runs.filter((run) => ids.has(run.id)).sort((a, b) => a.createdAt - b.createdAt),
    jobs,
  };
}
export function isSuccessful(run: WorkflowRun): boolean {
  return run.status === "completed" && run.conclusion === "success";
}
export function isMain(run: WorkflowRun): boolean {
  return run.headBranch === "main" && ["push", "workflow_dispatch"].includes(run.event);
}
export function buildBaseline(
  workflow: string,
  record: string,
  minRuns: number,
  constants: GateConstants,
  sampled: readonly SampledRun[],
): BaselineFile {
  const all = sampled.flatMap((item) => item.samples), runs = sampled.map((item) => item.run);
  const jobs = new Set(all.map((sample) => sample.job)).size;
  if (jobs > 0) constants = { ...constants, jobs };
  const paths: Record<string, PathBaseline> = {};
  for (const path of baselinePaths) {
    const built = buildPath(path, runs, all, minRuns, constants);
    if (built) paths[path] = built;
  }
  return { workflow, record, minRuns, constants, paths };
}
/**
 * Rebuilds one path from a window and copies every other path of `existing` unchanged. The new top-level record and
 * constants describe the rebuilt path; each copied path keeps, under `carried`, the record and constants its thresholds
 * were derived with. J counts the distinct jobs of the resulting file, as for a full rebuild.
 */
export function rebuildPath(
  existing: BaselineFile,
  path: string,
  record: string,
  minRuns: number,
  sampled: readonly SampledRun[],
): BaselineFile {
  if (!(baselinePaths as readonly string[]).includes(path)) {
    throw new Error(`unknown path ${path}; expected ${baselinePaths.join(" or ")}`);
  }
  const all = sampled.flatMap((item) => item.samples).filter((sample) => sample.path === path),
    runs = sampled.map((item) => item.run);
  const kept = Object.values(existing.paths).filter((other) => other.path !== path);
  const jobs = new Set([...all.map((sample) => sample.job), ...kept.flatMap((other) => Object.keys(other.jobs))]).size;
  const constants = { ...existing.constants, jobs };
  const built = buildPath(path, runs, all, minRuns, constants);
  if (!built) throw new Error(`no successful run on the ${path} path in the window`);
  const paths: Record<string, PathBaseline> = {}, carried: Record<string, CarriedPath> = {};
  for (const other of kept) {
    paths[other.path] = other;
    carried[other.path] = existing.carried?.[other.path] ??
      { record: existing.record, constants: { ...existing.constants } };
  }
  paths[path] = built;
  return {
    workflow: existing.workflow,
    record,
    minRuns,
    constants,
    paths,
    ...(Object.keys(carried).length ? { carried } : {}),
  };
}
export interface Exceedance extends PathSample {
  threshold: number;
}
export interface BackTest {
  runs: number;
  failedRuns: number;
  jobChecks: { job: string; path: string; checked: number; exceeded: number }[];
  exceedances: Exceedance[];
}
export function evaluateBaseline(baseline: BaselineFile, all: readonly PathSample[]): BackTest {
  const pinned = new Set(Object.values(baseline.paths).flatMap((path) => path.runs.map((run) => run.id)));
  const checked = new Set<number>(),
    exceedances: Exceedance[] = [],
    checks = new Map<string, { job: string; path: string; checked: number; exceeded: number }>();
  for (const sample of all.filter((sample) => !pinned.has(sample.runId))) {
    const job = baseline.paths[sample.path]?.jobs[sample.job];
    if (!job) continue;
    checked.add(sample.runId);
    const exceeded = sample.seconds > job.threshold;
    const key = JSON.stringify([sample.job, sample.path]);
    const count = checks.get(key) ?? { job: sample.job, path: sample.path, checked: 0, exceeded: 0 };
    count.checked++;
    if (exceeded) count.exceeded++;
    checks.set(key, count);
    if (exceeded) exceedances.push({ ...sample, threshold: job.threshold });
  }
  return {
    runs: checked.size,
    failedRuns: new Set(exceedances.map((item) => item.runId)).size,
    jobChecks: [...checks.values()].sort((a, b) => ordinal(a.job, b.job) || ordinal(a.path, b.path)),
    exceedances,
  };
}
export const listLimit = 1000;
export type GhRunner = (args: readonly string[]) => Promise<string>;
export async function sampleBaseline(
  gh: GhRunner,
  repo: string,
  workflow: string,
  range: string,
  keep: (run: WorkflowRun) => boolean,
): Promise<SampledRun[]> {
  const listed = parseRuns(
    await gh([
      "run",
      "list",
      "--workflow",
      workflow,
      "--limit",
      String(listLimit),
      "--created",
      range,
      "--repo",
      repo,
      "--json",
      "databaseId,status,conclusion,createdAt,event,headBranch,headSha",
    ]),
  );
  if (listed.length >= listLimit) {
    throw new Error(
      `the window ${range} holds at least ${listLimit} runs of ${workflow}, so its oldest runs would be left out; narrow it`,
    );
  }
  const sampled: SampledRun[] = [];
  for (const run of listed.filter((run) => isSuccessful(run) && keep(run)).sort((a, b) => a.createdAt - b.createdAt)) {
    const jobs = parseJobs(run.id, await gh(["api", `repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`]));
    sampled.push({ run, samples: samples(run, jobs) });
  }
  return sampled;
}
