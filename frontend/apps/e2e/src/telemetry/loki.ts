import { getJson, poll, type PollOptions } from './poll.ts';

/** One Loki stream: its labels (structured metadata included) and its lines. */
export interface LogStream {
  readonly labels: Readonly<Record<string, string>>;
  readonly lines: readonly string[];
}

interface LokiAnswer {
  data?: { result?: { stream?: Record<string, string>; values?: [string, string][] }[] };
}

/** The streams of a Loki `query_range` answer. */
export function streamsOf(body: unknown): LogStream[] {
  return ((body as LokiAnswer).data?.result ?? []).map((result) => ({
    labels: result.stream ?? {},
    lines: (result.values ?? []).map(([, line]) => line),
  }));
}

/** Runs a LogQL query over `[since, now]`. */
export async function queryLogs(
  lokiUrl: string,
  query: string,
  since: Date,
  limit = 5000,
): Promise<LogStream[]> {
  const url = new URL('/loki/api/v1/query_range', lokiUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('start', `${String(since.getTime())}000000`);
  url.searchParams.set('end', `${String(Date.now() + 60_000)}000000`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('direction', 'forward');
  return streamsOf(await getJson(url));
}

/**
 * The API's log records that carry `traceId`, once Loki has at least one, and a record with each of `messages`
 * (`'request finished'`, `'Google sign-in failed'`) among them.
 */
export async function waitForTraceLogs(
  lokiUrl: string,
  traceId: string,
  since: Date,
  options?: PollOptions,
  messages: readonly string[] = [],
): Promise<LogStream[]> {
  return poll(
    `API log records with trace id ${traceId} in Loki`,
    async () => {
      const streams = await queryLogs(
        lokiUrl,
        `{service_name="calendar-api"} | trace_id="${traceId}"`,
        since,
      );
      const lines = streams.flatMap((stream) => stream.lines);
      const missing = messages.filter((message) => !lines.includes(message));
      if (lines.length === 0) return { done: false, reason: 'no record carries the trace id' };
      return missing.length === 0
        ? { done: true, value: streams }
        : { done: false, reason: `no record '${missing.join("', '")}' carries the trace id` };
    },
    options,
  );
}

/** The most records one scan reads; Loki returns no more than this per query. */
export const SCAN_LIMIT = 5000;

/**
 * `streams`, or an error when they hold `limit` records: Loki stopped there, so a scan of them would quietly
 * miss the rest. On a long-lived stack (`just e2e test-on`), start a new one.
 */
export function completeScan(streams: LogStream[], limit = SCAN_LIMIT): LogStream[] {
  const count = streams.reduce((total, stream) => total + stream.lines.length, 0);
  if (count >= limit) {
    throw new Error(
      `Loki returned ${String(count)} log records, its limit, so the personal-data scan would be incomplete. ` +
        'Run the test on a fresh stack (just e2e test).',
    );
  }
  return streams;
}

/** Every log record of the API and the web app since `since`, for the personal-data scan. */
export async function logsSince(lokiUrl: string, since: Date): Promise<LogStream[]> {
  return completeScan(
    await queryLogs(lokiUrl, '{service_name=~"calendar-api|calendar-web"}', since, SCAN_LIMIT),
  );
}
