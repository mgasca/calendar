import { type BaselineFile, isSuccessful, type SampledRun } from "./baseline.ts";
import { clock, groupBy, ordinal, type WorkflowRun } from "./timings.ts";
import { fixed, hodgesLehmann, mannWhitney, percentile, roundEven, type TailProbabilities } from "./statistics.ts";
import { minute } from "./baseline-report.ts";
export interface TrendConstants {
  runs: number;
  pValue: number;
  minSeconds: number;
  minRelative: number;
}
export const trendDefaults: TrendConstants = { runs: 20, pValue: 0.002, minSeconds: 10, minRelative: 0.05 };
export type TrendVerdict = "NoShift" | "Slower" | "Faster";
export interface TrendRow {
  path: string;
  job: string;
  recentCount: number;
  baselineCount: number;
  baselineMedian: number;
  recentMedian: number;
  shift: number;
  low: number;
  high: number;
  pSlower: number;
  pFaster: number;
  minEffect: number;
  verdict: TrendVerdict;
}
export interface TrendResult {
  rows: TrendRow[];
  recent: WorkflowRun[];
  enough: boolean;
  regressed: boolean;
}
/** The runs that measure `main`: pushes (`ci.yml`) and the nightly schedule (`e2e.yml`, #737). A dispatch can run any ref
 * by hand and a pull request measures its branch, so neither is part of the trend. */
export const trendEvents: ReadonlySet<string> = new Set(["push", "schedule"]);
export const issueTitle = "CI run-time trend: jobs slower than the pinned baseline on main";
export const issueLabel = "performance";
export function recentRuns(
  baseline: BaselineFile,
  listed: readonly WorkflowRun[],
  constants: TrendConstants,
): WorkflowRun[] {
  const runs = Object.values(baseline.paths).flatMap((path) => path.runs), pinned = new Set(runs.map((run) => run.id));
  const since = runs.length ? Math.max(...runs.map((run) => run.createdAt)) : -Infinity;
  return listed.filter((run) =>
    isSuccessful(run) && trendEvents.has(run.event) && run.headBranch === "main" && !pinned.has(run.id) &&
    run.createdAt > since
  )
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, constants.runs).sort((a, b) => a.createdAt - b.createdAt);
}
export function judge(tails: TailProbabilities, shift: number, minEffect: number, pValue: number): TrendVerdict {
  if (tails.slower < pValue && shift >= minEffect) return "Slower";
  return tails.faster < pValue && -shift >= minEffect ? "Faster" : "NoShift";
}
export function evaluateTrend(
  baseline: BaselineFile,
  recent: readonly SampledRun[],
  constants: TrendConstants,
): TrendResult {
  const enough = recent.length >= constants.runs, rows: TrendRow[] = [];
  const groups = [
    ...groupBy(recent.flatMap((run) => run.samples), (sample) => JSON.stringify([sample.path, sample.job])).values(),
  ]
    .sort((a, b) => ordinal(a[0]!.path, b[0]!.path) || ordinal(a[0]!.job, b[0]!.job));
  for (const group of groups) {
    const { path, job: name } = group[0]!, job = baseline.paths[path]?.jobs[name];
    if (!job?.seconds.length) continue;
    const late = group.map((sample) => sample.seconds).sort((a, b) => a - b),
      tails = mannWhitney(late, job.seconds),
      estimate = hodgesLehmann(late, job.seconds);
    const minEffect = Math.max(constants.minSeconds, constants.minRelative * job.median);
    rows.push({
      path,
      job: name,
      recentCount: late.length,
      baselineCount: job.seconds.length,
      baselineMedian: job.median,
      recentMedian: percentile(late, 0.5),
      ...estimate,
      pSlower: tails.slower,
      pFaster: tails.faster,
      minEffect,
      verdict: enough ? judge(tails, estimate.shift, minEffect, constants.pValue) : "NoShift",
    });
  }
  return {
    rows,
    recent: recent.map((item) => item.run),
    enough,
    regressed: enough && rows.some((row) => row.verdict === "Slower"),
  };
}
const signed = (value: number) => (value > 0 ? "+" : "") + String(roundEven(value, 1));
const p = (value: number) => value < 0.0001 ? "< 0.0001" : fixed(value, 4);
const verdict = (value: TrendVerdict) =>
  value === "Slower" ? "**slower**" : value === "Faster" ? "faster (re-pin?)" : "no shift";
