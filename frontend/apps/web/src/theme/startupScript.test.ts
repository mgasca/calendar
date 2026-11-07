import { readChoice, resolveTheme, THEME_STORAGE_KEY } from './theme.ts';

import html from '../../index.html?raw';

const page = new DOMParser().parseFromString(html, 'text/html');
const inlineScript = page.querySelector('head script:not([src])');
const inline = inlineScript?.textContent ?? '';

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
    const scripts = Array.from(page.querySelectorAll('script'));
    const moduleScript = page.querySelector('script[type="module"][src]');
    expect(scripts.indexOf(inlineScript as HTMLScriptElement)).toBeLessThan(
      scripts.indexOf(moduleScript as HTMLScriptElement),
    );
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
