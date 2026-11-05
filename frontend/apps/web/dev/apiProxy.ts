import type { IncomingHttpHeaders } from 'node:http';
import type { Plugin, ProxyOptions } from 'vite';

/** Where the dev server sends `/api` when `CALENDAR_API_URL` is unset (`just backend dev`). */
export const DEFAULT_API_URL = 'http://localhost:5041';

/** The API's minimum seed key length (`DevSeedAuthenticationHandler.MinimumKeyLength`). */
export const MINIMUM_SEED_KEY_LENGTH = 32;

/** The header the API's Development-only seed scheme reads. */
export const SEED_KEY_HEADER = 'X-Dev-Seed-Key';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `server.host` / `preview.host` values that keep Vite listening on this machine only. */
const LOOPBACK_LISTEN_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** `Sec-Fetch-Site` values a browser sends for the page's own origin or a user-typed address. */
const OWN_FETCH_SITES = new Set(['same-origin', 'none']);

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Stops `vite` and `vite preview` from listening beyond loopback while dev sign-in is on (#242).
 *
 * The proxy signs in every request that carries no browser headers (curl, scripts). So with `--host`,
 * `server.host` or `preview.host` set to anything but a loopback address, anyone on the network would
 * be signed in as the first allow-listed email. The hooks run before the server listens, so nothing is
 * exposed even briefly. `vite preview` is covered because its proxy defaults to `server.proxy`, and
 * its host to `server.host`. In plain dev mode the plugin does nothing, so `--host` still works for
 * testing on another device.
 */
export function devSignInHostGuard(env: Env): Plugin {
  const signedIn = env.CALENDAR_DEV_SIGN_IN === 'true';
  return {
    name: 'calendar:dev-sign-in-host-guard',
    configureServer(server) {
      if (signedIn) assertLoopbackHost(server.config.server.host, 'server.host (--host)');
    },
    configurePreviewServer(server) {
      if (signedIn)
        assertLoopbackHost(server.config.preview.host, 'preview.host (vite preview --host)');
    },
  };
}

function assertLoopbackHost(host: string | boolean | undefined, setting: string): void {
  if (host === undefined || host === false) return;
  if (typeof host === 'string' && LOOPBACK_LISTEN_HOSTS.has(host.toLowerCase())) return;
  throw new Error(
    `Dev sign-in listens only on loopback (localhost, 127.0.0.1 or ::1), because it signs in every non-browser request, but ${setting} is ${String(host)}. Drop --host, or use plain \`just frontend dev\` to test from another device.`,
  );
}

/**
 * The dev server's `/api` proxy. Story 0021 and the 2026-11-04 amendment to ADR-0027 cover it.
 *
 * With `CALENDAR_DEV_SIGN_IN=true`, which only `just frontend dev-signed-in` sets, the proxy adds
 * `Auth__DevSeedKey` to requests from the dev server's own page. The browser is then signed in as
 * the API's first allow-listed email without Google. The key is added between the dev server and
 * the API, so it never reaches the page.
 *
 * The proxy always removes any key the client sends, and adds its own only when
 * `isSameOriginRequest` holds. Vite's default CORS policy lets any localhost origin read `/api`
 * responses, so a key on every request would sign other local pages in too.
 *
 * Throws when the mode is on and the key is missing or too short, or the target is not a loopback
 * host, so the key never goes to a remote API.
 */
export function apiProxy(env: Env): ProxyOptions {
  const target = env.CALENDAR_API_URL ?? DEFAULT_API_URL;
  const options: ProxyOptions = { target, changeOrigin: false };
  if (env.CALENDAR_DEV_SIGN_IN !== 'true') return options;

  const key = env.Auth__DevSeedKey ?? '';
  if (key === '') {
    throw new Error(
      'Dev sign-in needs Auth__DevSeedKey, the API seed key. Set it in .env (.env.example has one) and restart.',
    );
  }
  if (key.length < MINIMUM_SEED_KEY_LENGTH) {
    throw new Error(
      `Dev sign-in needs an Auth__DevSeedKey of at least ${String(MINIMUM_SEED_KEY_LENGTH)} characters, as the API does. Generate one with: openssl rand -hex 32`,
    );
  }
  if (!isLoopback(target)) {
    throw new Error(
      `Dev sign-in sends the seed key only to a loopback API (localhost, 127.0.0.1 or [::1]), but CALENDAR_API_URL is ${target}.`,
    );
  }
  return {
    ...options,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyRequest, request) => {
        proxyRequest.removeHeader(SEED_KEY_HEADER);
        if (isSameOriginRequest(request.headers)) proxyRequest.setHeader(SEED_KEY_HEADER, key);
      });
    },
  };
}

/**
 * Whether a request comes from the dev server's own page, or from no page at all (curl, or an
 * address typed into the browser). It's judged by headers that browsers set and pages cannot forge.
 *
 * `Sec-Fetch-Site: same-site` is refused, because `localhost:3000` and `localhost:5173` are the
 * same site. A browser too old to send `Sec-Fetch-Site` still sends `Origin` on cross-origin
 * requests, and that `Origin` must then name this host.
 */
export function isSameOriginRequest(headers: IncomingHttpHeaders): boolean {
  const site = headers['sec-fetch-site'];
  if (site !== undefined && !OWN_FETCH_SITES.has(site)) return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  if (headers.host === undefined) return false;
  try {
    return new URL(origin).host === headers.host.toLowerCase();
  } catch {
    return false;
  }
}

function isLoopback(target: string): boolean {
  try {
    const url = new URL(target);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}
