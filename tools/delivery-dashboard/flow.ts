import { gh } from "../ci-timings/gh.ts";
import { type GhRunner } from "../ci-timings/baseline.ts";
import { summarize } from "../ci-timings/statistics.ts";
import { array, integer, object, text, time } from "../ci-timings/timings.ts";
import { type SampleWindow, timeString } from "./snapshot.ts";
import { ascending, checkWindow, count, isObject, keys, type Obj, oneOf, seconds } from "./rules-helpers.ts";
export interface OpenPr {
  number: number;
  createdAt: number;
  isDraft: boolean;
  reviews: number;
  baseRef: string;
  headRef: string;
}
export interface MergedPr {
  number: number;
  createdAt: number;
  mergedAt: number;
  baseRef: string;
  closes: { number: number; createdAt: number }[];
}
export interface EpicInput {
  number: number;
  items: { issue: number; closed: boolean }[];
}
export interface Distribution {
  count: number;
  medianSeconds: number;
  p90Seconds: number;
  maxSeconds: number;
}
export interface StackInfo {
  depth: number;
  pullRequests: number[];
}
export interface FlowSection {
  basis: string;
  minSample: number;
  window: SampleWindow;
  openPullRequests: { count: number; drafts: number; age: Distribution | null };
  waitingForReview: { count: number; oldestSeconds: number | null };
  leadTime: { sample: number; stat: Distribution | null };
  issueToMerge: { sample: number; stat: Distribution | null };
  stacks: { mergedIntoBase: number; open: StackInfo[] };
  epics: { issue: number; total: number; done: number }[];
}
export const minSample = 5;
export function stacks(open: readonly OpenPr[]): StackInfo[] {
  const byHead = new Map<string, OpenPr>();
  for (const pr of [...open].sort((a, b) => a.number - b.number)) {
    if (!byHead.has(pr.headRef)) byHead.set(pr.headRef, pr);
  }
  const children = new Map<number, OpenPr[]>(), hasParent = new Set<number>();
  for (const pr of open) {
    const parent = byHead.get(pr.baseRef);
    if (parent && parent.number !== pr.number) {
      const list = children.get(parent.number) ?? [];
      list.push(pr);
      children.set(parent.number, list);
      hasParent.add(pr.number);
    }
  }
  function descend(number: number, members: Set<number>): number {
    if (members.has(number)) return 1;
    members.add(number);
    const below = children.get(number);
    return !below ? 1 : 1 + Math.max(...below.map((child) => descend(child.number, members)));
  }
  return open.filter((pr) => !hasParent.has(pr.number) && children.has(pr.number)).map((root) => {
    const members = new Set<number>(), depth = descend(root.number, members);
    return { depth, pullRequests: [...members].sort((a, b) => a - b) };
  }).sort((a, b) => a.pullRequests[0]! - b.pullRequests[0]!);
}
function distribute(values: number[]): Distribution | null {
  if (values.length < minSample) return null;
  const s = summarize(values);
  return {
    count: s.count,
    medianSeconds: Math.round(s.median),
    p90Seconds: Math.round(s.p90),
    maxSeconds: Math.round(s.max),
  };
}
const span = (end: number, start: number) => Math.max(0, (end - start) / 1000);
export function buildFlow(
  now: number,
  windowStart: number,
  mergedListFull: boolean,
  defaultBranch: string,
  open: readonly OpenPr[],
  merged: readonly MergedPr[],
  epics: readonly EpicInput[],
): FlowSection {
  const from = mergedListFull && merged.length
    ? Math.max(windowStart, Math.min(...merged.map((pr) => pr.mergedAt)))
    : windowStart;
  const inWindow = merged.filter((pr) => pr.mergedAt >= from && pr.mergedAt <= now),
    toDefault = inWindow.filter((pr) => pr.baseRef === defaultBranch);
  const waiting = open.filter((pr) => !pr.isDraft && pr.reviews === 0),
    closed = new Map<number, { createdAt: number; mergedAt: number }>();
  for (const pr of toDefault) {
    for (const issue of pr.closes) {
      const existing = closed.get(issue.number);
      if (existing) existing.mergedAt = Math.max(existing.mergedAt, pr.mergedAt);
      else closed.set(issue.number, { createdAt: issue.createdAt, mergedAt: pr.mergedAt });
    }
  }
  const issueSeconds = [...closed.values()].map((i) => span(i.mergedAt, i.createdAt));
  return {
    basis: "measured",
    minSample,
    window: { from: timeString(from), to: timeString(now) },
    openPullRequests: {
      count: open.length,
      drafts: open.filter((pr) => pr.isDraft).length,
      age: distribute(open.map((pr) => span(now, pr.createdAt))),
    },
    waitingForReview: {
      count: waiting.length,
      oldestSeconds: waiting.length ? Math.max(...waiting.map((pr) => span(now, pr.createdAt))) : null,
    },
    leadTime: { sample: toDefault.length, stat: distribute(toDefault.map((pr) => span(pr.mergedAt, pr.createdAt))) },
    issueToMerge: { sample: issueSeconds.length, stat: distribute(issueSeconds) },
    stacks: { mergedIntoBase: inWindow.length - toDefault.length, open: stacks(open) },
    epics: [...epics].sort((a, b) => a.number - b.number).map((epic) => ({
      issue: epic.number,
      total: epic.items.length,
      done: epic.items.filter((i) => i.closed).length,
    })),
  };
}
export function taskList(body: string): { issue: number; ticked: boolean }[] {
  const seen = new Set<number>(), items: { issue: number; ticked: boolean }[] = [];
  for (const m of body.matchAll(/^[ \t]*[-*][ \t]+\[([ xX])\][^\r\n]*?#(\d{1,7})\b/gm)) {
    const issue = Number(m[2]);
    if (!seen.has(issue)) {
      seen.add(issue);
      items.push({ issue, ticked: m[1] !== " " });
    }
  }
  return items;
}
export const flowQuery = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    open: pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { number createdAt isDraft baseRefName headRefName reviews { totalCount } }
    }
    merged: pullRequests(states: MERGED, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number createdAt mergedAt baseRefName closingIssuesReferences(first: 10) { nodes { number createdAt } } }
    }
    epics: issues(states: OPEN, labels: ["epic"], first: 20) { nodes { number body } }
  }
}`;
export interface FlowAnswer {
  defaultBranch: string;
  open: OpenPr[];
  merged: MergedPr[];
  epics: { number: number; body: string }[];
}
function requiredTime(value: unknown): number {
  const result = time(value);
  if (result === null) throw new Error("invalid timestamp");
  return result;
}
export function parseFlow(json: string): FlowAnswer {
  const repo = object(object(object(JSON.parse(json)).data).repository);
  const list = (key: string) => array(object(repo[key]).nodes).map(object);
  return {
    defaultBranch: text(object(repo.defaultBranchRef), "name") || "main",
    open: list("open").map((n) => ({
      number: integer(n.number),
      createdAt: requiredTime(n.createdAt),
      isDraft: n.isDraft === true,
      reviews: integer(object(n.reviews).totalCount),
      baseRef: text(n, "baseRefName"),
      headRef: text(n, "headRefName"),
    })),
    merged: list("merged").filter((n) => typeof n.mergedAt === "string").map((n) => ({
      number: integer(n.number),
      createdAt: requiredTime(n.createdAt),
      mergedAt: requiredTime(n.mergedAt),
      baseRef: text(n, "baseRefName"),
      closes: array(object(n.closingIssuesReferences).nodes).map((v) => {
        const i = object(v);
        return { number: integer(i.number), createdAt: requiredTime(i.createdAt) };
      }),
    })).sort((a, b) => b.mergedAt - a.mergedAt),
    epics: list("epics").map((n) => ({ number: integer(n.number), body: text(n, "body") })),
  };
}
export function stateQuery(numbers: Iterable<number>): string {
  return "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { " +
    [...new Set(numbers)].sort((a, b) => a - b).map((n) => `i${n}: issue(number: ${n}) { state }`).join(" ") + " } }";
}
export function closedIssues(json: string): Set<number> {
  const repo = object(object(object(JSON.parse(json)).data).repository), closed = new Set<number>();
  for (const [name, value] of Object.entries(repo)) {
    if (isObject(value) && value.state === "CLOSED" && /^\d+$/.test(name.slice(1))) closed.add(Number(name.slice(1)));
  }
  return closed;
}
export async function collectFlow(repository: string, now: number, runner: GhRunner = gh): Promise<FlowSection> {
  const [owner, name] = repository.split("/"), identity = ["-F", `owner=${owner}`, "-F", `name=${name}`];
  const parsed = parseFlow(await runner(["api", "graphql", "-f", `query=${flowQuery}`, ...identity]));
  const lists = parsed.epics.map((e) => ({
      number: e.number,
      issues: taskList(e.body).map((i) => i.issue).slice(0, 40),
    })
    ),
    listed = lists.flatMap((l) => l.issues);
  const closed = listed.length
    ? closedIssues(await runner(["api", "graphql", "-f", `query=${stateQuery(listed)}`, ...identity]))
    : new Set<number>();
  return buildFlow(
    now,
    now - 30 * 86400000,
    parsed.merged.length >= 100,
    parsed.defaultBranch,
    parsed.open,
    parsed.merged,
    lists.map((l) => ({ number: l.number, items: l.issues.map((issue) => ({ issue, closed: closed.has(issue) })) })),
  );
}
export function validateFlow(root: Obj, errors: string[]): void {
  const flow = root.flow;
  if (
    !keys(flow, "$.flow", [
      "basis",
      "minSample",
      "window",
      "openPullRequests",
      "waitingForReview",
      "leadTime",
      "issueToMerge",
      "stacks",
      "epics",
    ], errors)
  ) return;
  oneOf(flow.basis, "$.flow.basis", ["measured", "inferred"], errors);
  const min = count(flow.minSample, "$.flow.minSample", 1, errors);
  checkWindow(flow.window, "$.flow.window", errors);
  function stat(value: unknown, p: string, sample: number): void {
    if (value === null) {
      if (sample >= min) errors.push(`${p}: must be set when the sample reaches ${min}`);
      return;
    }
    if (sample < min) errors.push(`${p}: must be null while the sample is below ${min} (inconclusive)`);
    if (!keys(value, p, ["count", "medianSeconds", "p90Seconds", "maxSeconds"], errors)) return;
    if (count(value.count, `${p}.count`, 1, errors) !== sample) errors.push(`${p}.count: must equal the sample`);
    if (!ascending(["medianSeconds", "p90Seconds", "maxSeconds"].map((k) => seconds(value[k], `${p}.${k}`, errors)))) {
      errors.push(`${p}: medianSeconds <= p90Seconds <= maxSeconds must hold`);
    }
  }
  const open = flow.openPullRequests;
  if (keys(open, "$.flow.openPullRequests", ["count", "drafts", "age"], errors)) {
    const n = count(open.count, "$.flow.openPullRequests.count", 0, errors),
      drafts = count(open.drafts, "$.flow.openPullRequests.drafts", 0, errors);
    if (drafts > n) errors.push("$.flow.openPullRequests.drafts: must not exceed count");
    stat(open.age, "$.flow.openPullRequests.age", n);
  }
  const waiting = flow.waitingForReview;
  if (keys(waiting, "$.flow.waitingForReview", ["count", "oldestSeconds"], errors)) {
    const n = count(waiting.count, "$.flow.waitingForReview.count", 0, errors);
    if (waiting.oldestSeconds === null) {
      if (n > 0) errors.push("$.flow.waitingForReview.oldestSeconds: must be set when count is above 0");
    } else seconds(waiting.oldestSeconds, "$.flow.waitingForReview.oldestSeconds", errors);
  }
  for (const name of ["leadTime", "issueToMerge"]) {
    const section = flow[name], p = `$.flow.${name}`;
    if (keys(section, p, ["sample", "stat"], errors)) {
      stat(section.stat, `${p}.stat`, count(section.sample, `${p}.sample`, 0, errors));
    }
  }
  const stacks = flow.stacks;
  if (keys(stacks, "$.flow.stacks", ["mergedIntoBase", "open"], errors)) {
    count(stacks.mergedIntoBase, "$.flow.stacks.mergedIntoBase", 0, errors);
    if (!Array.isArray(stacks.open)) errors.push("$.flow.stacks.open: must be an array");
    else {stacks.open.forEach((stack, i) => {
        const p = `$.flow.stacks.open[${i}]`;
        if (!keys(stack, p, ["depth", "pullRequests"], errors)) return;
        const depth = count(stack.depth, `${p}.depth`, 2, errors);
        if (!Array.isArray(stack.pullRequests) || stack.pullRequests.length < depth || stack.pullRequests.length < 2) {
          errors.push(`${p}.pullRequests: must be an array of at least depth pull request numbers`);
          return;
        }
        for (const n of stack.pullRequests) count(n, `${p}.pullRequests[]`, 1, errors);
      });}
  }
  if (!Array.isArray(flow.epics)) errors.push("$.flow.epics: must be an array");
  else {flow.epics.forEach((epic, i) => {
      const p = `$.flow.epics[${i}]`;
      if (!keys(epic, p, ["issue", "total", "done"], errors)) return;
      count(epic.issue, `${p}.issue`, 1, errors);
      const total = count(epic.total, `${p}.total`, 0, errors);
      if (count(epic.done, `${p}.done`, 0, errors) > total) errors.push(`${p}.done: must not exceed total`);
    });}
}
