import { integer, type JsonObject, object, ordinal, text, time } from "../ci-timings/timings.ts";
import { join } from "@std/path";
export interface Options {
  issue: number;
  pullRequests: number[];
  peek: boolean;
}
export const usage = "usage: handover-watch <issue> [--pr N]... [--peek]";
function positive(value: string | undefined): number | null {
  if (!value || !/^#+\d+$|^\d+$/.test(value)) return null;
  const number = Number(value.replace(/^#+/, ""));
  return number > 0 && number <= 2147483647 ? number : null;
}
export function parseOptions(args: readonly string[]): Options | null {
  let issue: number | null = null, peek = false;
  const pullRequests: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--peek") peek = true;
    else if (arg === "--pr") {
      const pr = positive(args[++i]);
      if (pr === null) return null;
      pullRequests.push(pr);
    } else if (issue === null) {
      issue = positive(arg);
      if (issue === null) return null;
    } else return null;
  }
  return issue === null ? null : { issue, pullRequests: [...new Set(pullRequests)], peek };
}
export interface PullRequest {
  number: number;
  state: string;
  changedAt: number;
  url: string;
  author: string;
  association: string;
}
export interface WatchItem {
  kind: string;
  id: string;
  number: number;
  author: string;
  isBot: boolean;
  at: number;
  url: string;
  body: string;
  association: string;
  hiddenReason?: string;
  reviewState?: string;
  location?: string;
  replyTo?: string;
}
export type ListKind =
  | "IssueComments"
  | "CrossReferences"
  | "PrComments"
  | "Reviews"
  | "ReviewThreads"
  | "ThreadComments";
export interface PendingPage {
  kind: ListKind;
  nodeId: string;
  cursor: string;
  number: number;
}
export interface GraphQlRequest {
  text: string;
  variables: [string, string][];
  inRepository: boolean;
}
const pageInfo = "pageInfo { hasNextPage endCursor }",
  author = "author { __typename login }",
  trust = "authorAssociation isMinimized minimizedReason";
const commentFields = `fullDatabaseId createdAt url body ${author} ${trust}`;
const reviewFields = `fullDatabaseId state submittedAt url body ${author} ${trust}`;
const threadFields =
  `fullDatabaseId state createdAt url body path line originalLine replyTo { fullDatabaseId } ${author} ${trust}`;
const prHeader = `id number state createdAt closedAt mergedAt url body authorAssociation ${author}`;
const repository = "repository(owner: $owner, name: $name)";
const comments = (args: string) => `comments(${args}) { ${pageInfo} nodes { ${commentFields} } }`;
const reviews = (args: string) => `reviews(${args}) { ${pageInfo} nodes { ${reviewFields} } }`;
const threadComments = (args: string) => `comments(${args}) { ${pageInfo} nodes { ${threadFields} } }`;
const threads = (args: string) => `reviewThreads(${args}) { ${pageInfo} nodes { id ${threadComments("first: 50")} } }`;
const references = (args: string) =>
  `timelineItems(${args}, itemTypes: [CROSS_REFERENCED_EVENT]) { ${pageInfo} nodes { ... on CrossReferencedEvent { isCrossRepository source { ... on PullRequest { ${prHeader} } } } } }`;
const prLists = () => `id number ${comments("first: 100")} ${reviews("first: 100")} ${threads("first: 10")}`;
const appendPrs = (numbers: readonly number[], fields: string) =>
  numbers.map((n) => `pr${n}: pullRequest(number: ${n}) { ${fields} } `).join("");
export function firstQuery(issue: number, prs: readonly number[]): GraphQlRequest {
  const fields = `id ${comments("first: 100")} ${references("first: 100")}`;
  return {
    text:
      `query($owner: String!, $name: String!) { ${repository} { target: issueOrPullRequest(number: ${issue}) { ... on Issue { ${fields} } ... on PullRequest { ${fields} } } ${
        appendPrs(prs, `${prHeader} ${prLists()}`)
      }} }`,
    variables: [],
    inRepository: true,
  };
}
export function fieldOf(kind: ListKind): string {
  return kind === "CrossReferences"
    ? "timelineItems"
    : kind === "Reviews"
    ? "reviews"
    : kind === "ReviewThreads"
    ? "reviewThreads"
    : "comments";
}
function selection(kind: ListKind, args: string): string {
  if (kind === "IssueComments" || kind === "PrComments") {
    return `... on Issue { ${comments(args)} } ... on PullRequest { ${comments(args)} }`;
  }
  if (kind === "CrossReferences") {
    return `... on Issue { ${references(args)} } ... on PullRequest { ${references(args)} }`;
  }
  if (kind === "Reviews") return `... on PullRequest { ${reviews(args)} }`;
  if (kind === "ReviewThreads") return `... on PullRequest { ${threads(args)} }`;
  return `... on PullRequestReviewThread { ${threadComments(args)} }`;
}
export function nextQuery(pages: readonly PendingPage[], prs: readonly number[]): GraphQlRequest {
  const declarations = prs.length ? ["$owner: String!, $name: String!"] : [];
  declarations.push(...pages.map((_, i) => `$n${i}: ID!, $a${i}: String!`));
  const variables: [string, string][] = [];
  let query = `query(${declarations.join(", ")}) { `;
  pages.forEach((page, i) => {
    const size = page.kind === "ReviewThreads" ? 10 : page.kind === "ThreadComments" ? 50 : 100;
    query += `p${i}: node(id: $n${i}) { ${selection(page.kind, `first: ${size}, after: $a${i}`)} } `;
    variables.push([`n${i}`, page.nodeId], [`a${i}`, page.cursor]);
  });
  if (prs.length) query += `${repository} { ${appendPrs(prs, prLists())}} `;
  return { text: query + "}", variables, inRepository: prs.length > 0 };
}
export function queryArguments(request: GraphQlRequest): string[] {
  return [
    "api",
    "graphql",
    ...(request.inRepository ? ["-F", "owner={owner}", "-F", "name={repo}"] : []),
    ...request.variables.flatMap(([key, value]) => ["-f", `${key}=${value}`]),
    "-f",
    `query=${request.text}`,
  ];
}
function node(value: unknown, key: string): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = (value as JsonObject)[key];
  return result && typeof result === "object" && !Array.isArray(result) ? result as JsonObject : null;
}
/** GraphQL fullDatabaseId is a decimal string; never round it through Number. */
function long(value: JsonObject, key: string): string | null {
  const v = value[key];
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
  const id = BigInt(v);
  return id <= 9223372036854775807n ? String(id) : null;
}
function authorOf(value: JsonObject): { author: string; isBot: boolean } {
  const a = node(value, "author"), isBot = a ? text(a, "__typename") === "Bot" : false;
  const login = a ? text(a, "login") : "";
  return { author: isBot && !login.endsWith("[bot]") ? login + "[bot]" : login, isBot };
}
function toPr(value: JsonObject): PullRequest {
  const created = time(value.createdAt) ?? -62135596800000,
    merged = time(value.mergedAt),
    closed = text(value, "state") === "CLOSED";
  return {
    number: integer(value.number),
    state: merged !== null ? "merged" : closed ? "closed" : "open",
    changedAt: merged ?? (closed ? time(value.closedAt) ?? created : created),
    url: text(value, "url"),
    author: authorOf(value).author,
    association: text(value, "authorAssociation"),
  };
}
export function namesIssue(body: string, issue: number): boolean {
  for (
    const match of body.matchAll(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b:?\s+(#\d+(?:\s*(?:,|and|&)\s*#\d+)*)/gi,
    )
  ) {
    if ([...match[1]!.matchAll(/#(\d+)/g)].some((n) => Number(n[1]) === issue)) return true;
  }
  return false;
}
export function isDeliveryPr(value: JsonObject, issue: number): boolean {
  const source = node(value, "source");
  return value.isCrossRepository === false && source !== null && "number" in source &&
    ["OWNER", "MEMBER", "COLLABORATOR"].includes(text(source, "authorAssociation")) &&
    namesIssue(text(source, "body"), issue);
}
export function describe(page: PendingPage): string {
  const n = page.number;
  switch (page.kind) {
    case "IssueComments":
      return `the comments of #${n}`;
    case "CrossReferences":
      return `the cross-references of #${n}`;
    case "PrComments":
      return `the comments of PR #${n}`;
    case "Reviews":
      return `the reviews of PR #${n}`;
    case "ReviewThreads":
      return `the review threads of PR #${n}`;
    default:
      return `a review thread of PR #${n}`;
  }
}
function data(json: string): JsonObject {
  const root = object(JSON.parse(json));
  if (Array.isArray(root.errors) && root.errors.length) {
    throw new Error("GitHub GraphQL: " + root.errors.map((error) => text(object(error), "message")).join("; "));
  }
  const result = node(root, "data");
  if (!result) throw new Error("GitHub GraphQL: no data");
  return result;
}
function item(kind: string, number: number, value: JsonObject, timeKey: string): WatchItem | null {
  const id = long(value, "fullDatabaseId"), at = time(value[timeKey]);
  if (id === null || at === null) return null;
  return {
    kind,
    id,
    number,
    ...authorOf(value),
    at,
    url: text(value, "url"),
    body: text(value, "body"),
    association: text(value, "authorAssociation"),
    ...(value.isMinimized === true ? { hiddenReason: text(value, "minimizedReason") || "unspecified" } : {}),
  };
}
export class Snapshot {
  private prs = new Map<number, PullRequest>();
  private read = new Set<number>();
  private unread: number[] = [];
  private pending: PendingPage[] = [];
  items: WatchItem[] = [];
  unfinished: string[] = [];
  constructor(readonly issue: number) {}
  get pullRequests(): PullRequest[] {
    return [...this.prs.values()].sort((a, b) => a.number - b.number);
  }
  get hasPending(): boolean {
    return this.pending.length > 0 || this.unread.length > 0;
  }
  takePending(): PendingPage[] {
    const result = [...new Map(this.pending.map((p) => [JSON.stringify(p), p])).values()];
    this.pending = [];
    return result;
  }
  takeUnread(): number[] {
    const result = [...new Set(this.unread.filter((n) => !this.read.has(n)))];
    this.unread = [];
    return result;
  }
  stopFollowing(): void {
    this.unfinished.push(
      ...new Set(this.takePending().map(describe)),
      ...this.takeUnread().map((n) => `the lists of PR #${n}`),
    );
  }
  readFirst(json: string, named: readonly number[]): void {
    const repo = object(data(json).repository), target = node(repo, "target");
    if (!target) throw new Error(`#${this.issue} was not found`);
    this.readPrs(repo, named);
    this.readList(target, "IssueComments", text(target, "id"), this.issue);
    this.readList(target, "CrossReferences", text(target, "id"), this.issue);
  }
  readNext(pages: readonly PendingPage[], prs: readonly number[], json: string): void {
    const value = data(json);
    pages.forEach((page, i) => {
      const owner = node(value, `p${i}`);
      if (!owner) throw new Error(`the next page of ${describe(page)} was not returned`);
      this.readList(owner, page.kind, page.nodeId, page.number);
    });
    if (prs.length) {
      const repo = node(value, "repository");
      if (!repo) throw new Error("GitHub GraphQL: no repository");
      this.readPrs(repo, prs);
    }
  }
  private readPrs(repo: JsonObject, numbers: readonly number[]): void {
    for (const n of numbers) {
      const pr = node(repo, `pr${n}`);
      if (!pr) throw new Error(`PR #${n} was not found`);
      const number = integer(pr.number);
      if (this.read.has(number)) continue;
      this.read.add(number);
      if (!this.prs.has(number)) this.prs.set(number, toPr(pr));
      for (const kind of ["PrComments", "Reviews", "ReviewThreads"] as const) {
        this.readList(pr, kind, text(pr, "id"), number);
      }
    }
  }
  private readList(owner: JsonObject, kind: ListKind, nodeId: string, number: number): void {
    const list = node(owner, fieldOf(kind));
    if (!list) return;
    if (Array.isArray(list.nodes)) { for (const value of list.nodes) this.readNode(kind, number, object(value)); }
    const info = node(list, "pageInfo"), cursor = info ? text(info, "endCursor") : "";
    if (info?.hasNextPage === true && cursor && nodeId) this.pending.push({ kind, nodeId, cursor, number });
  }
  private readNode(kind: ListKind, number: number, value: JsonObject): void {
    let result: WatchItem | null = null;
    switch (kind) {
      case "IssueComments":
        result = item("issue-comment", number, value, "createdAt");
        break;
      case "PrComments":
        result = item("pr-comment", number, value, "createdAt");
        break;
      case "CrossReferences":
        if (isDeliveryPr(value, this.issue)) {
          const pr = toPr(object(value.source));
          if (!this.prs.has(pr.number)) {
            this.prs.set(pr.number, pr);
            this.unread.push(pr.number);
          }
        }
        break;
      case "Reviews": {
        const state = text(value, "state");
        if (state === "PENDING" || (state === "COMMENTED" && !text(value, "body").trim())) break;
        result = item("review", number, value, "submittedAt");
        if (result) result.reviewState = state;
        break;
      }
      case "ReviewThreads":
        this.readList(value, "ThreadComments", text(value, "id"), number);
        break;
      case "ThreadComments": {
        if (text(value, "state") === "PENDING") break;
        result = item("review-comment", number, value, "createdAt");
        if (result) {
          const path = text(value, "path"),
            line = long(value, "line") ?? long(value, "originalLine"),
            reply = node(value, "replyTo");
          result.location = line === null ? path : `${path}:${line}`;
          const id = reply ? long(reply, "fullDatabaseId") : null;
          if (id !== null) result.replyTo = id;
        }
        break;
      }
    }
    if (result) this.items.push(result);
  }
}
export const maxFollowUps = 20;
export async function fetchSnapshot(
  options: Options,
  send: (request: GraphQlRequest) => Promise<string>,
): Promise<Snapshot> {
  const result = new Snapshot(options.issue);
  result.readFirst(await send(firstQuery(options.issue, options.pullRequests)), options.pullRequests);
  let rounds = 0;
  while (result.hasPending) {
    if (++rounds > maxFollowUps) {
      result.stopFollowing();
      break;
    }
    const pages = result.takePending(), prs = result.takeUnread();
    result.readNext(pages, prs, await send(nextQuery(pages, prs)));
  }
  return result;
}
export const key = (item: WatchItem) => `${item.kind}:${item.id}`;
export function stateItems(prs: readonly PullRequest[]): WatchItem[] {
  return prs.map((pr) => ({
    kind: "pr-state",
    id: `${pr.number}:${pr.state}`,
    number: pr.number,
    author: pr.author,
    isBot: false,
    at: pr.changedAt,
    url: pr.url,
    body: "",
    association: pr.association,
  }));
}
export function newItems(items: readonly WatchItem[], seen: ReadonlySet<string>): WatchItem[] {
  const unique = new Map<string, WatchItem>();
  for (const item of items) if (!seen.has(key(item)) && !unique.has(key(item))) unique.set(key(item), item);
  return [...unique.values()].sort((a, b) => a.at - b.at || ordinal(key(a), key(b)));
}
export function parseSeen(text: string): Set<string> {
  return new Set(text.split("\n").map((line) => line.trim()).filter(Boolean));
}
export function seenLines(items: readonly WatchItem[]): string {
  return items.map((item) => key(item) + "\n").join("");
}
export function recordPathFor(root: string, issue: number): string {
  return join(root, ".plan", "handover-watch", `${issue}.seen`);
}
export function clean(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(
    // deno-lint-ignore no-control-regex -- sanitize terminal controls from untrusted discussion text.
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    "�",
  );
}
export function singleLine(text: string): string {
  return clean(text).replace(/[\n\t\u2028\u2029]/g, "�");
}
export function endsWithAgentFooter(body: string): boolean {
  return clean(body).split("\n").filter((line) => line.trim()).at(-1)?.trim().startsWith("🤖 Generated with") ?? false;
}
export function header(item: WatchItem): string {
  const parts = [
    "=== " + key(item),
    `${item.kind === "issue-comment" ? "#" : "PR #"}${item.number}`,
    item.isBot ? item.author + " (bot)" : item.author,
  ];
  if (item.association) parts.push(item.association);
  if (item.hiddenReason !== undefined) parts.push("hidden: " + item.hiddenReason);
  if (item.kind !== "pr-state") parts.push("agent-footer: " + (endsWithAgentFooter(item.body) ? "yes" : "no"));
  if (item.reviewState !== undefined) parts.push(item.reviewState);
  parts.push(new Date(item.at).toISOString().replace(/\.\d{3}Z$/, "Z"));
  if (item.location !== undefined) parts.push(item.location);
  if (item.replyTo !== undefined) parts.push("reply-to review-comment:" + item.replyTo);
  return singleLine(parts.join(" · "));
}
export function render(issue: number, prs: readonly PullRequest[], fresh: readonly WatchItem[]): string {
  let output = `#${issue} · ${
    prs.length ? "PRs " + prs.map((pr) => `#${pr.number} ${pr.state}`).join(", ") : "no delivery PRs"
  } · ${fresh.length ? fresh.length + " new" : "nothing new"}\n`;
  for (const item of fresh) {
    output += header(item) + "\n" + clean(item.url) + "\n";
    if (item.hiddenReason !== undefined || !item.body.trim()) continue;
    output += clean(item.body).replace(/\n+$/, "").split("\n").map((line) => (line ? "  " + line : "") + "\n").join("");
  }
  return output;
}
