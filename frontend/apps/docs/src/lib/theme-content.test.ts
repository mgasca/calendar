import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ownershipBoxMarker, ownershipLegend } from './architecture';
import { mermaidThemeCss } from './mermaid-theme';
import { colour, parsePalettes, readPalettes } from './theme-palette';

// Story 0046 (#517): diagrams, code blocks and status badges take their colours from the shared
// theme tokens and hold no second copy of the palette.

const styles = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', 'styles', name), 'utf8');
const tokenNames = new Set(
  [
    ...readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'theme', 'src', 'tokens.css'),
      'utf8',
    ).matchAll(/(--[\w-]+)\s*:/g),
  ].map((m) => m[1]),
);

describe('palette reader', () => {
  it('reads both themes from the shared token file', () => {
    const { light, dark } = readPalettes();
    expect(colour(light, 'bg')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colour(light, 'bg')).not.toBe(colour(dark, 'bg'));
  });

  it('fails loudly for a missing token or block', () => {
    const { light } = readPalettes();
    expect(() => colour(light, 'no-such-token')).toThrow(/no-such-token/);
    expect(() => parsePalettes('a { }')).toThrow(/not found/);
  });
});

describe('Mermaid theme CSS', () => {
  const colourValue = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i;

  it('holds no colour value, only token references that exist', () => {
    // The sequence-box markers are selectors that match a placeholder fill, not painted colours.
    const painted = mermaidThemeCss.replace(/\[fill='rgba\(0,0,0,0\.0\d\)'\]/g, '');
    expect(painted).not.toMatch(colourValue);
    const used = [...mermaidThemeCss.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((name) => !tokenNames.has(name ?? ''))).toEqual([]);
  });

  it('paints every ownership class and its sequence-box marker from that ownership tokens', () => {
    for (const [ownership, { fill, stroke }] of Object.entries(ownershipLegend)) {
      expect(mermaidThemeCss).toContain(`.node.${ownership} rect`);
      expect(mermaidThemeCss).toContain(`.cluster.${ownership} rect`);
      const marker = ownershipBoxMarker[ownership as keyof typeof ownershipBoxMarker];
      expect(mermaidThemeCss).toContain(`rect.rect[fill='${marker}'] { fill: ${fill} !important`);
      expect(mermaidThemeCss).toContain(`stroke: ${stroke}`);
    }
  });
});

describe('status badges', () => {
  const css = styles('docs.css');
  // Pairs covered by the contrast guard in @calendar/theme (background → allowed text tokens).
  const guarded: Record<string, string[]> = {
    'accent-soft': ['text', 'text-muted'],
    'current-bg': ['text', 'text-muted'],
    'overdue-bg': ['text', 'text-muted', 'overdue-text'],
    'error-soft': ['error'],
    'surface-sunken': ['text', 'text-muted'],
  };

  it.each(['accepted', 'draft', 'rejected', 'superseded', 'pending'])(
    'the %s badge uses a token pair the contrast guard covers',
    (status) => {
      const bg = new RegExp(`--adr-status-${status}-bg:\\s*var\\(--color-([\\w-]+)\\)`).exec(css);
      const text = new RegExp(`--adr-status-${status}-text:\\s*var\\(--color-([\\w-]+)\\)`).exec(
        css,
      );
      expect(bg, `${status} background`).not.toBeNull();
      expect(text, `${status} text`).not.toBeNull();
      expect(guarded[bg?.[1] ?? ''], `${status} background token`).toContain(text?.[1]);
    },
  );
});
