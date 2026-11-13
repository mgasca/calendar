import { gh } from "../ci-timings/gh.ts";
import { type GhRunner } from "../ci-timings/baseline.ts";
import { type SampleWindow, timeString } from "./snapshot.ts";
import { checkWindow, count, isObject, keys, type Obj, oneOf } from "./rules-helpers.ts";
export interface CountParse {
  kind: string;
  tasks: number;
  subagents: number;
}
export function parseCountComment(body: string): CountParse {
  let tasks = 0, subagents = 0, found = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith(">")) continue;
    for (const match of line.matchAll(/\b(task|subagent)s?\s+started\s*[:=]\s*([^\s.,;]*)/gi)) {
      found = true;
      const text = match[2]!;
      if (text.length === 0 || text.length > 4 || !/^\d+$/.test(text) || Number(text) > 1000) {
        return { kind: "malformed", tasks: 0, subagents: 0 };
      }
      if (match[1]!.toLowerCase() === "task") tasks += Number(text);
      else subagents += Number(text);
    }
  }
  return { kind: found ? "valid" : "none", tasks, subagents };
}
export interface IssueInput {
  number: number;
  updatedAt: number;
  commentTotal: number;
  commentBodies: string[];
  pullRequests: { number: number; reviews: number }[];
}
export interface AgentIssue {
  issue: number;
  countComments: number;
  malformed: number;
  tasks: number | null;
  subagents: number | null;
  comments: number;
  reviews: number;
  pullRequests: number;
}
export interface AgentsSection {
  basis: { activity: string; counts: string };
  sample: { scanned: number; window: SampleWindow | null };
  activity: { issues: number; withCounts: number; comments: number; reviews: number; pullRequests: number };
  counts: { countComments: number; malformed: number; tasks: number; subagents: number };
  issues: AgentIssue[];
}
export function buildAgents(issues: readonly IssueInput[]): AgentsSection {
  const rows = issues.map((issue) => {
    const parsed = issue.commentBodies.map(parseCountComment), valid = parsed.filter((i) => i.kind === "valid");
    const mentions = issue.pullRequests.filter((p, index, all) =>
      all.findIndex((other) => other.number === p.number) === index
    );
    return {
      issue: issue.number,
      countComments: valid.length,
      malformed: parsed.filter((i) => i.kind === "malformed").length,
      tasks: valid.length ? valid.reduce((s, i) => s + i.tasks, 0) : null,
      subagents: valid.length ? valid.reduce((s, i) => s + i.subagents, 0) : null,
      comments: Math.max(issue.commentTotal, issue.commentBodies.length),
      reviews: mentions.reduce((s, i) => s + i.reviews, 0),
      pullRequests: mentions.length,
    };
  }).filter((row) => row.comments > 0 || row.pullRequests > 0).sort((a, b) => b.issue - a.issue);
  const sum = (key: "comments" | "reviews" | "pullRequests" | "countComments" | "malformed" | "tasks" | "subagents") =>
    rows.reduce((s, r) => s + (r[key] ?? 0), 0);
  return {
    basis: { activity: "measured", counts: "inferred" },
    sample: {
      scanned: issues.length,
      window: issues.length
        ? {
          from: timeString(Math.min(...issues.map((i) => i.updatedAt))),
          to: timeString(Math.max(...issues.map((i) => i.updatedAt))),
        }
        : null,
    },
    activity: {
      issues: rows.length,
      withCounts: rows.filter((r) => r.countComments > 0).length,
      comments: sum("comments"),
      reviews: sum("reviews"),
      pullRequests: sum("pullRequests"),
    },
    counts: {
      countComments: sum("countComments"),
      malformed: sum("malformed"),
      tasks: sum("tasks"),
      subagents: sum("subagents"),
    },
    issues: rows,
  };
}
function path(value: unknown, ...names: string[]): unknown {
  for (const name of names) {
    if (!isObject(value)) return undefined;
    value = value[name];
  }
  return value;
}
function nodes(value: unknown): Obj[] {
  const list = path(value, "nodes");
  return Array.isArray(list) ? list.filter(isObject) : [];
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    ? value
    : null;
}
export function parseAgentIssues(json: string, repository: string): IssueInput[] {
  const root: unknown = JSON.parse(json), issues: IssueInput[] = [];
  for (const node of nodes(path(root, "data", "repository", "issues"))) {
    const n = number(node.number), updated = typeof node.updatedAt === "string" ? Date.parse(node.updatedAt) : NaN;
    if (n === null || !Number.isFinite(updated)) continue;
    const comments = node.comments, bodies = nodes(comments).map((c) => typeof c.body === "string" ? c.body : "");
    const mentions = nodes(node.timelineItems).flatMap((item) => {
      const source = path(item, "source"),
        n = number(path(source, "number")),
        origin = path(source, "repository", "nameWithOwner");
      return n !== null && typeof origin === "string" && origin.toLowerCase() === repository.toLowerCase()
        ? [{ number: n, reviews: number(path(source, "reviews", "totalCount")) ?? 0 }]
        : [];
    });
    issues.push({
      number: n,
      updatedAt: updated,
      commentTotal: number(path(comments, "totalCount")) ?? 0,
      commentBodies: bodies,
      pullRequests: mentions,
    });
  }
  return issues;
}
export const agentQuery = `query($owner: String!, $name: String!, $count: Int!) {
  repository(owner: $owner, name: $name) {
    issues(first: $count, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        updatedAt
        comments(first: 100) { totalCount nodes { body } }
        timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT]) {
          nodes {
            ... on CrossReferencedEvent {
              source { ... on PullRequest { number reviews { totalCount } repository { nameWithOwner } } }
            }
          }
        }
      }
    }
  }
}`;
export async function collectAgents(repository: string, count = 100, runner: GhRunner = gh): Promise<IssueInput[]> {
  const parts = repository.split("/");
  return parseAgentIssues(
    await runner([
      "api",
      "graphql",
      "-f",
      `query=${agentQuery}`,
      "-f",
      `owner=${parts[0]}`,
      "-f",
      `name=${parts[1]}`,
      "-F",
      `count=${Math.min(100, Math.max(1, count))}`,
    ]),
    repository,
  );
}
export function validateAgents(root: Obj, errors: string[]): void {
  const agents = root.agents;
  if (!keys(agents, "$.agents", ["basis", "sample", "activity", "counts", "issues"], errors)) return;
  if (keys(agents.basis, "$.agents.basis", ["activity", "counts"], errors)) {
    for (const key of ["activity", "counts"]) {
      oneOf(agents.basis[key], `$.agents.basis.${key}`, ["measured", "inferred"], errors);
    }
  }
  let scanned = 0;
  if (keys(agents.sample, "$.agents.sample", ["scanned", "window"], errors)) {
    scanned = count(agents.sample.scanned, "$.agents.sample.scanned", 0, errors);
    if (agents.sample.window === null) {
      if (scanned > 0) errors.push("$.agents.sample.window: must be set when scanned is above 0");
    } else checkWindow(agents.sample.window, "$.agents.sample.window", errors);
  }
  const activityKeys = ["issues", "withCounts", "comments", "reviews", "pullRequests"],
    countKeys = ["countComments", "malformed", "tasks", "subagents"],
    issueKeys = ["issue", "countComments", "malformed", "tasks", "subagents", "comments", "reviews", "pullRequests"];
  function numbers(value: unknown, p: string, allowed: string[]): Record<string, number> {
    if (!keys(value, p, allowed, errors)) return {};
    return Object.fromEntries(allowed.map((key) => [key, count(value[key], `${p}.${key}`, 0, errors)]));
  }
  const activity = numbers(agents.activity, "$.agents.activity", activityKeys),
    counts = numbers(agents.counts, "$.agents.counts", countKeys);
  if (!Array.isArray(agents.issues)) {
    errors.push("$.agents.issues: must be an array");
    return;
  }
  const rows: Record<string, number>[] = [], seen = new Set<number>();
  agents.issues.forEach((issue, index) => {
    const p = `$.agents.issues[${index}]`;
    if (!keys(issue, p, issueKeys, errors)) return;
    const row: Record<string, number> = {};
    for (const key of issueKeys.filter((k) => k !== "tasks" && k !== "subagents")) {
      row[key] = count(issue[key], `${p}.${key}`, key === "issue" ? 1 : 0, errors);
    }
    for (const key of ["tasks", "subagents"]) {
      if (row.countComments === 0) {
        if (issue[key] !== null) errors.push(`${p}.${key}: must be null without a count comment`);
        row[key] = 0;
      } else row[key] = count(issue[key], `${p}.${key}`, 0, errors);
    }
    if (row.comments === 0 && row.pullRequests === 0) {
      errors.push(`${p}: an issue with no comment and no pull request is not listed`);
    }
    rows.push(row);
    if (seen.has(row.issue!)) errors.push(`${p}.issue: must be listed once`);
    seen.add(row.issue!);
  });
  if (agents.issues.length > scanned) {
    errors.push(`$.agents.issues: cannot hold more issues than sample.scanned (${scanned})`);
  }
  if (
    rows.length === agents.issues.length && Object.keys(activity).length === activityKeys.length &&
    Object.keys(counts).length === countKeys.length
  ) {
    const same = (p: string, actual: number, expected: number) => {
      if (actual !== expected) errors.push(`${p}: must equal the sum over the listed issues (${expected})`);
    };
    same("$.agents.activity.issues", activity.issues!, rows.length);
    same("$.agents.activity.withCounts", activity.withCounts!, rows.filter((r) => r.countComments! > 0).length);
    for (const key of ["comments", "reviews", "pullRequests"]) {
      same(
        `$.agents.activity.${key}`,
        activity[key]!,
        rows.reduce((s, r) => s + r[key]!, 0),
      );
    }
    for (const key of countKeys) same(`$.agents.counts.${key}`, counts[key]!, rows.reduce((s, r) => s + r[key]!, 0));
  }
}
