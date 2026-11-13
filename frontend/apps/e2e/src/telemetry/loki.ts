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

/** The API's log records that carry `traceId`, once Loki has at least one. */
export async function waitForTraceLogs(
  lokiUrl: string,
  traceId: string,
  since: Date,
  options?: PollOptions,
): Promise<LogStream[]> {
  return poll(
    `API log records with trace id ${traceId} in Loki`,
    async () => {
      const streams = await queryLogs(
        lokiUrl,
        `{service_name="calendar-api"} | trace_id="${traceId}"`,
        since,
      );
      const count = streams.reduce((total, stream) => total + stream.lines.length, 0);
      return count > 0
        ? { done: true, value: streams }
        : { done: false, reason: 'no record carries the trace id' };
    },
    options,
  );
}

/** Every log record of the API and the web app since `since`, for the personal-data scan. */
export async function logsSince(lokiUrl: string, since: Date): Promise<LogStream[]> {
  return queryLogs(lokiUrl, '{service_name=~"calendar-api|calendar-web"}', since);
}
