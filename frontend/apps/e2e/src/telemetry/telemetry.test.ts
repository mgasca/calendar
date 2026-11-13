import { describe, expect, it } from 'vitest';

import { streamsOf } from './loki.ts';
import { PersonalData, fromLogs, fromSeries, fromSpans, report, scan } from './personal-data.ts';
import { api, flattenTrace, traceIdOf, traceProblems, web } from './tempo.ts';

const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');
const attribute = (key: string, value: string | number) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
});

/** A view-today trace in the shape Tempo's `GET /api/v2/traces/<id>` returns (ids in base64). */
function dayTrace(extra: { attributes?: ReturnType<typeof attribute>[] } = {}) {
  const span = (
    id: string,
    parent: string,
    name: string,
    kind: string,
    attributes: ReturnType<typeof attribute>[] = [],
  ) => ({
    spanId: b64(id),
    ...(parent && { parentSpanId: b64(parent) }),
    name,
    kind,
    attributes,
  });
  return {
    trace: {
      resourceSpans: [
        {
          resource: { attributes: [attribute('service.name', 'calendar-web')] },
          scopeSpans: [
            {
              spans: [
                span('00000000000000a1', '', 'ui.day.load', 'SPAN_KIND_INTERNAL'),
                span(
                  '00000000000000a2',
                  '00000000000000a1',
                  'GET /api/agenda/day',
                  'SPAN_KIND_CLIENT',
                  [attribute('url.template', '/api/agenda/day')],
                ),
              ],
            },
          ],
        },
        {
          resource: { attributes: [attribute('service.name', 'calendar-api')] },
          scopeSpans: [
            {
              spans: [
                span(
                  '00000000000000b1',
                  '00000000000000a2',
                  'GET /api/agenda/day',
                  'SPAN_KIND_SERVER',
                  [
                    attribute('http.route', '/api/agenda/day'),
                    attribute('http.response.status_code', 200),
                    ...(extra.attributes ?? []),
                  ],
                ),
                span('00000000000000b2', '00000000000000b1', 'SELECT events', 'SPAN_KIND_CLIENT', [
                  attribute(
                    'db.query.text',
                    'SELECT "events"."id" FROM "events" WHERE "events"."owner_id" = $1',
                  ),
                ]),
                span('00000000000000b3', '00000000000000b1', 'SELECT tasks', 'SPAN_KIND_CLIENT'),
              ],
            },
          ],
        },
      ],
    },
  };
}

const viewToday = {
  chain: [
    web('ui.day.load'),
    web('GET /api/agenda/day'),
    api('GET /api/agenda/day'),
    api('SELECT events'),
  ],
  spans: [api('SELECT tasks')],
};

