// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { THEME_STORAGE_KEY } from '@calendar/theme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindThemeControls, readChoice, resolveTheme } from './controller';

// Story 0046 (#516): the docs site has one theme controller. The start-up script applies the
// saved choice before first paint; the controller drives the radio groups afterwards.

const provider = readFileSync(
  join(import.meta.dirname, '..', 'components', 'ThemeProvider.astro'),
  'utf8',
);
const inline = /<script is:inline>([\s\S]*?)<\/script>/.exec(provider)?.[1] ?? '';

function setMatchMedia(dark: boolean | 'missing') {
  const listeners = new Set<() => void>();
  const mql = {
    matches: dark === true,
    media: '',
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  (window as { matchMedia: unknown }).matchMedia =
    dark === 'missing' ? undefined : (query: string) => ({ ...mql, media: query });
  return {
    setDark(next: boolean) {
      mql.matches = next;
      listeners.forEach((cb) => {
        cb();
      });
    },
  };
}

function runStartupScript(): string | undefined {
  delete document.documentElement.dataset.theme;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the component's own script is the point of this test
  const run = new Function(inline) as () => void;
  run();
  return document.documentElement.dataset.theme;
}

const original: unknown = Reflect.get(window, 'matchMedia');

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  (window as { matchMedia: unknown }).matchMedia = original;
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
});

describe('start-up script (ThemeProvider.astro)', () => {
  it('exists and reads the shared storage key', () => {
    expect(inline).not.toBe('');
    expect(inline).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(provider).not.toContain('starlight-theme');
  });

  for (const value of [null, 'light', 'dark', 'system', 'purple'] as const) {
    for (const dark of [true, false, 'missing'] as const) {
      it(`matches the controller for stored ${String(value)} and OS ${String(dark)}`, () => {
        if (value) window.localStorage.setItem(THEME_STORAGE_KEY, value);
        setMatchMedia(dark);
        expect(runStartupScript()).toBe(resolveTheme(readChoice()));
      });
    }
  }

  it('applies the saved Dark choice even when the OS is light (no wrong-theme flash)', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    setMatchMedia(false);
    expect(runStartupScript()).toBe('dark');
  });

  it('still themes the page when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setMatchMedia(true);
    expect(runStartupScript()).toBe('dark');
    expect(readChoice()).toBe('system');
  });
});

function controlHtml(): string {
  return `<fieldset class="theme-control"><legend>Theme</legend>${['light', 'dark', 'system']
    .map((v) => `<label><input type="radio" value="${v}"> ${v}</label>`)
    .join('')}</fieldset>`;
}

const radio = (group: number, value: string): HTMLInputElement => {
  const input = document
    .querySelectorAll('.theme-control')
    [group]?.querySelector(`input[value="${value}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error('missing radio');
  return input;
};

describe('theme controller', () => {
  let unbind: () => void;
  beforeEach(() => {
    document.body.innerHTML = controlHtml() + controlHtml();
  });
  afterEach(() => {
    unbind();
  });

  it('shows System when nothing valid is saved and sets the theme from the OS', () => {
    setMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    unbind = bindThemeControls();
    expect(radio(0, 'system').checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies and saves a choice, and keeps the other group in step', () => {
    setMatchMedia(false);
    unbind = bindThemeControls();
    radio(0, 'dark').click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(radio(1, 'dark').checked).toBe(true);
    expect(radio(1, 'system').checked).toBe(false);
  });

  it('gives each group its own radio name', () => {
    setMatchMedia(false);
    unbind = bindThemeControls();
    expect(radio(0, 'light').name).not.toBe('');
    expect(radio(0, 'light').name).not.toBe(radio(1, 'light').name);
  });

  it('retains the saved choice on the next page', () => {
    setMatchMedia(false);
    unbind = bindThemeControls();
    radio(1, 'dark').click();
    unbind();
    document.body.innerHTML = controlHtml();
    delete document.documentElement.dataset.theme;
    unbind = bindThemeControls();
    expect(radio(0, 'dark').checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows OS changes only while the choice is System', () => {
    const os = setMatchMedia(false);
    unbind = bindThemeControls();
    expect(document.documentElement.dataset.theme).toBe('light');
    os.setDark(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    radio(0, 'light').click();
    os.setDark(false);
    os.setDark(true);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('applies the choice for this visit when storage refuses writes or reads', () => {
    setMatchMedia(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    unbind = bindThemeControls();
    expect(radio(0, 'system').checked).toBe(true);
    expect(() => {
      radio(0, 'dark').click();
    }).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('works where matchMedia is missing', () => {
    setMatchMedia('missing');
    unbind = bindThemeControls();
    expect(document.documentElement.dataset.theme).toBe('light');
    radio(0, 'dark').click();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
