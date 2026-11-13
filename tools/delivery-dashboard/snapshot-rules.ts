import {
  ascending,
  checkDate,
  checkText,
  checkTime,
  checkWindow,
  count,
  keys,
  type Obj,
  oneOf,
  seconds,
} from "./rules-helpers.ts";
import { validateQuality } from "./quality-rules.ts";
import { validateAgents } from "./agents.ts";
import { validateFlow } from "./flow.ts";
import { validateSuperseded } from "./superseded.ts";
const absolutePath = /(?:^|[\s"'(=])(?:\/(?:home|tmp|Users|var|root|etc|mnt|opt|usr)\b|[A-Za-z]:\\)/i;
const handle = /\b(?:session|task|agent|local|subagent)[_-][0-9a-z]{6,}\b/i;
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
// .NET's \w includes Unicode letters, nonspacing marks, decimal digits and connector punctuation.
const localCharacter = /^[\p{L}\p{Mn}\p{Nd}\p{Pc}.+-]$/u;
const domainCharacter = /^[\p{L}\p{Mn}\p{Nd}\p{Pc}-]$/u;
const suffixCharacter = /^[\p{L}\p{Mn}\p{Nd}\p{Pc}.-]$/u;
function containsEmail(value: string): boolean {
  if (!value.includes("@")) return false;
  const chars = Array.from(value);
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] !== "@" || !localCharacter.test(chars[i - 1]!)) continue;
    let end = i + 1;
    while (end < chars.length && domainCharacter.test(chars[end]!)) end++;
    if (end > i + 1 && chars[end] === "." && end + 1 < chars.length && suffixCharacter.test(chars[end + 1]!)) {
      return true;
    }
  }
  return false;
}
function privacy(value: string, path: string, errors: string[]): void {
  if (absolutePath.test(value)) errors.push(path + ": looks like a machine path");
  if (handle.test(value)) errors.push(path + ": looks like a session or task handle");
  if (uuid.test(value)) errors.push(path + ": looks like a UUID");
  if (containsEmail(value)) errors.push(path + ": looks like an e-mail address");
}
/** Walk the validated JSON tokens rather than JSON.parse's object: duplicate fields must not hide private strings. */
function scan(json: string, errors: string[]): void {
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(json[offset] ?? "") && offset < json.length) offset++;
  };
  function string(): string {
    const start = offset++;
    while (offset < json.length) {
      const character = json[offset++];
      if (character === "\\") offset++;
      else if (character === '"') return JSON.parse(json.slice(start, offset)) as string;
    }
    throw new Error("unterminated JSON string");
  }
  function value(path: string, depth: number): void {
    whitespace();
    if (json[offset] === "{" || json[offset] === "[") {
      if (depth >= 64) throw new Error("maximum JSON depth of 64 exceeded");
      const object = json[offset++] === "{";
      whitespace();
      let index = 0;
      while (json[offset] !== (object ? "}" : "]")) {
        if (object) {
          const key = string();
          privacy(key, `${path}.${key} (field name)`, errors);
          whitespace();
          offset++;
          value(`${path}.${key}`, depth + 1);
        } else value(`${path}[${index++}]`, depth + 1);
        whitespace();
        if (json[offset] === ",") {
          offset++;
          whitespace();
        } else break;
      }
      offset++;
    } else if (json[offset] === '"') privacy(string(), path, errors);
    else while (offset < json.length && !/[\s,}\]]/.test(json[offset]!)) offset++;
  }
  value("$", 0);
}
const secondsKeys = ["minSeconds", "medianSeconds", "p90Seconds", "maxSeconds"];
const jobKeys = ["job", "path", "count", ...secondsKeys];
const ciKeys = ["workflow", "basis", "runs", "window", "jobs"];
function baseline(value: unknown, path: string, errors: string[]): void {
  if (value === null || !keys(value, path, ["count", "medianSeconds", "thresholdSeconds"], errors)) return;
  count(value.count, path + ".count", 1, errors);
  seconds(value.medianSeconds, path + ".medianSeconds", errors);
  seconds(value.thresholdSeconds, path + ".thresholdSeconds", errors);
}
function jobTrend(value: unknown, path: string, errors: string[]): void {
  if (
    value === null ||
    !keys(
      value,
      path,
      ["verdict", "recentRuns", "shiftSeconds", "lowSeconds", "highSeconds", "minEffectSeconds"],
      errors,
    )
  ) return;
  oneOf(value.verdict, path + ".verdict", ["noShift", "slower", "faster", "inconclusive"], errors);
  count(value.recentRuns, path + ".recentRuns", 0, errors);
  seconds(value.minEffectSeconds, path + ".minEffectSeconds", errors);
  for (const k of ["shiftSeconds", "lowSeconds", "highSeconds"]) {
    if (typeof value[k] !== "number") errors.push(`${path}.${k}: must be a number of seconds`);
  }
}
function checkJob(job: unknown, path: string, v2: boolean, errors: string[]): void {
  if (!keys(job, path, v2 ? [...jobKeys, "baseline", "trend"] : jobKeys, errors)) return;
  if (typeof job.job !== "string" || !job.job.trim() || job.job.length > 100) {
    errors.push(path + ".job: must be a non-empty string of at most 100 characters");
  }
  oneOf(job.path, path + ".path", ["check", "publication"], errors);
  count(job.count, path + ".count", 1, errors);
  if (!ascending(secondsKeys.map((k) => seconds(job[k], `${path}.${k}`, errors)))) {
    errors.push(`${path}: minSeconds <= medianSeconds <= p90Seconds <= maxSeconds must hold`);
  }
  if (v2) {
    baseline(job.baseline, path + ".baseline", errors);
    jobTrend(job.trend, path + ".trend", errors);
  }
}
function checkCi(ci: Obj, v2: boolean, errors: string[]): void {
  checkText(ci.workflow, "$.ci.workflow", /^[\w.-]+\.ya?ml$/i, "a workflow file name", errors);
  oneOf(ci.basis, "$.ci.basis", ["measured", "inferred"], errors);
  const runs = count(ci.runs, "$.ci.runs", 0, errors);
  if (ci.window === null) { if (runs > 0) errors.push("$.ci.window: must be set when runs is above 0"); }
  else checkWindow(ci.window, "$.ci.window", errors);
  if (v2) {
    if (ci.trend !== null && keys(ci.trend, "$.ci.trend", ["runs", "required", "window"], errors)) {
      const n = count(ci.trend.runs, "$.ci.trend.runs", 0, errors);
      count(ci.trend.required, "$.ci.trend.required", 1, errors);
      if (ci.trend.window === null) { if (n > 0) errors.push("$.ci.trend.window: must be set when runs is above 0"); }
      else checkWindow(ci.trend.window, "$.ci.trend.window", errors);
    }
    if (
      ci.queue !== null && keys(ci.queue, "$.ci.queue", ["runs", "medianSeconds", "p90Seconds", "maxSeconds"], errors)
    ) {
      const queue = ci.queue;
      count(queue.runs, "$.ci.queue.runs", 1, errors);
      if (!ascending(secondsKeys.slice(1).map((k) => seconds(queue[k], `$.ci.queue.${k}`, errors)))) {
        errors.push("$.ci.queue: medianSeconds <= p90Seconds <= maxSeconds must hold");
      }
    }
  }
  if (!Array.isArray(ci.jobs)) {
    errors.push("$.ci.jobs: must be an array");
    return;
  }
  ci.jobs.forEach((job, index) => checkJob(job, `$.ci.jobs[${index}]`, v2, errors));
}
export function validateSnapshot(json: string): string[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (error) {
    return [`$: not valid JSON (${error instanceof Error ? error.message : String(error)})`];
  }
  const errors: string[] = [];
  try {
    scan(json, errors);
  } catch (error) {
    return [`$: not valid JSON (${error instanceof Error ? error.message : String(error)})`];
  }
  if (
    !keys(root, "$", ["version", "date", "generatedAt", "repository", "ci"], errors, [
      "quality",
      "flow",
      "agents",
      "superseded",
    ])
  ) return errors;
  const version = root.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 3) {
    errors.push("$.version: must be 1 to 3");
    return errors;
  }
  checkDate(root.date, "$.date", errors);
  checkTime(root.generatedAt, "$.generatedAt", errors);
  checkText(root.repository, "$.repository", /^[\w.-]+\/[\w.-]+$/i, "owner/name", errors);
  const v2 = version >= 2;
  if (keys(root.ci, "$.ci", v2 ? [...ciKeys, "trend", "queue"] : ciKeys, errors)) checkCi(root.ci, v2, errors);
  if ("flow" in root) validateFlow(root, errors);
  if ("quality" in root) validateQuality(root, errors);
  if ("agents" in root) validateAgents(root, errors);
  if (version >= 3 && !("superseded" in root)) errors.push("$.superseded: field is missing (null when not sampled)");
  else if (version < 3 && "superseded" in root) {
    errors.push("$.superseded: field is not in the schema before version 3");
  } else if ("superseded" in root) validateSuperseded(root, errors);
  return errors;
}
