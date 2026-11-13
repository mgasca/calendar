import type { ProxyOptions } from 'vite';

/** Where the dev and preview servers send `/otlp` when `CALENDAR_OTLP_URL` is unset: LGTM's OTLP/HTTP port. */
export const DEFAULT_OTLP_URL = 'http://localhost:4318';

/** The one path the browser exports to (`src/telemetry/sdk.ts`); nothing else under `/otlp` is forwarded. */
export const OTLP_TRACES_PATH = '/otlp/v1/traces';

/** The `server.proxy` key: a regular expression (it starts with `^`), so only that exact path matches. */
export const OTLP_PROXY_KEY = `^${OTLP_TRACES_PATH}$`;

/** Request headers the collector never receives: the browser sends same-origin cookies to `/otlp`. */
export const STRIPPED_HEADERS = ['cookie', 'authorization'] as const;

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The `/otlp/v1/traces` proxy of `vite dev` and `vite preview` (ADR-0062; decided on #729): the
 * browser's spans go to the same origin, and the server forwards them to the collector's
 * `/v1/traces`, so the API exposes no ingestion endpoint and the collector needs no CORS.
 *
 * `CALENDAR_OTLP_URL` is the collector's OTLP/HTTP base URL, without a path (the E2E stack sets it,
 * #730). The proxy removes `Cookie` and `Authorization`, so the session never reaches the collector.
 * It is harmless when the web build has telemetry off: nothing posts to it.
 */
export function otlpProxy(env: Env): ProxyOptions {
  const target = (env.CALENDAR_OTLP_URL ?? DEFAULT_OTLP_URL).replace(/\/+$/, '');
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/otlp/, ''),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyRequest) => {
        for (const header of STRIPPED_HEADERS) proxyRequest.removeHeader(header);
      });
    },
  };
}
