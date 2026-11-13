import { gh } from "../ci-timings/gh.ts";
import { type GhRunner } from "../ci-timings/baseline.ts";
import { summarize } from "../ci-timings/statistics.ts";
import {
  type JobTiming,
  measurePair,
  pairRuns,
  parseJobs,
  parseRuns,
  type SupersededPair,
} from "../ci-timings/timings.ts";
import { round, type SampleWindow, timeString } from "./snapshot.ts";
import { ascending, checkWindow, count, keys, type Obj, oneOf, seconds, validDate } from "./rules-helpers.ts";
export interface SupersededWeek {
  week: string;
  pairs: number;
  waitRuns: number;
  waitMedianSeconds: number | null;
  waitP90Seconds: number | null;
  waitMaxSeconds: number | null;
  pushGapMedianSeconds: number | null;
  controlRuns: number;
  controlWaitMedianSeconds: number | null;
}
export interface SupersededSection {
  basis: { detection: string; timing: string };
  sample: {
    pairs: number;
    ignored: number;
    controlRuns: number;
    cap: number;
    minPairs: number;
    window: SampleWindow | null;
  };
  weeks: SupersededWeek[];
}
export function weekStart(time: number): string {
  const day = new Date(time);
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}
export function buildSuperseded(
  pairs: readonly SupersededPair[],
  ignored: number,
  control: readonly { created: number; wait: number }[],
  cap: number,
): SupersededSection | null {
  if (!pairs.length && !control.length) return null;
  const weeks = [
    ...new Set([...pairs.map((p) => weekStart(p.supersededAt)), ...control.map((r) => weekStart(r.created))]),
  ].sort().map((week) => {
    const inWeek = pairs.filter((p) => weekStart(p.supersededAt) === week),
      waits = inWeek.map((p) => p.wait).filter((w): w is number => w !== null),
      controls = control.filter((r) => weekStart(r.created) === week).map((r) => r.wait),
      s = summarize(waits);
    return {
      week,
      pairs: inWeek.length,
      waitRuns: waits.length,
      waitMedianSeconds: waits.length ? round(s.median) : null,
      waitP90Seconds: waits.length ? round(s.p90) : null,
      waitMaxSeconds: waits.length ? round(s.max) : null,
      pushGapMedianSeconds: inWeek.length ? round(summarize(inWeek.map((p) => p.pushGap)).median) : null,
      controlRuns: controls.length,
      controlWaitMedianSeconds: controls.length ? round(summarize(controls).median) : null,
    };
  });
  return {
    basis: { detection: "inferred", timing: "measured" },
    sample: {
      pairs: pairs.length,
      ignored,
      controlRuns: control.length,
      cap,
      minPairs: 3,
      window: pairs.length
        ? {
          from: timeString(Math.min(...pairs.map((p) => p.supersededAt))),
          to: timeString(Math.max(...pairs.map((p) => p.supersededAt))),
        }
        : null,
    },
    weeks,
  };
}
export function supersededDone(measured: number, ignored: number, cap: number): boolean {
  return measured >= cap || measured + ignored >= cap * 2;
}
export async function collectSuperseded(
  repository: string,
  workflow: string,
  cap = 30,
  runner: GhRunner = gh,
): Promise<SupersededSection | null> {
  const listed = parseRuns(
    await runner([
      "run",
      "list",
      "--workflow",
      workflow,
      "--event",
      "pull_request",
      "--repo",
      repository,
      "--limit",
      String(cap * 6),
      "--json",
      "databaseId,status,conclusion,createdAt,event,headBranch",
    ]),
  );
  const jobsByRun = new Map<number, JobTiming[]>();
  async function jobsOf(id: number): Promise<JobTiming[]> {
    let jobs = jobsByRun.get(id);
    if (!jobs) {
      jobs = parseJobs(id, await runner(["api", `repos/${repository}/actions/runs/${id}/jobs?per_page=50`]));
      jobsByRun.set(id, jobs);
    }
    return jobs;
  }
  const pairs: SupersededPair[] = [];
  let ignored = 0;
  for (const { cancelled, superseding } of pairRuns(listed)) {
    if (supersededDone(pairs.length, ignored, cap)) break;
    const pair = measurePair(cancelled, superseding, await jobsOf(cancelled.id), await jobsOf(superseding.id));
    if (pair) pairs.push(pair);
    else ignored++;
  }
  const superseding = new Set(pairs.map((p) => p.supersedingRunId)),
    cancelled = new Set(pairs.map((p) => p.cancelledRunId)),
    since = pairs.length ? Math.min(...pairs.map((p) => p.supersededAt)) : -Infinity,
    control: { created: number; wait: number }[] = [];
  for (
    const run of listed.filter((r) =>
      r.conclusion === "success" && !superseding.has(r.id) && !cancelled.has(r.id) && r.createdAt >= since
    ).slice(0, cap)
  ) {
    const jobs = await jobsOf(run.id);
    if (jobs.length) {
      control.push({
        created: run.createdAt,
        wait: (Math.min(...jobs.map((j) => j.startedAt)) - run.createdAt) / 1000,
      });
    }
  }
  return buildSuperseded(pairs, ignored, control, cap);
}
export function validateSuperseded(root: Obj, errors: string[]): void {
  const section = root.superseded, p = "$.superseded";
  if (section === null || !keys(section, p, ["basis", "sample", "weeks"], errors)) return;
  if (keys(section.basis, p + ".basis", ["detection", "timing"], errors)) {
    for (const k of ["detection", "timing"]) {
      oneOf(section.basis[k], `${p}.basis.${k}`, ["measured", "inferred"], errors);
    }
  }
  const sample = section.sample;
  let pairs = 0, controls = 0, cap = 0;
  if (keys(sample, p + ".sample", ["pairs", "ignored", "controlRuns", "cap", "minPairs", "window"], errors)) {
    pairs = count(sample.pairs, p + ".sample.pairs", 0, errors);
    count(sample.ignored, p + ".sample.ignored", 0, errors);
    controls = count(sample.controlRuns, p + ".sample.controlRuns", 0, errors);
    cap = count(sample.cap, p + ".sample.cap", 1, errors);
    count(sample.minPairs, p + ".sample.minPairs", 1, errors);
    if (sample.window === null) { if (pairs > 0) errors.push(p + ".sample.window: must be set when pairs is above 0"); }
    else checkWindow(sample.window, p + ".sample.window", errors);
    if (cap > 0 && pairs > cap) errors.push(`${p}.sample.pairs: cannot exceed sample.cap (${cap})`);
  }
  if (!Array.isArray(section.weeks)) {
    errors.push(p + ".weeks: must be an array");
    return;
  }
  let pairSum = 0, controlSum = 0, previous = "";
  function optional(value: unknown, p: string, required: boolean, because: string): number | null {
    if (value === null) {
      if (required) errors.push(`${p}: must be set when ${because} is above 0`);
      return null;
    }
    if (!required) errors.push(`${p}: must be null when ${because} is 0`);
    return seconds(value, p, errors);
  }
  section.weeks.forEach((week, i) => {
    const path = `${p}.weeks[${i}]`;
    if (
      !keys(week, path, [
        "week",
        "pairs",
        "waitRuns",
        "waitMedianSeconds",
        "waitP90Seconds",
        "waitMaxSeconds",
        "pushGapMedianSeconds",
        "controlRuns",
        "controlWaitMedianSeconds",
      ], errors)
    ) return;
    if (validDate(week.week) && new Date(week.week + "T00:00:00Z").getUTCDay() === 1) {
      if (week.week <= previous) errors.push(`${path}.week: weeks must be listed once, oldest first`);
      previous = week.week;
    } else errors.push(`${path}.week: must be the Monday of the week as yyyy-MM-dd`);
    const n = count(week.pairs, path + ".pairs", 0, errors),
      waits = count(week.waitRuns, path + ".waitRuns", 0, errors);
    if (waits > n) errors.push(`${path}.waitRuns: cannot exceed pairs (${n})`);
    const c = count(week.controlRuns, path + ".controlRuns", 0, errors);
    if (
      !ascending(
        ["waitMedianSeconds", "waitP90Seconds", "waitMaxSeconds"].map((k) =>
          optional(week[k], `${path}.${k}`, waits > 0, "waitRuns")
        ),
      )
    ) errors.push(`${path}: waitMedianSeconds <= waitP90Seconds <= waitMaxSeconds must hold`);
    optional(week.pushGapMedianSeconds, path + ".pushGapMedianSeconds", n > 0, "pairs");
    optional(week.controlWaitMedianSeconds, path + ".controlWaitMedianSeconds", c > 0, "controlRuns");
    pairSum += typeof week.pairs === "number" && Number.isInteger(week.pairs) ? week.pairs : 0;
    controlSum += typeof week.controlRuns === "number" && Number.isInteger(week.controlRuns) ? week.controlRuns : 0;
  });
  if (pairSum !== pairs) errors.push(`${p}.weeks: pairs add up to ${pairSum}, but sample.pairs is ${pairs}`);
  if (controlSum !== controls) {
    errors.push(`${p}.weeks: controlRuns add up to ${controlSum}, but sample.controlRuns is ${controls}`);
  }
}
