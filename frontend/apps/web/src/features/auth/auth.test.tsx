import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { renderApp } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { safeReturnTo } from './auth.ts';

describe('sign in', () => {
  it('redirects signed-out visitors and preserves a deep link', async () => {
    server.use(http.get('*/api/auth/me', () => new HttpResponse(null, { status: 401 })));
    renderApp('/day/2026-10-29?view=day');
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnUrl=%2Fday%2F2026-10-29%3Fview%3Dday',
    );
  });

  it('shows the user and signs out', async () => {
    renderApp('/tasks');
    expect(await screen.findByText('Calendar Owner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('redirects on an expired session with the current URL', async () => {
    server.use(http.get('*/api/agenda/day', () => new HttpResponse(null, { status: 401 })));
    renderApp('/day/2026-10-29');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
        'href',
        '/api/auth/login?returnUrl=%2Fday%2F2026-10-29',
      ),
    );
  });

  it('shows access denied', async () => {
    renderApp('/signin?error=access_denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  });

  it('rejects unsafe return paths', () => {
    for (const path of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/signin',
      '/\nfoo',
    ]) {
      expect(safeReturnTo(path)).toBe('/');
    }
    expect(safeReturnTo('/day/2026-10-29?view=day')).toBe('/day/2026-10-29?view=day');
  });
});
