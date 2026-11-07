import { isThemeChoice, THEME_STORAGE_KEY } from '@calendar/theme';
import type { ThemeChoice } from '@calendar/theme';

// The docs site's one theme controller (story 0046). The inline start-up script in
// components/ThemeProvider.astro applies the saved choice before first paint; this module drives
// the Light / Dark / System radio groups afterwards. Both write only `data-theme` on <html>, as
// the web app does (ADR-0047). The app and the docs site are different origins, so the shared
// key `calendar.theme` never crosses between them.

const DARK_QUERY = '(prefers-color-scheme: dark)';

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

function darkQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

/** `light` or `dark` for a choice; `system` follows the OS and is light when it can't be read. */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return darkQuery()?.matches ? 'dark' : 'light';
}

/**
 * Wires every `.theme-control` radio group under `root`: shows the saved choice, applies and saves
 * a change, keeps the other instances (header and mobile menu) in step and follows the operating
 * system while the choice is System. Returns a function that removes what it added.
 */
export function bindThemeControls(root: ParentNode = document): () => void {
  const groups = [...root.querySelectorAll<HTMLElement>('.theme-control')];
  // Each group needs its own name or the browser treats the radios as one group.
  groups.forEach((group, index) => {
    for (const input of group.querySelectorAll('input'))
      input.name = `calendar-theme-${String(index)}`;
  });
  let choice = readChoice();

  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(choice);
    for (const input of groups.flatMap((g) => [...g.querySelectorAll('input')])) {
      input.checked = input.value === choice;
    }
  };
  apply();

  const cleanups = groups.map((group) => {
    const onChange = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !isThemeChoice(input.value)) return;
      choice = input.value;
      saveChoice(choice);
      apply();
    };
    group.addEventListener('change', onChange);
    return () => {
      group.removeEventListener('change', onChange);
    };
  });

  const query = darkQuery();
  const onOsChange = () => {
    if (choice === 'system') apply();
  };
  query?.addEventListener('change', onOsChange);

  return () => {
    for (const cleanup of cleanups) cleanup();
    query?.removeEventListener('change', onOsChange);
  };
}
