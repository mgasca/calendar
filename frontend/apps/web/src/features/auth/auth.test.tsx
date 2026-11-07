import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { renderApp } from '../../test/render.tsx';
import { server } from '../../test/server.ts';
import { safeReturnTo } from './auth.ts';

/** The day agenda the day route loads and the task list the tasks route loads, both empty. */
function serveEmptyViews() {
  server.use(
    http.get('*/api/agenda/day', ({ request }) => {
      const url = new URL(request.url);
      const date = url.searchParams.get('date') ?? '';
      return HttpResponse.json({
        date,
        timeZone: url.searchParams.get('timeZone') ?? 'Europe/Madrid',
        window: { start: `${date}T00:00:00+01:00`, end: `${date}T24:00:00+01:00` },
        allDayEvents: [],
        events: [],
        tasks: { overdueTotal: 0, overdueOpenTotal: 0, overdue: [], dueToday: [] },
      });
    }),
    http.get('*/api/tasks', () => HttpResponse.json({ items: [], nextCursor: null })),
  );
}

describe('sign in', () => {
  it('redirects signed-out visitors and preserves a deep link', async () => {
    serveEmptyViews();
    server.use(http.get('*/api/auth/me', () => new HttpResponse(null, { status: 401 })));
    renderApp('/day/2026-10-29?view=day');
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnUrl=%2Fday%2F2026-10-29%3Fview%3Dday',
    );
  });

  it('shows the user and signs out', async () => {
    serveEmptyViews();
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
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Access denied');
    // Errors use the shared notice style, and the sign-in link the shared primary button (story 0039).
    expect(alert).toHaveClass('notice', 'notice-error');
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveClass('button-primary');
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
