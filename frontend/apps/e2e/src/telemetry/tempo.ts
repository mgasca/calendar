import { FatalPollError, getJson, poll, type PollOptions } from './poll.ts';

/** One span of a trace as Tempo returns it, with the ids in hex and every value as text. */
export interface FlatSpan {
  readonly service: string;
  readonly name: string;
  readonly kind: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly attributes: readonly (readonly [string, string])[];
  readonly resource: readonly (readonly [string, string])[];
  readonly events: readonly {
    readonly name: string;
    readonly attributes: readonly (readonly [string, string])[];
  }[];
  readonly status: string;
}

/** A span the flow must contain: its service and its name. */
export interface SpanMatcher {
  readonly service: string;
  readonly name: string | RegExp;
}

export const web = (name: string | RegExp): SpanMatcher => ({ service: 'calendar-web', name });
export const api = (name: string | RegExp): SpanMatcher => ({ service: 'calendar-api', name });

/** The trace id in a W3C `traceparent` header (`00-<trace id>-<span id>-<flags>`). */
export function traceIdOf(traceparent: string | null | undefined): string {
  const match = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/.exec(traceparent ?? '');
  if (!match?.[1])
    throw new Error(`The request carried no valid traceparent (got '${String(traceparent)}').`);
  return match[1];
}

interface OtlpValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpValue[] };
}
interface OtlpAttribute {
  key: string;
  value?: OtlpValue;
}
interface OtlpSpan {
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: string;
  attributes?: OtlpAttribute[];
  events?: { name?: string; attributes?: OtlpAttribute[] }[];
  status?: { code?: string; message?: string };
}
interface OtlpTrace {
  trace?: {
    resourceSpans?: {
      resource?: { attributes?: OtlpAttribute[] };
      scopeSpans?: { spans?: OtlpSpan[] }[];
    }[];
  };
}

function text(value: OtlpValue | undefined): string {
  if (!value) return '';
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(text).join(',');
  const scalar = value.stringValue ?? value.intValue ?? value.doubleValue ?? value.boolValue;
  return scalar === undefined ? '' : String(scalar);
}

const pairs = (attributes: OtlpAttribute[] | undefined) =>
  (attributes ?? []).map((attribute) => [attribute.key, text(attribute.value)] as const);

/** Tempo's v2 API sends span ids in base64; the traceparent and Loki use hex. */
function hex(id: string | undefined): string {
  if (!id) return '';
  if (/^[\da-f]+$/.test(id) && id.length % 2 === 0 && id.length >= 16) return id;
  return Buffer.from(id, 'base64').toString('hex');
}

/** The spans of a Tempo `GET /api/v2/traces/<id>` answer. */
export function flattenTrace(body: unknown): FlatSpan[] {
  const spans: FlatSpan[] = [];
  for (const resourceSpans of (body as OtlpTrace).trace?.resourceSpans ?? []) {
    const resource = pairs(resourceSpans.resource?.attributes);
    const service = resource.find(([key]) => key === 'service.name')?.[1] ?? '';
    for (const scope of resourceSpans.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        spans.push({
          service,
          name: span.name ?? '',
          kind: span.kind ?? '',
          spanId: hex(span.spanId),
          parentSpanId: hex(span.parentSpanId),
          attributes: pairs(span.attributes),
          resource,
          events: (span.events ?? []).map((event) => ({
            name: event.name ?? '',
            attributes: pairs(event.attributes),
          })),
          status: [span.status?.code, span.status?.message].filter(Boolean).join(': '),
        });
      }
    }
  }
  return spans;
}

const matches = (span: FlatSpan, matcher: SpanMatcher) =>
  span.service === matcher.service &&
  (typeof matcher.name === 'string' ? span.name === matcher.name : matcher.name.test(span.name));

export const describeMatcher = (matcher: SpanMatcher) =>
  `${matcher.service} '${String(matcher.name)}'`;

/** What the flow's trace must hold. */
export interface TraceExpectation {
  /**
   * Spans each nested under the one before it (a descendant, not necessarily a direct child): the browser
   * action, its fetch span, the API's server span and a database span, for example.
   */
  readonly chain: readonly SpanMatcher[];
  /** Further spans that must be in the same trace. */
  readonly spans?: readonly SpanMatcher[];
}

