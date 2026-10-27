import type { Schemas } from '@calendar/api-client';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { renderApp } from './test/render.tsx';
import { server } from './test/server.ts';

type Agenda = Schemas['DayAgendaResponse'];

const ZONE = 'Europe/Madrid';
// 10:30 in Madrid on Monday 26 October 2026.
const MORNING = '2026-10-26T09:30:00Z';

/** An agenda for `date` with one event running from 10:00 to 11:00 Madrid time. */
function agendaFor(date: string): Agenda {
  return {
    date,
    timeZone: ZONE,
    window: { start: `${date}T00:00:00+01:00`, end: `${date}T24:00:00+01:00` },
    allDayEvents: [],
    events: [
      {
        id: `e-${date}`,
        title: `Review on ${date}`,
        start: `${date}T09:00:00Z`,
        end: `${date}T10:00:00Z`,
        timeZone: ZONE,
        startsBeforeDay: false,
        endsAfterDay: false,
      },
    ],
    tasks: { overdue: [], dueToday: [] },
  };
}

/** Serves an agenda for whichever date is asked for, recording the requested dates. */
function serveAgendas() {
  const dates: (string | null)[] = [];
  server.use(
    http.get('*/api/agenda/day', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date');
      dates.push(date);
      return HttpResponse.json(agendaFor(date ?? ''));
    }),
  );
  return dates;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(MORNING));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('routes', () => {
  it('shows today at /', async () => {
    const dates = serveAgendas();

    renderApp('/');

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Monday,? 26 October$/);
    expect(within(screen.getByRole('main')).getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(dates).toEqual(['2026-10-26']);
  });

  it('shows the same view for /day/<today> as for /', async () => {
    serveAgendas();

    renderApp('/day/2026-10-26');

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Monday,? 26 October$/);
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('shows another date at /day/<date>, without the Now and Next markers', async () => {
    const dates = serveAgendas();

    renderApp('/day/2026-10-20');

    expect(await screen.findByText('Review on 2026-10-20')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Tuesday,? 20 October$/);
    expect(screen.getByText('6 days ago')).toBeInTheDocument();
    expect(screen.queryByText(/^(Earlier|Now|Next)$/)).not.toBeInTheDocument();
    expect(dates).toEqual(['2026-10-20']);
  });

  it.each([
    ['a date that does not exist', '2026-02-30'],
    ['the wrong format', '26-10-2026'],
    ['a word', 'tomorrow'],
    ['a year the API does not support', '1899-12-31'],
  ])('shows the invalid-date page for %s, without calling the API', async (_case, value) => {
    const dates = serveAgendas();

    renderApp(`/day/${value}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Invalid date' })).toBeVisible();
    expect(screen.getByText(new RegExp(`“${value}” isn’t a date`))).toBeInTheDocument();
    expect(dates).toEqual([]);
  });

  it('shows a not-found page for an unknown path', async () => {
    renderApp('/nowhere');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('goes back to today from another date with the Today link', async () => {
    const dates = serveAgendas();
    const { router } = renderApp('/day/2026-10-20');
    await screen.findByText('Review on 2026-10-20');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(nav).getByRole('link', { name: 'Today' }));

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(dates).toEqual(['2026-10-20', '2026-10-26']);
  });

  it('leaves the invalid-date page with its link to today', async () => {
    serveAgendas();
    renderApp('/day/2026-13-01');

    await userEvent.click(await screen.findByRole('link', { name: 'Go to today' }));

    expect(await screen.findByText('Review on 2026-10-26')).toBeInTheDocument();
  });

  it('restores the previous day with the browser back button', async () => {
    serveAgendas();
    const { router } = renderApp('/day/2026-10-20');
    await screen.findByText('Review on 2026-10-20');
    await userEvent.click(screen.getByRole('link', { name: 'Today' }));
    await screen.findByText('Review on 2026-10-26');

    act(() => {
      router.history.back();
    });

    expect(await screen.findByText('Review on 2026-10-20')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/day/2026-10-20');
  });
});
