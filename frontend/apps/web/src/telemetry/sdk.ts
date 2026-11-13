/**
 * The web app's OpenTelemetry setup (ADR-0062, #732). Loaded by `main.tsx` only in a build with
 * `VITE_OTEL_TRACES_EXPORTER=otlp`; otherwise this chunk is not emitted at all.
 *
 * - User-action spans come from `traceAction` (`action.ts`), which this module backs.
 * - The fetch instrumentation adds a span and a W3C `traceparent` to same-origin `/api` requests
 *   only, and names the span `<METHOD> <route template>` like the API's server span (#731).
 * - Spans leave through the same-origin `/otlp` path, which `vite dev` and `vite preview` forward
 *   to the collector (`dev/otlpProxy.ts`); every span is reduced to the allow-list first.
 */
import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  StackContextManager,
  TracerProvider,
  type SpanExporter,
} from '@opentelemetry/sdk-trace';

import { setActionTracer, type ActionTracer } from './action.ts';
import { AllowListSpanExporter } from './allowListExporter.ts';
import { routeTemplate } from './attributes.ts';

export const SERVICE_NAME = 'calendar-web';

/** The same-origin path the exporter posts to; the Vite proxy forwards it as `/v1/traces`. */
export const OTLP_TRACES_PATH = '/otlp/v1/traces';

export interface TelemetryOptions {
  /** The page origin; `/api` and `/otlp` are resolved against it. */
  origin?: string;
  /** Replaces the OTLP exporter, and exports each span as it ends (tests). */
  exporter?: SpanExporter;
}

export interface Telemetry {
  /** Exports what is pending, then removes every global this module registered. */
  stop(): Promise<void>;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function startTelemetry({
  origin = window.location.origin,
  exporter,
}: TelemetryOptions = {}): Telemetry {
  const filtered = new AllowListSpanExporter(
    exporter ?? new OTLPTraceExporter({ url: new URL(OTLP_TRACES_PATH, origin).href }),
  );
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': SERVICE_NAME }),
    spanProcessors: [
      exporter
        ? new SimpleSpanProcessor({ exporter: filtered })
        : new BatchSpanProcessor({ exporter: filtered, scheduledDelayMillis: 1000 }),
    ],
  });

  context.setGlobalContextManager(new StackContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);

  // Deprecated upstream in favour of the experimental `@opentelemetry/browser-instrumentation`
  // (0.x, different telemetry). ADR-0062 names this package; the move is #768.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see the comment above
  const instrumentation = new FetchInstrumentation({
    // Only same-origin `/api` requests get a span and a `traceparent`: not `/otlp`, fonts or any
    // other origin. No cross-origin URL is listed for propagation.
    ignoreUrls: [new RegExp(`^(?!${escapeRegExp(origin)}/api/)`)],
    ignoreNetworkEvents: true,
    requestHook: (span, request) => {
      if (!(request instanceof Request)) return;
      const template = routeTemplate(request.url);
      if (!template) return;
      span.updateName(`${request.method.toUpperCase()} ${template}`);
      span.setAttribute('url.template', template);
    },
  });
  instrumentation.setTracerProvider(provider);

  const tracer = provider.getTracer(SERVICE_NAME);
  const actions: ActionTracer = {
    run: (name, attributes, fn) =>
      tracer.startActiveSpan(name, { attributes }, async (span) => {
        const active = context.active();
        try {
          return await fn((call) => context.with(active, call));
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute('error.type', error instanceof Error ? error.name : '_OTHER');
          throw error;
        } finally {
          span.end();
        }
      }),
  };
  setActionTracer(actions);

  return {
    async stop() {
      setActionTracer(undefined);
      instrumentation.disable();
      await provider.shutdown();
      trace.disable();
      propagation.disable();
      context.disable();
    },
  };
}
