import { useId } from 'react';

import { type ThemeChoice } from './theme.ts';
import { useTheme } from './useTheme.ts';

const OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** The Light / Dark / System choice: a native radio group, so the keyboard behaviour is the browser's. */
export function ThemeControl() {
  const [choice, setChoice] = useTheme();
  const name = useId();
  return (
    <fieldset className="theme-control">
      <legend>Theme</legend>
      {OPTIONS.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={choice === option.value}
            onChange={() => {
              setChoice(option.value);
            }}
          />{' '}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
