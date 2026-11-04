import type { ProxyOptions } from 'vite';

/** Where the dev server sends `/api` when `CALENDAR_API_URL` is unset (`just backend dev`). */
export const DEFAULT_API_URL = 'http://localhost:5041';

/** The API's minimum seed key length (`DevSeedAuthenticationHandler.MinimumKeyLength`). */
export const MINIMUM_SEED_KEY_LENGTH = 32;

/** The header the API's Development-only seed scheme reads. */
export const SEED_KEY_HEADER = 'X-Dev-Seed-Key';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The dev server's `/api` proxy. Story 0021 and the 2026-11-04 amendment to ADR-0027 cover it.
 *
 * With `CALENDAR_DEV_SIGN_IN=true`, which only `just frontend dev-signed-in` sets, the proxy adds
 * `Auth__DevSeedKey` to every proxied request. The browser is then signed in as the API's first
 * allow-listed email without Google. The key is added between the dev server and the API, so it
 * never reaches the page. The proxy's value replaces any key the client sends.
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
  return { ...options, headers: { [SEED_KEY_HEADER]: key } };
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
