/** Quality proxies from recorded workflow conclusions and every job attempt. */
import { gh } from "../ci-timings/gh.ts";
import { type GhRunner } from "../ci-timings/baseline.ts";
import { groupBy, ordinal, pairRuns, type WorkflowRun } from "../ci-timings/timings.ts";
import { upperBound } from "../ci-timings/statistics.ts";
export interface RunCounts {
  total: number;
  passed: number;
  passedAfterRerun: number;
  failed: number;
  cancelled: number;
  superseded: number;
  other: number;
  reruns: number;
}
export interface RateInterval {
  rate: number;
  low: number;
  high: number;
}
export interface JobRate {
  job: string;
  required: boolean;
  trials: number;
  failures: number;
  verdict: string;
  rate: number | null;
  low: number | null;
  high: number | null;
}
export interface GuardDay {
  date: string;
  trials: number;
  failures: number;
}
export interface QualityScope {
  scope: string;
  listQuery: string;
  runs: RunCounts;
  failedRunIds: number[];
  rerunRunIds: number[];
  jobs: JobRate[];
  guardDays: GuardDay[];
}
export interface QualityRule {
  confidence: number;
  minTrials: number;
}
export interface QualitySection {
  workflow: string;
  basis: { runs: string; superseded: string; jobs: string; guards: string };
  sample: { runs: number; ignoredRuns: number; window: { from: string; to: string } | null };
  rule: QualityRule;
  guard: { job: string; step: string };
  scopes: QualityScope[];
}
export interface AttemptRun {
  run: WorkflowRun;
  attempt: number;
}
export interface StepResult {
  name: string;
  conclusion: string;
}
export interface AttemptJob {
  name: string;
  conclusion: string;
  attempt: number;
  steps: StepResult[];
}
export interface QualityInput {
  run: AttemptRun;
  jobs: AttemptJob[];
}
export const qualityListQueries: Record<string, string> = {
  main: "branch:main event:push",
  pullRequest: "event:pull_request",
};
export const qualityGuards = { job: "Tooling", step: "Test and lint tooling" };
export const qualityRule: QualityRule = { confidence: 0.95, minTrials: 20 };
export const maxQualityRunIds = 50;
const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: Record<string, unknown>, key: string): string => typeof value[key] === "string" ? value[key] : "";
const attempt = (value: Record<string, unknown>): number =>
  typeof value.run_attempt === "number" && Number.isInteger(value.run_attempt) && value.run_attempt <= 2147483647 &&
    value.run_attempt >= -2147483648
    ? Math.max(1, value.run_attempt)
    : 1;
const utc = (value: number) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
export function parseQualityRuns(json: string): AttemptRun[] {
  const root = obj(JSON.parse(json));
  if (!Array.isArray(root.workflow_runs)) return [];
  return root.workflow_runs.flatMap((value) => {
    const run = obj(value), id = run.id, at = run.created_at;
    const createdAt = typeof at === "string" ? Date.parse(at) : NaN;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || !Number.isFinite(createdAt)) return [];
    return [{
      run: {
        id,
        status: text(run, "status"),
        conclusion: text(run, "conclusion"),
        createdAt,
        event: text(run, "event"),
        headBranch: text(run, "head_branch"),
        headSha: text(run, "head_sha"),
      },
      attempt: attempt(run),
    }];
  });
}
export function parseQualityJobs(json: string): AttemptJob[] {
  const root = obj(JSON.parse(json));
  if (!Array.isArray(root.jobs)) return [];
  return root.jobs.flatMap((value) => {
    const job = obj(value), name = text(job, "name");
    if (!name) return [];
    return [{
      name,
      conclusion: text(job, "conclusion"),
      attempt: attempt(job),
      steps: Array.isArray(job.steps)
        ? job.steps.map((value) => {
          const step = obj(value);
          return { name: text(step, "name"), conclusion: text(step, "conclusion") };
        })
        : [],
    }];
  });
}
function roundAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
}
export function judgeRate(
  job: string,
  required: boolean,
  failures: number,
  trials: number,
  rule: QualityRule,
): JobRate {
  if (trials < rule.minTrials || trials === 0) {
    return { job, required, trials, failures, verdict: "inconclusive", rate: null, low: null, high: null };
  }
  const tail = 1 - (1 - rule.confidence) / 2;
  const high = upperBound(failures, trials, tail),
    low = failures === 0 ? 0 : 1 - upperBound(trials - failures, trials, tail);
  return {
    job,
    required,
    trials,
    failures,
    verdict: "conclusive",
    rate: roundAway(failures / trials, 4),
    low: roundAway(low, 4),
    high: roundAway(high, 4),
  };
}
export function classifyQuality(run: WorkflowRun, attempt: number, superseded: ReadonlySet<number>): string {
  switch (run.conclusion) {
    case "success":
      return attempt > 1 ? "passedAfterRerun" : "passed";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "failed";
    case "cancelled":
      return superseded.has(run.id) ? "superseded" : "cancelled";
    default:
      return "other";
  }
}
export function qualityScopeOf(run: WorkflowRun): string | null {
  if (run.event === "pull_request") return "pullRequest";
  return run.event === "push" && run.headBranch === "main" ? "main" : null;
}
function verdict(conclusion: string): boolean | null {
  return conclusion === "success" ? false : conclusion === "failure" || conclusion === "timed_out" ? true : null;
}
const newest = (inputs: readonly QualityInput[]) =>
  [...inputs].sort((a, b) => b.run.run.createdAt - a.run.run.createdAt).slice(0, maxQualityRunIds).map((input) =>
    input.run.run.id
  );
