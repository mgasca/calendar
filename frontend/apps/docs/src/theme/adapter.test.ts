import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Story 0046 (#516): the Starlight adapter maps the shared tokens and holds no palette of its own.

const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'theme-adapter.css'), 'utf8');
const mapped = new Map(
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--sl-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
    m[1] ?? '',
    (m[2] ?? '').trim(),
  ]),
);
const tokens = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'theme', 'src', 'tokens.css'),
  'utf8',
);

describe('Starlight adapter', () => {
  it('maps every colour variable to a shared token', () => {
    const colours = [...mapped].filter(([name]) => name.startsWith('--sl-color-'));
    expect(colours.length).toBeGreaterThan(30);
    for (const [name, value] of colours) {
      expect(value, name).toMatch(/^var\(--color-[\w-]+\)$/);
    }
  });

  it('references only tokens the token file defines', () => {
    for (const [, name] of css.matchAll(
      /var\(\s*(--(?:color|font|radius|shadow|text|space)[\w-]*)/g,
    )) {
      expect(tokens, name).toContain(`${name ?? ''}:`);
    }
  });

  it('maps the greys so text reaches AA on the page in both themes', () => {
    // sl-color-text and the muted greys must point at tokens that the contrast guard in
    // @calendar/theme covers against `bg`.
    expect(mapped.get('--sl-color-text')).toBe('var(--color-text)');
    expect(mapped.get('--sl-color-gray-3')).toBe('var(--color-text-muted)');
    expect(mapped.get('--sl-color-bg')).toBe('var(--color-bg)');
  });
});