/** Every way `spans` falls short of `expectation`; empty when the trace is as expected. */
export function traceProblems(spans: readonly FlatSpan[], expectation: TraceExpectation): string[] {
  const problems: string[] = [];
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const isUnder = (span: FlatSpan, ancestor: FlatSpan) => {
    const seen = new Set<string>();
    for (
      let parent = byId.get(span.parentSpanId);
      parent && !seen.has(parent.spanId);
      parent = byId.get(parent.parentSpanId)
    ) {
      if (parent === ancestor) return true;
      seen.add(parent.spanId);
    }
    return false;
  };
  for (const matcher of [...expectation.chain, ...(expectation.spans ?? [])]) {
    if (!spans.some((span) => matches(span, matcher)))
      problems.push(`no span ${describeMatcher(matcher)}`);
  }
  if (problems.length > 0) return problems;
  // Each link of the chain must have a candidate under some candidate of the link before it.
  let candidates = spans.filter((span) =>
    matches(span, expectation.chain[0] ?? { service: '', name: '' }),
  );
  for (let index = 1; index < expectation.chain.length; index++) {
    const matcher = expectation.chain[index];
    if (!matcher) break;
    const next = spans.filter(
      (span) => matches(span, matcher) && candidates.some((parent) => isUnder(span, parent)),
    );
    if (next.length === 0) {
      const previous = expectation.chain[index - 1];
      problems.push(
        `no span ${describeMatcher(matcher)} under ${previous ? describeMatcher(previous) : 'the root'}`,
      );
      break;
    }
    candidates = next;
  }
  return problems;
}

/** Summary of a trace for an assertion message: service and name per span, no attribute values. */
export const outline = (spans: readonly FlatSpan[]) =>
  spans.map((span) => `${span.service}: ${span.name}`).join('; ');

/** The trace, once Tempo holds every span `expectation` asks for (the browser exports in batches). */
export async function waitForTrace(
  tempoUrl: string,
  traceId: string,
  expectation: TraceExpectation,
  options?: PollOptions,
): Promise<FlatSpan[]> {
  return poll(
    `Trace ${traceId} in Tempo`,
    async () => {
      const spans = flattenTrace(await getJson(new URL(`/api/v2/traces/${traceId}`, tempoUrl)));
      const problems = traceProblems(spans, expectation);
      return problems.length === 0
        ? { done: true, value: spans }
        : { done: false, reason: `${problems.join(', ')} (has: ${outline(spans) || 'nothing'})` };
    },
    options,
  );
}

/** A trace as Tempo's search lists it. */
export interface FoundTrace {
  readonly traceId: string;
  readonly rootService: string;
  readonly rootName: string;
  /** The root span's start, in milliseconds since the epoch. */
  readonly startedAt: number;
}

interface TempoSearch {
  traces?: {
    traceID?: string;
    rootServiceName?: string;
    rootTraceName?: string;
    startTimeUnixNano?: string;
  }[];
}

/** The traces of a Tempo `GET /api/search` answer. */
export function searchResults(body: unknown): FoundTrace[] {
  return ((body as TempoSearch).traces ?? []).map((trace) => ({
    // Tempo's search drops the id's leading zeros; Loki and the traceparent keep all 32 hex digits.
    traceId: (trace.traceID ?? '').padStart(32, '0'),
    rootService: trace.rootServiceName ?? '',
    rootName: trace.rootTraceName ?? '',
    startedAt: Number(BigInt(trace.startTimeUnixNano ?? '0') / 1_000_000n),
  }));
}

/** The traces in `found` whose root is the API's span `name` and that started at or after `since`. */
export const apiRootTraces = (found: readonly FoundTrace[], name: string, since: Date) =>
  found.filter(
    (trace) =>
      trace.rootService === 'calendar-api' &&
      trace.rootName === name &&
      trace.startedAt >= since.getTime(),
  );

/**
 * The id of the one trace whose root is the API's server span `name`, started since `since`. A full-page
 * navigation (the sign-in redirects) carries no `traceparent`, so the API starts its own trace and the test
 * finds it by name. More than one is an error, because then the test cannot tell which one is its own.
 *
 * Tempo's search is queried without a time range: with one it reads only flushed blocks and misses the
 * traces still in the ingester, which are the ones a test has just made.
 */
export async function findRootTrace(
  tempoUrl: string,
  name: string,
  since: Date,
  options?: PollOptions,
): Promise<string> {
  const query = `{ resource.service.name = "calendar-api" && name = "${name}" && kind = server }`;
  return poll(
    `A trace with root '${name}' in Tempo`,
    async () => {
      const url = new URL('/api/search', tempoUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '100');
      const traces = apiRootTraces(searchResults(await getJson(url)), name, since);
      if (traces.length > 1) {
        throw new FatalPollError(
          `${String(traces.length)} traces with root '${name}' since the test began; expected exactly one`,
        );
      }
      const [trace] = traces;
      return trace
        ? { done: true, value: trace.traceId }
        : { done: false, reason: 'none since the test began' };
    },
    options,
  );
}
