import { readFileSync } from 'node:fs';

// Reads the canonical palette of @calendar/theme at build time, so nothing in the docs app holds a
// second copy of a colour (story 0046). Used where a build step needs a real colour value, such as
// the code-block theme's background, which Expressive Code uses to adjust syntax contrast.

export type Palette = ReadonlyMap<string, string>;
export interface Palettes {
  light: Palette;
  dark: Palette;
}

export const tokensFile = new URL('../../../../packages/theme/src/tokens.css', import.meta.url);

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} block not found in the theme tokens`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Unclosed block for ${selector}`);
}

function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]),
  );
}

/** The token values of both themes, by custom-property name (`--color-bg`). */
export function parsePalettes(css: string): Palettes {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return {
    light: declarations(block(clean, ":root[data-theme='light']")),
    dark: declarations(block(clean, ":root[data-theme='dark']")),
  };
}

export function readPalettes(): Palettes {
  return parsePalettes(readFileSync(tokensFile, 'utf8'));
}

/** A colour token of a theme; throws when it is missing so a rename fails the build. */
export function colour(palette: Palette, token: string): string {
  const value = palette.get(`--color-${token}`);
  if (value === undefined) throw new Error(`--color-${token} is not defined in the theme tokens`);
  return value;
}
