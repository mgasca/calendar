import type { LoaderContext } from 'astro/loaders';
import { fileURLToPath } from 'node:url';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { remarkDocLinks } from './adr';
import { documentRoutes } from './docs-loader';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const parser = unified().use(remarkParse);
// The same plugin and options as astro.config.ts, so a load exercises the real link rewriting.
const rewriteLinks = remarkDocLinks({ root, base: '/', links: documentRoutes });

/**
 * A stand-in for Astro's loader context: it stores entries in a Map and renders each body with
 * the repository's remark plugin, without an Astro project. Used by the loader test and benchmark.
 */
export function fakeLoaderContext() {
  const entries = new Map<string, unknown>();
  const context = {
    collection: 'docs',
    store: {
      clear: () => {
        entries.clear();
      },
      set: (entry: { id: string }) => {
        entries.set(entry.id, entry);
        return true;
      },
    },
    parseData: ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    generateDigest: (data: unknown) => JSON.stringify(data).length.toString(),
    renderMarkdown: async (body: string, options?: { fileURL?: URL }) => {
      const tree = parser.parse(body);
      await rewriteLinks(tree, { path: options?.fileURL && fileURLToPath(options.fileURL) });
      return { html: '' };
    },
    config: { root: new URL('file:///') },
    logger: { error: () => undefined },
  };
  return { entries, context: context as unknown as LoaderContext };
}
