import type { Schemas } from '@calendar/api-client';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { emptyWeek } from './weekAgenda.ts';

/** Default happy-path handlers; override per test with `server.use(...)`. */
export const handlers = [
  http.get('*/api/auth/me', () =>
    HttpResponse.json({ name: 'Calendar Owner', email: 'owner@example.com' }),
  ),
  http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/health', () => HttpResponse.json<Schemas['HealthResponse']>({ status: 'ok' })),
  // An empty week for whichever date is asked for, so views that link to the week can be visited.
  http.get('*/api/agenda/week', ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json(
      emptyWeek(url.searchParams.get('date') ?? '', url.searchParams.get('today') ?? ''),
    );
  }),
];

export const server = setupServer(...handlers);
