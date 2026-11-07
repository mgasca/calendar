import { readChoice, resolveTheme, THEME_STORAGE_KEY } from './theme.ts';

import html from '../../index.html?raw';

const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function runStartupScript() {
  delete document.documentElement.dataset.theme;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- running index.html's own script is the point of this test
  const run = new Function(inline) as () => void;
  run();
  return document.documentElement.getAttribute('data-theme');
}

function setMatchMedia(dark: boolean | 'missing') {
  (window as { matchMedia: unknown }).matchMedia =
    dark === 'missing'
      ? undefined
      : (query: string) => ({ matches: dark && query.includes('dark'), media: query });
}

const original: unknown = Reflect.get(window, 'matchMedia');

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  (window as { matchMedia: unknown }).matchMedia = original;
});

describe('inline start-up script in index.html', () => {
  it('exists, runs before the module script, and uses the storage key of the theme module', () => {
    expect(inline).not.toBe('');
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
    expect(inline).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  const stored = [null, 'light', 'dark', 'system', 'purple'] as const;
  const os = [true, false, 'missing'] as const;
  for (const value of stored) {
    for (const dark of os) {
      it(`matches the theme module for stored ${String(value)} and OS ${String(dark)}`, () => {
        if (value) window.localStorage.setItem(THEME_STORAGE_KEY, value);
        setMatchMedia(dark);
        expect(runStartupScript()).toBe(resolveTheme(readChoice()));
      });
    }
  }

  it('matches the theme module when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setMatchMedia(true);
    expect(runStartupScript()).toBe('dark');
    expect(runStartupScript()).toBe(resolveTheme(readChoice()));
  });
});
