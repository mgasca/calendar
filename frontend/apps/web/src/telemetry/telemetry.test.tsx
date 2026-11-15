import type { Schemas } from '@calendar/api-client';
import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';

import { api } from '../api/client.ts';
import { useCreateEvent } from '../features/events/useCreateEvent.ts';
import { useUpdateEvent } from '../features/events/useEditEvent.ts';
import { fromEvent, requestBody } from '../features/events/eventForm.ts';
import { submitInBatches } from '../features/triage/bulkBatches.ts';
import { createQueryClient } from '../queryClient.ts';
import { eventually } from '../test/render.tsx';
import { server } from '../test/server.ts';
import { traceAction } from './action.ts';
import { startTelemetry, type Telemetry } from './sdk.ts';

const EVENT_ID = '0b5c7d1e-3f4a-4b6c-8d9e-0f1a2b3c4d5e';
/** Personal values the test plants; none may reach an exported span. */
const TITLE = 'Dentist with Dr Planted';
const LOCATION = 'Planted Clinic, 12 Private Street';
const NOTES = 'planted-notes: bring the insurance card';
const EMAIL = 'planted.person@example.com';

const stored: Schemas['EventResponse'] = {
  id: EVENT_ID,
  title: TITLE,
  allDay: false,
  start: '2099-10-29T15:00:00Z',
  end: '2099-10-29T16:00:00Z',
  timeZone: 'UTC',
  location: LOCATION,
  notes: NOTES,
  version: 7,
};

/** `traceparent: 00-<trace id>-<span id>-<flags>` → the trace id. */
const traceIdOf = (header: string | null) =>
  /^00-([0-9a-f]{32})-[0-9a-f]{16}-0[01]$/.exec(header ?? '')?.[1];

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

