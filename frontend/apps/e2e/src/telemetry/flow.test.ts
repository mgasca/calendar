import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Stack } from '../stack.ts';
import { Observer } from './flow.ts';
import { PersonalData } from './personal-data.ts';
import { api, web } from './tempo.ts';

const stack: Stack = {
  webUrl: 'http://web.test',
  apiUrl: 'http://api.test',
  seedKey: 'seed-key',
  email: 'person@example.test',
  tempoUrl: 'http://tempo.test',
  lokiUrl: 'http://loki.test',
  prometheusUrl: 'http://prometheus.test',
};

const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');
const service = (name: string, spans: object[]) => ({
  resource: { attributes: [{ key: 'service.name', value: { stringValue: name } }] },
  scopeSpans: [{ spans }],
});

/** One user action's trace: its `ui.*` span, the fetch, the API's server span and one database span. */
function actionTrace(action: string, route: string, query: string, value = '') {
  const span = (id: string, parent: string, name: string) => ({
    spanId: b64(id),
    ...(parent && { parentSpanId: b64(parent) }),
    name,
    attributes: value ? [{ key: 'http.route', value: { stringValue: value } }] : [],
  });
  return {
    trace: {
      resourceSpans: [
        service('calendar-web', [
          span('00000000000000a1', '', action),
          span('00000000000000a2', '00000000000000a1', route),
        ]),
        service('calendar-api', [
          span('00000000000000b1', '00000000000000a2', route),
          span('00000000000000b2', '00000000000000b1', query),
        ]),
      ],
    },
  };
}

const OPEN = '1'.repeat(32);
const SAVE = '2'.repeat(32);

/** Fakes Tempo, Loki and Prometheus: `traces` by id, one log record per trace, and growing counts. */
function fakeStack(traces: Record<string, unknown>) {
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = new URL(input);
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
    if (url.pathname.startsWith('/api/v2/traces/'))
      return json(traces[url.pathname.slice('/api/v2/traces/'.length)] ?? {});
    if (url.pathname === '/loki/api/v1/query_range')
      return json({
        data: { result: [{ stream: { service_name: 'calendar-api' }, values: [['1', 'ok']] }] },
      });
    if (url.pathname === '/api/v1/query') return json({ data: { result: [{ value: [0, '3'] }] } });
    if (url.pathname === '/api/v1/series') return json({ data: [] });
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

const open = {
  traceId: OPEN,
  chain: [web('ui.event.open'), web('GET /api/events/{id}'), api('GET /api/events/{id}')],
  spans: [api('SELECT events')],
};
const save = {
  traceId: SAVE,
  chain: [web('ui.event.update'), web('PUT /api/events/{id}'), api('PUT /api/events/{id}')],
  spans: [api('UPDATE events')],
};
const routes = [{ method: 'PUT', route: '/api/events/{id}' }];

function observer(personalData = new PersonalData()) {
  return new Observer(stack, personalData, new Date(0), { timeoutMs: 50, intervalMs: 10 });
}

describe('a flow of several user actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asserts each action’s trace and returns its spans', async () => {
    fakeStack({
      [OPEN]: actionTrace('ui.event.open', 'GET /api/events/{id}', 'SELECT events'),
      [SAVE]: actionTrace('ui.event.update', 'PUT /api/events/{id}', 'UPDATE events'),
    });
    const observed = await observer().expectFlow({ ...open, traces: [save], routes, before: [0] });
    expect(observed.spans.map((span) => span.name)).toContain('SELECT events');
    expect(observed.traces[0]?.map((span) => span.name)).toContain('UPDATE events');
  });

  it('fails naming the further trace that falls short', async () => {
    fakeStack({
      [OPEN]: actionTrace('ui.event.open', 'GET /api/events/{id}', 'SELECT events'),
      [SAVE]: actionTrace('ui.event.update', 'PUT /api/events/{id}', 'SELECT events'),
    });
    await expect(
      observer().expectFlow({ ...open, traces: [save], routes, before: [0] }),
    ).rejects.toThrow(`Trace ${SAVE} in Tempo`);
  });

  it('scans the further traces for personal data too', async () => {
    const personalData = new PersonalData();
    personalData.add('a seeded event title', 'Dentist with Ana · e2e-1234');
    fakeStack({
      [OPEN]: actionTrace('ui.event.open', 'GET /api/events/{id}', 'SELECT events'),
      [SAVE]: actionTrace(
        'ui.event.update',
        'PUT /api/events/{id}',
        'UPDATE events',
        'Dentist with Ana · e2e-1234',
      ),
    });
    await expect(
      observer(personalData).expectFlow({ ...open, traces: [save], routes, before: [0] }),
    ).rejects.toThrow(/a seeded event title/);
  });
});
