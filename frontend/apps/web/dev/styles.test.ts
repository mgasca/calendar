import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// ADR-0047 guards that belong to the app: view rules use tokens only, every token that is used exists.
// The token file and its own guards (literals, theme selectors, OS-fallback block, contrast) live in
// @calendar/theme (packages/theme/tests), which also scans this app's stylesheets. This runs in the
// Node test project (like the other files in dev/): the web project turns CSS off, and the app's
// tsconfig has no Node types. It reads the stylesheets and sources from src/.

const SRC = join(import.meta.dirname, '..', 'src');
/** Paths relative to `src/`, with forward slashes, for example `styles/tokens.css`. */
const allFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).map((f) =>
  f.replaceAll('\\', '/'),
);
const sourceFiles: Record<string, string> = Object.fromEntries(
  allFiles.filter((f) => /\.tsx?$/.test(f)).map((f) => [f, readFileSync(join(SRC, f), 'utf8')]),
);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const cssByPath = new Map(
  allFiles
    .filter((f) => f.endsWith('.css'))
    .map((f) => [f, stripComments(readFileSync(join(SRC, f), 'utf8'))]),
);
const cssFiles = [...cssByPath.keys()];
const tokensPath = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'theme',
  'src',
  'tokens.css',
);
const nonTokenCss = cssFiles;
const read = (file: string) => cssByPath.get(file) ?? '';
const tokens = stripComments(readFileSync(tokensPath, 'utf8'));

describe('app stylesheet guards (ADR-0047)', () => {
  it('finds the stylesheets', () => {
    expect(cssFiles).toContain('index.css');
    expect(tokens).toContain('--color-bg');
  });

  it.each(nonTokenCss)('%s fades only through --opacity-stale', (file) => {
    // Fading text lowers its contrast below 4.5:1 (found on earlier events in the running app, #435).
    // Only the transient stale/disabled state may fade, and 0 hides a control's native input.
    const values = [...read(file).matchAll(/(?<![-\w])opacity\s*:\s*([^;}]+)/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(values.filter((v) => v !== 'var(--opacity-stale)' && v !== '0')).toEqual([]);
  });

  it('gives dialog headings no top margin, so the gap above matches the padding (#464)', () => {
    expect(read('styles/components.css')).toMatch(
      /\.modal-dialog > h2\s*\{[^}]*margin-top:\s*0;[^}]*\}/,
    );
  });

  it('keeps each day-summary part on one line (#464)', () => {
    expect(read('index.css')).toMatch(/\.summary-part\s*\{[^}]*white-space:\s*nowrap;[^}]*\}/);
  });

  it('has no Refresh button rules left, since the views refresh themselves (story 0052)', () => {
    expect(read('index.css')).not.toMatch(/\.refresh\b/);
  });

  it.each(cssFiles)('%s animates only when reduced motion is not requested', (file) => {
    // Story 0042 (#463): with reduced motion, the notification appears and disappears without
    // animating. Every animation and transition sits in a `no-preference` block.
    const outside = read(file).replace(
      /@media \(prefers-reduced-motion: no-preference\) \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
      '',
    );
    expect(outside).not.toMatch(/(?<![-\w])(animation|transition)(-[a-z-]+)?\s*:/);
  });

  it('defines every token that a stylesheet uses', () => {
    const defined = new Set<string>();
    for (const m of tokens.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1] ?? '');
    for (const file of cssFiles) {
      for (const m of read(file).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1] ?? '');
    }
    // Custom properties a component sets inline, such as the week grid's heights.
    for (const [file, source] of Object.entries(sourceFiles)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      for (const m of source.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(m[1] ?? '');
    }
    const used = new Set<string>();
    for (const file of cssFiles) {
      for (const m of read(file).matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1] ?? '');
    }
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
