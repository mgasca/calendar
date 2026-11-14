import type { Stack } from '../stack.ts';
import { logsSince, waitForTraceLogs } from './loki.ts';
import type { PollOptions } from './poll.ts';
import {
  fromLogs,
  fromSeries,
  fromSpans,
  report,
  scan,
  type PersonalData,
} from './personal-data.ts';
import { requestCounts, seriesLabels, waitForRequestMetrics, type RouteHit } from './prometheus.ts';
import { findRootTrace, waitForTrace, type FlatSpan, type TraceExpectation } from './tempo.ts';

/** One user action's trace: the trace id the browser sent with its API call, and what the trace must hold. */
export interface ActionTrace extends TraceExpectation {
  /** The trace id the browser sent with the action's API call (`traceIdOf`, or `flowRequest`'s `traceId`). */
  readonly traceId: string;
  /**
   * Log messages that must be among the API's records carrying this trace id (`'Google sign-in failed'`, say);
   * any record will do when omitted.
   */
  readonly logs?: readonly string[];
}

/** What a flow test proves about its telemetry (ADR-0062, "End-to-end assertions"). */
export interface FlowTelemetry extends ActionTrace {
  /**
   * The flow's further user actions, one trace each (the browser starts a new trace per action): opening and
   * then saving a dialog, for example. Each gets the trace and logs assertions, and the scan covers its spans.
   */
  readonly traces?: readonly ActionTrace[];
  /** The routes the flow hit, whose request metrics must grow. */
  readonly routes: readonly RouteHit[];
  /** The request counts before the flow, from `observe.before(routes)`. */
  readonly before: readonly number[];
}

/** What the four assertions found, for a test that wants to check more. */
export interface ObservedFlow {
  /** The spans of the flow's first trace (`traceId`). */
  readonly spans: readonly FlatSpan[];
  /** The spans of each of `traces`, in the same order. */
  readonly traces: readonly (readonly FlatSpan[])[];
}

/**
 * The telemetry side of a flow test. `before` reads the request counts the flow will grow; `expectFlow` then
 * makes the four assertions: one trace per user action from the browser action down to the database, API log
 * records carrying each trace id, request count and duration metrics for the routes hit, and no personal data in any span, log
 * record or metric label exported since the test started.
 */
export class Observer {
  private readonly stack: Stack;
  private readonly personalData: PersonalData;
  private readonly since: Date;
  private readonly poll: PollOptions | undefined;

  /** `poll` overrides how long each signal is waited for (the helpers' own defaults when omitted). */
  constructor(stack: Stack, personalData: PersonalData, since: Date, poll?: PollOptions) {
    this.stack = stack;
    this.personalData = personalData;
    this.since = since;
    this.poll = poll;
  }

  before(routes: readonly RouteHit[]): Promise<number[]> {
    return requestCounts(this.stack.prometheusUrl, routes);
  }

  async expectFlow(flow: FlowTelemetry): Promise<ObservedFlow> {
    const actions = [flow, ...(flow.traces ?? [])];
    const traces: FlatSpan[][] = [];
    for (const action of actions) {
      traces.push(await waitForTrace(this.stack.tempoUrl, action.traceId, action, this.poll));
      await waitForTraceLogs(
        this.stack.lokiUrl,
        action.traceId,
        this.since,
        this.poll,
        action.logs,
      );
    }
    const [spans = [], ...rest] = traces;
    await waitForRequestMetrics(this.stack.prometheusUrl, flow.routes, flow.before, this.poll);
    const [logs, series] = await Promise.all([
      logsSince(this.stack.lokiUrl, this.since),
      seriesLabels(this.stack.prometheusUrl, this.since),
    ]);
    const findings = scan(
      [...traces.flatMap((trace) => fromSpans(trace)), ...fromLogs(logs), ...fromSeries(series)],
      this.personalData,
    );
    if (findings.length > 0) {
      throw new Error(`Personal data in the flow's telemetry:\n${report(findings)}`);
    }
    return { spans, traces: rest };
  }

  /**
   * The trace a full-page navigation to an API route started, found by its root server span `name`
   * (`findRootTrace`): the sign-in redirects carry no `traceparent`, so the API starts their traces.
   */
  rootTrace(name: string): Promise<string> {
    return findRootTrace(this.stack.tempoUrl, name, this.since, this.poll);
  }
}
