/** Schema checks for the optional quality section; privacy scanning is performed by the root validator. */
import { maxQualityRunIds, qualityListQueries } from "./quality.ts";
import { checkDate as date, checkTime as time, count, keys, type Obj, oneOf } from "./rules-helpers.ts";
function name(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    errors.push(`${path}: must be a non-empty string of at most 100 characters`);
  }
}
const runKeys = ["total", "passed", "passedAfterRerun", "failed", "cancelled", "superseded", "other", "reruns"];
function checkRuns(value: unknown, path: string, errors: string[]): void {
  if (!keys(value, path, runKeys, errors)) return;
  const counts = Object.fromEntries(runKeys.map((key) => [key, count(value[key], `${path}.${key}`, 0, errors)]));
  const sum = runKeys.filter((key) => key !== "total" && key !== "reruns").reduce((sum, key) => sum + counts[key]!, 0);
  if (sum !== counts.total) errors.push(`${path}.total: must equal the sum of the run classes (${sum})`);
  if (counts.reruns! > counts.total! || counts.passedAfterRerun! > counts.reruns!) {
    errors.push(`${path}.reruns: must be at most total and at least passedAfterRerun`);
  }
}
function checkIds(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > maxQualityRunIds) {
    errors.push(`${path}: must be an array of at most ${maxQualityRunIds} run ids`);
    return;
  }
  value.forEach((id, i) => {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      errors.push(`${path}[${i}]: must be a positive whole number`);
    }
  });
}
function checkRate(value: unknown, path: string, minTrials: number, errors: string[]): void {
  if (!keys(value, path, ["job", "required", "trials", "failures", "verdict", "rate", "low", "high"], errors)) return;
  name(value.job, `${path}.job`, errors);
  if (typeof value.required !== "boolean") errors.push(`${path}.required: must be true or false`);
  const trials = count(value.trials, `${path}.trials`, 1, errors),
    failures = count(value.failures, `${path}.failures`, 0, errors);
  if (failures > trials) errors.push(`${path}.failures: must be at most trials`);
  oneOf(value.verdict, `${path}.verdict`, ["conclusive", "inconclusive"], errors);
  const inconclusive = trials < minTrials;
  if (typeof value.verdict === "string" && (value.verdict === "inconclusive") !== inconclusive) {
    errors.push(`${path}.verdict: must be ${inconclusive ? "inconclusive" : "conclusive"} for ${trials} trials`);
  }
  const values = [value.rate, value.low, value.high];
  if (inconclusive) {
    if (values.some((value) => value !== null)) {
      errors.push(`${path}: an inconclusive row must carry no rate and no interval`);
    }
    return;
  }
  if (
    values.some((value) => typeof value !== "number" || value < 0 || value > 1) ||
    !(typeof value.low === "number" && typeof value.rate === "number" && typeof value.high === "number" &&
      value.low <= value.rate && value.rate <= value.high)
  ) errors.push(`${path}: rate, low and high must be numbers from 0 to 1 with low <= rate <= high`);
}
function checkDay(value: unknown, path: string, errors: string[]): void {
  if (!keys(value, path, ["date", "trials", "failures"], errors)) return;
  date(value.date, `${path}.date`, errors);
  const trials = count(value.trials, `${path}.trials`, 1, errors);
  if (count(value.failures, `${path}.failures`, 0, errors) > trials) {
    errors.push(`${path}.failures: must be at most trials`);
  }
}
function checkScope(value: unknown, path: string, minTrials: number, errors: string[]): void {
  if (!keys(value, path, ["scope", "listQuery", "runs", "failedRunIds", "rerunRunIds", "jobs", "guardDays"], errors)) {
    return;
  }
  oneOf(value.scope, `${path}.scope`, ["main", "pullRequest"], errors);
  if (typeof value.listQuery !== "string" || !Object.values(qualityListQueries).includes(value.listQuery)) {
    errors.push(`${path}.listQuery: must be one of the Actions searches the tool writes`);
  }
  checkRuns(value.runs, `${path}.runs`, errors);
  checkIds(value.failedRunIds, `${path}.failedRunIds`, errors);
  checkIds(value.rerunRunIds, `${path}.rerunRunIds`, errors);
  if (!Array.isArray(value.jobs)) errors.push(`${path}.jobs: must be an array`);
  else value.jobs.forEach((job, i) => checkRate(job, `${path}.jobs[${i}]`, minTrials, errors));
  if (!Array.isArray(value.guardDays)) errors.push(`${path}.guardDays: must be an array`);
  else value.guardDays.forEach((day, i) => checkDay(day, `${path}.guardDays[${i}]`, errors));
}
export function validateQuality(root: Obj, errors: string[]): void {
  if (!("quality" in root)) return;
  const value = root.quality, path = "$.quality";
  if (!keys(value, path, ["workflow", "basis", "sample", "rule", "guard", "scopes"], errors)) return;
  if (typeof value.workflow !== "string" || !/^[-A-Za-z0-9_.]+\.ya?ml$/.test(value.workflow)) {
    errors.push(`${path}.workflow: must be a workflow file name`);
  }
  if (keys(value.basis, `${path}.basis`, ["runs", "superseded", "jobs", "guards"], errors)) {
    for (const key of ["runs", "superseded", "jobs", "guards"]) {
      oneOf(value.basis[key], `${path}.basis.${key}`, ["measured", "inferred"], errors);
    }
  }
  if (keys(value.sample, `${path}.sample`, ["runs", "ignoredRuns", "window"], errors)) {
    const runs = count(value.sample.runs, `${path}.sample.runs`, 0, errors);
    count(value.sample.ignoredRuns, `${path}.sample.ignoredRuns`, 0, errors);
    if (value.sample.window === null) {
      if (runs > 0) errors.push(`${path}.sample.window: must be set when runs is above 0`);
    } else if (keys(value.sample.window, `${path}.sample.window`, ["from", "to"], errors)) {
      time(value.sample.window.from, `${path}.sample.window.from`, errors);
      time(value.sample.window.to, `${path}.sample.window.to`, errors);
    }
  }
  let minTrials = 2147483647;
  if (keys(value.rule, `${path}.rule`, ["confidence", "minTrials"], errors)) {
    const confidence = value.rule.confidence;
    if (typeof confidence !== "number" || confidence <= 0 || confidence >= 1) {
      errors.push(`${path}.rule.confidence: must be a number above 0 and below 1`);
    }
    minTrials = Math.max(1, count(value.rule.minTrials, `${path}.rule.minTrials`, 1, errors));
  }
  if (keys(value.guard, `${path}.guard`, ["job", "step"], errors)) {
    name(value.guard.job, `${path}.guard.job`, errors);
    name(value.guard.step, `${path}.guard.step`, errors);
  }
  if (!Array.isArray(value.scopes)) errors.push(`${path}.scopes: must be an array`);
  else value.scopes.forEach((scope, i) => checkScope(scope, `${path}.scopes[${i}]`, minTrials, errors));
}
