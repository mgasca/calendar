import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  apiProxy,
  DEFAULT_API_URL,
  isSameOriginRequest,
  PLACEHOLDER_SEED_KEY,
  SEED_KEY_HEADER,
  type Env,
} from './apiProxy.ts';

const KEY = 'a-seed-key-for-tests-0123456789abcdef';
const SIGNED_IN: Env = { CALENDAR_DEV_SIGN_IN: 'true', Auth__DevSeedKey: KEY };
const PLAIN = { target: DEFAULT_API_URL, changeOrigin: false };

describe('apiProxy', () => {
  it('proxies to the local API without a key by default, even when .env holds one', () => {
    expect(apiProxy({ Auth__DevSeedKey: KEY })).toEqual(PLAIN);
  });

  it('keeps CALENDAR_API_URL as the target', () => {
    expect(apiProxy({ CALENDAR_API_URL: 'http://127.0.0.1:55041' }).target).toBe(
      'http://127.0.0.1:55041',
    );
  });

  it.each(['1', 'yes', 'TRUE', ''])('stays off for CALENDAR_DEV_SIGN_IN=%j', (value) => {
    expect(apiProxy({ ...SIGNED_IN, CALENDAR_DEV_SIGN_IN: value })).toEqual(PLAIN);
  });

  it.each([
    ['http://localhost:5041'],
    ['http://127.0.0.1:55041'],
    ['http://[::1]:5041'],
    ['https://localhost:7041'],
  ])('accepts the loopback API %s', (url) => {
    expect(() => apiProxy({ ...SIGNED_IN, CALENDAR_API_URL: url })).not.toThrow();
  });

  it('refuses a missing key', () => {
    expect(() => apiProxy({ CALENDAR_DEV_SIGN_IN: 'true' })).toThrow(/needs Auth__DevSeedKey/);
  });

  it('tells you to generate a key when it is missing', () => {
    expect(() => apiProxy({ CALENDAR_DEV_SIGN_IN: 'true' })).toThrow(/openssl rand -hex 32/);
  });

  it('warns, but still signs in, when the key is the public placeholder from .env.example', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const options = apiProxy({ ...SIGNED_IN, Auth__DevSeedKey: PLACEHOLDER_SEED_KEY });
      expect(options.configure).toBeTypeOf('function');
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/placeholder.*openssl rand -hex 32/s);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn about a generated key, or when dev sign-in is off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      apiProxy(SIGNED_IN);
      apiProxy({ Auth__DevSeedKey: PLACEHOLDER_SEED_KEY });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('knows the placeholder that .env.example commits', () => {
    const example = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
    expect(example).toMatch(new RegExp(`^Auth__DevSeedKey=${PLACEHOLDER_SEED_KEY}$`, 'm'));
  });

  it('refuses a key shorter than the API minimum', () => {
    expect(() => apiProxy({ ...SIGNED_IN, Auth__DevSeedKey: 'x'.repeat(31) })).toThrow(
      /at least 32 characters/,
    );
  });

  it.each([
    ['http://example.com:5041'],
    ['https://calendar.example.org'],
    ['http://localhost.example.com'],
    ['http://10.0.0.5:5041'],
    ['not a url'],
  ])('refuses to send the key to %s', (url) => {
    expect(() => apiProxy({ ...SIGNED_IN, CALENDAR_API_URL: url })).toThrow(
      /only to a loopback API/,
    );
  });
});

