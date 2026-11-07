import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// ADR-0047 guards: the token layer is the only place that holds colours and theme selectors, the two
// dark sets cannot drift, every token that is used exists, and both palettes meet WCAG contrast.
// This runs in the Node test project (like the other files in dev/): the web project turns CSS off,
// and the app's tsconfig has no Node types. It reads the stylesheets and sources from src/.

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
const tokensPath = 'styles/tokens.css';
const nonTokenCss = cssFiles.filter((f) => f !== tokensPath);
const read = (file: string) => cssByPath.get(file) ?? '';
const tokens = read(tokensPath);

/** The text between the braces of the block whose selector starts at `selectorStart`. */
function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `${selector} block in tokens.css`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Unclosed block for ${selector}`);
}

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return map;
}

const light = declarations(blockAfter(tokens, ":root[data-theme='light']"));
const dark = declarations(blockAfter(tokens, ":root[data-theme='dark']"));
const osDark = declarations(
  blockAfter(blockAfter(tokens, '@media (prefers-color-scheme: dark)'), ':root:not([data-theme])'),
);

describe('token layer guards (ADR-0047)', () => {
  it('finds the stylesheets', () => {
    expect(cssFiles).toContain(tokensPath);
    expect(nonTokenCss.length).toBeGreaterThan(0);
  });

  const colourLiteral =
    /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|navy|teal|Canvas|CanvasText|Field|FieldText|ButtonFace|ButtonText|Highlight|LinkText|GrayText)\b/i;
  // Case-insensitive on purpose: CSS keywords are.

  it.each(nonTokenCss)('%s has no colour literal', (file) => {
    // Only declaration values count: class names such as .field are not colours. Token references
    // and color-mix() over tokens are fine; a literal inside them is not.
    const values = [...read(file).matchAll(/:\s*([^;{}]+)[;}]/g)].map((m) =>
      (m[1] ?? '').replace(/var\([^)]*\)/g, ''),
    );
    expect(values.filter((v) => colourLiteral.test(v))).toEqual([]);
  });

  it.each(nonTokenCss)('%s has no theme selector or colour-scheme query', (file) => {
    const css = read(file);
    expect(css).not.toMatch(/\[data-theme/);
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it.each(nonTokenCss)('%s fades only through --opacity-stale', (file) => {
    // Fading text lowers its contrast below 4.5:1 (found on earlier events in the running app, #435).
    // Only the transient stale/disabled state may fade, and 0 hides a control's native input.
    const values = [...read(file).matchAll(/(?<![-\w])opacity\s*:\s*([^;}]+)/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(values.filter((v) => v !== 'var(--opacity-stale)' && v !== '0')).toEqual([]);
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

  it('keeps the OS-fallback dark block identical to the data-theme dark block', () => {
    expect(osDark.size).toBeGreaterThan(20);
    expect([...osDark]).toEqual([...dark]);
  });

  it('defines the same token names in both themes', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
  });

  it('defines every token that a stylesheet uses', () => {
    const defined = new Set<string>();
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

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  expect(hex, 'contrast pairs must be 6-digit hex colours').toMatch(/^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** [foreground, backgrounds] pairs, by token name without the `--color-` prefix. */
const TEXT_PAIRS: [string, string[]][] = [
  [
    'text',
    [
      'bg',
      'surface',
      'surface-raised',
      'surface-sunken',
      'current-bg',
      'overdue-bg',
      'accent-soft',
    ],
  ],
  [
    'text-muted',
    [
      'bg',
      'surface',
      'surface-raised',
      'surface-sunken',
      'current-bg',
      'overdue-bg',
      'accent-soft',
    ],
  ],
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

describe.each([
  ['light (Paper & Sage)', light],
  ['dark (Midnight Studio)', dark],
])('contrast, %s', (_name, theme) => {
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
