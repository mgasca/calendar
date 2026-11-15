import {
  type BackTest,
  type BaselineFile,
  type CarriedPath,
  type GateConstants,
  type JobBaseline,
  type PathBaseline,
} from "./baseline.ts";
import { array, clock, integer, object, ordinal, text, time } from "./timings.ts";
import { fixed, normalQuantile, roundEven, upperBound } from "./statistics.ts";
export function utc(at: number): string {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
}
export function minute(at: number): string {
  return utc(at).slice(0, 16).replace("T", " ") + "Z";
}
function constantsJson(c: GateConstants) {
  return {
    alpha: c.alpha,
    jobs: c.jobs,
    z: roundEven(normalQuantile(1 - c.alpha / c.jobs), 4),
    floorSeconds: c.floorSeconds,
    relativeMargin: c.relativeMargin,
  };
}
export function writeBaseline(file: BaselineFile): string {
  const carried = Object.entries(file.carried ?? {}).sort(([a], [b]) => ordinal(a, b));
  const paths = Object.fromEntries(
    Object.values(file.paths).sort((a, b) => ordinal(a.path, b.path)).map((path) => {
      const first = path.runs[0], last = path.runs.at(-1);
      const window = first && last
        ? { from: utc(first.createdAt), to: utc(last.createdAt), firstCommit: first.headSha, lastCommit: last.headSha }
        : undefined;
      const jobs = Object.fromEntries(
        Object.entries(path.jobs).sort(([a], [b]) => ordinal(a, b)).map((
          [name, j],
        ) => [name, {
          n: j.count,
          median: j.median,
          logMedian: j.logMedian,
          logMad: j.logMad,
          p90: j.p90,
          p95: j.p95,
          max: j.max,
          threshold: j.threshold,
          seconds: j.seconds,
        }]),
      );
      return [path.path, {
        status: path.status,
        n: path.runs.length,
        ...(window ? { window } : {}),
        jobs,
        runs: path.runs.map((run) => ({
          id: run.id,
          createdAt: utc(run.createdAt),
          event: run.event,
          commit: run.headSha,
        })),
      }];
    }),
  );
  return JSON.stringify(
    {
      schema: 1,
      workflow: file.workflow,
      record: file.record,
      method:
        "threshold = ceil(max(exp(logMedian + z * 1.4826 * logMad), median + max(floorSeconds, relativeMargin * median))); z = NormalQuantile(1 - alpha / jobs); nearest-rank statistics of each job's start-to-end seconds (ADR 0045)",
      minRuns: file.minRuns,
      constants: constantsJson(file.constants),
      ...(carried.length
        ? {
          carried: Object.fromEntries(
            carried.map(([name, entry]) => [name, { record: entry.record, constants: constantsJson(entry.constants) }]),
          ),
        }
        : {}),
      paths,
    },
    null,
    2,
  ) + "\n";
}
function number(value: unknown): number {
  if (typeof value !== "number") throw new Error("expected number");
  return value;
}
function readConstants(value: unknown): GateConstants {
  const c = object(value);
  return {
    alpha: number(c.alpha),
    jobs: integer(c.jobs),
    floorSeconds: number(c.floorSeconds),
    relativeMargin: number(c.relativeMargin),
  };
}
export function readBaseline(json: string): BaselineFile {
  const root = object(JSON.parse(json)), constants = readConstants(root.constants);
  const carried: Record<string, CarriedPath> = {};
  if (root.carried !== undefined) {
    for (const [name, value] of Object.entries(object(root.carried)).sort(([a], [b]) => ordinal(a, b))) {
      const entry = object(value);
      carried[name] = { record: text(entry, "record"), constants: readConstants(entry.constants) };
    }
  }
  const paths: Record<string, PathBaseline> = {};
  for (const [name, value] of Object.entries(object(root.paths)).sort(([a], [b]) => ordinal(a, b))) {
    const p = object(value), jobs: Record<string, JobBaseline> = {};
    for (const [name, value] of Object.entries(object(p.jobs)).sort(([a], [b]) => ordinal(a, b))) {
      const j = object(value);
      jobs[name] = {
        count: integer(j.n),
        median: number(j.median),
        logMedian: number(j.logMedian),
        logMad: number(j.logMad),
        p90: number(j.p90),
        p95: number(j.p95),
        max: number(j.max),
        threshold: number(j.threshold),
        seconds: array(j.seconds).map(number),
      };
    }
    const runs = array(p.runs).map((value) => {
      const r = object(value), createdAt = time(r.createdAt);
      if (createdAt === null) throw new Error("invalid createdAt");
      return {
        id: integer(r.id),
        status: "completed",
        conclusion: "success",
        createdAt,
        event: text(r, "event"),
        headBranch: "main",
        headSha: text(r, "commit"),
      };
    });
    paths[name] = { path: name, status: text(p, "status"), runs, jobs };
  }
  return {
    workflow: text(root, "workflow"),
    record: text(root, "record"),
    minRuns: integer(root.minRuns),
    constants,
    paths,
    ...(Object.keys(carried).length ? { carried } : {}),
  };
}
export function baselineTable(file: BaselineFile): string {
  let output =
    "| Path | Job | n | median | log-MAD | p90 | p95 | max | threshold | status |\n| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |\n";
  for (const path of Object.values(file.paths).sort((a, b) => ordinal(a.path, b.path))) {
    for (const [name, j] of Object.entries(path.jobs).sort(([a], [b]) => ordinal(a, b))) {
      output += `| ${path.path} | ${name} | ${j.count} | ${clock(j.median)} | ${fixed(j.logMad, 3)} | ${
        clock(j.p90)
      } | ${clock(j.p95)} | ${clock(j.max)} | ${clock(j.threshold)} | ${path.status} |\n`;
    }
  }
  return output;
}
const percent = (rate: number) => fixed(rate * 100, 1) + " %";
export function backTestTable(test: BackTest): string {
  let output =
    "| Path | Job | held-out runs | exceeded | observed rate | 95 % upper bound |\n| --- | --- | --: | --: | --: | --: |\n";
  for (const row of [...test.jobChecks].sort((a, b) => ordinal(a.path, b.path) || ordinal(a.job, b.job))) {
    output += `| ${row.path} | ${row.job} | ${row.checked} | ${row.exceeded} | ${
      percent(row.exceeded / row.checked)
    } | ${percent(upperBound(row.exceeded, row.checked, 0.95))} |\n`;
  }
  output += "\n";
  if (test.runs === 0) return output + "No held-out run had a gated job with a baseline.\n";
  output += `Runs the gate would have failed: **${test.failedRuns} of ${test.runs}** (${
    percent(test.failedRuns / test.runs)
  }; one-sided 95 % upper bound ${percent(upperBound(test.failedRuns, test.runs, 0.95))}).\n`;
  for (const item of test.exceedances) {
    output += `- run ${item.runId}: ${item.job} (${item.path}) took ${clock(item.seconds)} against a threshold of ${
      clock(item.threshold)
    }\n`;
  }
  return output;
}
export function baselineWindow(file: BaselineFile): string {
  let output =
    "| Path | status | runs | events | from | to | span | commits |\n| --- | --- | --: | --- | --- | --- | --: | --- |\n";
  for (const path of Object.values(file.paths).sort((a, b) => ordinal(a.path, b.path))) {
    const first = path.runs[0], last = path.runs.at(-1);
    if (!first || !last) continue;
    const events = [...new Set(path.runs.map((run) => run.event))].sort(ordinal),
      commits = new Set(path.runs.map((run) => run.headSha)).size;
    output += `| ${path.path} | ${path.status} | ${path.runs.length} | ${events.join(", ")} | ${
      minute(first.createdAt)
    } | ${minute(last.createdAt)} | ${fixed((last.createdAt - first.createdAt) / 3600000, 1)} h | ${commits} |\n`;
  }
  return output;
}