function guardDays(inputs: readonly QualityInput[]): GuardDay[] {
  const steps = inputs.flatMap((input) =>
    input.jobs.filter((job) => job.name === qualityGuards.job).flatMap((job) => job.steps).filter((step) =>
      step.name === qualityGuards.step && verdict(step.conclusion) !== null
    ).map((step) => ({ date: utc(input.run.run.createdAt).slice(0, 10), failed: verdict(step.conclusion) === true }))
  );
  return [...groupBy(steps, (step) => step.date)].sort(([a], [b]) => ordinal(a, b)).map(([date, items]) => ({
    date,
    trials: items.length,
    failures: items.filter((item) => item.failed).length,
  }));
}
function buildScope(
  scope: string,
  inputs: readonly QualityInput[],
  superseded: ReadonlySet<number>,
  trustedNames: ReadonlySet<string> | null,
): QualityScope {
  const classes = inputs.map((input) => ({
    input,
    class: classifyQuality(input.run.run, input.run.attempt, superseded),
  }));
  const count = (name: string) => classes.filter((item) => item.class === name).length;
  const counts: RunCounts = {
    total: inputs.length,
    passed: count("passed"),
    passedAfterRerun: count("passedAfterRerun"),
    failed: count("failed"),
    cancelled: count("cancelled"),
    superseded: count("superseded"),
    other: count("other"),
    reruns: inputs.filter((input) => input.run.attempt > 1).length,
  };
  const judged = classes.filter((item) => item.class !== "cancelled" && item.class !== "superseded").map((item) =>
    item.input
  );
  const jobs = judged.flatMap((input) => input.jobs).filter((job) =>
    (trustedNames === null || trustedNames.has(job.name)) && verdict(job.conclusion) !== null
  );
  const rates = [...groupBy(jobs, (job) => job.name)].sort(([a], [b]) => ordinal(a, b)).map(([name, items]) =>
    judgeRate(
      name,
      name === "CI result",
      items.filter((job) => verdict(job.conclusion) === true).length,
      items.length,
      qualityRule,
    )
  );
  return {
    scope,
    listQuery: qualityListQueries[scope]!,
    runs: counts,
    failedRunIds: newest(classes.filter((item) => item.class === "failed").map((item) => item.input)),
    rerunRunIds: newest(inputs.filter((input) => input.run.attempt > 1)),
    jobs: rates,
    guardDays: guardDays(judged),
  };
}
export function buildQuality(workflow: string, inputs: readonly QualityInput[]): QualitySection {
  const completed = inputs.filter((input) => input.run.run.status === "completed");
  const superseded = new Set(pairRuns(completed.map((input) => input.run.run)).map((pair) => pair.cancelled.id));
  const mainNames = new Set(
    completed.filter((input) => qualityScopeOf(input.run.run) === "main").flatMap((input) => input.jobs).map((job) =>
      job.name
    ),
  );
  const inScope = completed.filter((input) => qualityScopeOf(input.run.run) !== null),
    dates = inScope.map((input) => input.run.run.createdAt);
  return {
    workflow,
    basis: { runs: "measured", superseded: "inferred", jobs: "measured", guards: "inferred" },
    sample: {
      runs: inScope.length,
      ignoredRuns: completed.length - inScope.length,
      window: dates.length ? { from: utc(Math.min(...dates)), to: utc(Math.max(...dates)) } : null,
    },
    rule: { ...qualityRule },
    guard: { ...qualityGuards },
    scopes: ["main", "pullRequest"].map((scope) =>
      buildScope(
        scope,
        completed.filter((input) => qualityScopeOf(input.run.run) === scope),
        superseded,
        scope === "main" ? null : mainNames,
      )
    ),
  };
}
export function reusableJobs(run: AttemptRun, knownJobs?: ReadonlyMap<number, string> | null): string | null {
  return run.attempt === 1 ? (knownJobs?.get(run.run.id) ?? null) : null;
}
export async function collectQuality(
  repository: string,
  workflow: string,
  runCount: number,
  knownJobs?: ReadonlyMap<number, string> | null,
  runner: GhRunner = gh,
): Promise<QualityInput[]> {
  const runs: AttemptRun[] = [];
  for (let page = 1; runs.length < runCount; page++) {
    const batch = parseQualityRuns(
      await runner([
        "api",
        `repos/${repository}/actions/workflows/${workflow}/runs?status=completed&per_page=100&page=${page}`,
      ]),
    );
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  const inputs: QualityInput[] = [];
  for (const run of runs.slice(0, Math.max(0, runCount))) {
    const json = reusableJobs(run, knownJobs) ??
      await runner(["api", `repos/${repository}/actions/runs/${run.run.id}/jobs?filter=all&per_page=100`]);
    inputs.push({ run, jobs: parseQualityJobs(json) });
  }
  return inputs;
}
