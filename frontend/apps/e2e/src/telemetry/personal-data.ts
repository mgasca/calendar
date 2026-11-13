import type { LogStream } from './loki.ts';
import type { FlatSpan } from './tempo.ts';

/**
 * The privacy check of ADR-0062: no email, title, location, notes, query value, cookie or token in any span,
 * log record or metric label. A test registers the values it seeded and the signed-in email; generic patterns
 * catch an email address or a token the test did not seed.
 */
export class PersonalData {
  readonly #values = new Map<string, string>();

  /** Registers `value` as personal data the telemetry must never carry, under a description for reports. */
  add(description: string, value: string): void {
    const trimmed = value.trim();
    if (trimmed.length > 0) this.#values.set(trimmed.toLowerCase(), description);
  }

  /** The registered values and their descriptions. */
  get values(): ReadonlyMap<string, string> {
    return this.#values;
  }
}

/** Shapes that are personal data or secrets whoever wrote them. */
const PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['an email address', /[\w.%+-]+@[\w-]+(\.[\w-]+)+/i],
  ['a JWT-shaped token', /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/],
  ['a cookie header', /\b(set-)?cookie\s*[:=]/i],
  ['a bearer token', /\bbearer\s+[\w.~+/-]{8,}/i],
];

/** One piece of exported text and where it came from. */
export interface Exported {
  readonly signal: 'span' | 'log' | 'metric';
  readonly where: string;
  readonly text: string;
}

/** A leak: where it was and what matched, never the value itself, so the report does not leak it again. */
export interface Finding {
  readonly signal: Exported['signal'];
  readonly where: string;
  readonly matched: string;
}

/** Every leak of `personalData` (or of a generic pattern) in `exported`. */
export function scan(exported: readonly Exported[], personalData: PersonalData): Finding[] {
  const findings: Finding[] = [];
  for (const item of exported) {
    const lower = item.text.toLowerCase();
    for (const [value, description] of personalData.values) {
      if (lower.includes(value))
        findings.push({ signal: item.signal, where: item.where, matched: description });
    }
    for (const [description, pattern] of PATTERNS) {
      if (pattern.test(item.text))
        findings.push({ signal: item.signal, where: item.where, matched: description });
    }
  }
  return findings;
}

/** Every string a trace exports: span names, attribute keys and values, resource attributes, events, status. */
export function fromSpans(spans: readonly FlatSpan[]): Exported[] {
  return spans.flatMap((span) => {
    const where = `${span.service} span '${span.name}'`;
    return [
      { signal: 'span' as const, where: `${where} name`, text: span.name },
      { signal: 'span' as const, where: `${where} status`, text: span.status },
      ...[...span.attributes, ...span.resource].map(([key, value]) => ({
        signal: 'span' as const,
        where: `${where} attribute ${key}`,
        text: `${key}=${value}`,
      })),
      ...span.events.flatMap((event) => [
        { signal: 'span' as const, where: `${where} event`, text: event.name },
        ...event.attributes.map(([key, value]) => ({
          signal: 'span' as const,
          where: `${where} event '${event.name}' attribute ${key}`,
          text: `${key}=${value}`,
        })),
      ]),
    ];
  });
}

/** Every line and label of the log streams. */
export function fromLogs(streams: readonly LogStream[]): Exported[] {
  return streams.flatMap((stream) => {
    const where = `log stream of ${stream.labels.service_name ?? 'unknown service'}`;
    return [
      ...Object.entries(stream.labels).map(([key, value]) => ({
        signal: 'log' as const,
        where: `${where} label ${key}`,
        text: `${key}=${value}`,
      })),
      ...stream.lines.map((line, index) => ({
        signal: 'log' as const,
        where: `${where} line ${String(index + 1)}`,
        text: line,
      })),
    ];
  });
}

/** Every label of the metric series. */
export function fromSeries(series: readonly Record<string, string>[]): Exported[] {
  return series.flatMap((labels) =>
    Object.entries(labels).map(([key, value]) => ({
      signal: 'metric' as const,
      where: `metric ${labels.__name__ ?? 'series'} label ${key}`,
      text: `${key}=${value}`,
    })),
  );
}

/** One line per finding, for an assertion message. */
export const report = (findings: readonly Finding[]) =>
  findings.map((finding) => `${finding.signal}: ${finding.matched} in ${finding.where}`).join('\n');
