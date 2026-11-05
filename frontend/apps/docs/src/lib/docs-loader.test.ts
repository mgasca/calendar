import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { decisionsDirectory, docsLoader, documentRoutes, resetDocumentRoutes } from './docs-loader';
import { fakeLoaderContext } from './fakeLoaderContext';

// Counts directory listings, the first step of every corpus read.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});
const { readdir } = await import('node:fs/promises');
const decisionsPath = fileURLToPath(decisionsDirectory);
const decisionListings = () =>
  vi.mocked(readdir).mock.calls.filter(([path]) => fileURLToPath(path as URL) === decisionsPath)
    .length;

beforeEach(() => {
  vi.mocked(readdir).mockClear();
  resetDocumentRoutes();
});

describe('docs loader', () => {
  it('reads the corpus once per sync, however many documents the remark plugin rewrites', async () => {
    const { entries, context } = fakeLoaderContext();
    await docsLoader().load(context);
    expect(entries.size).toBeGreaterThan(50);
    // Before #273 the plugin called readDocuments() for every rendered entry: one listing per document.
    expect(decisionListings()).toBe(1);
  }, 60_000);

  it('computes the route map once for callers outside a sync', async () => {
    const first = await documentRoutes();
    const second = await documentRoutes();
    expect(second).toBe(first);
    expect(decisionListings()).toBe(1);
    resetDocumentRoutes();
    expect(await documentRoutes()).not.toBe(first);
    expect(decisionListings()).toBe(2);
  }, 60_000);
});
