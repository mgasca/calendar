import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blockAfter,
  colourLiterals,
  contrast,
  cssFilesUnder,
  declarations,
  readCss,
  stripComments,
  themeSelectors,
} from './guards.ts';

// ADR-0047 guards for the shared token layer (story 0046): the token file is the only place that
// holds colours and theme selectors, in the package and in every consumer; the dark sets cannot
// drift; both palettes meet WCAG contrast. Moved from apps/web/dev/styles.test.ts.

const PACKAGE = join(import.meta.dirname, '..');
const tokens = stripComments(readFileSync(join(PACKAGE, 'src', 'tokens.css'), 'utf8'));
const light = declarations(blockAfter(tokens, ":root[data-theme='light']"));
const dark = declarations(blockAfter(tokens, ":root[data-theme='dark']"));
const osDark = declarations(
  blockAfter(blockAfter(tokens, '@media (prefers-color-scheme: dark)'), ':root:not([data-theme])'),
);

const CONSUMERS = [
  ['web app', join(PACKAGE, '..', '..', 'apps', 'web', 'src')],
  ['docs site', join(PACKAGE, '..', '..', 'apps', 'docs', 'src')],
] as const;

/**
 * Docs stylesheets that still hold colour literals until #516 (adapter) and #517 (badges, diagrams)
 * map them to tokens. Each entry must still contain a literal, so the exemption cannot outlive them.
 */
const PENDING_LITERALS = new Set(['docs:styles/docs.css']);

describe('guard scanners', () => {
  it('finds colour literals, system colours and literals inside color-mix, but not token references', () => {
    expect(colourLiterals('a { color: #fff; }')).toHaveLength(1);
    expect(colourLiterals('a { background: Canvas; }')).toHaveLength(1);
    expect(colourLiterals('a { border: 1px solid rgb(0 0 0 / 20%); }')).toHaveLength(1);
    expect(
      colourLiterals('a { color: color-mix(in srgb, var(--color-accent) 20%, white); }'),
    ).toHaveLength(1);
    expect(colourLiterals('.field { color: var(--color-text); }')).toEqual([]);
    expect(colourLiterals('/* #fff */ a { color: var(--color-text); }')).toEqual([]);
  });

  it('finds theme selectors and colour-scheme queries', () => {
    expect(themeSelectors(":root[data-theme='dark'] a {}")).toHaveLength(1);
    expect(themeSelectors('@media (prefers-color-scheme: dark) {}')).toHaveLength(1);
    expect(themeSelectors('a { color: var(--x); }')).toEqual([]);
  });
});

describe('shared token file (ADR-0047)', () => {
  it('keeps the OS-fallback dark block identical to the data-theme dark block', () => {
    expect(osDark.size).toBeGreaterThan(20);
    expect([...osDark]).toEqual([...dark]);
  });

  it('defines the same token names in both themes', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
  });

  it('is the font-family source: fonts.css only imports the pinned Fontsource packages', () => {
    const fonts = stripComments(readFileSync(join(PACKAGE, 'src', 'fonts.css'), 'utf8'));
    const imports = [...fonts.matchAll(/@import\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual([
      '@fontsource-variable/fraunces/wght.css',
      '@fontsource-variable/plus-jakarta-sans/wght.css',
    ]);
    expect(fonts.replace(/@import\s+'[^']+';/g, '').trim()).toBe('');
  });
});

describe.each(CONSUMERS)('consumer stylesheets, %s', (name, dir) => {
  const key = name === 'docs site' ? 'docs' : 'web';
  const files = cssFilesUnder(dir);

  it('has stylesheets', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no colour literal', (file) => {
    const found = colourLiterals(readCss(dir, file));
    if (PENDING_LITERALS.has(`${key}:${file}`)) {
      expect(found.length, `${file} no longer needs its exemption`).toBeGreaterThan(0);
    } else {
      expect(found).toEqual([]);
    }
  });

  it.each(files)('%s has no theme selector or colour-scheme query', (file) => {
    // docs.css still scopes a shadow to :root[data-theme='dark']; #517 replaces it with a token.
    if (PENDING_LITERALS.has(`${key}:${file}`)) return;
    expect(themeSelectors(readCss(dir, file))).toEqual([]);
  });
});

function sets(): [string, Map<string, string>][] {
  return [
    ['light (Paper & Sage)', light],
    ['dark (Midnight Studio)', dark],
  ];
}

/** [foreground, backgrounds] pairs, by token name without the `--color-` prefix. */
const SURFACES = [
  'bg',
  'surface',
  'surface-raised',
  'surface-sunken',
  'current-bg',
  'overdue-bg',
  'accent-soft',
];
const TEXT_PAIRS: [string, string[]][] = [
  ['text', SURFACES],
  ['text-muted', SURFACES],
  ['completed-text', ['bg', 'surface']],
  ['loading-text', ['bg', 'surface']],
  ['empty-text', ['bg', 'surface']],
  ['accent', ['bg', 'surface', 'surface-raised']],
  ['on-accent', ['accent', 'accent-hover']],
  ['overdue-text', ['overdue-bg', 'surface', 'bg']],
  ['error', ['bg', 'surface', 'surface-raised', 'error-soft']],
  ['on-error', ['error']],
];
const NON_TEXT_PAIRS: [string, string[]][] = [
  ['border-strong', ['bg', 'surface']],
  ['focus', ['bg', 'surface']],
  ['current-border', ['bg', 'surface']],
  ['error', ['bg', 'surface']],
  ['now-line', ['bg', 'surface']],
];

describe.each(sets())('contrast, %s', (_name, theme) => {
  const colour = (token: string) => theme.get(`--color-${token}`) ?? '';

  it.each(TEXT_PAIRS.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const)))(
    'text %s on %s is at least 4.5:1',
    (fg, bg) => {
      expect(contrast(colour(fg), colour(bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(NON_TEXT_PAIRS.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const)))(
    'non-text %s on %s is at least 3:1',
    (fg, bg) => {
      expect(contrast(colour(fg), colour(bg))).toBeGreaterThanOrEqual(3);
    },
  );
});
