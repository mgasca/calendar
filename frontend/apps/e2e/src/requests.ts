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
