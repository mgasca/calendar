import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { THEME_STORAGE_KEY } from './theme.ts';
import { ThemeControl } from './ThemeControl.tsx';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeControl', () => {
  it('is a group named Theme with System selected by default', () => {
    render(<ThemeControl />);
    expect(screen.getByRole('group', { name: 'Theme' })).toBeVisible();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'light',
      'dark',
      'system',
    ]);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  it('selects each option with the keyboard and updates the page and storage', async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('shows the saved choice as selected', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeControl />);
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  it('switches with no error when storage refuses', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<ThemeControl />);
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
