import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { THEME_CHOICES, THEME_STORAGE_KEY, isThemeChoice } from '../src/index.ts';

describe('storage contract', () => {
  it('keeps the key and values the app has always saved', () => {
    expect(THEME_STORAGE_KEY).toBe('calendar.theme');
    expect([...THEME_CHOICES]).toEqual(['light', 'dark', 'system']);
  });

  it('accepts only the three choices', () => {
    expect(THEME_CHOICES.every(isThemeChoice)).toBe(true);
    for (const bad of [null, undefined, '', 'purple', 'Light', 1])
      expect(isThemeChoice(bad)).toBe(false);
  });

  it("is the key the web app's inline start-up script reads", () => {
    const html = readFileSync(join(import.meta.dirname, '../../../apps/web/index.html'), 'utf8');
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });
});
