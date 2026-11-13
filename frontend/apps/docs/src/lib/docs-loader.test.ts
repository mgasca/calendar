import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  decisionsDirectory,
  docsLoader,
  documentRoutes,
  readNarratives,
  resetDocumentRoutes,
} from './docs-loader';
import { fakeLoaderContext } from './fakeLoaderContext';

// Every read of the real corpus starts with one listing of docs/decisions, then parses each document
// under docs/: several seconds of the Docs site job's `test:coverage` on a CI runner (#752). This file
// reads it three times: one sync shared by the tests that need its entries (`syncCorpus()`), and the
// two route-map computations of the test that counts them. `corpusReads.file` counts the whole file
// and is never cleared, because Vitest clears a mock's calls between tests.
const corpusReadBudget = 3;
const corpusReads = vi.hoisted(() => ({ file: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = ((...args: Parameters<typeof actual.readdir>) => {
    if (String(args[0]).endsWith('/docs/decisions/')) corpusReads.file += 1;
    return actual.readdir(...args);
  }) as typeof actual.readdir;
  return { ...actual, readdir: vi.fn(readdir) };
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

afterAll(() => {
  // Before #752 the narratives test ran a second full sync: four reads.
  expect(corpusReads.file).toBeLessThanOrEqual(corpusReadBudget);
});

let corpus: Promise<{ entries: Map<string, unknown>; listings: number }> | undefined;
const syncCorpus = () =>
  (corpus ??= (async () => {
    const { entries, context } = fakeLoaderContext();
    await docsLoader().load(context);
    return { entries, listings: decisionListings() };
  })());

describe('docs loader', () => {
  it('reads the corpus once per sync, however many documents the remark plugin rewrites', async () => {
    const { entries, listings } = await syncCorpus();
    expect(entries.size).toBeGreaterThan(50);
    // Before #273 the plugin called readDocuments() for every rendered entry: one listing per document.
    expect(listings).toBe(1);
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

describe('narratives (ADR-0059)', () => {
  const fixtures = new URL('fixtures/narratives/', import.meta.url);

  it('publishes the stitched narratives only, skipping part directories and other files', async () => {
    const { index, records } = await readNarratives(fixtures);
    expect(index).toContain('Fixture conventions page.');
    // calendar/ holds parts and stray-narrative.md/ is a directory: neither is read as a narrative.
    // ticket-kata/ holds only a deck, so its stitched file is not generated from parts, and the
    // narrative links that deck.
    expect(records.map((record) => record.file)).toEqual([
      'calendar-narrative.md',
      'ticket-kata-narrative.md',
    ]);
    expect(records.map((record) => [record.slug, record.hasParts, record.slides])).toEqual([
      ['calendar', true, undefined],
      ['ticket-kata', false, 'slides/ticket-kata/'],
    ]);
  });

  it.each([
    [
      'narratives-missing-deck',
      'Narrative links a deck without docs/narratives/calendar/slides.md',
    ],
    ['narratives-unlinked-deck', 'Deck docs/narratives/calendar/slides.md is not linked'],
    ['narratives-orphan-deck', 'Deck docs/narratives/kata/slides.md has no narrative'],
  ])('fails the build for %s (ADR-0060)', async (fixture, message) => {
    await expect(readNarratives(new URL(`fixtures/${fixture}/`, import.meta.url))).rejects.toThrow(
      message,
    );
  });

  it('publishes the repository narratives with an index page and an edit link per page', async () => {
    const { entries } = await syncCorpus();
    const index = entries.get('narratives');
    expect(index).toBeDefined();
    const { records } = await readNarratives();
    for (const record of records) {
      const entry = entries.get(`narratives/${record.slug}`);
      expect(entry, record.file).toBeDefined();
      expect(JSON.stringify(entry), record.file).toContain(
        record.hasParts
          ? `/tree/main/docs/narratives/${record.slug}`
          : `/edit/main/docs/narratives/${record.file}`,
      );
    }
  }, 60_000);
});
