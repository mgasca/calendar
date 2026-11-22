import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';

/** Where the Rune UI's browser bundle is served, on the web app's own origin (ADR-0067, #1009). */
export const NATIVE_PREFIX = '/native/';

/** `native/target/web/`, which `just native build-web` writes. */
export const DEFAULT_NATIVE_BUNDLE = fileURLToPath(
  new URL('../../../../native/target/web/', import.meta.url),
);

const HTML = 'text/html; charset=utf-8';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': HTML,
  '.js': 'text/javascript; charset=utf-8',
  // WebAssembly.instantiateStreaming refuses any other type.
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  // Rune's full Inter faces, fetched beside app.js after the first frame (#1043).
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

export type NativeResponse =
  | { kind: 'redirect'; location: string }
  | { kind: 'file'; file: string; contentType: string }
  | { kind: 'not-built' }
  | { kind: 'not-found' };

/**
 * What the dev server answers for `url` under `/native`, or `null` when the path is not the bundle's.
 *
 * The rules are the deployed host's (backend `hosting`): `/native` redirects to `/native/`, a file of
 * the bundle is served with its type, and a path without an extension falls back to
 * `/native/index.html`, never to the React app's entry page. Nothing outside `bundle` is ever read.
 */
export function resolveNativeRequest(bundle: string, url: string): NativeResponse | null {
  const [rawPath = '/', query] = url.split('?', 2);
  if (rawPath === '/native') {
    return {
      kind: 'redirect',
      location: query === undefined ? NATIVE_PREFIX : `${NATIVE_PREFIX}?${query}`,
    };
  }
  if (!rawPath.startsWith(NATIVE_PREFIX)) return null;
  const root = resolve(bundle);
  if (!existsSync(resolve(root, 'index.html'))) return { kind: 'not-built' };
  let relative: string;
  try {
    relative = decodeURIComponent(rawPath.slice(NATIVE_PREFIX.length));
  } catch {
    return { kind: 'not-found' };
  }
  const file = resolve(root, relative === '' ? 'index.html' : relative);
  if (file !== root && !file.startsWith(root + sep)) return { kind: 'not-found' };
  if (existsSync(file) && statSync(file).isFile()) {
    return {
      kind: 'file',
      file,
      contentType: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    };
  }
  if (extname(rawPath) !== '') return { kind: 'not-found' };
  return { kind: 'file', file: resolve(root, 'index.html'), contentType: HTML };
}

function middleware(bundle: string): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const answer = req.url === undefined ? null : resolveNativeRequest(bundle, req.url);
    if (answer === null) {
      next();
      return;
    }
    // Revalidate every file: wasm-bindgen's names are not fingerprinted, as in deployment.
    res.setHeader('Cache-Control', 'no-cache');
    switch (answer.kind) {
      case 'redirect':
        res.statusCode = 301;
        res.setHeader('Location', answer.location);
        res.end();
        return;
      case 'not-built':
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('The native UI is not built. Run `just native build-web`, then reload.\n');
        return;
      case 'not-found':
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not found\n');
        return;
      case 'file':
        res.statusCode = 200;
        res.setHeader('Content-Type', answer.contentType);
        res.end(req.method === 'HEAD' ? undefined : readFileSync(answer.file));
    }
  };
}

/**
 * Serves the Rune UI's browser bundle under `/native/` in `vite` and `vite preview` (ADR-0067, #1009),
 * beside the `/api` proxy, so it shares the web app's origin and its session cookie. The middleware runs
 * before Vite's own, so the React app's history fallback never answers a `/native/` path.
 */
export function nativeBundle(bundle: string = DEFAULT_NATIVE_BUNDLE): Plugin {
  return {
    name: 'calendar:native-bundle',
    configureServer(server) {
      server.middlewares.use(middleware(bundle));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(bundle));
    },
  };
}
