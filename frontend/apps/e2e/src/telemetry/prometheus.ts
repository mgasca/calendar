import { getJson, poll, type PollOptions } from './poll.ts';

/** A route a flow calls, as the API's metrics label it: the method and the route template. */
export interface RouteHit {
  readonly method: string;
  readonly route: string;
  /** How many requests the flow makes to it at least (1 when omitted). */
  readonly times?: number;
}

/** The API's HTTP server duration histogram (#731); its `_count` is the request count. */
const HISTOGRAM = 'http_server_request_duration_seconds';

const selector = (hit: RouteHit) =>
  `{job="calendar-api",http_route="${hit.route}",http_request_method="${hit.method}"}`;

interface PromAnswer {
  data?: { result?: { metric?: Record<string, string>; value?: [number, string] }[] };
}

async function instant(prometheusUrl: string, query: string): Promise<number | undefined> {
  const url = new URL('/api/v1/query', prometheusUrl);
  url.searchParams.set('query', query);
  const value = ((await getJson(url)) as PromAnswer).data?.result?.[0]?.value?.[1];
  return value === undefined ? undefined : Number(value);
}

/** The request count of each route so far (0 for a route with no series yet). */
export async function requestCounts(
  prometheusUrl: string,
  hits: readonly RouteHit[],
): Promise<number[]> {
  return Promise.all(
    hits.map(
      async (hit) => (await instant(prometheusUrl, `sum(${HISTOGRAM}_count${selector(hit)})`)) ?? 0,
    ),
  );
}

/**
 * Waits until each route's request count has grown by at least its `times` since `before`, and its duration
 * buckets exist. The API pushes metrics on its export interval, so this can take a minute.
 */
export async function waitForRequestMetrics(
  prometheusUrl: string,
  hits: readonly RouteHit[],
  before: readonly number[],
  options: PollOptions = { timeoutMs: 120_000, intervalMs: 2_000 },
): Promise<void> {
  await poll(
    `Request metrics for ${hits.map((hit) => `${hit.method} ${hit.route}`).join(', ')} in Prometheus`,
    async () => {
      const now = await requestCounts(prometheusUrl, hits);
      for (const [index, hit] of hits.entries()) {
        const grown = (now[index] ?? 0) - (before[index] ?? 0);
        if (grown < (hit.times ?? 1)) {
          return {
            done: false,
            reason: `${hit.method} ${hit.route} count grew by ${String(grown)}`,
          };
        }
        const buckets = await instant(prometheusUrl, `count(${HISTOGRAM}_bucket${selector(hit)})`);
        if (!buckets)
          return { done: false, reason: `${hit.method} ${hit.route} has no duration buckets` };
      }
      return { done: true, value: undefined };
    },
    options,
  );
}

interface SeriesAnswer {
  data?: Record<string, string>[];
}

/** The label sets of every series the API and the web app export, for the personal-data scan. */
export async function seriesLabels(
  prometheusUrl: string,
  since: Date,
): Promise<Record<string, string>[]> {
  const url = new URL('/api/v1/series', prometheusUrl);
  url.searchParams.append('match[]', '{job=~"calendar-api|calendar-web"}');
  url.searchParams.set('start', String(Math.floor(since.getTime() / 1000) - 60));
  return ((await getJson(url)) as SeriesAnswer).data ?? [];
}
