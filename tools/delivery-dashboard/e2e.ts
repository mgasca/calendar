/**
 * The E2E section of the snapshot (story 0069, issue #892): the newest completed runs of the nightly `E2E flows`
 * workflow on `main`, with their conclusion and run time. One `gh run list` call; no job calls.
 */
import { gh } from "../ci-timings/gh.ts";
import { type GhRunner } from "../ci-timings/baseline.ts";
import { array, integer, object, text, time } from "../ci-timings/timings.ts";
import { round, type SampleWindow, timeString } from "./snapshot.ts";
import { checkText, checkTime, checkWindow, count, keys, type Obj, oneOf, seconds } from "./rules-helpers.ts";

export const e2eWorkflow = "e2e.yml", e2eCap = 30;
/** The triggers of `e2e.yml`: the nightly schedule and a run started by hand. */
export const e2eEvents = ["schedule", "workflow_dispatch"] as const;
/** The conclusions GitHub gives a completed workflow run. */
export const runConclusions = [
  "success",
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
] as const;

export interface E2eRun {
  id: number;
  event: string;
  createdAt: string;
  conclusion: string;
  runSeconds: number | null;
}
export interface E2eSection {
  workflow: string;
  basis: string;
  sample: { runs: number; cap: number; window: SampleWindow | null };
  runs: E2eRun[];
}
export interface ListedRun {
  id: number;
  status: string;
  conclusion: string;
  event: string;
  headBranch: string;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number | null;
}

export function parseListedRuns(json: string): ListedRun[] {
  return array(JSON.parse(json)).map((value) => {
    const run = object(value), createdAt = time(run.createdAt);
    if (createdAt === null) throw new Error("invalid createdAt");
    return {
      id: integer(run.databaseId),
      status: text(run, "status"),
      conclusion: text(run, "conclusion"),
      event: text(run, "event"),
      headBranch: text(run, "headBranch"),
      createdAt,
      startedAt: time(run.startedAt),
      updatedAt: time(run.updatedAt),
    };
  });
}

/** The section from the listed runs: completed runs on `main` with a known trigger and conclusion, newest first. */
export function buildE2e(listed: readonly ListedRun[], workflow = e2eWorkflow, cap = e2eCap): E2eSection {
  const kept = listed
    .filter((r) =>
      r.status === "completed" && r.headBranch === "main" && (e2eEvents as readonly string[]).includes(r.event) &&
      (runConclusions as readonly string[]).includes(r.conclusion)
    )
    .filter((r, i, all) => all.findIndex((o) => o.id === r.id) === i)
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
    .slice(0, cap);
  // Whole seconds, as GitHub records them, so the run time is not shown more precisely than it was measured.
  const runs = kept.map((r) => ({
    id: r.id,
    event: r.event,
    createdAt: timeString(Math.floor(r.createdAt / 1000) * 1000),
    conclusion: r.conclusion,
    runSeconds: r.startedAt !== null && r.updatedAt !== null && r.updatedAt >= r.startedAt
      ? round((r.updatedAt - r.startedAt) / 1000)
      : null,
  }));
  return {
    workflow,
    basis: "measured",
    sample: {
      runs: runs.length,
      cap,
      window: runs.length ? { from: runs.at(-1)!.createdAt, to: runs[0]!.createdAt } : null,
    },
    runs,
  };
}

export async function collectE2e(
  repository: string,
  workflow = e2eWorkflow,
  cap = e2eCap,
  runner: GhRunner = gh,
): Promise<E2eSection> {
  const json = await runner([
    "run",
    "list",
    "--workflow",
    workflow,
    "--branch",
    "main",
    "--repo",
    repository,
    // Runs still in progress are read and dropped, so ask for a few more than the cap.
    "--limit",
    String(cap + 10),
    "--json",
    "databaseId,status,conclusion,createdAt,startedAt,updatedAt,event,headBranch",
  ]);
  return buildE2e(parseListedRuns(json), workflow, cap);
}

export function validateE2e(root: Obj, errors: string[]): void {
  const section = root.e2e, p = "$.e2e";
  if (section === null || !keys(section, p, ["workflow", "basis", "sample", "runs"], errors)) return;
  checkText(section.workflow, p + ".workflow", /^[\w.-]+\.ya?ml$/i, "a workflow file name", errors);
  oneOf(section.basis, p + ".basis", ["measured", "inferred"], errors);
  let listed = -1, cap = 0;
  const sample = section.sample;
  let window: Obj | null = null;
  if (keys(sample, p + ".sample", ["runs", "cap", "window"], errors)) {
    listed = count(sample.runs, p + ".sample.runs", 0, errors);
    cap = count(sample.cap, p + ".sample.cap", 1, errors);
    if (cap > 0 && listed > cap) errors.push(`${p}.sample.runs: cannot exceed sample.cap (${cap})`);
    if (sample.window === null) {
      if (listed > 0) errors.push(p + ".sample.window: must be set when runs is above 0");
    } else {
      if (listed === 0) errors.push(p + ".sample.window: must be null when runs is 0");
      checkWindow(sample.window, p + ".sample.window", errors);
      window = sample.window as Obj;
    }
  }
  if (!Array.isArray(section.runs)) {
    errors.push(p + ".runs: must be an array");
    return;
  }
  if (listed >= 0 && section.runs.length !== listed) {
    errors.push(`${p}.runs: lists ${section.runs.length} runs, but sample.runs is ${listed}`);
  }
  const ids = new Set<number>(), times: string[] = [];
  section.runs.forEach((run, i) => {
    const path = `${p}.runs[${i}]`;
    if (!keys(run, path, ["id", "event", "createdAt", "conclusion", "runSeconds"], errors)) return;
    if (typeof run.id !== "number" || !Number.isSafeInteger(run.id) || run.id < 1) {
      errors.push(path + ".id: must be a run id (a whole number of at least 1)");
    } else if (ids.has(run.id)) errors.push(path + ".id: each run must be listed once");
    else ids.add(run.id);
    oneOf(run.event, path + ".event", e2eEvents, errors);
    oneOf(run.conclusion, path + ".conclusion", runConclusions, errors);
    if (run.runSeconds !== null) seconds(run.runSeconds, path + ".runSeconds", errors);
    const before = errors.length;
    checkTime(run.createdAt, path + ".createdAt", errors);
    if (errors.length === before) {
      const at = run.createdAt as string, previous = times.at(-1);
      if (previous !== undefined && at > previous) errors.push(path + ".createdAt: runs must be listed newest first");
      times.push(at);
    }
  });
  if (window && times.length && times.length === section.runs.length) {
    if (window.to !== times[0] || window.from !== times.at(-1)) {
      errors.push(p + ".sample.window: must run from the oldest run's createdAt to the newest one's");
    }
  }
}
