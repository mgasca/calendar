import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, preview } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import viteConfig from '../vite.config.ts';
import { DEFAULT_OTLP_URL, OTLP_PROXY_KEY, OTLP_TRACES_PATH, otlpProxy } from './otlpProxy.ts';

interface Received {
  method: string | undefined;
  path: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe('otlpProxy', () => {
  it('forwards to LGTM on localhost by default', () => {
    expect(otlpProxy({}).target).toBe(DEFAULT_OTLP_URL);
  });

  it('takes CALENDAR_OTLP_URL as the collector base URL', () => {
    expect(otlpProxy({ CALENDAR_OTLP_URL: 'http://127.0.0.1:55218/' }).target).toBe(
      'http://127.0.0.1:55218',
    );
  });

  it('is the web app’s proxy for the traces path only', () => {
    expect(Object.keys(viteConfig.server?.proxy ?? {})).toContain(OTLP_PROXY_KEY);
    const pattern = new RegExp(OTLP_PROXY_KEY);
    expect(pattern.test(OTLP_TRACES_PATH)).toBe(true);
    expect(pattern.test('/otlp/v1/logs')).toBe(false);
    expect(pattern.test('/otlp/v1/traces/extra')).toBe(false);
  });
});

describe('otlpProxy through Vite', () => {
  let collector: Server | undefined;
  let close: (() => Promise<void>) | undefined;
  let outDir: string | undefined;
  let received: Received[] = [];

  afterEach(async () => {
    await close?.();
    const upstream = collector;
    if (upstream) await new Promise((resolve) => upstream.close(resolve));
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    collector = undefined;
    close = undefined;
    outDir = undefined;
    received = [];
  });

  /** A fake collector that records what reaches it. */
  async function startCollector(): Promise<string> {
    collector = createHttpServer((incoming, response) => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => (body += chunk));
      incoming.on('end', () => {
        received.push({
          method: incoming.method,
          path: incoming.url,
          headers: incoming.headers,
          body,
        });
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => collector?.listen(0, '127.0.0.1', resolve));
    const { port } = collector.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}`;
  }

  const proxyConfig = (collectorUrl: string) => ({
    host: '127.0.0.1',
    port: 0,
    proxy: { [OTLP_PROXY_KEY]: otlpProxy({ CALENDAR_OTLP_URL: collectorUrl }) },
  });

  async function startDev(collectorUrl: string): Promise<string> {
    const vite = await createServer({
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { ...proxyConfig(collectorUrl), ws: false },
    });
    await vite.listen();
    close = () => vite.close();
    const address = vite.httpServer?.address() as AddressInfo;
    return `http://127.0.0.1:${String(address.port)}`;
  }

  /** `vite preview` with only `server.proxy` set, as in the web app's config. */
  async function startPreview(collectorUrl: string): Promise<string> {
    outDir = mkdtempSync(join(tmpdir(), 'otlp-preview-'));
    writeFileSync(join(outDir, 'index.html'), '<!doctype html>');
    const server = await preview({
      configFile: false,
      logLevel: 'silent',
      build: { outDir },
      server: proxyConfig(collectorUrl),
      preview: { host: '127.0.0.1', port: 0 },
    });
    close = () => server.close();
    const address = server.httpServer.address() as AddressInfo;
    return `http://127.0.0.1:${String(address.port)}`;
  }

  /** Posts like the browser exporter, with the cookies a browser sends to its own origin. */
  function post(url: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const call = request(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: '.Calendar.Session=secret-session',
            authorization: 'Bearer secret-token',
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode);
          });
        },
      );
      call.on('error', reject);
      call.end('{"resourceSpans":[]}');
    });
  }

  it.each([
    ['vite dev', startDev],
    ['vite preview', startPreview],
  ])(
    '%s forwards /otlp/v1/traces to the collector’s /v1/traces without cookies',
    async (_name, start) => {
      const base = await start(await startCollector());

      expect(await post(`${base}${OTLP_TRACES_PATH}`)).toBe(200);

      expect(received).toHaveLength(1);
      const [forwarded] = received;
      expect(forwarded?.method).toBe('POST');
      expect(forwarded?.path).toBe('/v1/traces');
      expect(forwarded?.body).toBe('{"resourceSpans":[]}');
      expect(forwarded?.headers['content-type']).toBe('application/json');
      expect(forwarded?.headers.cookie).toBeUndefined();
      expect(forwarded?.headers.authorization).toBeUndefined();
    },
  );

  it('forwards nothing else under /otlp', async () => {
    const base = await startDev(await startCollector());

    await post(`${base}/otlp/v1/logs`);

    expect(received).toHaveLength(0);
  });
});
