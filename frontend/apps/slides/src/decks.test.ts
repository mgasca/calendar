import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildArguments,
  buildDeck,
  deckBase,
  findDecks,
  narrativesDirectory,
  siteBase,
  themeDirectory,
} from './decks.ts';

const fixtures = fileURLToPath(new URL('../fixtures/narratives', import.meta.url));

describe('deck discovery', () => {
  it('finds each system with a slides.md and skips part directories and files without one', async () => {
    const decks = await findDecks(fixtures);
    expect(decks).toEqual([{ system: 'example', source: `${fixtures}/example/slides.md` }]);
  });

  it('reads the repository narratives by default', async () => {
    for (const deck of await findDecks()) {
      expect(deck.source).toBe(`${narrativesDirectory}/${deck.system}/slides.md`);
    }
  });
});

describe('deck base', () => {
  it.each([
    [undefined, '/'],
    ['https://mgasca.github.io/calendar/', '/calendar/'],
    ['https://mgasca.github.io/calendar/pr-preview/pr-7/', '/calendar/pr-preview/pr-7/'],
    ['https://example.org/calendar', '/calendar/'],
  ])('reads the site base of %s as %s, as the docs site does', (url, base) => {
    expect(siteBase(url)).toBe(base);
    expect(deckBase(base, 'calendar')).toBe(`${base}slides/calendar/`);
  });

  it('builds with the Calendar theme, the deck base and one output directory per system', () => {
    expect(buildArguments({ system: 'x', source: '/n/x/slides.md' }, '/out', '/calendar/')).toEqual(
      [
        'build',
        '/n/x/slides.md',
        '--theme',
        themeDirectory,
        '--base',
        '/calendar/slides/x/',
        '--out',
        '/out/x',
      ],
    );
  });
});

describe('fixture deck build', () => {
  let out = '';
  afterAll(async () => {
    if (out) await rm(out, { recursive: true, force: true });
  });

  // A real Slidev build of the fixture takes 10 to 20 s, well over Vitest's 5 s default.
  it('builds a static deck with its base, the Calendar theme, Mermaid and no CDN fonts or icon', async () => {
    out = await mkdtemp(join(tmpdir(), 'calendar-slides-'));
    const [deck] = await findDecks(fixtures);
    if (!deck) throw new Error('fixture deck missing');
    await buildDeck(deck, out, '/calendar/');
    const index = await readFile(join(out, 'example', 'index.html'), 'utf8');
    expect(index).toContain('href="/calendar/slides/example/assets/');
    expect(index).toContain('<title>Example architecture narrative');
    expect(index).not.toContain('fonts.googleapis.com');
    expect(index).not.toContain('cdn.jsdelivr.net');
    const assets = await readdir(join(out, 'example', 'assets'), { recursive: true });
    const code = (
      await Promise.all(
        assets
          .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
          .map((name) => readFile(join(out, 'example', 'assets', name), 'utf8')),
      )
    ).join('\n');
    // The Act 3 slide renders its diagram with Slidev's Mermaid component, which receives the source
    // compressed (`code-lz`) and draws it in the browser.
    expect(code).toMatch(/`Act 3: Resolution`[\s\S]{0,400}"code-lz":`[A-Za-z0-9+/=]+`/);
    // The theme's token mapping and the shared tokens are in the stylesheet.
    expect(code).toMatch(/--slidev-theme-primary:\s*var\(--color-accent\)/);
    expect(code).toMatch(/:root\[data-theme=["']?dark["']?\]/);
    expect(code).toContain('Plus Jakarta Sans Variable');
  }, 120_000);
});