export function trendReport(
  result: TrendResult,
  baseline: BaselineFile,
  constants: TrendConstants,
  file = ".github/ci-baseline.json",
): string {
  // ci.yml keeps the wording the parity fixtures froze (tests/fixtures/README.md); its runs are pushes only.
  const runs = baseline.workflow === "ci.yml" ? "push runs" : `push and scheduled runs of \`${baseline.workflow}\``;
  let output =
    `Trend check (ADR 0045): the last ${result.recent.length} successful ${runs} on \`main\` not in the baseline, against \`${file}\` (${baseline.record}). A job is reported when a one-sided exact Mann–Whitney test gives p < ${constants.pValue} and the Hodges–Lehmann shift is at least max(${constants.minSeconds} s, ${
      constants.minRelative * 100
    } % of the baseline median).\n\n`;
  const first = result.recent[0], last = result.recent.at(-1);
  if (first && last) {
    output += `Recent window: ${minute(first.createdAt)} to ${minute(last.createdAt)}, commits \`${
      first.headSha.slice(0, 8)
    }\` to \`${last.headSha.slice(0, 8)}\`.\n\n`;
  }
  if (!result.enough) {
    return output +
      `Not enough runs since the baseline: ${result.recent.length} of ${constants.runs}. Nothing is concluded.\n`;
  }
  output +=
    "| Path | Job | n recent | n baseline | baseline median | recent median | shift (≈95 % interval) | p slower | p faster | verdict |\n| --- | --- | --: | --: | --: | --: | --: | --: | --: | --- |\n";
  for (const r of result.rows) {
    output += `| ${r.path} | ${r.job} | ${r.recentCount} | ${r.baselineCount} | ${clock(r.baselineMedian)} | ${
      clock(r.recentMedian)
    } | ${signed(r.shift)} s (${signed(r.low)} to ${signed(r.high)}) | ${p(r.pSlower)} | ${p(r.pFaster)} | ${
      verdict(r.verdict)
    } |\n`;
  }
  output += "\n";
  const slower = result.rows.filter((r) => r.verdict === "Slower"),
    faster = result.rows.filter((r) => r.verdict === "Faster");
  if (!slower.length) {
    output += "No job is slower than its baseline by a shift that is both significant and above the minimum effect.\n";
  }
  for (const r of slower) {
    output += `- **${r.job}** (${r.path}) is slower by ${signed(r.shift)} s (minimum effect ${
      roundEven(r.minEffect)
    } s, p = ${
      p(r.pSlower)
    }). Sample its steps with \`ci-timings --job\` over the recent window and look for the commit that moved it; if the time is necessary, re-pin the baseline deliberately with a benchmark record.\n`;
  }
  for (const r of faster) {
    output += `- Suggestion: **${r.job}** (${r.path}) is faster by ${signed(-r.shift)} s (p = ${
      p(r.pFaster)
    }); a deliberate re-pin would tighten its threshold.\n`;
  }
  return output + "\nRuns: " + result.recent.map((run) => run.id).join(", ") + "\n";
}
export function issueAction(
  result: TrendResult,
  openIssues: readonly { number: number; title: string }[],
): number | null {
  if (!result.regressed) return null;
  const numbers = openIssues.filter((issue) => issue.title === issueTitle).map((issue) => issue.number);
  return numbers.length ? Math.min(...numbers) : 0;
}
