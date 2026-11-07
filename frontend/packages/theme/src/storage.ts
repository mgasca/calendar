/** The saved choice; `system` follows the operating system. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** The values a saved choice may hold. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'];

/**
 * The `localStorage` key of the saved choice. The web app and the docs site use the same key in
 * their own origins; nothing crosses origins (story 0046).
 */
export const THEME_STORAGE_KEY = 'calendar.theme';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}