describe('traceIdOf', () => {
  it('reads the trace id of a W3C traceparent', () => {
    expect(traceIdOf('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
  });

  it('refuses a missing or malformed header', () => {
    expect(() => traceIdOf(null)).toThrow(/no valid traceparent/);
    expect(() => traceIdOf('00-xyz-00f067aa0ba902b7-01')).toThrow(/no valid traceparent/);
  });
});

describe('the trace assertion', () => {
  it('accepts a trace from the browser action down to the database', () => {
    const spans = flattenTrace(dayTrace());
    expect(
      spans.map((span) => [span.service, span.name, span.spanId, span.parentSpanId]),
    ).toContainEqual([
      'calendar-api',
      'GET /api/agenda/day',
      '00000000000000b1',
      '00000000000000a2',
    ]);
    expect(traceProblems(spans, viewToday)).toEqual([]);
  });

  it('names a missing span', () => {
    const spans = flattenTrace(dayTrace()).filter((span) => span.name !== 'SELECT tasks');
    expect(traceProblems(spans, viewToday)).toEqual(["no span calendar-api 'SELECT tasks'"]);
  });

  it('fails when the API span is not under the browser span (two traces glued by name)', () => {
    const spans = flattenTrace(dayTrace()).map((span) =>
      span.service === 'calendar-api' && span.kind === 'SPAN_KIND_SERVER'
        ? { ...span, parentSpanId: 'ffffffffffffffff' }
        : span,
    );
    expect(traceProblems(spans, viewToday)).toEqual([
      "no span calendar-api 'GET /api/agenda/day' under calendar-web 'GET /api/agenda/day'",
    ]);
  });
});

describe('the personal-data scanner', () => {
  const personalData = new PersonalData();
  personalData.add('a seeded event title', 'Dentist with Ana · e2e-1234abcd');
  personalData.add('the signed-in email', 'e2e-user@example.com');
  personalData.add('the agenda date', '2026-03-14');

  const lokiAnswer = (line: string, labels: Record<string, string> = {}) => ({
    status: 'success',
    data: {
      resultType: 'streams',
      result: [
        {
          stream: {
            service_name: 'calendar-api',
            severity_text: 'INFO',
            trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
            ...labels,
          },
          values: [['1794597571506415931', line]],
        },
      ],
    },
  });
  const series = (labels: Record<string, string> = {}) => [
    {
      __name__: 'http_server_request_duration_seconds_count',
      http_request_method: 'GET',
      http_route: '/api/agenda/day',
      http_response_status_code: '200',
      job: 'calendar-api',
      ...labels,
    },
  ];
  const clean = () => [
    ...fromSpans(flattenTrace(dayTrace())),
    ...fromLogs(streamsOf(lokiAnswer('request finished'))),
    ...fromSeries(series()),
  ];

  it('passes clean telemetry', () => {
    expect(scan(clean(), personalData)).toEqual([]);
  });

  it('fails on a seeded title in a span attribute, without repeating the value', () => {
    const spans = fromSpans(
      flattenTrace(
        dayTrace({ attributes: [attribute('app.title', 'dentist with ana · E2E-1234ABCD')] }),
      ),
    );
    const findings = scan(spans, personalData);
    expect(findings).toEqual([
      {
        signal: 'span',
        where: "calendar-api span 'GET /api/agenda/day' attribute app.title",
        matched: 'a seeded event title',
      },
    ]);
    expect(report(findings)).not.toContain('Dentist');
  });

  it('fails on the email in a log line and on an email nobody seeded in a log label', () => {
    expect(
      scan(fromLogs(streamsOf(lokiAnswer('signed in as e2e-user@example.com'))), personalData),
    ).toEqual([
      { signal: 'log', where: 'log stream of calendar-api line 1', matched: 'the signed-in email' },
      { signal: 'log', where: 'log stream of calendar-api line 1', matched: 'an email address' },
    ]);
    expect(
      scan(
        fromLogs(streamsOf(lokiAnswer('request finished', { user: 'ana@example.org' }))),
        personalData,
      ),
    ).toEqual([
      {
        signal: 'log',
        where: 'log stream of calendar-api label user',
        matched: 'an email address',
      },
    ]);
  });

  it('fails on a query value in a metric label', () => {
    expect(scan(fromSeries(series({ url_query: 'date=2026-03-14' })), personalData)).toEqual([
      {
        signal: 'metric',
        where: 'metric http_server_request_duration_seconds_count label url_query',
        matched: 'the agenda date',
      },
    ]);
  });

  it('fails on a token or a cookie header whoever wrote it', () => {
    const exported = [
      { signal: 'span' as const, where: 'a', text: 'authorization=Bearer abcdefgh12345678' },
      {
        signal: 'log' as const,
        where: 'b',
        text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl',
      },
      { signal: 'log' as const, where: 'c', text: 'Cookie: calendar.session=abc' },
    ];
    expect(scan(exported, new PersonalData()).map((finding) => finding.matched)).toEqual([
      'a bearer token',
      'a JWT-shaped token',
      'a cookie header',
    ]);
  });
});