describe('web telemetry', () => {
  let exporter: InMemorySpanExporter;
  let telemetry: Telemetry;
  let traceparents: (string | null)[];

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    telemetry = startTelemetry({ origin: window.location.origin, exporter });
    traceparents = [];
    server.use(
      http.put('*/api/events/:id', async ({ request }) => {
        traceparents.push(request.headers.get('traceparent'));
        const body = (await request.json()) as object;
        return HttpResponse.json({ ...stored, ...body, version: 8 });
      }),
      http.post('*/api/events', ({ request }) => {
        traceparents.push(request.headers.get('traceparent'));
        return HttpResponse.json(stored, { status: 201 });
      }),
      http.get('*/api/agenda/day', () => HttpResponse.json({})),
    );
  });

  afterEach(async () => {
    await telemetry.stop();
  });

  const spans = () => exporter.getFinishedSpans();
  const named = (name: string) => spans().find((span) => span.name === name);
  /** A fetch span ends once the instrumentation has read the response body, after the call returns. */
  const ended = (...names: string[]) =>
    eventually(() => {
      for (const name of names) if (!named(name)) throw new Error(`span ${name} has not ended`);
    });

  it('puts the save, its fetch span and the API request in one trace', async () => {
    const { result } = renderHook(() => useUpdateEvent('UTC'), { wrapper });

    await act(() =>
      result.current.mutateAsync({ id: EVENT_ID, version: 7, values: fromEvent(stored) }),
    );

    await ended('ui.event.update', 'PUT /api/events/{id}');
    const action = named('ui.event.update');
    const fetchSpan = named('PUT /api/events/{id}');
    expect(action).toBeDefined();
    expect(fetchSpan).toBeDefined();
    const traceId = action?.spanContext().traceId;
    expect(fetchSpan?.spanContext().traceId).toBe(traceId);
    expect(fetchSpan?.parentSpanContext?.spanId).toBe(action?.spanContext().spanId);
    // The API received the fetch span as its parent, in the same trace.
    expect(traceparents).toHaveLength(1);
    expect(traceIdOf(traceparents[0] ?? null)).toBe(traceId);
    expect(traceparents[0]).toContain(fetchSpan?.spanContext().spanId);
  });

  it('gives a new event its own trace, joined by the API request', async () => {
    const { result } = renderHook(() => useCreateEvent('UTC'), { wrapper });

    await act(() => result.current.mutateAsync(fromEvent(stored)));

    await ended('ui.event.create', 'POST /api/events');
    const action = named('ui.event.create');
    expect(named('POST /api/events')?.spanContext().traceId).toBe(action?.spanContext().traceId);
    expect(traceIdOf(traceparents[0] ?? null)).toBe(action?.spanContext().traceId);
  });

  it('keeps every bulk batch in the action’s trace', async () => {
    server.use(
      http.post('*/api/tasks/bulk', ({ request }) => {
        traceparents.push(request.headers.get('traceparent'));
        return HttpResponse.json({ results: [], applied: 1, skipped: 0, notFound: 0 });
      }),
    );

    await traceAction(
      'ui.tasks.bulk',
      (within) =>
        submitInBatches(
          ['a', 'b', 'c'],
          (ids) => within(() => api.POST('/api/tasks/bulk', { body: { action: 'complete', ids } })),
          1,
        ),
      { 'app.bulk.action': 'complete', 'app.bulk.batches': 3 },
    );

    await ended('ui.tasks.bulk', 'POST /api/tasks/bulk');
    const action = named('ui.tasks.bulk');
    expect(traceparents).toHaveLength(3);
    for (const header of traceparents)
      expect(traceIdOf(header)).toBe(action?.spanContext().traceId);
    expect(action?.attributes).toEqual({ 'app.bulk.action': 'complete', 'app.bulk.batches': 3 });
  });

  it('names the span of a fetch(url, init) call by its route, like a Request call (#879)', async () => {
    let traceparent: string | null = null;
    server.use(
      http.get('*/api/auth/me', ({ request }) => {
        traceparent = request.headers.get('traceparent');
        return HttpResponse.json({ name: '', email: EMAIL, pictureUrl: null });
      }),
      http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    );

    // The two raw calls of the app: getUser() with a URL, signOut() with a URL and an init.
    await fetch(new URL('/api/auth/me', window.location.origin));
    await fetch(new URL('/api/auth/logout', window.location.origin), { method: 'POST' });

    await eventually(() => {
      if (spans().length < 2) throw new Error('the fetch spans have not ended');
    });
    expect(spans().map((span) => span.name)).toEqual(['GET /api/auth/me', 'POST /api/auth/logout']);
    const me = named('GET /api/auth/me');
    expect(me?.attributes['url.template']).toBe('/api/auth/me');
    expect(named('POST /api/auth/logout')?.attributes['url.template']).toBe('/api/auth/logout');
    expect(traceparent).toContain(me?.spanContext().spanId);
  });

  it('sends traceparent to /api only', async () => {
    let otherHeader: string | null | undefined;
    server.use(
      http.get('*/health-elsewhere', ({ request }) => {
        otherHeader = request.headers.get('traceparent');
        return HttpResponse.text('ok');
      }),
    );

    await traceAction('ui.day.load', () =>
      fetch(new URL('/health-elsewhere?email=' + EMAIL, window.location.origin)),
    );

    expect(otherHeader).toBeNull();
    expect(spans().map((span) => span.name)).toEqual(['ui.day.load']);
  });

  it('exports no personal value, query string or URL', async () => {
    server.use(http.get('*/api/agenda/day', () => HttpResponse.json({}, { status: 500 })));
    await traceAction('ui.event.update', () =>
      api.PUT('/api/events/{id}', {
        params: { path: { id: EVENT_ID } },
        body: { ...requestBody(fromEvent(stored), 'UTC'), version: 7 },
      }),
    );
    await traceAction('ui.day.load', () =>
      api.GET('/api/agenda/day', {
        params: { query: { date: '2099-10-29', timeZone: 'Europe/Madrid' } },
        headers: { cookie: '.Calendar.Session=secret', 'x-email': EMAIL },
      }),
    );

    await ended('PUT /api/events/{id}', 'GET /api/agenda/day');
    const exported = JSON.stringify(spans().map(describeSpan));
    for (const planted of [TITLE, LOCATION, NOTES, EMAIL, 'secret', 'Europe', '2099-10-29', '?']) {
      expect(exported).not.toContain(planted);
    }
    expect(named('GET /api/agenda/day')?.attributes).toEqual({
      'http.request.method': 'GET',
      'http.response.status_code': 500,
      'url.template': '/api/agenda/day',
      'error.type': '500',
    });
    expect(named('GET /api/agenda/day')?.resource.attributes['service.name']).toBe('calendar-web');
  });
});

describe('web telemetry when not configured', () => {
  it('runs the action directly and registers no tracer provider', async () => {
    const before = trace.getTracerProvider();
    let ran = false;

    const value = await traceAction('ui.event.update', (within) => {
      ran = within(() => true);
      return Promise.resolve(42);
    });

    expect(value).toBe(42);
    expect(ran).toBe(true);
    expect(trace.getTracer('calendar-web').startSpan('x').isRecording()).toBe(false);
    expect(trace.getTracerProvider()).toBe(before);
  });
});

/** Everything an exporter would send, as plain data. */
function describeSpan(span: ReadableSpan) {
  return {
    name: span.name,
    attributes: span.attributes,
    events: span.events,
    status: span.status,
    links: span.links,
    resource: span.resource.attributes,
  };
}
