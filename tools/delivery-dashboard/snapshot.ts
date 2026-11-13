import { type BaselineFile, type SampledRun } from "../ci-timings/baseline.ts";
import { evaluateTrend, recentRuns, type TrendConstants, trendDefaults } from "../ci-timings/trend.ts";
import { summarize } from "../ci-timings/statistics.ts";
import { groupBy, type JobTiming, ordinal, type WorkflowRun } from "../ci-timings/timings.ts";
export interface SampleWindow {
  from: string;
  to: string;
}
export interface JobBaselineStat {
  count: number;
  medianSeconds: number;
  thresholdSeconds: number;
}
export interface JobTrend {
  verdict: string;
  recentRuns: number;
  shiftSeconds: number;
  lowSeconds: number;
  highSeconds: number;
  minEffectSeconds: number;
}
export interface JobStat {
  job: string;
  path: string;
  count: number;
  minSeconds: number;
  medianSeconds: number;
  p90Seconds: number;
  maxSeconds: number;
  baseline: JobBaselineStat | null;
  trend: JobTrend | null;
}
export interface TrendSection {
  runs: number;
  required: number;
  window: SampleWindow | null;
}
export interface QueueStat {
  runs: number;
  medianSeconds: number;
  p90Seconds: number;
  maxSeconds: number;
}
export interface CiSection {
  workflow: string;
  basis: string;
  runs: number;
  window: SampleWindow | null;
  trend: TrendSection | null;
  queue: QueueStat | null;
  jobs: JobStat[];
}
export interface Snapshot {
  version: number;
  date: string;
  generatedAt: string;
  repository: string;
  ci: CiSection;
  quality?: unknown;
  flow?: unknown;
  agents?: unknown;
  superseded?: unknown;
}
export const currentVersion = 3, oldestVersion = 1;
export const timeString = (time: number) => new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
export const round = (seconds: number) => Math.sign(seconds) * Math.round(Math.abs(seconds) * 10) / 10;
export function sampleWindow(runs: readonly WorkflowRun[]): SampleWindow | null {
  return runs.length
    ? {
      from: timeString(Math.min(...runs.map((r) => r.createdAt))),
      to: timeString(Math.max(...runs.map((r) => r.createdAt))),
    }
    : null;
}
export function queueSeconds(run: WorkflowRun, jobs: readonly JobTiming[]): number | null {
  if (!jobs.length) return null;
  const wait = (Math.min(...jobs.map((j) => j.startedAt)) - run.createdAt) / 1000;
  return wait < 0 ? null : wait;
}
export function buildCi(
  workflow: string,
  runs: readonly SampledRun[],
  baseline: BaselineFile | null = null,
  constants: TrendConstants = trendDefaults,
  queue: readonly number[] | null = null,
): CiSection {
  const ids = baseline ? new Set(recentRuns(baseline, runs.map((r) => r.run), constants).map((r) => r.id)) : null;
  const trend = baseline ? evaluateTrend(baseline, runs.filter((r) => ids!.has(r.run.id)), constants) : null;
  const jobs = [...groupBy(runs.flatMap((r) => r.samples), (s) => JSON.stringify([s.job, s.path])).values()].map(
    (group) => {
      const { job, path } = group[0]!,
        s = summarize(group.map((i) => i.seconds)),
        pinned = baseline?.paths[path]?.jobs[job];
      const row = pinned ? trend?.rows.find((r) => r.path === path && r.job === job) : undefined;
      const baselineStat = pinned
        ? { count: pinned.count, medianSeconds: round(pinned.median), thresholdSeconds: round(pinned.threshold) }
        : null;
      const jobTrend: JobTrend | null = row && trend
        ? {
          verdict: trend.enough
            ? row.verdict === "Slower" ? "slower" : row.verdict === "Faster" ? "faster" : "noShift"
            : "inconclusive",
          recentRuns: row.recentCount,
          shiftSeconds: round(row.shift),
          lowSeconds: round(row.low),
          highSeconds: round(row.high),
          minEffectSeconds: round(row.minEffect),
        }
        : null;
      return {
        job,
        path,
        count: s.count,
        minSeconds: round(s.min),
        medianSeconds: round(s.median),
        p90Seconds: round(s.p90),
        maxSeconds: round(s.max),
        baseline: baselineStat,
        trend: jobTrend,
      };
    },
  ).sort((a, b) => ordinal(a.job, b.job) || ordinal(a.path, b.path));
  const q = queue?.length ? summarize(queue) : null;
  return {
    workflow,
    basis: "measured",
    runs: runs.length,
    window: sampleWindow(runs.map((r) => r.run)),
    trend: trend ? { runs: trend.recent.length, required: constants.runs, window: sampleWindow(trend.recent) } : null,
    queue: q
      ? { runs: q.count, medianSeconds: round(q.median), p90Seconds: round(q.p90), maxSeconds: round(q.max) }
      : null,
    jobs,
  };
}
/** Match Utf8JsonWriter's default escaping (including HTML-sensitive ASCII) and fixed output ordering. */
export function writeSnapshot(snapshot: Snapshot): string {
  const value = {
    version: snapshot.version,
    date: snapshot.date,
    generatedAt: snapshot.generatedAt,
    repository: snapshot.repository,
    ci: snapshot.ci,
    ...(snapshot.quality !== undefined && snapshot.quality !== null ? { quality: snapshot.quality } : {}),
    ...(snapshot.flow !== undefined && snapshot.flow !== null ? { flow: snapshot.flow } : {}),
    ...(snapshot.agents !== undefined && snapshot.agents !== null ? { agents: snapshot.agents } : {}),
    ...(snapshot.version >= 3 ? { superseded: snapshot.superseded ?? null } : {}),
  };
  return JSON.stringify(value, null, 2).replace(/"(?:\\.|[^"\\])*"/g, (token) => {
    const decoded = JSON.parse(token) as string;
    let encoded = '"';
    for (let index = 0; index < decoded.length; index++) {
      const c = decoded[index]!, code = decoded.charCodeAt(index);
      if (c === "\\") encoded += "\\\\";
      else if (c === "\n") encoded += "\\n";
      else if (c === "\r") encoded += "\\r";
      else if (c === "\t") encoded += "\\t";
      else if (c === "\b") encoded += "\\b";
      else if (c === "\f") encoded += "\\f";
      else if (code < 32 || code >= 127 || "<>&'+`\"".includes(c)) {
        encoded += "\\u" + code.toString(16).toUpperCase().padStart(4, "0");
      } else encoded += c;
    }
    return encoded + '"';
  }) + "\n";
}
