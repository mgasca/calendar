/**
 * User-action spans for the architecture flows (ADR-0062, #732).
 *
 * This module is always in the bundle and imports no OpenTelemetry code. Until the telemetry chunk
 * (`sdk.ts`) registers a tracer, which happens only in a build with
 * `VITE_OTEL_TRACES_EXPORTER=otlp`, `traceAction` just runs its callback.
 */

/** The span names #733 queries in Tempo, one per user action of a flow (posted on #732). */
export const USER_ACTIONS = [
  'ui.day.load',
  'ui.week.load',
  'ui.event.create',
  'ui.event.open',
  'ui.event.update',
  'ui.event.delete',
  'ui.task.create',
  'ui.task.open',
  'ui.task.update',
  'ui.task.complete',
  'ui.task.reopen',
  'ui.triage.load',
  'ui.tasks.bulk',
] as const;

export type UserAction = (typeof USER_ACTIONS)[number];

/** Allow-listed action attributes; anything else is dropped before export (`attributes.ts`). */
export type ActionAttributes = Readonly<Record<string, string | number>>;

/**
 * Runs `fn` again inside the action, for API calls made after the action's first `await` (the
 * browser has no async context, so a later call would otherwise start a trace of its own).
 */
export type Within = <T>(fn: () => T) => T;

export interface ActionTracer {
  run<T>(
    name: UserAction,
    attributes: ActionAttributes,
    fn: (within: Within) => Promise<T>,
  ): Promise<T>;
}

const direct: Within = (fn) => fn();

let tracer: ActionTracer | undefined;

/** Called by the telemetry chunk when it starts, and with `undefined` when it stops. */
export function setActionTracer(next: ActionTracer | undefined): void {
  tracer = next;
}

/**
 * Wraps one user action in a span, so the API request it makes joins the action's trace. Make the
 * API call the callback's first `await`, or wrap a later one in `within`.
 */
export function traceAction<T>(
  name: UserAction,
  fn: (within: Within) => Promise<T>,
  attributes: ActionAttributes = {},
): Promise<T> {
  return tracer ? tracer.run(name, attributes, fn) : fn(direct);
}
