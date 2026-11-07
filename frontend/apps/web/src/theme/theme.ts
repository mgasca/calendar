import { isThemeChoice, THEME_STORAGE_KEY } from '@calendar/theme';
import type { ThemeChoice } from '@calendar/theme';

export { THEME_STORAGE_KEY };
export type { ThemeChoice };
/** The theme the page shows. */
export type Theme = 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The saved choice; `system` when nothing valid is saved or storage is unavailable. */
export function readChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Saves the choice. Refused storage is ignored: the choice still applies for this visit. */
export function saveChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage is unavailable (private mode, blocked site data): nothing to do.
  }
}

/** The media query list for the OS preference, or null where `matchMedia` is missing. */
export function darkQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

/** `light` or `dark` for a choice; `system` follows the OS and is light when it can't be read. */
export function resolveTheme(choice: ThemeChoice): Theme {
  if (choice !== 'system') return choice;
  return darkQuery()?.matches ? 'dark' : 'light';
}

/** The only writer of `data-theme` on `<html>` (ADR-0047). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
