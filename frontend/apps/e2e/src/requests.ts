import type { Page, Request } from '@playwright/test';

import { traceIdOf } from './telemetry/tempo.ts';

/**
 * Whether `url`'s path is `template`, a route template as the API's metrics and spans name it: each
 * `{name}` segment stands for one non-empty path segment (`/api/events/{id}` matches `/api/events/3f…`).
 */
export function matchesRoute(url: string, template: string): boolean {
  const path = new URL(url).pathname.split('/');
  const parts = template.split('/');
  return (
    path.length === parts.length &&
    parts.every((part, index) => {
      const segment = path[index] ?? '';
      return /^\{[^/{}]+\}$/.test(part) ? segment !== '' : segment === part;
    })
  );
}

/** A request the page sent, and the trace id of the user action it belongs to. */
export interface FlowRequest {
  readonly request: Request;
  readonly traceId: string;
}

/**
 * The page's next `method` request to the route `template`, with its trace id. Call it before the action
 * that sends the request, and await it after:
 *
 *     const saved = flowRequest(page, 'POST', '/api/events');
 *     await dialog.getByRole('button', { name: 'Save event' }).click();
 *     const { traceId } = await saved;
 */
export async function flowRequest(
  page: Page,
  method: string,
  template: string,
): Promise<FlowRequest> {
  const request = await page.waitForRequest(
    (candidate) => candidate.method() === method && matchesRoute(candidate.url(), template),
  );
  return { request, traceId: traceIdOf(await request.headerValue('traceparent')) };
}

/** Requests held by `holdRequests` until the test lets them go. */
export interface HeldRequests {
  /** How many matching requests are waiting. */
  readonly count: () => number;
  /** Sends every held request on, and every later one straight away. */
  release(): void;
}

/**
 * Holds the page's `method` requests to the route `template` until `release()`, to see the page's state
 * while they are in flight (an optimistic update, a pending control) or to send a burst together. A held
 * request goes on through the signed-in route (`route.fallback()`), so it reaches the API unchanged, with
 * the seed key and its `traceparent`.
 */
export async function holdRequests(
  page: Page,
  method: string,
  template: string,
): Promise<HeldRequests> {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let waiting = 0;
  await page.route(
    (url) => matchesRoute(url.href, template),
    async (route) => {
      if (route.request().method() === method) {
        waiting++;
        await gate;
        waiting--;
      }
      await route.fallback();
    },
  );
  return {
    count: () => waiting,
    release() {
      open();
    },
  };
}
