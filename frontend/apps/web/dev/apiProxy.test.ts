import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { apiProxy, DEFAULT_API_URL, SEED_KEY_HEADER, type Env } from './apiProxy.ts';

const KEY = 'a-seed-key-for-tests-0123456789abcdef';
const SIGNED_IN: Env = { CALENDAR_DEV_SIGN_IN: 'true', Auth__DevSeedKey: KEY };

describe('apiProxy', () => {
  it('proxies to the local API without a key by default, even when .env holds one', () => {
    expect(apiProxy({ Auth__DevSeedKey: KEY })).toEqual({
      target: DEFAULT_API_URL,
      changeOrigin: false,
    });
  });

  it('keeps CALENDAR_API_URL as the target', () => {
    expect(apiProxy({ CALENDAR_API_URL: 'http://127.0.0.1:55041' }).target).toBe(
      'http://127.0.0.1:55041',
    );
  });

  it('adds the seed key when dev sign-in is on', () => {
    expect(apiProxy(SIGNED_IN).headers).toEqual({ [SEED_KEY_HEADER]: KEY });
  });

  it.each(['1', 'yes', 'TRUE', ''])('stays off for CALENDAR_DEV_SIGN_IN=%j', (value) => {
    expect(apiProxy({ ...SIGNED_IN, CALENDAR_DEV_SIGN_IN: value }).headers).toBeUndefined();
  });

  it.each([
    ['http://localhost:5041'],
    ['http://127.0.0.1:55041'],
    ['http://[::1]:5041'],
    ['https://localhost:7041'],
  ])('accepts the loopback API %s', (url) => {
    expect(apiProxy({ ...SIGNED_IN, CALENDAR_API_URL: url }).headers).toEqual({
      [SEED_KEY_HEADER]: KEY,
    });
  });

  it('refuses a missing key', () => {
    expect(() => apiProxy({ CALENDAR_DEV_SIGN_IN: 'true' })).toThrow(/needs Auth__DevSeedKey/);
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
    upstream = createHttpServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ key: request.headers[SEED_KEY_HEADER.toLowerCase()] ?? null }));
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

  async function keySeenByApi(base: string, headers?: Record<string, string>): Promise<unknown> {
    const response = await fetch(`${base}/api/auth/me`, headers ? { headers } : {});
    return ((await response.json()) as { key: unknown }).key;
  }

  it('signs requests in with the seed key when dev sign-in is on', async () => {
    const base = await start(SIGNED_IN);
    expect(await keySeenByApi(base)).toBe(KEY);
  });

  it("replaces a key the client sends with the proxy's", async () => {
    const base = await start(SIGNED_IN);
    expect(await keySeenByApi(base, { [SEED_KEY_HEADER]: 'a-different-key' })).toBe(KEY);
  });

  it('adds no key in plain dev mode', async () => {
    const base = await start({ Auth__DevSeedKey: KEY });
    expect(await keySeenByApi(base)).toBeNull();
  });
});
