import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

import { allowAttributes, allowSpanName } from './attributes.ts';

/**
 * Hands the wrapped exporter a copy of each span that holds only allow-listed names and
 * attributes (`attributes.ts`). Span events keep only listed names and attributes;
 * status messages and links are dropped. The resource is set by `sdk.ts` and passes as it is.
 */
export class AllowListSpanExporter implements SpanExporter {
  readonly #inner: SpanExporter;

  constructor(inner: SpanExporter) {
    this.#inner = inner;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.#inner.export(spans.map(redactSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush?.() ?? Promise.resolve();
  }
}

export function redactSpan(span: ReadableSpan): ReadableSpan {
  const spanContext = span.spanContext();
  return {
    name: allowSpanName(span.name),
    kind: span.kind,
    spanContext: () => spanContext,
    ...(span.parentSpanContext && { parentSpanContext: span.parentSpanContext }),
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes: allowAttributes(span.attributes),
    links: [],
    events: span.events.map((event) => ({
      name: allowEventName(event.name),
      time: event.time,
      attributes: allowAttributes(event.attributes ?? {}),
      droppedAttributesCount: 0,
    })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: 0,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.links.length + span.droppedLinksCount,
  };
}

/** The SDK's exception event; network-timing events are off (`ignoreNetworkEvents`). */
const EVENT_NAMES = new Set(['exception']);

const allowEventName = (name: string) => (EVENT_NAMES.has(name) ? name : 'event');
