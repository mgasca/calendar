import { fileURLToPath } from 'node:url';
import { createServer, preview, type InlineConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { devSignInHostGuard, type Env } from './apiProxy.ts';

const KEY = 'a-seed-key-for-tests-0123456789abcdef';
const SIGNED_IN: Env = { CALENDAR_DEV_SIGN_IN: 'true', Auth__DevSeedKey: KEY };
const REFUSED = /Dev sign-in listens only on loopback/;

type Host = string | boolean | undefined;

/** Hosts that make Vite listen beyond this machine: `--host`, `--host 0.0.0.0`, `--host ::`, a LAN address or name. */
const NON_LOOPBACK: Host[][] = [[true], ['0.0.0.0'], ['::'], ['192.168.1.20'], ['my-laptop.lan']];
const LOOPBACK: Host[][] = [[undefined], ['localhost'], ['127.0.0.1'], ['::1']];

/** `{ host }` for a set host and `{}` for the default (exactOptionalPropertyTypes forbids `host: undefined`). */
function hostOption(host: Host): { host?: string | boolean } {
  return host === undefined ? {} : { host };
}

/** An inline Vite config with only the guard, so each test checks the guard alone. */
function inline(env: Env): InlineConfig {
  return {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [devSignInHostGuard(env)],
  };
}

describe('devSignInHostGuard with dev sign-in on', () => {
  it.each(NON_LOOPBACK)('stops the dev server on host %j before it listens', async (host) => {
    await expect(
      createServer({ ...inline(SIGNED_IN), server: { ...hostOption(host), ws: false } }),
    ).rejects.toThrow(REFUSED);
  });

  it.each(NON_LOOPBACK)('stops vite preview on host %j before it listens', async (host) => {
    await expect(
      preview({ ...inline(SIGNED_IN), preview: { ...hostOption(host), port: 0 } }),
    ).rejects.toThrow(REFUSED);
  });

  it('stops vite preview when it inherits a non-loopback server.host', async () => {
    await expect(
      preview({ ...inline(SIGNED_IN), server: { host: '0.0.0.0' }, preview: { port: 0 } }),
    ).rejects.toThrow(REFUSED);
  });

  it.each(LOOPBACK)('lets the dev server start on host %j', async (host) => {
    const server = await createServer({
      ...inline(SIGNED_IN),
      server: { ...hostOption(host), ws: false },
    });
    await server.close();
  });

  it.each(LOOPBACK)('lets vite preview start on host %j', async (host) => {
    const server = await preview({
      ...inline(SIGNED_IN),
      preview: { ...hostOption(host), port: 0 },
    });
    await server.close();
  });
});

describe('devSignInHostGuard in plain dev mode', () => {
  it.each(NON_LOOPBACK)('leaves the dev server on host %j alone', async (host) => {
    // createServer doesn't listen, so nothing binds beyond loopback here.
    const server = await createServer({
      ...inline({ Auth__DevSeedKey: KEY }),
      server: { ...hostOption(host), ws: false },
    });
    await server.close();
  });
});

describe('vite.config.ts', () => {
  const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function signIn() {
    vi.stubEnv('CALENDAR_DEV_SIGN_IN', 'true');
    vi.stubEnv('Auth__DevSeedKey', KEY);
    vi.stubEnv('CALENDAR_API_URL', 'http://127.0.0.1:5041');
  }

  it('refuses `--host` under dev sign-in (what `pnpm dev --host` passes)', async () => {
    signIn();
    await expect(
      createServer({ configFile, logLevel: 'silent', server: { host: true, ws: false } }),
    ).rejects.toThrow(REFUSED);
  });

  it('starts on the default host under dev sign-in (what the recipe runs)', async () => {
    signIn();
    const server = await createServer({ configFile, logLevel: 'silent', server: { ws: false } });
    await server.close();
  });
});
