import { roundEven } from "../ci-timings/statistics.ts";
import { array, integer, object, text } from "../ci-timings/timings.ts";
import { isObject } from "./rules-helpers.ts";
export interface AlertThresholds {
  waitingReviewSeconds: number;
  leadTimeMedianSeconds: number;
  stackDepth: number;
  failureRateLow: number;
}
export const alertDefaults: AlertThresholds = {
  waitingReviewSeconds: 14 * 86400,
  leadTimeMedianSeconds: 24 * 3600,
  stackDepth: 4,
  failureRateLow: 0.1,
};
export interface Breach {
  kind: string;
  text: string;
}
export interface AlertAction {
  kind: string;
  title: string;
  issue: number;
  body: string;
}
export const flowTitle = "Delivery dashboard: flow thresholds breached",
  qualityTitle = "Delivery dashboard: failure-rate thresholds breached on main",
  issueLabel = "performance";
const fraction = (v: number) => String(roundEven(v, 1));
export function evaluateAlerts(json: string, t: AlertThresholds = alertDefaults): Breach[] {
  const root = object(JSON.parse(json)), breaches: Breach[] = [];
  if (isObject(root.flow)) {
    const flow = root.flow, oldest = object(flow.waitingForReview).oldestSeconds;
    if (typeof oldest === "number" && oldest > t.waitingReviewSeconds) {
      breaches.push({
        kind: "flow",
        text: `The oldest pull request waiting for a first review has waited ${
          fraction(oldest / 86400)
        } days (threshold ${fraction(t.waitingReviewSeconds / 86400)} days).`,
      });
    }
    const lead = object(flow.leadTime), stat = lead.stat;
    if (isObject(stat) && Number(stat.medianSeconds) > t.leadTimeMedianSeconds) {
      breaches.push({
        kind: "flow",
        text: `The median lead time to \`main\` is ${
          fraction(Number(stat.medianSeconds) / 3600)
        } h over ${lead.sample} pull requests (threshold ${fraction(t.leadTimeMedianSeconds / 3600)} h).`,
      });
    }
    const deepest = Math.max(0, ...array(object(flow.stacks).open).map((s) => integer(object(s).depth)));
    if (deepest > t.stackDepth) {
      breaches.push({
        kind: "flow",
        text: `The deepest open stack has ${deepest} pull requests (threshold ${t.stackDepth}).`,
      });
    }
  }
  if (isObject(root.quality)) {
    for (const s of array(root.quality.scopes)) {
      const scope = object(s);
      if (scope.scope !== "main") continue;
      for (const value of array(scope.jobs)) {
        const job = object(value);
        if (job.verdict !== "conclusive" || typeof job.low !== "number" || job.low <= t.failureRateLow) continue;
        const name = text(job, "job").replace(/`/g, "'");
        breaches.push({
          kind: "quality",
          text: `\`${name}\` fails ${
            fraction(Number(job.rate) * 100)
          } % of its ${job.trials} attempts on \`main\`, and even the low end of the 95 % interval, ${
            fraction(job.low * 100)
          } %, is above the threshold of ${fraction(t.failureRateLow * 100)} %.`,
        });
      }
    }
  }
  return breaches;
}
export function alertActions(
  breaches: readonly Breach[],
  open: readonly { number: number; title: string }[],
  pageUrl: string,
): AlertAction[] {
  const result: AlertAction[] = [];
  for (const kind of ["flow", "quality"]) {
    const items = breaches.filter((b) => b.kind === kind);
    if (!items.length) continue;
    const title = kind === "flow" ? flowTitle : qualityTitle,
      ids = open.filter((i) => i.title === title).map((i) => i.number);
    const body =
      "The daily delivery snapshot crossed a threshold of the delivery dashboard (story 0053, ADR-0049):\n\n" +
      items.map((i) => "- " + i.text + "\n").join("") +
      "\nEvery number is from the latest snapshot, with its sample and window on the dashboard page" +
      (pageUrl ? ": " + pageUrl : ".") +
      "\n\nThis issue is the only alert for these thresholds. It is updated while they stay crossed and is closed by a person; no other issue is opened.\n\nPosted by the daily `Dashboard snapshot` workflow (`.github/workflows/dashboard-snapshot.yml`).\n";
    result.push({ kind, title, issue: ids.length ? Math.min(...ids) : 0, body });
  }
  return result;
}
export const limitBytes = 50 * 1024 * 1024, warnFraction = 0.8;
export interface RetentionVerdict {
  files: number;
  bytes: number;
  status: string;
  message: string;
}
export function checkRetention(lsTree: string, limit = limitBytes, incoming = 0): RetentionVerdict {
  let files = 0, bytes = 0;
  if (lsTree.trimStart().startsWith("{")) {
    const root = object(JSON.parse(lsTree));
    if (root.truncated === true) {
      return {
        files: 0,
        bytes: 0,
        status: "over",
        message: "The tree listing was truncated by GitHub, so the size cannot be judged: thin the data branch.",
      };
    }
    for (const value of array(root.tree)) {
      const e = object(value);
      if (e.type === "blob" && text(e, "path").startsWith("snapshots/") && "size" in e) {
        files++;
        bytes += integer(e.size);
      }
    }
  } else {for (const line of lsTree.split("\n").filter(Boolean)) {
      const tab = line.indexOf("\t");
      if (tab < 0 || !line.slice(tab + 1).startsWith("snapshots/")) continue;
      const fields = line.slice(0, tab).split(" ").filter(Boolean);
      if (fields.length === 4 && fields[1] === "blob" && /^\d+$/.test(fields[3]!)) {
        files++;
        bytes += Number(fields[3]);
      }
    }}
  if (incoming > 0) files++;
  bytes += incoming;
  const summary = `${files} snapshot files, ${bytes} bytes: ${
    fraction(100 * bytes / limit)
  } % of the ${limit} byte limit.`;
  if (bytes > limit) {
    return {
      files,
      bytes,
      status: "over",
      message: summary + " Over the limit: thin the data branch as the runbook says before the next snapshot.",
    };
  }
  return bytes >= limit * warnFraction
    ? {
      files,
      bytes,
      status: "warning",
      message: summary + " Past 80 % of the limit: plan the thinning in the runbook.",
    }
    : { files, bytes, status: "ok", message: summary };
}