describe('isSameOriginRequest', () => {
  const host = 'localhost:5173';

  it.each([
    ['no Origin or Sec-Fetch-Site (curl, a top-level navigation)', {}],
    ['Sec-Fetch-Site: same-origin', { 'sec-fetch-site': 'same-origin' }],
    ['Sec-Fetch-Site: none (typed into the address bar)', { 'sec-fetch-site': 'none' }],
    ["the dev server's own Origin", { origin: 'http://localhost:5173' }],
    [
      'same-origin with its own Origin',
      { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:5173' },
    ],
  ])('accepts %s', (_name, headers: Record<string, string>) => {
    expect(isSameOriginRequest({ host, ...headers })).toBe(true);
  });

  it.each([
    ['another local port', { origin: 'http://localhost:3000' }],
    ['another loopback address', { origin: 'http://127.0.0.1:5173' }],
    ['a *.localhost name', { origin: 'http://tool.localhost:5173' }],
    ['an internet site', { origin: 'https://attacker.example' }],
    ['an opaque origin (file:// or a sandboxed frame)', { origin: 'null' }],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
    [
      'Sec-Fetch-Site: same-site (localhost:3000 is the same site)',
      { 'sec-fetch-site': 'same-site' },
    ],
    [
      'same-origin with a foreign Origin',
      { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000' },
    ],
  ])('refuses %s', (_name, headers: Record<string, string>) => {
    expect(isSameOriginRequest({ host, ...headers })).toBe(false);
  });

  it('refuses a request with an Origin but no Host', () => {
    expect(isSameOriginRequest({ origin: 'http://localhost:5173' })).toBe(false);
  });
});

describe('the dev server with apiProxy', () => {
  let upstream: Server | undefined;
  let vite: ViteDevServer | undefined;

  afterEach(async () => {
    await vite?.close();
    const api = upstream;
    if (api) await new Promise((resolve) => api.close(resolve));
    vite = undefined;
    upstream = undefined;
  });

  /** Starts a fake API that echoes the seed key it received, and a Vite dev server proxying to it. */
  async function start(env: Env): Promise<string> {
    upstream = createHttpServer((incoming, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({ key: incoming.headers[SEED_KEY_HEADER.toLowerCase()] ?? null }),
      );
    });
    await new Promise<void>((resolve) => upstream?.listen(0, '127.0.0.1', resolve));
    const { port } = upstream.address() as AddressInfo;
    vite = await createServer({
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        host: '127.0.0.1',
        port: 0,
        ws: false,
        proxy: {
          '/api': apiProxy({ ...env, CALENDAR_API_URL: `http://127.0.0.1:${String(port)}` }),
        },
      },
    });
    await vite.listen();
    const address = vite.httpServer?.address() as AddressInfo;
    return `http://127.0.0.1:${String(address.port)}`;
  }

  /**
   * Calls the API through the dev server and returns the seed key the API received. Uses node:http
   * rather than fetch, so Origin and Sec-Fetch-Site go out exactly as a browser would send them.
   */
  function keySeenByApi(base: string, headers: Record<string, string> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const call = request(`${base}/api/auth/me`, { headers }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => {
          resolve((JSON.parse(body) as { key: unknown }).key);
        });
      });
      call.on('error', reject);
      call.end();
    });
  }

  it('signs requests in with the seed key when dev sign-in is on', async () => {
    const base = await start(SIGNED_IN);
    expect(await keySeenByApi(base)).toBe(KEY);
  });

  it("signs in a request from the dev server's own page", async () => {
    const base = await start(SIGNED_IN);
    expect(await keySeenByApi(base, { origin: base, 'sec-fetch-site': 'same-origin' })).toBe(KEY);
  });

  it("replaces a key the client sends with the proxy's", async () => {
    const base = await start(SIGNED_IN);
    expect(await keySeenByApi(base, { [SEED_KEY_HEADER]: 'a-different-key' })).toBe(KEY);
  });

  it.each([
    ['another local origin', { origin: 'http://localhost:3000' }],
    ['a cross-site page', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site page on another port', { 'sec-fetch-site': 'same-site' }],
    [
      'another origin sending a key of its own',
      { origin: 'http://localhost:3000', [SEED_KEY_HEADER]: 'a-different-key' },
    ],
  ])('sends no key for %s', async (_name, headers: Record<string, string>) => {
    const base = await start(SIGNED_IN);
    expect(await keySeenByApi(base, headers)).toBeNull();
  });

  it('adds no key in plain dev mode', async () => {
    const base = await start({ Auth__DevSeedKey: KEY });
    expect(await keySeenByApi(base)).toBeNull();
  });

  it("passes a client's own key through unchanged in plain dev mode (the run-calendar driver)", async () => {
    const base = await start({ Auth__DevSeedKey: KEY });
    expect(await keySeenByApi(base, { [SEED_KEY_HEADER]: 'the-drivers-key' })).toBe(
      'the-drivers-key',
    );
  });
});
