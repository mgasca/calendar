// Helpers for the ADR-0047 guards: read the token file, parse its theme blocks and scan consumer
// stylesheets for colour literals and theme selectors.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const colourLiteral =
  /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|navy|teal|Canvas|CanvasText|Field|FieldText|ButtonFace|ButtonText|Highlight|LinkText|GrayText)\b/i;
// Case-insensitive on purpose: CSS keywords are.

/**
 * Declaration values of a stylesheet that contain a colour literal. Only values count: class names
 * such as `.field` are not colours. Token references and `color-mix()` over tokens are fine; a
 * literal inside them is not.
 */
export function colourLiterals(css: string): string[] {
  const values = [...stripComments(css).matchAll(/:\s*([^;{}]+)[;}]/g)].map((m) =>
    (m[1] ?? '').replace(/var\([^)]*\)/g, ''),
  );
  return values.filter((v) => colourLiteral.test(v));
}

/** Theme selectors and colour-scheme queries, which only the token file may contain. */
export function themeSelectors(css: string): string[] {
  return [...stripComments(css).matchAll(/\[data-theme|prefers-color-scheme/g)].map((m) => m[0]);
}

/** Paths of the `.css` files under `dir`, relative to it, with forward slashes. */
export function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.css'));
}

export const readCss = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');

/** The text between the braces of the block whose selector starts at `selector`. */
export function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} block not found`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Unclosed block for ${selector}`);
}

export function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return map;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`contrast pairs must be 6-digit hex: ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
