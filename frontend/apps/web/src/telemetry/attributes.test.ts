import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';

import { USER_ACTIONS } from './action.ts';
import { redactSpan } from './allowListExporter.ts';
import { allowAttributes, allowSpanName, routeTemplate } from './attributes.ts';

const EMAIL = 'planted.person@example.com';
const TITLE = 'Dentist with Dr Planted';
const NOTES = 'planted-notes: bring the insurance card';
const COOKIE = '.Calendar.Session=CfDJ8planted';
const ID = '0b5c7d1e-3f4a-4b6c-8d9e-0f1a2b3c4d5e';

describe('allowAttributes', () => {
  it('keeps the allow-listed keys with well-formed values', () => {
    const allowed = {
      'http.request.method': 'PUT',
      'http.response.status_code': 409,
      'url.template': '/api/tasks/{id}/complete',
      'error.type': '409',
      'app.bulk.action': 'setDueDate',
      'app.bulk.batches': 2,
    };
    expect(allowAttributes(allowed)).toEqual(allowed);
  });

  it('drops every other key, whatever it holds', () => {
    expect(
      allowAttributes({
        'url.full': `http://localhost/api/agenda/day?date=2026-11-13&timeZone=Europe%2FMadrid`,
        'http.url': '/api/tasks?view=overdue',
        'server.address': 'localhost',
        'user_agent.original': 'Mozilla/5.0',
        'enduser.id': EMAIL,
        'http.request.header.cookie': COOKIE,
        'event.title': TITLE,
        notes: NOTES,
        'http.request.body.size': 120,
      }),
    ).toEqual({});
  });

  it.each([
    ['http.request.method', EMAIL],
    ['http.request.method', 'get'],
    ['http.response.status_code', 600],
    ['http.response.status_code', '200'],
    ['url.template', `/api/events/${ID}`],
    ['url.template', '/api/agenda/day?date=2026-11-13'],
    ['url.template', `/api/users/${EMAIL}`],
    ['url.template', 'http://localhost/api/events'],
    ['error.type', TITLE],
    ['error.type', `Error: ${NOTES}`],
    ['error.type', 'Dentist'],
    ['app.bulk.action', 'rename'],
    ['app.bulk.batches', 1.5],
    ['app.bulk.batches', [1, 2]],
  ])('drops %s when it holds %j', (key, value) => {
    expect(allowAttributes({ [key]: value })).toEqual({});
  });

  it('ignores keys inherited from the prototype', () => {
    expect(allowAttributes({ toString: 'x', constructor: 'y' })).toEqual({});
  });
});

describe('allowSpanName', () => {
  it.each([...USER_ACTIONS, 'GET', 'PUT /api/events/{id}', 'POST /api/tasks/bulk'])(
    'keeps %s',
    (name) => {
      expect(allowSpanName(name)).toBe(name);
    },
  );

  it.each([TITLE, EMAIL, `GET /api/events/${ID}`, 'GET /api/tasks?view=overdue', 'ui.other'])(
    'replaces %s',
    (name) => {
      expect(allowSpanName(name)).toBe('redacted');
    },
  );
});

describe('routeTemplate', () => {
  it.each([
    ['http://localhost/api/agenda/day?date=2026-11-13&timeZone=Europe%2FMadrid', '/api/agenda/day'],
    [`http://localhost/api/events/${ID}`, '/api/events/{id}'],
    [`http://localhost/api/tasks/${ID.toUpperCase()}/complete`, '/api/tasks/{id}/complete'],
    ['http://localhost/api/tasks/bulk', '/api/tasks/bulk'],
  ])('turns %s into %s', (url, template) => {
    expect(routeTemplate(url)).toBe(template);
  });

  it.each([
    'http://localhost/otlp/v1/traces',
    `http://localhost/api/users/${encodeURIComponent(EMAIL)}`,
    'http://localhost/api/events/e1',
    'not a url',
  ])('has no template for %s', (url) => {
    expect(routeTemplate(url)).toBeUndefined();
  });
});

describe('redactSpan', () => {
  const span: ReadableSpan = {
    name: TITLE,
    kind: SpanKind.CLIENT,
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }),
    parentSpanContext: { traceId: 'a'.repeat(32), spanId: 'c'.repeat(16), traceFlags: 1 },
    startTime: [1, 0],
    endTime: [2, 0],
    status: { code: SpanStatusCode.ERROR, message: `Couldn’t save ${TITLE}` },
    attributes: { 'http.request.method': 'POST', 'url.full': `http://x/api?email=${EMAIL}` },
    links: [
      {
        context: { traceId: 'd'.repeat(32), spanId: 'e'.repeat(16), traceFlags: 1 },
        attributes: { notes: NOTES },
      },
    ],
    events: [
      {
        name: 'exception',
        time: [1, 5],
        attributes: { 'exception.message': NOTES, 'error.type': 'TypeError' },
      },
      { name: EMAIL, time: [1, 6] },
    ],
    duration: [1, 0],
    ended: true,
    resource: resourceFromAttributes({ 'service.name': 'calendar-web' }),
    instrumentationScope: { name: 'calendar-web' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };

  it('keeps the trace identity and timing', () => {
    const redacted = redactSpan(span);
    expect(redacted.spanContext()).toEqual(span.spanContext());
    expect(redacted.parentSpanContext).toEqual(span.parentSpanContext);
    expect([redacted.startTime, redacted.endTime, redacted.kind]).toEqual([
      span.startTime,
      span.endTime,
      span.kind,
    ]);
    expect(redacted.status).toEqual({ code: SpanStatusCode.ERROR });
  });

  it('carries no planted value in its name, attributes, status, events or links', () => {
    const redacted = redactSpan(span);
    const exported = JSON.stringify({
      name: redacted.name,
      attributes: redacted.attributes,
      status: redacted.status,
      events: redacted.events,
      links: redacted.links,
    });
    for (const planted of [TITLE, EMAIL, NOTES]) expect(exported).not.toContain(planted);
    expect(redacted.attributes).toEqual({ 'http.request.method': 'POST' });
    expect(redacted.events.map((event) => [event.name, event.attributes])).toEqual([
      ['exception', { 'error.type': 'TypeError' }],
      ['event', {}],
    ]);
    expect(redacted.droppedLinksCount).toBe(1);
  });
});
