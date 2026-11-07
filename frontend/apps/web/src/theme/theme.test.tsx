import { act, renderHook } from '@testing-library/react';

import { applyTheme, readChoice, resolveTheme, saveChoice, THEME_STORAGE_KEY } from './theme.ts';
import { useTheme } from './useTheme.ts';

type Listener = () => void;

/** Installs a `matchMedia` whose dark preference can be flipped; returns the flipper. */
function mockOs(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('dark') && dark;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      dark = next;
      listeners.forEach((l) => {
        l();
      });
    },
    listeners,
  };
}

const original: unknown = Reflect.get(window, 'matchMedia');

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.restoreAllMocks();
  (window as { matchMedia: unknown }).matchMedia = original;
});

describe('readChoice and saveChoice', () => {
  it('round-trips a saved choice and reads system when nothing valid is saved', () => {
    expect(readChoice()).toBe('system');
    saveChoice('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readChoice()).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readChoice()).toBe('system');
  });

  it('reads system and ignores writes when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readChoice()).toBe('system');
    expect(() => {
      saveChoice('dark');
    }).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('lets light and dark win over the OS', () => {
    mockOs(true);
    expect(resolveTheme('light')).toBe('light');
    mockOs(false);
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('follows the OS for system, and is light when matchMedia is missing', () => {
    mockOs(true);
    expect(resolveTheme('system')).toBe('dark');
    mockOs(false);
    expect(resolveTheme('system')).toBe('light');
    (window as { matchMedia: unknown }).matchMedia = undefined;
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('useTheme', () => {
  it('applies the saved choice and saves a new one', () => {
    mockOs(false);
    saveChoice('dark');
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => {
      result.current[1]('light');
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('follows a live OS change while the choice is system, and only then', () => {
    const os = mockOs(false);
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => {
      os.set(true);
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => {
      result.current[1]('light');
    });
    expect(os.listeners.size).toBe(0);
    act(() => {
      os.set(true);
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('still switches for the visit when storage throws', () => {
    mockOs(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current[1]('dark');
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('sets data-theme on the root element', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
