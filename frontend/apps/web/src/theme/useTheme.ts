import { useCallback, useEffect, useState } from 'react';

import {
  applyTheme,
  darkQuery,
  readChoice,
  resolveTheme,
  saveChoice,
  type ThemeChoice,
} from './theme.ts';

/**
 * The saved theme choice and its setter. Applies the choice to `<html>`, and while it is `system`
 * re-applies when the OS preference changes. Returns the choice only: no component reads the
 * theme to pick a colour (ADR-0047).
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);

  useEffect(() => {
    applyTheme(resolveTheme(choice));
    if (choice !== 'system') return;
    const query = darkQuery();
    if (!query) return;
    const onChange = () => {
      applyTheme(resolveTheme('system'));
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    saveChoice(next);
    setChoiceState(next);
  }, []);

  return [choice, setChoice];
}
