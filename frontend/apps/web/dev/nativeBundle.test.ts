import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_NATIVE_BUNDLE, nativeBundle, resolveNativeRequest } from './nativeBundle.ts';

let root: string;
let bundle: string;
let empty: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'native-bundle-'));
  bundle = join(root, 'web');
  empty = join(root, 'not-built');
  mkdirSync(bundle);
  mkdirSync(join(bundle, 'assets'));
  mkdirSync(empty);
  writeFileSync(join(bundle, 'index.html'), '<!doctype html><title>native</title>');
  writeFileSync(join(bundle, 'app.js'), 'export default async function init() {}');
  writeFileSync(join(bundle, 'app_bg.wasm'), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFileSync(join(bundle, 'assets', 'icon.svg'), '<svg/>');
  writeFileSync(join(bundle, 'Inter-Regular.ttf'), new Uint8Array([0, 1, 0, 0]));
  writeFileSync(join(root, 'secret.txt'), 'outside the bundle');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveNativeRequest', () => {
  it('points at native/target/web/, where `just native build-web` writes', () => {
    expect(DEFAULT_NATIVE_BUNDLE.replaceAll('\\', '/')).toMatch(/\/native\/target\/web\/$/);
  });

  it.each(['/', '/api/tasks', '/nativeish', '/natives/x', '/week'])(
    'leaves %s to the web app',
    (url) => {
      expect(resolveNativeRequest(bundle, url)).toBeNull();
    },
  );

  it('redirects /native to /native/, keeping the query', () => {
    expect(resolveNativeRequest(bundle, '/native')).toEqual({
      kind: 'redirect',
      location: '/native/',
    });
    expect(resolveNativeRequest(bundle, '/native?x=1')).toEqual({
      kind: 'redirect',
      location: '/native/?x=1',
    });
  });

  it('serves the entry page at /native/', () => {
    expect(resolveNativeRequest(bundle, '/native/')).toEqual({
      kind: 'file',
      file: join(bundle, 'index.html'),
      contentType: 'text/html; charset=utf-8',
    });
  });

  it.each([
    ['/native/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/native/app_bg.wasm', 'app_bg.wasm', 'application/wasm'],
    ['/native/Inter-Regular.ttf', 'Inter-Regular.ttf', 'font/ttf'],
    ['/native/assets/icon.svg?v=2', 'assets/icon.svg', 'image/svg+xml'],
  ])('serves %s with its type', (url, file, contentType) => {
    expect(resolveNativeRequest(bundle, url)).toEqual({
      kind: 'file',
      file: join(bundle, file),
      contentType,
    });
  });

  it.each(['/native/week', '/native/tasks/123', '/native/assets/'])(
    'falls back to the native entry page for %s',
    (url) => {
      expect(resolveNativeRequest(bundle, url)).toMatchObject({
        kind: 'file',
        file: join(bundle, 'index.html'),
      });
    },
  );

  it.each(['/native/missing.js', '/native/assets/gone.wasm'])('answers 404 for %s', (url) => {
    expect(resolveNativeRequest(bundle, url)).toEqual({ kind: 'not-found' });
  });

  it.each([
    '/native/../secret.txt',
    '/native/%2e%2e/secret.txt',
    '/native/%2e%2e%2fsecret.txt',
    '/native/%zz',
  ])('never reads outside the bundle: %s', (url) => {
    expect(resolveNativeRequest(bundle, url)).toEqual({ kind: 'not-found' });
  });

  it('says the bundle is not built when it has no index.html', () => {
    expect(resolveNativeRequest(empty, '/native/')).toEqual({ kind: 'not-built' });
    expect(resolveNativeRequest(join(root, 'absent'), '/native/week')).toEqual({
      kind: 'not-built',
    });
  });
});

describe('nativeBundle on the dev server', () => {
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function start(dir: string): Promise<string> {
    server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [nativeBundle(dir)],
      server: { port: 0, host: '127.0.0.1' },
    });
    await server.listen();
    const address = server.httpServer?.address() as AddressInfo;
    return `http://127.0.0.1:${String(address.port)}`;
  }

  it('serves the bundle with its types, the fallback and no-cache, ahead of the history fallback', async () => {
    const base = await start(bundle);
    const wasm = await fetch(`${base}/native/app_bg.wasm`);
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect(wasm.headers.get('cache-control')).toBe('no-cache');
    const deep = await fetch(`${base}/native/week`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<title>native</title>');
    const bare = await fetch(`${base}/native`, { redirect: 'manual' });
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/native/');
  });

  it('names the recipe when the bundle is not built', async () => {
    const base = await start(empty);
    const response = await fetch(`${base}/native/`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('just native build-web');
  });
});
