import { fixed, roundEven, summarize } from "./statistics.ts";

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string;
  createdAt: number;
  event: string;
  headBranch: string;
  headSha: string;
}
export interface StepTiming {
  number: number;
  name: string;
  startedAt: number;
  completedAt: number;
  conclusion: string;
  seconds: number;
}
export interface JobTiming {
  runId: number;
  name: string;
  conclusion: string;
  startedAt: number;
  completedAt: number;
  steps: StepTiming[];
  createdAt: number | null;
  seconds: number;
}
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected JSON object");
  return value as JsonObject;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected JSON array");
  return value;
}
export function text(value: JsonObject, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("expected safe integer");
  return value;
}
export function time(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function parseRuns(json: string): WorkflowRun[] {
  return array(JSON.parse(json)).map((value) => {
    const run = object(value), createdAt = time(run.createdAt);
    if (createdAt === null) throw new Error("invalid createdAt");
    return {
      id: integer(run.databaseId),
      status: text(run, "status"),
      conclusion: text(run, "conclusion"),
      createdAt,
      event: text(run, "event"),
      headBranch: text(run, "headBranch"),
      headSha: text(run, "headSha"),
    };
  });
}
export function parseJobs(runId: number, json: string): JobTiming[] {
  return array(object(JSON.parse(json)).jobs).flatMap((value) => {
    const job = object(value), startedAt = time(job.started_at), completedAt = time(job.completed_at);
    if (text(job, "conclusion") === "skipped" || startedAt === null || completedAt === null) return [];
    const steps = array(job.steps).flatMap((value) => {
      const step = object(value), start = time(step.started_at), end = time(step.completed_at);
      return start === null || end === null ? [] : [{
        number: integer(step.number),
        name: text(step, "name"),
        startedAt: start,
        completedAt: end,
        conclusion: text(step, "conclusion"),
        seconds: (end - start) / 1000,
      }];
    });
    return [{
      runId,
      name: text(job, "name"),
      conclusion: text(job, "conclusion"),
      startedAt,
      completedAt,
      steps,
      createdAt: time(job.created_at),
      seconds: (completedAt - startedAt) / 1000,
    }];
  });
}
export function parseIssues(json: string): { number: number; title: string }[] {
  return array(JSON.parse(json)).map((value) => {
    const issue = object(value);
    return { number: integer(issue.number), title: text(issue, "title") };
  });
}
export function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function groupBy<T>(values: Iterable<T>, key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const k = key(value);
    const group = groups.get(k);
    if (group) group.push(value);
    else groups.set(k, [value]);
  }
  return groups;
}
export function clock(seconds: number): string {
  const whole = roundEven(seconds);
  return `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
export function jobsTable(jobs: readonly JobTiming[]): string {
  const rows = [...groupBy(jobs, (job) => job.name)].map(([name, items]) => ({
    name,
    stats: summarize(items.map((job) => job.seconds)),
  }))
    .sort((a, b) => b.stats.median - a.stats.median || ordinal(a.name, b.name));
  return "| Job | n | min | median | p90 | max |\n| --- | --: | --: | --: | --: | --: |\n" +
    rows.map(({ name, stats: s }) =>
      `| ${name} | ${s.count} | ${clock(s.min)} | ${clock(s.median)} | ${clock(s.p90)} | ${clock(s.max)} |\n`
    ).join("");
}
export function stepsTable(jobs: readonly JobTiming[], jobName: string): string {
  const steps = jobs.filter((job) => job.name === jobName).flatMap((job) => job.steps);
  const rows = [...groupBy(steps, (step) => step.name)].map(([name, items]) => ({
    name,
    number: Math.min(...items.map((step) => step.number)),
    stats: summarize(items.map((step) => step.seconds)),
  }))
    .sort((a, b) => a.number - b.number || ordinal(a.name, b.name));
  return "| Step | n | min s | median s | p90 s | max s | mean s |\n| --- | --: | --: | --: | --: | --: | --: |\n" +
    rows.map(({ name, number, stats: s }) =>
      `| ${number}. ${name} | ${s.count} | ${roundEven(s.min)} | ${roundEven(s.median)} | ${roundEven(s.p90)} | ${
        roundEven(s.max)
      } | ${fixed(s.mean, 1)} |\n`
    ).join("");
}
export function pairRuns(runs: readonly WorkflowRun[]): { cancelled: WorkflowRun; superseding: WorkflowRun }[] {
  const ordered = runs.filter((run) => run.event === "pull_request").sort((a, b) => a.createdAt - b.createdAt);
  return ordered.flatMap((run, index) => {
    if (run.conclusion !== "cancelled") return [];
    const next = ordered.slice(index + 1).find((later) => later.headBranch === run.headBranch);
    return next ? [{ cancelled: run, superseding: next }] : [];
  }).reverse();
}
export interface SupersededPair {
  cancelledRunId: number;
  supersedingRunId: number;
  supersededAt: number;
  pushGap: number;
  wait: number | null;
  allStarted: number | null;
  cancelNotHeardAt: number | null;
  cancelHeardBy: number | null;
  cancelledJobsEnd: number | null;
  runEnd: number;
  jobsNotCancelled: string;
}
export function isBookkeeping(name: string): boolean {
  return name.startsWith("Post ") ||
    ["Set up job", "Complete job", "Initialize containers", "Stop containers"].includes(name);
}
export function firstJobsStarted(jobs: readonly JobTiming[]): number | null {
  const created = jobs.filter((job): job is JobTiming & { createdAt: number } => job.createdAt !== null);
  if (!created.length) return null;
  const firstWave = Math.min(...created.map((job) => job.createdAt)) + 5000;
  return Math.max(...created.filter((job) => job.createdAt <= firstWave).map((job) => job.startedAt));
}
export function measurePair(
  cancelled: WorkflowRun,
  superseding: WorkflowRun,
  oldJobs: readonly JobTiming[],
  newJobs: readonly JobTiming[],
): SupersededPair | null {
  const t0 = superseding.createdAt;
  if (!oldJobs.length || Math.max(...oldJobs.map((job) => job.completedAt)) <= t0) return null;
  const after = (t: number) => (t - t0) / 1000;
  const stopped = oldJobs.filter((job) => job.conclusion === "cancelled");
  const notHeard = stopped.flatMap((job) => job.steps).filter((step) =>
    ["success", "failure", "cancelled"].includes(step.conclusion) && !isBookkeeping(step.name) && step.startedAt > t0
  ).map((step) => after(step.startedAt));
  const heard = oldJobs.flatMap((job) => job.steps).filter((step) =>
    step.conclusion === "cancelled" && step.completedAt > t0
  ).map((step) => after(step.completedAt));
  const allStarted = firstJobsStarted(newJobs);
  return {
    cancelledRunId: cancelled.id,
    supersedingRunId: superseding.id,
    supersededAt: t0,
    pushGap: after(t0) - (cancelled.createdAt - t0) / 1000,
    wait: newJobs.length ? after(Math.min(...newJobs.map((job) => job.startedAt))) : null,
    allStarted: allStarted === null ? null : after(allStarted),
    cancelNotHeardAt: notHeard.length ? Math.max(...notHeard) : null,
    cancelHeardBy: heard.length ? Math.min(...heard) : null,
    cancelledJobsEnd: stopped.length ? after(Math.max(...stopped.map((job) => job.completedAt))) : null,
    runEnd: after(Math.max(...oldJobs.map((job) => job.completedAt))),
    jobsNotCancelled: oldJobs.filter((job) => job.conclusion !== "cancelled").map((job) =>
      `${job.name} ${job.conclusion}`
    ).join(", "),
  };
}
const wholeOrDash = (seconds: number | null) => seconds === null ? "–" : String(roundEven(seconds));
export function supersededTable(pairs: readonly SupersededPair[]): string {
  return "| Cancelled | Superseding | Push gap s | Wait s | All started s | Cancel heard s | Old jobs end s | Old run ends s | Not cancelled |\n| --- | --- | --: | --: | --: | --: | --: | --: | --- |\n" +
    pairs.map((p) =>
      `| ${p.cancelledRunId} | ${p.supersedingRunId} | ${roundEven(p.pushGap)} | ${wholeOrDash(p.wait)} | ${
        wholeOrDash(p.allStarted)
      } | ${wholeOrDash(p.cancelNotHeardAt)}..${wholeOrDash(p.cancelHeardBy)} | ${wholeOrDash(p.cancelledJobsEnd)} | ${
        roundEven(p.runEnd)
      } | ${p.jobsNotCancelled || "–"} |\n`
    ).join("");
}
export function supersessionSummary(
  pairs: readonly SupersededPair[],
  controlFirstJob: readonly number[],
  controlAllStarted: readonly number[],
): string {
  const values = (key: keyof SupersededPair) =>
    pairs.map((p) => p[key]).filter((v): v is number => typeof v === "number");
  const rows: [string, number[] | readonly number[]][] = [
    ["Wait: the superseding run's first job starts", values("wait")],
    ["All of the superseding run's first jobs have started", values("allStarted")],
    ["The old run's runners had not yet heard of the cancel (lower bound)", values("cancelNotHeardAt")],
    ["The old run's runners had heard of it (upper bound)", values("cancelHeardBy")],
    ["The old run's cancelled jobs end", values("cancelledJobsEnd")],
    ["The old run ends", values("runEnd")],
    ["Control: a pull request run that superseded nothing, created → first job", controlFirstJob],
    ["Control: the same runs, created → all first jobs started", controlAllStarted],
  ];
  return "| Seconds after the superseding run was created | n | min | median | p90 | max |\n| --- | --: | --: | --: | --: | --: |\n" +
    rows.map(([label, values]) => {
      const s = summarize(values);
      return `| ${label} | ${s.count} | ${
        s.count ? [s.min, s.median, s.p90, s.max].map((v) => roundEven(v)).join(" | ") : "– | – | – | –"
      } |\n`;
    }).join("");
}
