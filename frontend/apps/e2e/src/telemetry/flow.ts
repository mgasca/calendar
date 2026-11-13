import type { Stack } from '../stack.ts';
import { logsSince, waitForTraceLogs } from './loki.ts';
import {
  fromLogs,
  fromSeries,
  fromSpans,
  report,
  scan,
  type PersonalData,
} from './personal-data.ts';
import { requestCounts, seriesLabels, waitForRequestMetrics, type RouteHit } from './prometheus.ts';
import { waitForTrace, type FlatSpan, type TraceExpectation } from './tempo.ts';

/** What a flow test proves about its telemetry (ADR-0062, "End-to-end assertions"). */
export interface FlowTelemetry extends TraceExpectation {
  /** The trace id the browser sent with the flow's API call (`traceIdOf`). */
  readonly traceId: string;
  /** The routes the flow hit, whose request metrics must grow. */
  readonly routes: readonly RouteHit[];
  /** The request counts before the flow, from `observe.before(routes)`. */
  readonly before: readonly number[];
}

/** What the four assertions found, for a test that wants to check more. */
export interface ObservedFlow {
  readonly spans: readonly FlatSpan[];
}

/**
 * The telemetry side of a flow test. `before` reads the request counts the flow will grow; `expectFlow` then
 * makes the four assertions: one trace from the browser action down to the database, API log records carrying
 * that trace id, request count and duration metrics for the routes hit, and no personal data in any span, log
 * record or metric label exported since the test started.
 */
export class Observer {
  private readonly stack: Stack;
  private readonly personalData: PersonalData;
  private readonly since: Date;

  constructor(stack: Stack, personalData: PersonalData, since: Date) {
    this.stack = stack;
    this.personalData = personalData;
    this.since = since;
  }

  before(routes: readonly RouteHit[]): Promise<number[]> {
    return requestCounts(this.stack.prometheusUrl, routes);
  }

  async expectFlow(flow: FlowTelemetry): Promise<ObservedFlow> {
    const spans = await waitForTrace(this.stack.tempoUrl, flow.traceId, flow);
    await waitForTraceLogs(this.stack.lokiUrl, flow.traceId, this.since);
    await waitForRequestMetrics(this.stack.prometheusUrl, flow.routes, flow.before);
    const [logs, series] = await Promise.all([
      logsSince(this.stack.lokiUrl, this.since),
      seriesLabels(this.stack.prometheusUrl, this.since),
    ]);
    const findings = scan(
      [...fromSpans(spans), ...fromLogs(logs), ...fromSeries(series)],
      this.personalData,
    );
    if (findings.length > 0) {
      throw new Error(`Personal data in the flow's telemetry:\n${report(findings)}`);
    }
    return { spans };
  }
}
