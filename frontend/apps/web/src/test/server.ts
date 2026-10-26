import type { Schemas } from '@calendar/api-client';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** Default happy-path handlers; override per test with `server.use(...)`. */
export const handlers = [
  http.get('*/api/health', () => HttpResponse.json<Schemas['HealthResponse']>({ status: 'ok' })),
];

export const server = setupServer(...handlers);
